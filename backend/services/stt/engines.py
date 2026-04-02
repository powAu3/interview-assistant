"""STT engine implementations: Whisper (local), Doubao (Volcengine), Iflytek."""

import gzip
import json
import re
import struct
import uuid
import numpy as np
import threading
from typing import Optional, Any

from core.logger import get_logger
from .text_utils import TECH_VOCAB, _postprocess, _build_initial_prompt

_log = get_logger("stt.engines")

try:
    import websocket
    _WS_TIMEOUT = getattr(websocket, "WebSocketTimeoutException", TimeoutError)
    _WS_CLOSED = getattr(websocket, "WebSocketConnectionClosedException", ConnectionError)
except ImportError:
    websocket = None
    _WS_TIMEOUT = TimeoutError
    _WS_CLOSED = ConnectionError


# ---------------------------------------------------------------------------
# Shared audio helpers
# ---------------------------------------------------------------------------

def _audio_to_pcm_int16(audio: np.ndarray) -> np.ndarray:
    if audio.dtype == np.float32 or audio.dtype == np.float64:
        if audio.max() <= 1.0 and audio.min() >= -1.0:
            return (audio * 32767).astype(np.int16)
        return audio.astype(np.int16)
    if audio.dtype != np.int16:
        return audio.astype(np.int16)
    return audio


# ---------------------------------------------------------------------------
# DoubaoSTT – Volcengine streaming ASR
# ---------------------------------------------------------------------------

DOUBAO_ASR_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
MSG_FULL_CLIENT_REQUEST = 0x01
MSG_AUDIO_ONLY = 0x02
MSG_FULL_SERVER_RESPONSE = 0x09
MSG_ERROR = 0x0F
FLAG_LAST_AUDIO = 0x02
COMPRESSION_GZIP = 0x01
CHUNK_MS = 200
CHUNK_SAMPLES = 16000 * CHUNK_MS // 1000


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
    header = bytes([0x11, 0x10, 0x11, 0x00])
    return header + struct.pack(">I", len(payload)) + payload


def _build_ws_frame_audio(pcm_chunk: bytes, is_last: bool = False) -> bytes:
    payload = gzip.compress(pcm_chunk)
    header = bytes([0x11, 0x22 if is_last else 0x20, 0x01, 0x00])
    return header + struct.pack(">I", len(payload)) + payload


def _parse_ws_response(data: bytes) -> tuple[int, Optional[dict]]:
    if len(data) < 4:
        return 0, None
    msg_type = (data[1] >> 4) & 0x0F
    compression = data[2] & 0x0F
    if msg_type == MSG_ERROR:
        return MSG_ERROR, None
    if msg_type == MSG_FULL_SERVER_RESPONSE:
        if len(data) < 12:
            return msg_type, None
        payload_size = struct.unpack(">I", data[8:12])[0]
        if len(data) < 12 + payload_size:
            return msg_type, None
        raw = data[12 : 12 + payload_size]
        if compression == COMPRESSION_GZIP:
            try:
                raw = gzip.decompress(raw)
            except Exception:
                return msg_type, None
        try:
            payload = json.loads(raw.decode("utf-8"))
            return msg_type, payload
        except Exception:
            return msg_type, None
    return msg_type, None


