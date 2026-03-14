"""
Audio capture backend.

Windows system audio (loopback): uses `soundcard` (WASAPI native, no extra drivers).
Microphone input: uses `sounddevice` (PortAudio).

Device ID scheme (all integers, frontend-compatible):
  0 – 9 999   : sounddevice microphone devices
  20 000+N    : soundcard WASAPI loopback speakers (N = index in speaker list)
"""
import numpy as np
import threading
import platform
import queue
import time
from typing import Callable, Optional

import sounddevice as sd

# Windows WDM-KS devices crash PortAudio with -9999; exclude them entirely
_WDM_KS_API = "Windows WDM-KS"

# ---------------------------------------------------------------------------
# soundcard (Windows WASAPI loopback) – optional
# ---------------------------------------------------------------------------
try:
    import soundcard as _sc
    _HAS_SC = True
except Exception:
    _HAS_SC = False

# Stable mapping: integer device_id (20000+N) -> soundcard speaker GUID
# Populated by list_devices(); used by start() to find the right device.
_SC_ID_BASE = 20000
_SC_ID_MAP: dict[int, str] = {}   # id -> speaker.id (GUID)


def _is_sc_id(device_id) -> bool:
    try:
        return int(device_id) >= _SC_ID_BASE
    except (TypeError, ValueError):
        return False


def _get_sc_loopback_devices() -> list[dict]:
    """Return soundcard-based WASAPI loopback device entries."""
    if not _HAS_SC:
        return []
    result = []
    _SC_ID_MAP.clear()
    try:
        default_id = _sc.default_speaker().id
        speakers = _sc.all_speakers()
        for n, spk in enumerate(speakers):
            dev_id = _SC_ID_BASE + n
            _SC_ID_MAP[dev_id] = spk.id
            is_default = (spk.id == default_id)
            label = ("★ " if is_default else "") + spk.name + " (系统音频)"
            result.append({
                "id": dev_id,
                "name": label,
                "channels": getattr(spk, "channels", 2),
                "sample_rate": 16000,
                "is_loopback": True,
                "category": "system_audio",
                "host_api": "WASAPI (soundcard)",
                "is_default_output": is_default,
            })
    except Exception:
        pass
    # default output first
    result.sort(key=lambda d: (0 if d.get("is_default_output") else 1, d["name"]))
    return result


# ---------------------------------------------------------------------------
# Resampling helpers (pure numpy – needed for sounddevice mics at 44100/48000)
# ---------------------------------------------------------------------------

def _make_lowpass_fir(cutoff_norm: float, num_taps: int = 63) -> np.ndarray:
    n = np.arange(num_taps) - (num_taps - 1) / 2
    h = 2.0 * cutoff_norm * np.sinc(2.0 * cutoff_norm * n)
    h *= np.blackman(num_taps)
    h /= h.sum()
    return h.astype(np.float32)


_FIR_DECIMATE_3X: np.ndarray = _make_lowpass_fir(7500 / 48000, 63)


def _resample_chunk(audio: np.ndarray, native_sr: int, target_sr: int,
                    state_holder: list) -> np.ndarray:
    if native_sr == target_sr:
        return audio
    if native_sr == 48000 and target_sr == 16000:
        fir = _FIR_DECIMATE_3X
        n_overlap = len(fir) - 1
        if state_holder[0] is None:
            state_holder[0] = np.zeros(n_overlap, dtype=np.float32)
        x = np.concatenate([state_holder[0], audio])
        filtered = np.convolve(x, fir, mode="valid")
        state_holder[0] = x[-n_overlap:]
        return filtered[::3].astype(np.float32)
    ratio = target_sr / native_sr
    new_len = max(1, int(len(audio) * ratio))
    return np.interp(np.linspace(0, len(audio) - 1, new_len),
                     np.arange(len(audio)), audio).astype(np.float32)


# ---------------------------------------------------------------------------
# AudioCapture
# ---------------------------------------------------------------------------

