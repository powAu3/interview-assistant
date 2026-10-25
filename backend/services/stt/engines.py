"""STT engine implementations: Whisper / FunASR (local), Doubao, and generic HTTP ASR."""

import io
import gzip
import json
import logging
import re
import struct
import time
import uuid
import wave
import numpy as np
import threading
from typing import Optional, Any

import requests

from core.logger import get_logger
from .text_utils import TECH_VOCAB, _postprocess, _build_initial_prompt, build_tech_hotwords, custom_hotwords_from_config

_log = get_logger("stt.engines")

try:
    import websocket
except ImportError:
    websocket = None


# ---------------------------------------------------------------------------
# Shared audio helpers
# ---------------------------------------------------------------------------

def _audio_to_pcm_int16(audio: np.ndarray) -> np.ndarray:
    if audio.dtype == np.float32 or audio.dtype == np.float64:
        if audio.max() <= 1.0 and audio.min() >= -1.0:
            return (audio * 32767).astype(np.int16)
        return np.clip(audio, -32768, 32767).astype(np.int16)
    if audio.dtype != np.int16:
        return audio.astype(np.int16)
    return audio


def _audio_to_wav_bytes(audio: np.ndarray, sample_rate: int = 16000) -> bytes:
    pcm = _audio_to_pcm_int16(audio)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate or 16000))
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def _looks_like_whisper_hallucination(seg, text: str) -> bool:
    """识别 whisper 家族在静音/噪声上的典型幻觉段。

    过滤三类：
    - no_speech / 低置信（avg_logprob 很低）
    - 压缩比异常（重复 token 循环，如 "a new version of a new version of ..."）
    - 短语 n-gram 重复 >=3 次（中文按字符 n-gram）
    """
    no_speech = float(getattr(seg, "no_speech_prob", 0.0) or 0.0)
    if no_speech > 0.5:
        return True
    avg_logprob = float(getattr(seg, "avg_logprob", 0.0) or 0.0)
    if avg_logprob < -1.0:
        return True
    compression = float(getattr(seg, "compression_ratio", 0.0) or 0.0)
    if compression > 2.4:
        return True
    if len(text) >= 24 and _has_repeated_ngram(text):
        return True
    return False


# 幻觉循环 = 同一片段「连续」重复 >=3 次（如 "a new version of a new version of ..."）。
# 只看连续重复：正常 speech 里散布的重复词（"of the" x3）不算，避免整段误杀。
_CJK_LOOP_RE = re.compile(r"([\u4e00-\u9fff]{2,12}?)\1{2,}")
_WORD_LOOP_RE = re.compile(r"(\b\w+(?:\s+\w+){0,5}?)(?:\s*\1\s*){2,}", re.IGNORECASE)


def _has_repeated_ngram(text: str, min_repeat: int = 3) -> bool:
    compact = re.sub(r"[\s,，.。!！?？、]+", "", text)
    if len(compact) >= 12 and _CJK_LOOP_RE.search(compact):
        return True
    return bool(_WORD_LOOP_RE.search(text))


# ---------------------------------------------------------------------------
# DoubaoSTT – Volcengine streaming ASR
# ---------------------------------------------------------------------------

DOUBAO_ASR_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream"
MSG_FULL_CLIENT_REQUEST = 0x01
MSG_AUDIO_ONLY = 0x02
MSG_FULL_SERVER_RESPONSE = 0x09
MSG_ERROR = 0x0F
# 客户端帧 flags（byte1 低 4 位）：带序号=0b0001；最后一包音频再或上 0b0010（且序号取负）。
# 参考 issue #22 / 火山文档：服务端只在收到「负序号结束包」后才出结果；旧实现最后一包
# 不带负序号，服务端会干等约 8 秒（错误码 45000081）再断会话。
FLAG_SEQUENCE = 0x01
FLAG_LAST = 0x02
COMPRESSION_GZIP = 0x01
CHUNK_MS = 200
CHUNK_SAMPLES = 16000 * CHUNK_MS // 1000


