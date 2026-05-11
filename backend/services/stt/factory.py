"""STT engine factory: singleton management, provider selection, and resilience."""

import time
import threading
from typing import Optional

import numpy as np

from core.logger import get_logger
from .engines import STTEngine, DoubaoSTT, GenericHTTPSTT

_log = get_logger("stt.factory")

_engine: Optional[STTEngine] = None
_doubao_engine: Optional[DoubaoSTT] = None
_generic_engine: Optional[GenericHTTPSTT] = None

# ---------------------------------------------------------------------------
# Circuit breaker for remote STT engines (doubao / generic)
# ---------------------------------------------------------------------------

_circuit_lock = threading.Lock()
_circuit_failures = 0
_circuit_open_until = 0.0
CIRCUIT_THRESHOLD = 3
CIRCUIT_THRESHOLD_TIMEOUT = 5
CIRCUIT_COOLDOWN_SEC = 60.0

_TIMEOUT_EXCEPTIONS = (TimeoutError,)
try:
    import websocket as _ws_mod
    _WS_TIMEOUT_EXC = getattr(_ws_mod, "WebSocketTimeoutException", None)
    if _WS_TIMEOUT_EXC:
        _TIMEOUT_EXCEPTIONS = (TimeoutError, _WS_TIMEOUT_EXC)
except ImportError:
    pass


def _is_timeout_error(err: Exception) -> bool:
    if isinstance(err, _TIMEOUT_EXCEPTIONS):
        return True
    msg = str(err).lower()
    return "timeout" in msg or "timed out" in msg


def _circuit_record_failure(is_timeout: bool = False):
    global _circuit_failures, _circuit_open_until
    threshold = CIRCUIT_THRESHOLD_TIMEOUT if is_timeout else CIRCUIT_THRESHOLD
    with _circuit_lock:
        _circuit_failures += 1
        if _circuit_failures >= threshold:
            _circuit_open_until = time.monotonic() + CIRCUIT_COOLDOWN_SEC
            _log.warning(
                "STT circuit OPEN after %d failures (timeout=%s), fallback for %.0fs",
                _circuit_failures, is_timeout, CIRCUIT_COOLDOWN_SEC,
            )


def _circuit_reset():
    global _circuit_failures, _circuit_open_until
    with _circuit_lock:
        if _circuit_failures > 0:
            _circuit_failures = 0
            _circuit_open_until = 0.0


def _is_circuit_open() -> bool:
    with _circuit_lock:
        if _circuit_failures < CIRCUIT_THRESHOLD:
            return False
        if time.monotonic() >= _circuit_open_until:
            return False
        return True


# ---------------------------------------------------------------------------
# Whisper fallback (lazy init)
# ---------------------------------------------------------------------------

def _get_whisper_fallback() -> STTEngine:
    """Get or lazily create a local Whisper engine for fallback."""
    global _engine
    from core.config import get_config
    cfg = get_config()
    size = cfg.whisper_model or "base"
    lang = cfg.whisper_language or "auto"
    if _engine is None:
        _engine = STTEngine(model_size=size, language=lang)
    if not _engine.is_loaded:
        _log.info("Whisper fallback: loading model %s", _engine.model_size)
        _engine.load_model()
    return _engine


def _whisper_transcribe(audio: np.ndarray, sample_rate: int,
                        position: str, language: str) -> str:
    engine = _get_whisper_fallback()
    return engine.transcribe(audio, sample_rate, position=position, language=language)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def set_whisper_language(language: str) -> None:
    global _engine
    if _engine is not None:
        _engine.language = language


