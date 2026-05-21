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
_engine_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Circuit breaker for remote STT engines (doubao / generic)
# ---------------------------------------------------------------------------

_circuit_lock = threading.Lock()
_circuit_failures = 0
_circuit_open_until = 0.0
CIRCUIT_THRESHOLD = 3
CIRCUIT_THRESHOLD_TIMEOUT = 5
CIRCUIT_COOLDOWN_SEC = 60.0
CIRCUIT_COOLDOWN_AUTH_SEC = 3600.0

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


def _is_auth_error(err: Exception) -> bool:
    msg = str(err).lower()
    return "401" in msg or "403" in msg or "unauthorized" in msg or "forbidden" in msg or "grant not found" in msg


def _circuit_record_failure(is_timeout: bool = False, is_auth: bool = False):
    global _circuit_failures, _circuit_open_until
    threshold = CIRCUIT_THRESHOLD_TIMEOUT if is_timeout else CIRCUIT_THRESHOLD
    with _circuit_lock:
        _circuit_failures += 1
        if _circuit_failures >= threshold:
            cooldown = CIRCUIT_COOLDOWN_AUTH_SEC if is_auth else CIRCUIT_COOLDOWN_SEC
            _circuit_open_until = time.monotonic() + cooldown
            _log.warning(
                "STT circuit OPEN after %d failures (timeout=%s auth=%s), fallback for %.0fs",
                _circuit_failures, is_timeout, is_auth, cooldown,
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
    global _engine, _whisper_preload_done
    from core.config import get_config
    cfg = get_config()
    size = cfg.whisper_model or "base"
    lang = cfg.whisper_language or "auto"
    with _engine_lock:
        if _engine is None:
            _engine = STTEngine(model_size=size, language=lang)
        engine = _engine
    if not engine.is_loaded:
        _log.info("Whisper fallback: loading model %s", engine.model_size)
        # Loading can take seconds; do not hold the global engine lock while
        # faster-whisper initializes, or /ws init and start/resume can block.
        engine.load_model()
    if engine.is_loaded:
        _whisper_preload_done = True
    return engine


def _whisper_transcribe(audio: np.ndarray, sample_rate: int,
                        position: str, language: str) -> str:
    engine = _get_whisper_fallback()
    return engine.transcribe(audio, sample_rate, position=position, language=language)


_whisper_preload_done = False


def _is_whisper_preloaded() -> bool:
    global _whisper_preload_done
    if _whisper_preload_done:
        return True
    with _engine_lock:
        if _engine is not None and _engine.is_loaded:
            _whisper_preload_done = True
            return True
    return False


def _whisper_transcribe_fallback(audio: np.ndarray, sample_rate: int,
                                 position: str, language: str) -> str:
    """Fallback through Whisper, loading it first if preload has not completed."""
    global _whisper_preload_done, _engine
    with _engine_lock:
        if _engine is not None and _engine.is_loaded:
            _whisper_preload_done = True
            return _engine.transcribe(audio, sample_rate, position=position, language=language)
        if _engine is None:
            from core.config import get_config
            cfg = get_config()
            _engine = STTEngine(model_size=cfg.whisper_model or "base", language=cfg.whisper_language or "auto")
        engine = _engine
    _log.warning("Whisper fallback not loaded, loading synchronously for %.1fs audio", len(audio) / max(sample_rate, 1))
    from api.realtime.ws import broadcast
    broadcast({"type": "stt_status", "loaded": False, "loading": True, "provider": "whisper"})
    engine.load_model()
    _whisper_preload_done = bool(engine.is_loaded)
    broadcast({"type": "stt_status", "loaded": bool(engine.is_loaded), "loading": False, "provider": "whisper"})
    return engine.transcribe(audio, sample_rate, position=position, language=language)


def _do_whisper_load():
    global _whisper_preload_done
    from api.realtime.ws import broadcast
    try:
        _get_whisper_fallback()
        _whisper_preload_done = True
        _log.info("Whisper fallback model loaded after degradation")
        broadcast({"type": "stt_status", "loaded": True, "loading": False, "provider": "whisper"})
    except Exception as e:
        _log.error("Whisper fallback load failed: %s", e, exc_info=True)
        broadcast({"type": "stt_status", "loaded": False, "loading": False, "provider": "whisper", "error": str(e)})


def preload_whisper_fallback() -> None:
    """Pre-load whisper model in background so fallback is instant when needed."""
    from core.config import get_config
    cfg = get_config()
    if not cfg.whisper_preload:
        _log.info("Whisper preload disabled by config")
        return
    if cfg.stt_provider in ("doubao", "generic"):
        def _load():
            from api.realtime.ws import broadcast
            broadcast({"type": "stt_status", "loaded": False, "loading": True, "provider": "whisper-preload"})
            try:
                _get_whisper_fallback()
                _log.info("Whisper fallback model pre-loaded")
                broadcast({"type": "stt_status", "loaded": True, "loading": False, "provider": "whisper-preload"})
            except Exception as e:
                _log.warning("Whisper fallback pre-load failed: %s", e)
                broadcast({"type": "stt_status", "loaded": False, "loading": False, "provider": "whisper-preload", "error": str(e)})
        t = threading.Thread(target=_load, daemon=True, name="whisper-preload")
        t.start()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def set_whisper_language(language: str) -> None:
    global _engine
    with _engine_lock:
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
        access_token = cfg.doubao_stt_access_token or ""
        api_key = getattr(cfg, "doubao_stt_api_key", "") or ""
        with _engine_lock:
            if _doubao_engine is None or (
                _doubao_engine.app_id != cfg.doubao_stt_app_id
                or _doubao_engine.access_token != access_token
                or _doubao_engine.api_key != api_key
                or _doubao_engine.resource_id != cfg.doubao_stt_resource_id
                or _doubao_engine.boosting_table_id != (cfg.doubao_stt_boosting_table_id or "")
            ):
                _doubao_engine = DoubaoSTT(
                    app_id=cfg.doubao_stt_app_id,
                    access_token=access_token,
                    api_key=api_key,
                    resource_id=cfg.doubao_stt_resource_id or "volc.seedasr.sauc.duration",
                    boosting_table_id=cfg.doubao_stt_boosting_table_id or "",
                )
            return _doubao_engine
    if cfg.stt_provider == "generic":
        global _generic_engine
        api_key = cfg.generic_stt_api_key or ""
        with _engine_lock:
            if _generic_engine is None or (
                _generic_engine.api_base_url != (cfg.generic_stt_api_base_url or "").rstrip("/")
                or _generic_engine.api_key != api_key
                or _generic_engine.model != (cfg.generic_stt_model or "")
                or _generic_engine.custom_headers != getattr(cfg, "generic_stt_custom_headers", "")
            ):
                _generic_engine = GenericHTTPSTT(
                    api_base_url=cfg.generic_stt_api_base_url,
                    api_key=api_key,
                    model=cfg.generic_stt_model,
                    custom_headers=getattr(cfg, "generic_stt_custom_headers", ""),
                )
            return _generic_engine
    if cfg.stt_provider != "whisper":
        raise RuntimeError(f"未知 STT provider: {cfg.stt_provider}")
    global _engine
    size = model_size if model_size is not None else cfg.whisper_model
    lang = language if language is not None else cfg.whisper_language
    with _engine_lock:
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
    audio_sec = len(audio) / sample_rate if sample_rate and len(audio) else 0.0

    if is_remote and _is_circuit_open():
        _log.info("STT circuit open, using whisper fallback directly")
        broadcast({"type": "stt_fallback", "from": provider, "to": "whisper", "reason": "circuit_open"})
        broadcast({"type": "stt_status", "loaded": _is_whisper_preloaded(), "loading": not _is_whisper_preloaded(), "provider": "whisper"})
        try:
            if _is_whisper_preloaded():
                return _whisper_transcribe(audio, sample_rate, position, language)
            return _whisper_transcribe_fallback(audio, sample_rate, position, language)
        except Exception as e:
            _log.error("Whisper fallback also failed: %s", e, exc_info=True)
            return ""

    primary = get_stt_engine()
    last_err: Optional[Exception] = None

    is_timeout_err = False
    is_auth_err = False
    max_attempts = 2 if is_remote else 1
    for attempt in range(max_attempts):
        try:
            text = primary.transcribe(audio, sample_rate, position=position, language=language)
            if is_remote and not (text or "").strip():
                if audio_sec < 5.0:
                    _log.info(
                        "STT %s returned empty text for short audio %.1fs; suppress fallback",
                        provider,
                        audio_sec,
                    )
                    return ""
                last_err = RuntimeError(f"{provider} 返回空文本")
                break
            if is_remote:
                _circuit_reset()
                broadcast({"type": "stt_status", "loaded": bool(primary.is_loaded), "loading": False, "provider": provider})
            return text
        except Exception as e:
            last_err = e
            is_timeout_err = _is_timeout_error(e)
            is_auth_err = _is_auth_error(e)
            if attempt == 0 and is_remote:
                if is_timeout_err or is_auth_err:
                    _log.warning("STT %s attempt 1 %s, skipping retry: %s", provider,
                                 "auth error" if is_auth_err else "timeout", e)
                    break
                _log.warning("STT %s attempt 1 failed, retrying: %s", provider, e)
                time.sleep(0.3)
            else:
                _log.error("STT %s attempt %d failed: %s", provider, attempt + 1, e)

    if is_remote and last_err is not None:
        _circuit_record_failure(is_timeout=is_timeout_err, is_auth=is_auth_err)

    if is_remote:
        _log.warning("STT fallback to whisper (primary=%s err=%s)", provider, last_err)
        broadcast({"type": "stt_fallback", "from": provider, "to": "whisper", "reason": str(last_err)[:80]})
        broadcast({"type": "stt_status", "loaded": _is_whisper_preloaded(), "loading": not _is_whisper_preloaded(), "provider": "whisper"})
        try:
            if _is_whisper_preloaded():
                return _whisper_transcribe(audio, sample_rate, position, language)
            return _whisper_transcribe_fallback(audio, sample_rate, position, language)
        except Exception as e:
            _log.error("Whisper fallback also failed: %s", e, exc_info=True)

    return ""