def _doubao_language(language: str) -> str:
    """把 whisper 风格语言码映射成豆包 language 参数；auto/默认按 zh-CN。"""
    lang = (language or "").strip().lower()
    if lang.startswith("zh"):
        return "zh-CN"
    if lang.startswith("en"):
        return "en-US"
    return "zh-CN"


def _build_ws_frame_full_request(
    app_key: str,
    boosting_table_id: str,
    language: str = "zh-CN",
) -> bytes:
    req: dict[str, Any] = {
        "user": {"uid": app_key},
        "audio": {
            "format": "pcm",
            "rate": 16000,
            "bits": 16,
            "channel": 1,
            "language": language if language and language != "auto" else "zh-CN",
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }
    if boosting_table_id and boosting_table_id.strip():
        req["request"]["corpus"] = {"boosting_table_id": boosting_table_id.strip()}
    payload_raw = json.dumps(req, ensure_ascii=False).encode("utf-8")
    payload = gzip.compress(payload_raw)
    # header(4) + sequence(4, 全量请求固定 1) + payload_size(4) + payload
    header = bytes([0x11, 0x10 | FLAG_SEQUENCE, 0x11, 0x00])
    return header + struct.pack(">i", 1) + struct.pack(">I", len(payload)) + payload


def _build_ws_frame_audio(pcm_chunk: bytes, sequence: int, is_last: bool = False) -> bytes:
    payload = gzip.compress(pcm_chunk)
    flags = FLAG_SEQUENCE | (FLAG_LAST if is_last else 0)
    header = bytes([0x11, 0x20 | flags, 0x01, 0x00])
    # 最后一包序号取负，服务端据此识别音频结束并立即出结果
    return header + struct.pack(">i", -sequence if is_last else sequence) + struct.pack(">I", len(payload)) + payload


def _parse_ws_response(data: bytes) -> tuple[int, Optional[dict], bool]:
    """解析服务端帧；返回 (msg_type, payload, is_last)。

    带 sequence 的帧（flags 0b0001/0b0011）：header(4) + sequence(4) + size(4) + payload；
    不带 sequence 的帧：header(4) + size(4) + payload。
    服务端最后一包 flags 带 0b0010，收到后调用方应立即返回，不再等 recv 超时。
    """
    if len(data) < 4:
        return 0, None, False
    msg_type = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    compression = data[2] & 0x0F
    is_last = bool(flags & FLAG_LAST)
    if msg_type == MSG_ERROR:
        return MSG_ERROR, None, False
    if msg_type == MSG_FULL_SERVER_RESPONSE:
        size_offset = 8 if flags & FLAG_SEQUENCE else 4
        if len(data) < size_offset + 4:
            return msg_type, None, is_last
        payload_size = struct.unpack(">I", data[size_offset : size_offset + 4])[0]
        if len(data) < size_offset + 4 + payload_size:
            return msg_type, None, is_last
        raw = data[size_offset + 4 : size_offset + 4 + payload_size]
        if compression == COMPRESSION_GZIP:
            try:
                raw = gzip.decompress(raw)
            except Exception:
                _log.warning("_parse_ws_response gzip decompress failed")
                return msg_type, None, is_last
        try:
            payload = json.loads(raw.decode("utf-8"))
            return msg_type, payload, is_last
        except Exception:
            _log.warning("_parse_ws_response invalid JSON at offset %d", len(raw))
            return msg_type, None, is_last
    return msg_type, None, is_last


class DoubaoSTT:
    """豆包流式语音识别模型，WebSocket 双流式。

    支持两种鉴权方式（自动选择）：
    - 新版控制台：X-Api-Key（api_key 非空时优先使用）
    - 旧版控制台：X-Api-App-Key + X-Api-Access-Key
    """

    def __init__(
        self,
        app_id: str = "",
        access_token: str = "",
        api_key: str = "",
        resource_id: str = "volc.seedasr.sauc.duration",
        boosting_table_id: str = "",
    ):
        self.app_id = app_id or ""
        self.access_token = access_token or ""
        self.api_key = api_key or ""
        self.resource_id = resource_id or "volc.bigasr.sauc.duration"
        self.boosting_table_id = boosting_table_id or ""

    @property
    def model_size(self) -> str:
        return "doubao"

    @property
    def is_loaded(self) -> bool:
        return bool(self.api_key or self.access_token)

    @property
    def is_loading(self) -> bool:
        return False

    def load_model(self) -> None:
        pass

    def change_model(self, _model_size: str) -> None:
        pass

    def _build_headers(self) -> dict:
        if self.api_key:
            return {
                "X-Api-Key": self.api_key,
                "X-Api-Resource-Id": self.resource_id,
                "X-Api-Connect-Id": str(uuid.uuid4()),
            }
        app_key = self.app_id or self.access_token
        return {
            "X-Api-App-Key": app_key,
            "X-Api-Access-Key": self.access_token,
            "X-Api-Resource-Id": self.resource_id,
            "X-Api-Connect-Id": str(uuid.uuid4()),
        }

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000,
                   position: str = "后端开发", language: str = "Python") -> str:
        if not self.api_key and not self.access_token:
            return ""
        if websocket is None:
            return ""
        app_key = self.app_id or self.access_token or self.api_key
        pcm = _audio_to_pcm_int16(audio)
        if sample_rate != 16000:
            n_orig = len(pcm)
            n_new = int(round(n_orig * 16000 / sample_rate))
            if n_new < 1:
                n_new = 1
            indices = np.linspace(0, n_orig - 1, n_new).astype(np.int32)
            pcm = pcm[indices]

        first_frame = _build_ws_frame_full_request(
            app_key,
            self.boosting_table_id,
            language=_doubao_language(language),
        )
        n_samples = len(pcm)
        chunks = []
        offset = 0
        sequence = 1  # 全量请求占用序号 1，音频包从 2 开始递增
        while offset < n_samples:
            take = min(CHUNK_SAMPLES, n_samples - offset)
            chunk_bytes = pcm[offset : offset + take].tobytes()
            is_last = offset + take >= n_samples
            sequence += 1
            chunks.append(_build_ws_frame_audio(chunk_bytes, sequence, is_last=is_last))
            offset += take
        if not chunks:
            pad = np.zeros(CHUNK_SAMPLES, dtype=np.int16)
            chunks = [_build_ws_frame_audio(pad.tobytes(), 2, is_last=True)]

        try:
            ws = websocket.create_connection(
                DOUBAO_ASR_WS_URL,
                header=[f"{k}: {v}" for k, v in self._build_headers().items()],
                timeout=10,
            )
            try:
                # 整段连发：不按 100-200ms 间隔空等，最后一包负序号即结束包
                ws.send_binary(first_frame)
                for frame in chunks:
                    ws.send_binary(frame)
                final_text = ""
                ws.settimeout(5)
                first_packet = True
                while True:
                    try:
                        raw = ws.recv()
                    except Exception:
                        break
                    if first_packet:
                        ws.settimeout(15)
                        first_packet = False
                    if raw is None:
                        break
                    if isinstance(raw, str):
                        raw = raw.encode("utf-8")
                    msg_type, payload, is_last = _parse_ws_response(raw)
                    if msg_type == MSG_ERROR:
                        # error 帧也可能带 sequence（flags 0b0001），字段整体后移 4 字节
                        err_off = 8 if (len(raw) > 4 and raw[1] & FLAG_SEQUENCE) else 4
                        code = struct.unpack(">I", raw[err_off:err_off + 4])[0] if len(raw) >= err_off + 4 else 0
                        err_size = struct.unpack(">I", raw[err_off + 4:err_off + 8])[0] if len(raw) >= err_off + 8 else 0
                        msg_start = err_off + 8
                        err_msg = raw[msg_start:msg_start + err_size].decode("utf-8", errors="replace") if err_size else ""
                        raise RuntimeError(f"豆包 ASR 错误: {code} {err_msg}")
                    if msg_type == MSG_FULL_SERVER_RESPONSE and payload:
                        res = payload.get("result") or {}
                        text = (res.get("text") or "").strip()
                        if text:
                            final_text = text
                    if is_last:
                        # 服务端结束包（flags 0b0010/0b0011）：立即返回，不再空等到超时
                        break
                return _postprocess(final_text) if final_text else ""
            finally:
                ws.close()
        except Exception as e:
            _log.warning("Doubao ASR error: %s", e, exc_info=True)
            if "websocket" in str(type(e).__name__).lower():
                raise RuntimeError(f"豆包 ASR 连接异常: {e}") from e
            raise


