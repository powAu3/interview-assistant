"""STT engine factory: singleton management, provider selection, and resilience."""

import time
import threading
from typing import Optional

import numpy as np

from core.logger import get_logger
from .engines import STTEngine, DoubaoSTT, GenericHTTPSTT

_log = get_logger("stt.factory")

_engine: Optional[STTEngine] = None
_whisper_engines: dict[tuple[str, str], STTEngine] = {}
_doubao_engine: Optional[DoubaoSTT] = None
_generic_engine: Optional[GenericHTTPSTT] = None
_engine_lock = threading.Lock()
_whisper_infer_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Circuit breaker for remote STT engines (doubao / generic)
# ---------------------------------------------------------------------------

_circuit_lock = threading.Lock()
_circuit_failures = 0
_circuit_open_until = 0.0
_circuit_failures_by_scope: dict[str, int] = {}
_circuit_open_until_by_scope: dict[str, float] = {}
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


def _circuit_record_failure(is_timeout: bool = False, is_auth: bool = False, scope: str = "interviewer"):
    global _circuit_failures, _circuit_open_until
    circuit_scope = (scope or "interviewer").strip() or "interviewer"
    threshold = CIRCUIT_THRESHOLD_TIMEOUT if is_timeout else CIRCUIT_THRESHOLD
    with _circuit_lock:
        failures = _circuit_failures_by_scope.get(circuit_scope, 0) + 1
        _circuit_failures_by_scope[circuit_scope] = failures
        if circuit_scope == "interviewer":
            _circuit_failures = failures
        if failures >= threshold:
            cooldown = CIRCUIT_COOLDOWN_AUTH_SEC if is_auth else CIRCUIT_COOLDOWN_SEC
            open_until = time.monotonic() + cooldown
            _circuit_open_until_by_scope[circuit_scope] = open_until
            if circuit_scope == "interviewer":
                _circuit_open_until = open_until
            _log.warning(
                "STT circuit OPEN scope=%s after %d failures (timeout=%s auth=%s), fallback for %.0fs",
                circuit_scope, failures, is_timeout, is_auth, cooldown,
            )


def _circuit_reset(scope: str = "interviewer"):
    global _circuit_failures, _circuit_open_until
    circuit_scope = (scope or "interviewer").strip() or "interviewer"
    with _circuit_lock:
        if _circuit_failures_by_scope.get(circuit_scope, 0) > 0:
            _circuit_failures_by_scope[circuit_scope] = 0
            _circuit_open_until_by_scope[circuit_scope] = 0.0
        if circuit_scope == "interviewer" and _circuit_failures > 0:
            _circuit_failures = 0
            _circuit_open_until = 0.0


def _is_circuit_open(scope: str = "interviewer") -> bool:
    circuit_scope = (scope or "interviewer").strip() or "interviewer"
    with _circuit_lock:
        failures = _circuit_failures_by_scope.get(circuit_scope, _circuit_failures if circuit_scope == "interviewer" else 0)
        open_until = _circuit_open_until_by_scope.get(
            circuit_scope,
            _circuit_open_until if circuit_scope == "interviewer" else 0.0,
        )
        if failures < CIRCUIT_THRESHOLD:
            return False
        if time.monotonic() >= open_until:
            return False
        return True


def _call_circuit_open(scope: str) -> bool:
    try:
        return _is_circuit_open(scope)
    except TypeError:
        return _is_circuit_open()


def _call_circuit_reset(scope: str) -> None:
    try:
        _circuit_reset(scope)
    except TypeError:
        _circuit_reset()


def _call_circuit_record_failure(scope: str, *, is_timeout: bool, is_auth: bool) -> None:
    try:
        _circuit_record_failure(is_timeout=is_timeout, is_auth=is_auth, scope=scope)
    except TypeError:
        _circuit_record_failure(is_timeout=is_timeout, is_auth=is_auth)


# ---------------------------------------------------------------------------
# Whisper fallback (lazy init)
# ---------------------------------------------------------------------------

def _get_whisper_fallback() -> STTEngine:
    global _engine, _whisper_preload_done
    from core.config import get_config
    cfg = get_config()
    size = cfg.whisper_model or "base"
    lang = cfg.whisper_language or "auto"
    engine = get_stt_engine(provider="whisper", model_size=size, language=lang)
    if not engine.is_loaded:
        _log.info("Whisper fallback: loading model %s", engine.model_size)
        # Loading can take seconds; do not hold the global engine lock while
        # faster-whisper initializes, or /ws init and start/resume can block.
        engine.load_model()
    if engine.is_loaded:
        _whisper_preload_done = True
    return engine