def get_stt_engine(
    model_size: Optional[str] = None,
    language: Optional[str] = None,
):
    """返回当前配置对应的 STT 引擎：whisper（本地）/ doubao（豆包）/ generic（通用 HTTP）。"""
    from core.config import get_config
    cfg = get_config()
    if cfg.stt_provider == "iflytek":
        raise RuntimeError("讯飞 STT 已下线，请在设置中改为通用 ASR 或 Whisper")
    if cfg.stt_provider == "doubao":
        global _doubao_engine
        if _doubao_engine is None or (
            _doubao_engine.app_id != cfg.doubao_stt_app_id
            or _doubao_engine.access_token != cfg.doubao_stt_access_token
            or _doubao_engine.resource_id != cfg.doubao_stt_resource_id
            or _doubao_engine.boosting_table_id != (cfg.doubao_stt_boosting_table_id or "")
        ):
            _doubao_engine = DoubaoSTT(
                app_id=cfg.doubao_stt_app_id,
                access_token=cfg.doubao_stt_access_token,
                resource_id=cfg.doubao_stt_resource_id or "volc.seedasr.sauc.duration",
                boosting_table_id=cfg.doubao_stt_boosting_table_id or "",
            )
        return _doubao_engine
    if cfg.stt_provider == "generic":
        global _generic_engine
        if _generic_engine is None or (
            _generic_engine.api_base_url != (cfg.generic_stt_api_base_url or "").rstrip("/")
            or _generic_engine.api_key != (cfg.generic_stt_api_key or "")
            or _generic_engine.model != (cfg.generic_stt_model or "")
        ):
            _generic_engine = GenericHTTPSTT(
                api_base_url=cfg.generic_stt_api_base_url,
                api_key=cfg.generic_stt_api_key,
                model=cfg.generic_stt_model,
            )
        return _generic_engine
    if cfg.stt_provider != "whisper":
        raise RuntimeError(f"未知 STT provider: {cfg.stt_provider}")
    global _engine
    size = model_size if model_size is not None else cfg.whisper_model
    lang = language if language is not None else cfg.whisper_language
    if _engine is None:
        _engine = STTEngine(model_size=size, language=lang)
    elif _engine.model_size != size:
        _engine.change_model(size)
    return _engine


def transcribe_with_fallback(
    audio: np.ndarray,
    sample_rate: int,
    position: str = "",
    language: str = "",
) -> str:
    """Resilient transcription: retry once, then fallback to whisper, with circuit breaker.

    Flow:
      1. If circuit breaker is open and provider != whisper → go straight to whisper.
      2. Try primary engine (up to 2 attempts with 0.3s gap).
      3. On failure → record circuit failure → fallback to whisper.
    """
    from core.config import get_config
    from api.realtime.ws import broadcast

    cfg = get_config()
    provider = cfg.stt_provider
    is_remote = provider in ("doubao", "generic")

    if is_remote and _is_circuit_open():
        _log.info("STT circuit open, using whisper fallback directly")
        broadcast({"type": "stt_fallback", "from": provider, "to": "whisper", "reason": "circuit_open"})
        try:
            return _whisper_transcribe(audio, sample_rate, position, language)
        except Exception as e:
            _log.error("Whisper fallback also failed: %s", e, exc_info=True)
            return ""

    primary = get_stt_engine()
    last_err: Optional[Exception] = None

    max_attempts = 2 if is_remote else 1
    for attempt in range(max_attempts):
        try:
            text = primary.transcribe(audio, sample_rate, position=position, language=language)
            if is_remote and not (text or "").strip():
                raise RuntimeError(f"{provider} 返回空文本")
            if is_remote:
                _circuit_reset()
            return text
        except Exception as e:
            last_err = e
            if attempt == 0 and is_remote:
                _log.warning("STT %s attempt 1 failed, retrying: %s", provider, e)
                time.sleep(0.3)
            else:
                _log.error("STT %s attempt %d failed: %s", provider, attempt + 1, e, exc_info=True)

    if is_remote and last_err is not None:
        _circuit_record_failure(is_timeout=_is_timeout_error(last_err))

    if is_remote:
        _log.warning("STT fallback to whisper (primary=%s err=%s)", provider, last_err)
        broadcast({"type": "stt_fallback", "from": provider, "to": "whisper", "reason": str(last_err)[:80]})
        try:
            return _whisper_transcribe(audio, sample_rate, position, language)
        except Exception as e:
            _log.error("Whisper fallback also failed: %s", e, exc_info=True)

    return ""