# ---------------------------------------------------------------------------
# GenericHTTPSTT – OpenAI-compatible multipart ASR
# ---------------------------------------------------------------------------

class GenericHTTPSTT:
    """通用 HTTP ASR: POST {base_url}/audio/transcriptions with multipart file."""

    def __init__(self, api_base_url: str, api_key: str, model: str,
                 custom_headers: str = ""):
        self.api_base_url = (api_base_url or "").rstrip("/")
        self.api_key = api_key or ""
        self.model = model or ""
        self.custom_headers = custom_headers or ""

    @property
    def model_size(self) -> str:
        return "generic"

    @property
    def is_loaded(self) -> bool:
        return bool(self.api_base_url and self.api_key and self.model)

    @property
    def is_loading(self) -> bool:
        return False

    def load_model(self) -> None:
        pass

    def change_model(self, _model_size: str) -> None:
        pass

    def _extract_text(self, data: Any) -> str:
        if isinstance(data, str):
            return data.strip()
        if not isinstance(data, dict):
            return ""
        for key in ("text", "transcript", "result", "content"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        result = data.get("result")
        if isinstance(result, dict):
            for key in ("text", "transcript", "content"):
                value = result.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        return ""

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000,
                   position: str = "后端开发", language: str = "Python") -> str:
        if not self.api_base_url:
            raise RuntimeError("通用 ASR Base URL 未配置")
        if not self.api_key:
            raise RuntimeError("通用 ASR API Key 未配置")
        if not self.model:
            raise RuntimeError("通用 ASR Model 未配置")

        url = f"{self.api_base_url}/audio/transcriptions"
        wav_bytes = _audio_to_wav_bytes(audio, sample_rate=sample_rate)
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if self.custom_headers.strip():
            try:
                extra = json.loads(self.custom_headers)
                if isinstance(extra, dict):
                    headers.update({k: str(v) for k, v in extra.items()})
            except (json.JSONDecodeError, ValueError):
                for line in self.custom_headers.strip().splitlines():
                    line = line.strip()
                    if ":" in line:
                        k, v = line.split(":", 1)
                        headers[k.strip()] = v.strip()
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        data = {"model": self.model, "response_format": "json"}
        try:
            resp = requests.post(url, headers=headers, files=files, data=data, timeout=(10, 60))
            if resp.status_code >= 400:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
            ctype = resp.headers.get("content-type", "")
            if "json" in ctype.lower():
                payload = resp.json()
            else:
                try:
                    payload = resp.json()
                except Exception:
                    payload = resp.text
            text = self._extract_text(payload)
            return _postprocess(text) if text else ""
        except requests.exceptions.Timeout as e:
            raise RuntimeError(f"通用 ASR 请求超时: {e}") from e
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"通用 ASR 请求失败: {e}") from e