class AudioCapture:
    """Cross-platform audio capture.

    On Windows, loopback (system audio) uses soundcard/WASAPI directly.
    Microphone input uses sounddevice on all platforms.
    """

    SAMPLE_RATE = 16000
    CHANNELS = 1
    BLOCK_SIZE = 1024
    DTYPE = "float32"

    # AGC constants
    AGC_NOISE_GATE = 0.003
    AGC_TARGET     = 0.25
    AGC_MAX_GAIN   = 10.0
    AGC_RELEASE    = 0.995

    def __init__(self):
        self._stream: Optional[sd.InputStream] = None
        self._running = False
        self._audio_queue: queue.Queue[np.ndarray] = queue.Queue()
        self._callback: Optional[Callable[[np.ndarray], None]] = None
        self._lock = threading.Lock()
        # soundcard thread
        self._sc_stop = threading.Event()
        self._sc_thread: Optional[threading.Thread] = None
        # resampling state for sounddevice path
        self._resample_state: list = [None]
        # AGC state
        self._agc_peak: float = 0.0
        self._use_agc: bool = False

    # ------------------------------------------------------------------
    # Device listing
    # ------------------------------------------------------------------

    @staticmethod
    def list_devices() -> list[dict]:
        devices = sd.query_devices()
        result = []
        system = platform.system()

        for i, dev in enumerate(devices):
            if dev["max_input_channels"] > 0:
                name: str = dev["name"]
                host_api = sd.query_hostapis(dev["hostapi"])["name"]
                # WDM-KS crashes PortAudio on Windows
                if system == "Windows" and host_api == _WDM_KS_API:
                    continue
                is_loopback = False
                category = "microphone"
                if system == "Darwin":
                    lower = name.lower()
                    if "blackhole" in lower or "soundflower" in lower or "loopback" in lower:
                        is_loopback = True
                        category = "system_audio"
                elif system == "Windows":
                    lower = name.lower()
                    if ("loopback" in lower or "stereo mix" in lower
                            or "立体声混音" in lower or "what u hear" in lower):
                        is_loopback = True
                        category = "system_audio"
                result.append({
                    "id": i,
                    "name": name,
                    "channels": dev["max_input_channels"],
                    "sample_rate": dev["default_samplerate"],
                    "is_loopback": is_loopback,
                    "category": category,
                    "host_api": host_api,
                })

        # Windows: add soundcard WASAPI loopback entries (preferred)
        if system == "Windows":
            sc_devs = _get_sc_loopback_devices()
            result = sc_devs + [d for d in result if not d["is_loopback"]]

        result.sort(key=lambda d: (0 if d["is_loopback"] else 1, d["name"]))
        return result

    @staticmethod
    def get_platform_info() -> dict:
        system = platform.system()
        info = {
            "platform": system,
            "needs_virtual_device": False,
            "instructions": "",
            "has_loopback": False,
        }
        if system == "Darwin":
            devices = AudioCapture.list_devices()
            has_loopback = any(d["is_loopback"] for d in devices)
            info["has_loopback"] = has_loopback
            if not has_loopback:
                info["needs_virtual_device"] = True
                info["instructions"] = (
                    "⚠️ 未检测到系统音频捕获设备！\n\n"
                    "请安装 BlackHole 虚拟音频设备：\n"
                    "  brew install blackhole-2ch\n"
                    "然后在「音频 MIDI 设置」中创建多输出设备。"
                )
        elif system == "Windows":
            devices = AudioCapture.list_devices()
            has_loopback = any(d["is_loopback"] for d in devices)
            info["has_loopback"] = has_loopback
            if not has_loopback:
                info["needs_virtual_device"] = True
                info["instructions"] = (
                    "⚠️ 未检测到系统音频输出设备！\n\n"
                    "请安装 soundcard：\n"
                    "  pip install soundcard"
                )
        return info

    # ------------------------------------------------------------------
    # AGC
    # ------------------------------------------------------------------

    def _apply_agc(self, audio: np.ndarray) -> np.ndarray:
        rms = float(np.sqrt(np.mean(audio ** 2))) if len(audio) else 0.0
        self._agc_peak = max(self._agc_peak * self.AGC_RELEASE, rms)
        if self._agc_peak > self.AGC_NOISE_GATE:
            gain = min(self.AGC_TARGET / self._agc_peak, self.AGC_MAX_GAIN)
            return np.clip(audio * gain, -1.0, 1.0).astype(np.float32)
        return audio

    # ------------------------------------------------------------------
    # Start / Stop
    # ------------------------------------------------------------------

    def start(self, device_id, on_audio: Optional[Callable[[np.ndarray], None]] = None):
        with self._lock:
            if self._running:
                return
            self._callback = on_audio
            self._running = True
            self._audio_queue = queue.Queue()
            self._resample_state = [None]
            self._agc_peak = 0.0
            self._sc_stop.clear()

            if _is_sc_id(device_id):
                self._use_agc = True
                self._start_soundcard(int(device_id))
            else:
                self._use_agc = False
                self._start_sounddevice(int(device_id))

    def _push(self, audio: np.ndarray):
        """Common path: optionally AGC → queue → callback."""
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)
        if self._use_agc:
            audio = self._apply_agc(audio)
        self._audio_queue.put(audio)
        if self._callback:
            self._callback(audio)

    # soundcard path -------------------------------------------------------

    def _start_soundcard(self, device_id: int):
        speaker_guid = _SC_ID_MAP.get(device_id)
        if speaker_guid is None:
            # Map may have been rebuilt; try refreshing
            _get_sc_loopback_devices()
            speaker_guid = _SC_ID_MAP.get(device_id)
        if speaker_guid is None:
            self._running = False
            raise RuntimeError(f"找不到系统音频设备 ID={device_id}，请刷新页面重新选择设备")

        stop_event = self._sc_stop

        def _reader():
            try:
                # soundcard uses COM on Windows; must init COM in each new thread
                import ctypes
                try:
                    ctypes.windll.ole32.CoInitializeEx(0, 0)
                except Exception:
                    pass

                mic = _sc.get_microphone(speaker_guid, include_loopback=True)
                print(f"[AudioCapture] soundcard loopback opened: {mic.name}", flush=True)
                with mic.recorder(samplerate=self.SAMPLE_RATE,
                                  channels=1,
                                  blocksize=self.BLOCK_SIZE) as rec:
                    while not stop_event.is_set() and self._running:
                        data = rec.record(numframes=self.BLOCK_SIZE)
                        self._push(data[:, 0].copy())
            except Exception as e:
                import traceback
                print(f"[AudioCapture] soundcard error: {e}", flush=True)
                traceback.print_exc()
                self._running = False
            finally:
                try:
                    ctypes.windll.ole32.CoUninitialize()
                except Exception:
                    pass

        self._sc_thread = threading.Thread(target=_reader, daemon=True)
        self._sc_thread.start()

    # sounddevice (mic) path -----------------------------------------------

    def _start_sounddevice(self, device_id: int):
        def audio_cb(indata, frames, time_info, status):
            audio = indata[:, 0].copy() if indata.ndim > 1 else indata.copy().flatten()
            native_sr = getattr(self, '_native_sr', self.SAMPLE_RATE)
            audio = _resample_chunk(audio, native_sr, self.SAMPLE_RATE, self._resample_state)
            self._push(audio)

        try:
            dev_info = sd.query_devices(device_id)
            native_sr = int(dev_info["default_samplerate"])
            self._native_sr = native_sr
            use_sr = self.SAMPLE_RATE if native_sr == self.SAMPLE_RATE else native_sr
            self._stream = sd.InputStream(
                device=device_id,
                samplerate=use_sr,
                channels=self.CHANNELS,
                dtype=self.DTYPE,
                blocksize=self.BLOCK_SIZE,
                callback=audio_cb,
            )
            self._stream.start()
        except Exception as e:
            self._running = False
            raise RuntimeError(f"无法启动麦克风: {e}")

    def stop(self):
        with self._lock:
            self._running = False
            self._sc_stop.set()
            if self._stream:
                try:
                    self._stream.stop()
                    self._stream.close()
                except Exception:
                    pass
                self._stream = None
            if self._sc_thread and self._sc_thread.is_alive():
                self._sc_thread.join(timeout=1.0)
            self._sc_thread = None

    def get_audio_chunk(self, timeout: float = 0.1) -> Optional[np.ndarray]:
        chunks = []
        try:
            while True:
                chunks.append(self._audio_queue.get_nowait())
        except queue.Empty:
            pass
        return np.concatenate(chunks) if chunks else None

    @property
    def is_running(self) -> bool:
        return self._running

    @staticmethod
    def compute_energy(audio: np.ndarray) -> float:
        return float(np.sqrt(np.mean(audio ** 2)))