def _transcribe_with_whisper_lock(
    engine: STTEngine,
    audio: np.ndarray,
    sample_rate: int,
    position: str,
    language: str,
    whisper_lock_timeout_sec: Optional[float] = None,
) -> str:
    acquired = False
    try:
        if whisper_lock_timeout_sec is None:
            _whisper_infer_lock.acquire()
            acquired = True
        else:
            acquired = _whisper_infer_lock.acquire(timeout=max(0.0, whisper_lock_timeout_sec))
        if not acquired:
            _log.debug("Whisper skip reason=infer_lock_busy model=%s", getattr(engine, "model_size", ""))
            return ""
        return engine.transcribe(audio, sample_rate, position=position, language=language)
    finally:
        if acquired:
            _whisper_infer_lock.release()


def _whisper_transcribe(
    audio: np.ndarray,
    sample_rate: int,
    position: str,
    language: str,
    *,
    model_size: Optional[str] = None,
    whisper_language: Optional[str] = None,
    whisper_lock_timeout_sec: Optional[float] = None,
) -> str:
    engine = get_stt_engine(
        provider="whisper",
        model_size=model_size,
        language=whisper_language,
    )
    if not engine.is_loaded:
        _log.info("Whisper: loading model %s", engine.model_size)
        engine.load_model()
    return _transcribe_with_whisper_lock(
        engine,
        audio,
        sample_rate,
        position,
        language,
        whisper_lock_timeout_sec,
    )


_whisper_preload_done = False


def _remove_whisper_engine_aliases_locked(
    engine: STTEngine,
    *,
    keep_key: Optional[tuple[str, str]] = None,
) -> None:
    for cached_key, cached_engine in list(_whisper_engines.items()):
        if cached_engine is engine and cached_key != keep_key:
            _whisper_engines.pop(cached_key, None)


def _is_whisper_preloaded() -> bool:
    global _whisper_preload_done
    if _whisper_preload_done:
        return True
    with _engine_lock:
        if _engine is not None and _engine.is_loaded:
            _whisper_preload_done = True
            return True
    return False


def _is_whisper_engine_loaded(
    model_size: Optional[str] = None,
    whisper_language: Optional[str] = None,
) -> bool:
    from core.config import get_config

    cfg = get_config()
    key = (
        model_size or cfg.whisper_model or "base",
        whisper_language or cfg.whisper_language or "auto",
    )
    with _engine_lock:
        engine = _whisper_engines.get(key)
        if engine is not None and engine.is_loaded:
            return True
        return bool(
            _engine is not None
            and getattr(_engine, "model_size", None) == key[0]
            and getattr(_engine, "language", None) == key[1]
            and _engine.is_loaded
        )


def _whisper_transcribe_fallback(
    audio: np.ndarray,
    sample_rate: int,
    position: str,
    language: str,
    *,
    model_size: Optional[str] = None,
    whisper_language: Optional[str] = None,
    status_event_type: str = "stt_status",
    whisper_lock_timeout_sec: Optional[float] = None,
) -> str:
    """Fallback through Whisper, loading it first if preload has not completed."""
    global _whisper_preload_done
    from core.config import get_config
    cfg = get_config()
    size = model_size or cfg.whisper_model or "base"
    lang = whisper_language or cfg.whisper_language or "auto"
    try:
        engine = get_stt_engine(
            provider="whisper",
            model_size=size,
            language=lang,
        )
    except TypeError:
        # Some tests and plugins monkeypatch get_stt_engine with the old
        # signature. Build the Whisper fallback directly in that case.
        global _engine
        with _engine_lock:
            if _engine is None:
                _engine = STTEngine(model_size=size, language=lang)
            engine = _engine
    if engine.is_loaded:
        _whisper_preload_done = True
        return _transcribe_with_whisper_lock(
            engine,
            audio,
            sample_rate,
            position,
            language,
            whisper_lock_timeout_sec,
        )
    _log.warning("Whisper fallback not loaded, loading synchronously for %.1fs audio", len(audio) / max(sample_rate, 1))
    from api.realtime.ws import broadcast
    broadcast({"type": status_event_type, "loaded": False, "loading": True, "provider": "whisper"})
    engine.load_model()
    _whisper_preload_done = bool(engine.is_loaded)
    broadcast({"type": status_event_type, "loaded": bool(engine.is_loaded), "loading": False, "provider": "whisper"})
    return _transcribe_with_whisper_lock(
        engine,
        audio,
        sample_rate,
        position,
        language,
        whisper_lock_timeout_sec,
    )


