"""STT engine factory: singleton management and provider selection."""

from typing import Optional
from .engines import STTEngine, DoubaoSTT, IflyitekSTT

_engine: Optional[STTEngine] = None
_doubao_engine: Optional[DoubaoSTT] = None
_iflytek_engine: Optional[IflyitekSTT] = None


def set_whisper_language(language: str) -> None:
    global _engine
    if _engine is not None:
        _engine.language = language


def get_stt_engine(
    model_size: Optional[str] = None,
    language: Optional[str] = None,
):
    """返回当前配置对应的 STT 引擎：whisper（本地）/ doubao（豆包）/ iflytek（讯飞）。"""
    from core.config import get_config
    cfg = get_config()
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
    if cfg.stt_provider == "iflytek":
        global _iflytek_engine
        if _iflytek_engine is None or (
            _iflytek_engine.app_id != (cfg.iflytek_stt_app_id or "")
            or _iflytek_engine.api_key != (cfg.iflytek_stt_api_key or "")
            or _iflytek_engine.api_secret != (cfg.iflytek_stt_api_secret or "")
        ):
            _iflytek_engine = IflyitekSTT(
                app_id=cfg.iflytek_stt_app_id,
                api_key=cfg.iflytek_stt_api_key,
                api_secret=cfg.iflytek_stt_api_secret,
            )
        return _iflytek_engine
    global _engine
    size = model_size if model_size is not None else cfg.whisper_model
    lang = language if language is not None else cfg.whisper_language
    if _engine is None:
        _engine = STTEngine(model_size=size, language=lang)
    elif _engine.model_size != size:
        _engine.change_model(size)
    return _engine