# ---------------------------------------------------------------------------
# VADBuffer
# ---------------------------------------------------------------------------

class VADBuffer:
    """Voice Activity Detection: accumulate speech, trigger after silence."""

    def __init__(self, sample_rate: int = 16000, silence_threshold: float = 0.01,
                 silence_duration: float = 2.5, min_speech_duration: float = 0.5):
        self.sample_rate = sample_rate
        self.silence_threshold = silence_threshold
        self.silence_duration = silence_duration
        self.min_speech_duration = min_speech_duration
        self._buffer: list[np.ndarray] = []
        self._speech_started = False
        self._silence_start: Optional[float] = None
        self._speech_start: Optional[float] = None

    def feed(self, audio: np.ndarray) -> Optional[np.ndarray]:
        energy = float(np.sqrt(np.mean(audio ** 2)))
        now = time.time()
        if energy > self.silence_threshold:
            if not self._speech_started:
                self._speech_started = True
                self._speech_start = now
            self._silence_start = None
            self._buffer.append(audio)
            return None
        if self._speech_started:
            self._buffer.append(audio)
            if self._silence_start is None:
                self._silence_start = now
            elif now - self._silence_start >= self.silence_duration:
                speech_duration = now - (self._speech_start or now)
                if speech_duration >= self.min_speech_duration and self._buffer:
                    result = np.concatenate(self._buffer)
                    self._reset()
                    return result
                self._reset()
        return None

    def flush(self) -> Optional[np.ndarray]:
        if self._buffer:
            result = np.concatenate(self._buffer)
            self._reset()
            return result
        return None

    def _reset(self):
        self._buffer.clear()
        self._speech_started = False
        self._silence_start = None
        self._speech_start = None

    @property
    def is_speaking(self) -> bool:
        return self._speech_started and self._silence_start is None


audio_capture = AudioCapture()
