import sounddevice as sd
import numpy as np
import threading
import platform
import queue
import time
from typing import Callable, Optional


class AudioCapture:
    """Cross-platform system audio capture using sounddevice (PortAudio)."""

    SAMPLE_RATE = 16000
    CHANNELS = 1
    BLOCK_SIZE = 1024
    DTYPE = "float32"

    def __init__(self):
        self._stream: Optional[sd.InputStream] = None
        self._running = False
        self._audio_queue: queue.Queue[np.ndarray] = queue.Queue()
        self._callback: Optional[Callable[[np.ndarray], None]] = None
        self._lock = threading.Lock()

    @staticmethod
    def list_devices() -> list[dict]:
        devices = sd.query_devices()
        result = []
        system = platform.system()

        for i, dev in enumerate(devices):
            if dev["max_input_channels"] > 0:
                name: str = dev["name"]
                host_api = sd.query_hostapis(dev["hostapi"])["name"]

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
                    "当前只有麦克风可用，无法录制面试官通过电脑播放的声音。\n"
                    "你需要安装 BlackHole 虚拟音频设备：\n\n"
                    "1. 安装: brew install blackhole-2ch\n"
                    "2. 打开「音频 MIDI 设置」\n"
                    "3. 创建「多输出设备」，勾选扬声器 + BlackHole 2ch\n"
                    "4. 将系统输出设为该多输出设备\n"
                    "5. 在面试助手中选择 BlackHole 2ch 作为输入\n\n"
                    "详细步骤请参考 README.md"
                )
        elif system == "Windows":
            devices = AudioCapture.list_devices()
            has_loopback = any(d["is_loopback"] for d in devices)
            info["has_loopback"] = has_loopback
            if not has_loopback:
                info["needs_virtual_device"] = True
                info["instructions"] = (
                    "⚠️ 未检测到 Loopback 设备！\n\n"
                    "请在声音设置 → 录制 → 右键空白处 → 显示已禁用的设备\n"
                    "→ 启用「立体声混音 (Stereo Mix)」"
                )
        return info

    def start(self, device_id: int, on_audio: Optional[Callable[[np.ndarray], None]] = None):
        with self._lock:
            if self._running:
                return
            self._callback = on_audio
            self._running = True
            self._audio_queue = queue.Queue()

            def audio_cb(indata, frames, time_info, status):
                if status:
                    pass
                audio = indata[:, 0].copy() if indata.ndim > 1 else indata.copy().flatten()
                self._audio_queue.put(audio)
                if self._callback:
                    self._callback(audio)

            try:
                self._stream = sd.InputStream(
                    device=device_id,
                    samplerate=self.SAMPLE_RATE,
                    channels=self.CHANNELS,
                    dtype=self.DTYPE,
                    blocksize=self.BLOCK_SIZE,
                    callback=audio_cb,
                )
                self._stream.start()
            except Exception as e:
                self._running = False
                raise RuntimeError(f"无法启动音频捕获: {e}")

    def stop(self):
        with self._lock:
            self._running = False
            if self._stream:
                try:
                    self._stream.stop()
                    self._stream.close()
                except Exception:
                    pass
                self._stream = None

    def get_audio_chunk(self, timeout: float = 0.1) -> Optional[np.ndarray]:
        chunks = []
        try:
            while True:
                chunks.append(self._audio_queue.get_nowait())
        except queue.Empty:
            pass
        if chunks:
            return np.concatenate(chunks)
        return None

    @property
    def is_running(self) -> bool:
        return self._running

    @staticmethod
    def compute_energy(audio: np.ndarray) -> float:
        return float(np.sqrt(np.mean(audio ** 2)))


class VADBuffer:
    """Voice Activity Detection: accumulates speech audio, triggers on silence.

    Continuously monitors audio energy. When energy exceeds silence_threshold,
    starts buffering. Mid-sentence pauses shorter than silence_duration are
    tolerated. When silence exceeds silence_duration, the buffered speech is
    returned for transcription.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        silence_threshold: float = 0.01,
        silence_duration: float = 2.5,
        min_speech_duration: float = 0.5,
    ):
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
