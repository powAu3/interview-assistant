"""STT engine factory: singleton management, provider selection, and resilience."""

import time
import threading
from typing import Optional

import numpy as np

from core.logger import get_logger
from .engines import STTEngine, DoubaoSTT, FunASRSTT, GenericHTTPSTT

_log = get_logger("stt.factory")

_engine: Optional[STTEngine] = None
_whisper_engines: dict[tuple[str, str], STTEngine] = {}
_doubao_engine: Optional[DoubaoSTT] = None
_generic_engine: Optional[GenericHTTPSTT] = None
_funasr_engines: dict[str, FunASRSTT] = {}
_engine_lock = threading.Lock()
_whisper_infer_lock = threading.Lock()
_funasr_infer_lock = threading.Lock()
# 本地引擎推理非线程安全，同引擎串行；不同引擎（whisper vs funasr）互不阻塞，
# 面试官链路（funasr）不会被候选人链路（whisper）的转写卡住。
LOCAL_STT_PROVIDERS = ("whisper", "funasr")


def _local_infer_lock(provider: str) -> threading.Lock:
    return _funasr_infer_lock if provider == "funasr" else _whisper_infer_lock


def _fallback_target(cfg) -> str:
    """远程 ASR 失败时的降级引擎：whisper（默认）/funasr/none。"""
    return (getattr(cfg, "stt_fallback_provider", "whisper") or "whisper").strip().lower()


def _candidate_local_provider(cfg) -> str:
    """候选人链路最终使用的本地引擎（与 pipeline._candidate_provider_config
    的跟随规则一致）；远程候选人返回空串。"""
    provider = (getattr(cfg, "candidate_stt_provider", "whisper") or "whisper").strip()
    if provider in ("doubao", "generic") and not getattr(cfg, "candidate_remote_stt_enabled", False):
        provider = "whisper"
    primary = (getattr(cfg, "stt_provider", "") or "").strip()
    if primary in LOCAL_STT_PROVIDERS and provider in LOCAL_STT_PROVIDERS:
        provider = primary
    return provider if provider in LOCAL_STT_PROVIDERS else ""


def _evict_other_local_engine_locked(
    primary_provider: str,
    fallback: str = "whisper",
    in_use: str = "",
    candidate: str = "",
) -> None:
    """本地引擎互斥：只保留配置上真实会被使用的本地引擎——主链路本地引擎、
    远程主链路的降级引擎、候选人链路引擎（以及本次调用正在请求的引擎），
    其余卸载引用，避免两个模型（合计 ~1GB+ 内存）同时驻留。
    keep 集由配置稳定决定：若只按「最后请求者」滚动，candidate 与
    fallback 会互相把对方正在使用的引擎清掉。"""
    global _engine
    keep: set[str] = set()
    if primary_provider in LOCAL_STT_PROVIDERS:
        keep.add(primary_provider)
    else:
        # 远程主链路：只保留配置的降级引擎（默认 whisper）
        if fallback in LOCAL_STT_PROVIDERS:
            keep.add(fallback)
    if candidate in LOCAL_STT_PROVIDERS:
        keep.add(candidate)
    if in_use in LOCAL_STT_PROVIDERS:
        keep.add(in_use)
    if "whisper" not in keep and (_whisper_engines or _engine is not None):
        _log.info("Local STT mutex: evict whisper engines (primary=%s fallback=%s)", primary_provider, fallback)
        _whisper_engines.clear()
        _engine = None
    if "funasr" not in keep and _funasr_engines:
        _log.info("Local STT mutex: evict funasr engines (primary=%s fallback=%s)", primary_provider, fallback)
        _funasr_engines.clear()
REMOTE_EMPTY_RETRY_PAD_MS = 240
REMOTE_EMPTY_RETRY_MAX_AUDIO_SEC = 6.0

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


def _pad_audio_tail_silence(
    audio: np.ndarray,
    sample_rate: int,
    *,
    pad_ms: int,
) -> np.ndarray:
    if sample_rate <= 0 or len(audio) <= 0 or pad_ms <= 0:
        return audio
    pad_samples = int(round(sample_rate * (pad_ms / 1000.0)))
    if pad_samples <= 0:
        return audio
    return np.concatenate([audio, np.zeros(pad_samples, dtype=audio.dtype)])


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