# ---------------------------------------------------------------------------
# FunASRSTT – local FunASR (paraformer / SenseVoice)
# ---------------------------------------------------------------------------

# 短名 -> ModelScope 仓库 id
FUNASR_MODEL_REPOS = {
    "paraformer-zh": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "sensevoice-small": "iic/SenseVoiceSmall",
    "paraformer-zh-streaming": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online",
}

# SenseVoice 富文本转写会带 <|zh|><|NEUTRAL|><|withitn|> 之类的控制标签
_FUNASR_TAG_RE = re.compile(r"<\|[^|<>]{0,32}\|>")


class FunASRSTT:
    """本地 FunASR 引擎（中文面试场景：准确率高、CPU 快、paraformer 支持热词）。

    首次使用需显式下载模型（设置页「下载模型」按钮 / scripts/download_funasr_models.py）。
    """

    def __init__(self, model_name: str = "paraformer-zh"):
        self.model_name = model_name if model_name in FUNASR_MODEL_REPOS else "paraformer-zh"
        self._model = None
        self._lock = threading.Lock()
        self._loading = False
        self._load_failed_until = 0.0
        self._last_load_error = ""

    @property
    def model_size(self) -> str:
        return self.model_name

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def is_loading(self) -> bool:
        return self._loading

    def _repo_id(self) -> str:
        return FUNASR_MODEL_REPOS[self.model_name]

    def _auto_model_kwargs(self) -> dict:
        kwargs: dict[str, Any] = {
            "model": self._repo_id(),
            "disable_update": True,
            "disable_pbar": True,
            "disable_log": True,
        }
        if self.model_name == "sensevoice-small":
            kwargs["trust_remote_code"] = True
        elif self.model_name == "paraformer-zh":
            # 短音频片段上游已做 VAD；只挂标点模型，不重复挂 VAD
            kwargs["vad_model"] = None
            kwargs["punc_model"] = "ct-punc-c"
        elif self.model_name == "paraformer-zh-streaming":
            kwargs["vad_model"] = None
            kwargs["punc_model"] = None
        return kwargs

    def load_model(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            # 失败冷却：断网时每个 VAD 段都会重付一次下载尝试，60s 内直接复用上次错误
            now = time.monotonic()
            if self._load_failed_until and now < self._load_failed_until:
                raise RuntimeError(self._last_load_error or "FunASR 模型加载失败")
            self._loading = True
            try:
                try:
                    from funasr import AutoModel
                except ImportError as e:
                    raise RuntimeError(
                        "FunASR 未安装：请先运行 pip install funasr（或参考 docs/stt/README.md）"
                    ) from e
                device = "cpu"
                try:
                    import torch

                    if torch.cuda.is_available():
                        device = "cuda"
                    else:
                        # 线程可配置（stt_infer_threads，0=自动 min(8,核数-2)）：
                        # 留核给实时链路、降低推理时风扇/发热
                        from core.config import get_config

                        configured = int(getattr(get_config(), "stt_infer_threads", 0) or 0)
                        torch.set_num_threads(configured if configured > 0 else min(8, os.cpu_count() or 4))
                except ImportError:
                    pass
                kwargs = self._auto_model_kwargs()
                kwargs["device"] = device
                self._model = AutoModel(**kwargs)
                self._load_failed_until = 0.0
                self._last_load_error = ""
            except Exception as e:
                self._load_failed_until = now + 60.0
                self._last_load_error = str(e)[:200]
                raise
            finally:
                self._loading = False

    def change_model(self, model_name: str) -> None:
        if model_name == self.model_name and self._model is not None:
            return
        with self._lock:
            self._model = None
            self.model_name = model_name if model_name in FUNASR_MODEL_REPOS else "paraformer-zh"
        self.load_model()

    def _hotword_string(self, position: str, language: str) -> str:
        words = build_tech_hotwords(position, language, limit=400, custom=custom_hotwords_from_config())
        return " ".join(words)

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000,
                   position: str = "后端开发", language: str = "Python") -> str:
        if self._model is None:
            self.load_model()

        # FunASR 的 kaldi fbank 前端要求 float 波形（int16 会触发 torch Short 未实现）
        audio_f = audio.astype(np.float32)
        if audio_f.size and (np.abs(audio_f).max(initial=0.0) > 1.0):
            audio_f = audio_f / 32768.0
        if sample_rate != 16000:
            n_orig = len(audio_f)
            n_new = max(1, int(round(n_orig * 16000 / sample_rate)))
            indices = np.linspace(0, n_orig - 1, n_new).astype(np.int32)
            audio_f = audio_f[indices]

        generate_kwargs: dict[str, Any] = {"input": audio_f}
        if self.model_name.startswith("paraformer"):
            hotwords = self._hotword_string(position, language)
            if hotwords:
                generate_kwargs["hotword"] = hotwords
        if self.model_name == "sensevoice-small":
            generate_kwargs["language"] = "auto"
            generate_kwargs["use_itn"] = True

        try:
            results = self._model.generate(**generate_kwargs)
        except TypeError:
            generate_kwargs.pop("hotword", None)
            results = self._model.generate(**generate_kwargs)

        text = ""
        for item in results or []:
            if isinstance(item, dict) and item.get("text"):
                text = str(item["text"])
                break
        text = _FUNASR_TAG_RE.sub("", text).strip()
        return _postprocess(text) if text else ""