class DoubaoSTT:
    """豆包流式语音识别模型2.0 小时版，WebSocket 双流式。"""

    def __init__(
        self,
        app_id: str,
        access_token: str,
        resource_id: str = "volc.seedasr.sauc.duration",
        boosting_table_id: str = "",
    ):
        self.app_id = app_id or ""
        self.access_token = access_token or ""
        self.resource_id = resource_id or "volc.seedasr.sauc.duration"
        self.boosting_table_id = boosting_table_id or ""

    @property
    def model_size(self) -> str:
        return "doubao"

    @property
    def is_loaded(self) -> bool:
        return True

    @property
    def is_loading(self) -> bool:
        return False

    def load_model(self) -> None:
        pass

    def change_model(self, _model_size: str) -> None:
        pass

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000,
                  position: str = "后端开发", language: str = "Python") -> str:
        if not self.access_token or websocket is None:
            return ""
        app_key = self.app_id or self.access_token
        pcm = _audio_to_pcm_int16(audio)
        if sample_rate != 16000:
            n_orig = len(pcm)
            n_new = int(round(n_orig * 16000 / sample_rate))
            if n_new < 1:
                n_new = 1
            indices = np.linspace(0, n_orig - 1, n_new).astype(np.int32)
            pcm = pcm[indices]

        first_frame = _build_ws_frame_full_request(
            app_key, self.boosting_table_id, language="zh-CN"
        )
        n_samples = len(pcm)
        chunks = []
        offset = 0
        while offset < n_samples:
            take = min(CHUNK_SAMPLES, n_samples - offset)
            chunk_bytes = pcm[offset : offset + take].tobytes()
            is_last = offset + take >= n_samples
            chunks.append(_build_ws_frame_audio(chunk_bytes, is_last=is_last))
            offset += take
        if not chunks:
            pad = np.zeros(CHUNK_SAMPLES, dtype=np.int16)
            chunks = [_build_ws_frame_audio(pad.tobytes(), is_last=True)]

        headers = {
            "X-Api-App-Key": app_key,
            "X-Api-Access-Key": self.access_token,
            "X-Api-Resource-Id": self.resource_id,
            "X-Api-Connect-Id": str(uuid.uuid4()),
        }
        try:
            ws = websocket.create_connection(
                DOUBAO_ASR_WS_URL,
                header=[f"{k}: {v}" for k, v in headers.items()],
                timeout=30,
            )
            ws.send_binary(first_frame)
            for frame in chunks:
                ws.send_binary(frame)
            final_text = ""
            ws.settimeout(15)
            while True:
                try:
                    raw = ws.recv()
                except Exception:
                    break
                if raw is None:
                    break
                if isinstance(raw, str):
                    raw = raw.encode("utf-8")
                msg_type, payload = _parse_ws_response(raw)
                if msg_type == MSG_ERROR:
                    code = struct.unpack(">I", raw[4:8])[0] if len(raw) >= 8 else 0
                    err_size = struct.unpack(">I", raw[8:12])[0] if len(raw) >= 12 else 0
                    err_msg = raw[12:12 + err_size].decode("utf-8", errors="replace") if err_size else ""
                    ws.close()
                    raise RuntimeError(f"豆包 ASR 错误: {code} {err_msg}")
                if msg_type == MSG_FULL_SERVER_RESPONSE and payload:
                    res = payload.get("result") or {}
                    text = (res.get("text") or "").strip()
                    if text:
                        final_text = text
            ws.close()
            return _postprocess(final_text) if final_text else ""
        except Exception as e:
            _log.error("Doubao ASR error: %s", e, exc_info=True)
            if "websocket" in str(type(e).__name__).lower():
                raise RuntimeError(f"豆包 ASR 连接异常: {e}") from e
            raise


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

    def load_model(self):
        with self._lock:
            if self._model is not None:
                return
            self._loading = True
            try:
                from faster_whisper import WhisperModel
                device, compute_type = self._best_device()
                self._model = WhisperModel(
                    self.model_size,
                    device=device,
                    compute_type=compute_type,
                )
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

        hotwords_list = []
        for key in ["通用", language, position]:
            v = TECH_VOCAB.get(key)
            if v:
                for w in v.split():
                    if w and any(c.isascii() and c.isalpha() for c in w):
                        hotwords_list.append(w)
        hotwords_str = " ".join(dict.fromkeys(hotwords_list))[:900]

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
            if hasattr(seg, "no_speech_prob") and seg.no_speech_prob > 0.5:
                continue
            texts.append(text)

        return _postprocess(" ".join(texts))

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def is_loading(self) -> bool:
        return self._loading


# ---------------------------------------------------------------------------
# IflyitekSTT – Iflytek streaming ASR
# ---------------------------------------------------------------------------