def _funasr_fallback_transcribe(
    audio,
    sample_rate: int,
    position: str,
    language: str,
    *,
    status_event_type: str,
    whisper_lock_timeout_sec=None,
) -> str:
    """远程失败降级到 FunASR：未加载时广播状态并同步加载（与 whisper 降级同语义）。"""
    from api.realtime.ws import broadcast

    engine = get_stt_engine(provider="funasr")
    if not engine.is_loaded:
        _log.warning("FunASR fallback not loaded, loading synchronously for %.1fs audio", len(audio) / max(sample_rate, 1))
        broadcast({"type": status_event_type, "loaded": False, "loading": True, "provider": "funasr"})
        engine.load_model()
        broadcast({"type": status_event_type, "loaded": bool(engine.is_loaded), "loading": False, "provider": "funasr"})
    infer_lock = _local_infer_lock("funasr")
    acquired = False
    try:
        if whisper_lock_timeout_sec is None:
            infer_lock.acquire()
            acquired = True
        else:
            acquired = infer_lock.acquire(timeout=max(0.0, whisper_lock_timeout_sec))
        if not acquired:
            _log.debug("FunASR fallback skip reason=infer_lock_busy")
            return ""
        return engine.transcribe(audio, sample_rate, position=position, language=language)
    finally:
        if acquired:
            infer_lock.release()