def _call_whisper_transcribe(
    audio: np.ndarray,
    sample_rate: int,
    position: str,
    language: str,
    *,
    model_size: Optional[str] = None,
    whisper_language: Optional[str] = None,
    whisper_lock_timeout_sec: Optional[float] = None,
) -> str:
    try:
        return _whisper_transcribe(
            audio,
            sample_rate,
            position,
            language,
            model_size=model_size,
            whisper_language=whisper_language,
            whisper_lock_timeout_sec=whisper_lock_timeout_sec,
        )
    except TypeError:
        return _whisper_transcribe(audio, sample_rate, position, language)


def _call_whisper_transcribe_fallback(
    audio: np.ndarray,
    sample_rate: int,
    position: str,
    language: str,
    *,
    model_size: Optional[str] = None,
    whisper_language: Optional[str] = None,
    status_event_type: str = "stt_status",
    whisper_lock_timeout_sec: Optional[float] = None,
) -> str:
    try:
        return _whisper_transcribe_fallback(
            audio,
            sample_rate,
            position,
            language,
            model_size=model_size,
            whisper_language=whisper_language,
            status_event_type=status_event_type,
            whisper_lock_timeout_sec=whisper_lock_timeout_sec,
        )
    except TypeError:
        return _whisper_transcribe_fallback(audio, sample_rate, position, language)


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
    lang = (language or "auto").strip() or "auto"
    with _engine_lock:
        if _engine is not None:
            _remove_whisper_engine_aliases_locked(_engine)
            _engine.language = lang
            _whisper_engines[(getattr(_engine, "model_size", "base") or "base", lang)] = _engine


def get_stt_engine(
    provider: Optional[str] = None,
    model_size: Optional[str] = None,
    language: Optional[str] = None,
):
    """返回当前配置对应的 STT 引擎：whisper（本地）/ doubao（豆包）/ generic（通用 HTTP）。"""
    from core.config import get_config
    cfg = get_config()
    effective_provider = provider or cfg.stt_provider
    if effective_provider == "iflytek":
        raise RuntimeError("讯飞 STT 已下线，请在设置中改为通用 ASR 或 Whisper")
    if effective_provider == "doubao":
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
    if effective_provider == "generic":
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
    if effective_provider != "whisper":
        raise RuntimeError(f"未知 STT provider: {effective_provider}")
    global _engine
    size = model_size if model_size is not None else cfg.whisper_model
    lang = language if language is not None else cfg.whisper_language
    key = (size or "base", lang or "auto")
    with _engine_lock:
        default_key = (cfg.whisper_model or "base", cfg.whisper_language or "auto")
        if _engine is None and key == default_key:
            _whisper_engines.pop(key, None)
        engine = _whisper_engines.get(key)
        if engine is not None and (
            getattr(engine, "model_size", None) != key[0]
            or getattr(engine, "language", None) != key[1]
        ):
            _whisper_engines.pop(key, None)
            engine = None
        if engine is None:
            if (
                _engine is not None
                and getattr(_engine, "model_size", None) == key[0]
                and getattr(_engine, "language", None) == key[1]
            ):
                engine = _engine
            else:
                engine = STTEngine(model_size=key[0], language=key[1])
            _whisper_engines[key] = engine
        _remove_whisper_engine_aliases_locked(engine, keep_key=key)
        if _engine is None or key == default_key:
            _engine = engine
        return engine