class IflyitekSTT:
    """讯飞语音听写（流式版）WebSocket API。"""

    WSS_URL = "wss://iat-api.xfyun.cn/v2/iat"

    def __init__(self, app_id: str, api_key: str, api_secret: str):
        self.app_id = app_id or ""
        self.api_key = api_key or ""
        self.api_secret = api_secret or ""

    @property
    def model_size(self) -> str:
        return "iflytek"

    @property
    def is_loaded(self) -> bool:
        return True

    @property
    def is_loading(self) -> bool:
        return False

    def load_model(self) -> None:
        pass

    def change_model(self, _model_size: str) -> None:
        pass

    def _build_auth_url(self) -> str:
        import hashlib, hmac, base64
        from datetime import datetime
        from time import mktime
        from wsgiref.handlers import format_date_time
        from urllib.parse import urlencode, urlparse

        url_parts = urlparse(self.WSS_URL)
        now = datetime.now()
        date = format_date_time(mktime(now.timetuple()))
        signature_origin = (
            f"host: {url_parts.netloc}\n"
            f"date: {date}\n"
            f"GET {url_parts.path} HTTP/1.1"
        )
        signature_sha = hmac.new(
            self.api_secret.encode("utf-8"),
            signature_origin.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).digest()
        signature = base64.b64encode(signature_sha).decode("utf-8")
        authorization_origin = (
            f'api_key="{self.api_key}", algorithm="hmac-sha256", '
            f'headers="host date request-line", signature="{signature}"'
        )
        authorization = base64.b64encode(authorization_origin.encode("utf-8")).decode("utf-8")
        params = {"authorization": authorization, "date": date, "host": url_parts.netloc}
        return f"{self.WSS_URL}?{urlencode(params)}"

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000,
                  position: str = "后端开发", language: str = "Python") -> str:
        if not self.api_key or not self.api_secret or websocket is None:
            return ""
        pcm = _audio_to_pcm_int16(audio)
        if sample_rate != 16000:
            n_orig = len(pcm)
            n_new = int(round(n_orig * 16000 / sample_rate))
            if n_new < 1:
                n_new = 1
            indices = np.linspace(0, n_orig - 1, n_new).astype(np.int32)
            pcm = pcm[indices]

        auth_url = self._build_auth_url()
        FRAME_SIZE = 1280
        pcm_bytes = pcm.tobytes()
        try:
            ws = websocket.create_connection(auth_url, timeout=15)
        except Exception as e:
            _log.error("Iflytek ASR connect failed: %s", e, exc_info=True)
            raise RuntimeError(f"讯飞 ASR 连接失败: {e}") from e

        try:
            offset = 0
            total = len(pcm_bytes)
            frame_idx = 0
            while offset < total:
                end = min(offset + FRAME_SIZE, total)
                chunk = pcm_bytes[offset:end]
                import base64 as _b64
                data_field = {"status": 0 if frame_idx == 0 else 1, "format": "audio/L16;rate=16000",
                              "encoding": "raw", "audio": _b64.b64encode(chunk).decode("utf-8")}
                if frame_idx == 0:
                    payload = {
                        "common": {"app_id": self.app_id},
                        "business": {"language": "zh_cn", "domain": "iat", "accent": "mandarin",
                                     "vad_eos": 3000, "dwa": "wpgs", "ptt": 0},
                        "data": data_field,
                    }
                else:
                    payload = {"data": data_field}
                ws.send(json.dumps(payload))
                offset = end
                frame_idx += 1

            last_payload = {
                "data": {"status": 2, "format": "audio/L16;rate=16000",
                         "encoding": "raw", "audio": ""}
            }
            ws.send(json.dumps(last_payload))

            result_parts: list[str] = []
            ws.settimeout(10)
            while True:
                try:
                    msg = ws.recv()
                except Exception:
                    break
                if not msg:
                    break
                resp = json.loads(msg)
                code = resp.get("code", -1)
                if code != 0:
                    ws.close()
                    raise RuntimeError(f"讯飞 ASR 错误 {code}: {resp.get('message', '')}")
                data = resp.get("data", {})
                result = data.get("result", {})
                ws_list = result.get("ws", [])
                for ws_item in ws_list:
                    cw_list = ws_item.get("cw", [])
                    for cw in cw_list:
                        w = cw.get("w", "")
                        if w:
                            result_parts.append(w)
                status = data.get("status", 0)
                if status == 2:
                    break
            ws.close()
            text = "".join(result_parts).strip()
            return _postprocess(text) if text else ""
        except Exception as e:
            _log.error("Iflytek ASR error: %s", e, exc_info=True)
            try:
                ws.close()
            except Exception:
                pass
            raise