def _local_fallback_transcribe(
    cfg,
    audio,
    sample_rate: int,
    position: str,
    language: str,
    *,
    status_event_type: str,
    whisper_model=None,
    whisper_language=None,
    whisper_lock_timeout_sec=None,
) -> str:
    """按 stt_fallback_provider 配置分派降级：whisper / funasr / none。"""
    target = _fallback_target(cfg)
    if target == "none":
        return ""
    if target == "funasr":
        try:
            return _funasr_fallback_transcribe(
                audio, sample_rate, position, language,
                status_event_type=status_event_type,
                whisper_lock_timeout_sec=whisper_lock_timeout_sec,
            )
        except Exception as e:
            _log.error("FunASR fallback failed: %s", e, exc_info=True)
            return ""
    whisper_loaded = _is_whisper_engine_loaded(whisper_model, whisper_language)
    from api.realtime.ws import broadcast

    broadcast({"type": status_event_type, "loaded": whisper_loaded, "loading": not whisper_loaded, "provider": "whisper"})
    try:
        if whisper_loaded:
            return _call_whisper_transcribe(
                audio, sample_rate, position, language,
                model_size=whisper_model,
                whisper_language=whisper_language,
                whisper_lock_timeout_sec=whisper_lock_timeout_sec,
            )
        return _call_whisper_transcribe_fallback(
            audio, sample_rate, position, language,
            model_size=whisper_model,
            whisper_language=whisper_language,
            status_event_type=status_event_type,
            whisper_lock_timeout_sec=whisper_lock_timeout_sec,
        )
    except Exception as e:
        _log.error("Whisper fallback also failed: %s", e, exc_info=True)
        return ""


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
    """后台预载降级引擎（按 stt_fallback_provider 配置），降级时零等待。"""
    from core.config import get_config
    cfg = get_config()
    if not cfg.whisper_preload:
        _log.info("Fallback preload disabled by config")
        return
    if cfg.stt_provider in ("doubao", "generic"):
        target = _fallback_target(cfg)
        if target == "none":
            return
        if target == "funasr":
            def _load_funasr():
                from api.realtime.ws import broadcast
                broadcast({"type": "stt_status", "loaded": False, "loading": True, "provider": "funasr-preload"})
                try:
                    engine = get_stt_engine(provider="funasr")
                    engine.load_model()
                    _log.info("FunASR fallback model pre-loaded")
                    broadcast({"type": "stt_status", "loaded": bool(engine.is_loaded), "loading": False, "provider": "funasr-preload"})
                except Exception as e:
                    _log.warning("FunASR fallback pre-load failed: %s", e)
                    broadcast({"type": "stt_status", "loaded": False, "loading": False, "provider": "funasr-preload", "error": str(e)})
            threading.Thread(target=_load_funasr, daemon=True, name="funasr-preload").start()
            return
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
    if effective_provider == "funasr":
        global _funasr_engines
        model_name = getattr(cfg, "funasr_model", "paraformer-zh") or "paraformer-zh"
        with _engine_lock:
            # 以主链路配置为准做互斥：远程主链路时即使临时请求 funasr 也不清 whisper 兜底
            _evict_other_local_engine_locked(
                getattr(cfg, "stt_provider", "") or effective_provider,
                _fallback_target(cfg),
                in_use=effective_provider,
                candidate=_candidate_local_provider(cfg),
            )
            engine = _funasr_engines.get(model_name)
            if engine is None or engine.model_name != model_name:
                engine = FunASRSTT(model_name=model_name)
                # 只保留新引擎：换模型时卸掉旧引用，避免两份 ~1GB 模型同时驻留
                _funasr_engines.clear()
                _funasr_engines[model_name] = engine
            return engine
    if effective_provider != "whisper":
        raise RuntimeError(f"未知 STT provider: {effective_provider}")
    global _engine
    size = model_size if model_size is not None else cfg.whisper_model
    lang = language if language is not None else cfg.whisper_language
    key = (size or "base", lang or "auto")
    with _engine_lock:
        _evict_other_local_engine_locked(
            getattr(cfg, "stt_provider", "") or effective_provider,
            _fallback_target(cfg),
            in_use=effective_provider,
            candidate=_candidate_local_provider(cfg),
        )
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
    fallback_on_empty_remote: bool = False,
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
        target = _fallback_target(cfg)
        _log.info("STT circuit open, fallback via %s", target)
        broadcast({"type": fallback_event_type, "scope": circuit_scope, "from": selected_provider, "to": target, "reason": "circuit_open"})
        return _local_fallback_transcribe(
            cfg,
            audio,
            sample_rate,
            position,
            language,
            status_event_type=status_event_type,
            whisper_model=whisper_model,
            whisper_language=whisper_language,
            whisper_lock_timeout_sec=whisper_lock_timeout_sec,
        )

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
    # 空文本（多为 VAD 切出的静音/语气词短段）不算服务故障，不计入熔断：
    # 10-23 那场面试就是 3 个 1-2s 空段把熔断打开，整场被降级到本地 whisper。
    empty_result = False

    is_timeout_err = False
    is_auth_err = False
    max_attempts = 2 if is_remote else 1
    for attempt in range(max_attempts):
        try:
            if selected_provider in LOCAL_STT_PROVIDERS:
                if not primary.is_loaded:
                    if whisper_require_loaded:
                        _log.debug(
                            "Local STT skip scope=%s reason=model_not_loaded model=%s",
                            circuit_scope,
                            getattr(primary, "model_size", ""),
                        )
                        return ""
                    primary.load_model()
                infer_lock = _local_infer_lock(selected_provider)
                acquired = False
                try:
                    if whisper_lock_timeout_sec is None:
                        infer_lock.acquire()
                        acquired = True
                    else:
                        acquired = infer_lock.acquire(timeout=max(0.0, whisper_lock_timeout_sec))
                    if not acquired:
                        _log.debug(
                            "Local STT skip scope=%s reason=infer_lock_busy model=%s audio=%.1fs",
                            circuit_scope,
                            getattr(primary, "model_size", ""),
                            audio_sec,
                        )
                        return ""
                    text = primary.transcribe(audio, sample_rate, position=position, language=language)
                finally:
                    if acquired:
                        infer_lock.release()
            else:
                text = primary.transcribe(audio, sample_rate, position=position, language=language)
            if is_remote and not (text or "").strip():
                _log.warning(
                    "STT %s returned empty text scope=%s raw=%.1fs fallback_on_empty=%s",
                    selected_provider,
                    circuit_scope,
                    audio_sec,
                    fallback_on_empty_remote,
                )
                if (
                    circuit_scope == "interviewer"
                    and audio_sec > 0.0
                    and audio_sec <= REMOTE_EMPTY_RETRY_MAX_AUDIO_SEC
                ):
                    try:
                        retry_audio = _pad_audio_tail_silence(
                            audio,
                            sample_rate,
                            pad_ms=REMOTE_EMPTY_RETRY_PAD_MS,
                        )
                        retry_audio_sec = len(retry_audio) / sample_rate if sample_rate else audio_sec
                        _log.info(
                            "STT %s retrying empty interviewer segment with tail pad raw=%.1fs padded=%.1fs",
                            selected_provider,
                            audio_sec,
                            retry_audio_sec,
                        )
                        retry_text = primary.transcribe(
                            retry_audio,
                            sample_rate,
                            position=position,
                            language=language,
                        )
                        if (retry_text or "").strip():
                            _call_circuit_reset(circuit_scope)
                            broadcast({
                                "type": status_event_type,
                                "loaded": bool(primary.is_loaded),
                                "loading": False,
                                "provider": selected_provider,
                            })
                            return retry_text
                    except Exception as retry_err:
                        _log.warning(
                            "STT %s empty-text retry failed scope=%s: %s",
                            selected_provider,
                            circuit_scope,
                            retry_err,
                        )
                if not fallback_on_empty_remote and audio_sec < 5.0:
                    _log.info(
                        "STT %s returned empty text for short audio %.1fs; suppress fallback",
                        selected_provider,
                        audio_sec,
                    )
                    return ""
                empty_result = True
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

    if is_remote and last_err is not None and not empty_result:
        _call_circuit_record_failure(circuit_scope, is_timeout=is_timeout_err, is_auth=is_auth_err)

    if is_remote:
        target = _fallback_target(cfg)
        _log.warning("STT fallback via %s (primary=%s err=%s)", target, selected_provider, last_err)
        broadcast({"type": fallback_event_type, "scope": circuit_scope, "from": selected_provider, "to": target, "reason": str(last_err)[:80]})
        return _local_fallback_transcribe(
            cfg,
            audio,
            sample_rate,
            position,
            language,
            status_event_type=status_event_type,
            whisper_model=whisper_model,
            whisper_language=whisper_language,
            whisper_lock_timeout_sec=whisper_lock_timeout_sec,
        )

    return ""