# ---------------------------------------------------------------------------
# STTEngine – Whisper (local)
# ---------------------------------------------------------------------------

class STTEngine:
    """Speech-to-text engine using faster-whisper."""

    TEMPERATURE_FALLBACK = [0.0, 0.2]

    def __init__(self, model_size: str = "base", language: str = "zh"):
        self.model_size = model_size
        self.language = language
        self._model = None
        self._lock = threading.Lock()
        self._loading = False

    @staticmethod
    def _best_device() -> tuple[str, str]:
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda", "float16"
        except ImportError:
            pass
        return "cpu", "int8"

    @staticmethod
    def _cpu_threads() -> int:
        # 留 2 个核给音频采集/VAD/LLM 流式等实时链路线程：
        # whisper 推理默认吃满全部核时，drain 线程会被饿死导致原始音频被丢
        # （日志曾出现单会话丢 7125 块 ≈ 7.6 分钟音频）。
        import os

        cores = os.cpu_count() or 4
        return max(1, min(cores, cores - 2))

    def load_model(self):
        with self._lock:
            if self._model is not None:
                return
            self._loading = True
            try:
                from faster_whisper import WhisperModel
                device, compute_type = self._best_device()
                model_kwargs: dict = {"device": device, "compute_type": compute_type}
                if device == "cpu":
                    from core.config import get_config

                    configured = int(getattr(get_config(), "stt_infer_threads", 0) or 0)
                    model_kwargs["cpu_threads"] = configured if configured > 0 else self._cpu_threads()
                self._model = WhisperModel(self.model_size, **model_kwargs)
            finally:
                self._loading = False

    def change_model(self, model_size: str):
        if model_size == self.model_size and self._model is not None:
            return
        with self._lock:
            self._model = None
            self.model_size = model_size
        self.load_model()

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000,
                   position: str = "后端开发", language: str = "Python") -> str:
        if self._model is None:
            self.load_model()

        audio_f = audio.astype(np.float32)
        if audio_f.max() > 1.0:
            audio_f = audio_f / 32768.0

        whisper_lang: Optional[str] = None if self.language in ("auto", "zh-en") else self.language
        initial_prompt = _build_initial_prompt(position, language)
        hotwords_str = " ".join(
            build_tech_hotwords(position, language, limit=900, custom=custom_hotwords_from_config())
        )

        kwargs = dict(
            language=whisper_lang,
            beam_size=3,
            temperature=self.TEMPERATURE_FALLBACK,
            initial_prompt=initial_prompt,
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=200,
            ),
            word_timestamps=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
        )

        try:
            segments, _ = self._model.transcribe(audio_f, hotwords=hotwords_str, **kwargs)
        except TypeError:
            segments, _ = self._model.transcribe(audio_f, **kwargs)

        texts = []
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            if _looks_like_whisper_hallucination(seg, text):
                continue
            texts.append(text)

        return _postprocess(" ".join(texts))

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def is_loading(self) -> bool:
        return self._loading