def transcribe_with_fallback(
    audio: np.ndarray,
    sample_rate: int,
    position: str = "",
    language: str = "",
    *,
    provider: Optional[str] = None,
    whisper_model: Optional[str] = None,
    whisper_language: Optional[str] = None,
    allow_remote: bool = True,
    status_event_type: str = "stt_status",
    scope: str = "interviewer",
    whisper_lock_timeout_sec: Optional[float] = None,
    whisper_require_loaded: bool = False,
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
    selected_provider = provider or cfg.stt_provider
    if selected_provider in ("doubao", "generic") and not allow_remote:
        selected_provider = "whisper"
    is_remote = selected_provider in ("doubao", "generic")
    audio_sec = len(audio) / sample_rate if sample_rate and len(audio) else 0.0
    circuit_scope = (scope or "interviewer").strip() or "interviewer"
    fallback_event_type = "candidate_stt_fallback" if circuit_scope == "candidate" else "stt_fallback"

    if is_remote and _call_circuit_open(circuit_scope):
        _log.info("STT circuit open, using whisper fallback directly")
        broadcast({"type": fallback_event_type, "scope": circuit_scope, "from": selected_provider, "to": "whisper", "reason": "circuit_open"})
        whisper_loaded = _is_whisper_engine_loaded(whisper_model, whisper_language)
        broadcast({"type": status_event_type, "loaded": whisper_loaded, "loading": not whisper_loaded, "provider": "whisper"})
        try:
            if whisper_loaded:
                return _call_whisper_transcribe(
                    audio,
                    sample_rate,
                    position,
                    language,
                    model_size=whisper_model,
                    whisper_language=whisper_language,
                    whisper_lock_timeout_sec=whisper_lock_timeout_sec,
                )
            return _call_whisper_transcribe_fallback(
                audio,
                sample_rate,
                position,
                language,
                model_size=whisper_model,
                whisper_language=whisper_language,
                status_event_type=status_event_type,
                whisper_lock_timeout_sec=whisper_lock_timeout_sec,
            )
        except Exception as e:
            _log.error("Whisper fallback also failed: %s", e, exc_info=True)
            return ""

    try:
        primary = get_stt_engine(
            provider=selected_provider,
            model_size=whisper_model,
            language=whisper_language,
        )
    except TypeError:
        # Backward compatibility for tests or plugins monkeypatching the old
        # two-argument factory signature.
        primary = get_stt_engine(
            model_size=whisper_model,
            language=whisper_language,
        )
    last_err: Optional[Exception] = None

    is_timeout_err = False
    is_auth_err = False
    max_attempts = 2 if is_remote else 1
    for attempt in range(max_attempts):
        try:
            if selected_provider == "whisper":
                if not primary.is_loaded:
                    if whisper_require_loaded:
                        _log.debug(
                            "Whisper skip scope=%s reason=model_not_loaded model=%s",
                            circuit_scope,
                            getattr(primary, "model_size", ""),
                        )
                        return ""
                    primary.load_model()
                acquired = False
                try:
                    if whisper_lock_timeout_sec is None:
                        _whisper_infer_lock.acquire()
                        acquired = True
                    else:
                        acquired = _whisper_infer_lock.acquire(timeout=max(0.0, whisper_lock_timeout_sec))
                    if not acquired:
                        _log.debug(
                            "Whisper skip scope=%s reason=infer_lock_busy model=%s audio=%.1fs",
                            circuit_scope,
                            getattr(primary, "model_size", ""),
                            audio_sec,
                        )
                        return ""
                    text = primary.transcribe(audio, sample_rate, position=position, language=language)
                finally:
                    if acquired:
                        _whisper_infer_lock.release()
            else:
                text = primary.transcribe(audio, sample_rate, position=position, language=language)
            if is_remote and not (text or "").strip():
                if audio_sec < 5.0:
                    _log.info(
                        "STT %s returned empty text for short audio %.1fs; suppress fallback",
                        selected_provider,
                        audio_sec,
                    )
                    return ""
                last_err = RuntimeError(f"{selected_provider} 返回空文本")
                break
            if is_remote:
                _call_circuit_reset(circuit_scope)
                broadcast({"type": status_event_type, "loaded": bool(primary.is_loaded), "loading": False, "provider": selected_provider})
            return text
        except Exception as e:
            last_err = e
            is_timeout_err = _is_timeout_error(e)
            is_auth_err = _is_auth_error(e)
            if attempt == 0 and is_remote:
                if is_timeout_err or is_auth_err:
                    _log.warning("STT %s attempt 1 %s, skipping retry: %s", selected_provider,
                                 "auth error" if is_auth_err else "timeout", e)
                    break
                _log.warning("STT %s attempt 1 failed, retrying: %s", selected_provider, e)
                time.sleep(0.3)
            else:
                _log.error("STT %s attempt %d failed: %s", selected_provider, attempt + 1, e)

    if is_remote and last_err is not None:
        _call_circuit_record_failure(circuit_scope, is_timeout=is_timeout_err, is_auth=is_auth_err)

    if is_remote:
        _log.warning("STT fallback to whisper (primary=%s err=%s)", selected_provider, last_err)
        broadcast({"type": fallback_event_type, "scope": circuit_scope, "from": selected_provider, "to": "whisper", "reason": str(last_err)[:80]})
        whisper_loaded = _is_whisper_engine_loaded(whisper_model, whisper_language)
        broadcast({"type": status_event_type, "loaded": whisper_loaded, "loading": not whisper_loaded, "provider": "whisper"})
        try:
            if whisper_loaded:
                return _call_whisper_transcribe(
                    audio,
                    sample_rate,
                    position,
                    language,
                    model_size=whisper_model,
                    whisper_language=whisper_language,
                    whisper_lock_timeout_sec=whisper_lock_timeout_sec,
                )
            return _call_whisper_transcribe_fallback(
                audio,
                sample_rate,
                position,
                language,
                model_size=whisper_model,
                whisper_language=whisper_language,
                status_event_type=status_event_type,
                whisper_lock_timeout_sec=whisper_lock_timeout_sec,
            )
        except Exception as e:
            _log.error("Whisper fallback also failed: %s", e, exc_info=True)

    return ""
