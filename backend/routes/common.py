import threading
import time
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from openai import OpenAI

from core.config import (
    get_config, update_config,
    POSITION_OPTIONS, LANGUAGE_OPTIONS, WHISPER_MODEL_OPTIONS,
)
from services.audio import AudioCapture
from services.stt import get_stt_engine
from services.resume import parse_resume_bytes, summarize_resume

router = APIRouter()

_model_health: dict[int, str] = {}


class ConfigUpdate(BaseModel):
    active_model: Optional[int] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    think_mode: Optional[bool] = None
    whisper_model: Optional[str] = None
    whisper_language: Optional[str] = None
    position: Optional[str] = None
    language: Optional[str] = None
    auto_detect: Optional[bool] = None
    silence_threshold: Optional[float] = None
    silence_duration: Optional[float] = None


@router.get("/config")
async def api_get_config():
    cfg = get_config()
    m = cfg.get_active_model()
    return {
        "models": [{"name": mdl.name, "supports_think": mdl.supports_think, "supports_vision": mdl.supports_vision} for mdl in cfg.models],
        "active_model": cfg.active_model,
        "model_name": m.name,
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
        "think_mode": cfg.think_mode,
        "whisper_model": cfg.whisper_model,
        "whisper_language": cfg.whisper_language,
        "position": cfg.position,
        "language": cfg.language,
        "auto_detect": cfg.auto_detect,
        "silence_threshold": cfg.silence_threshold,
        "silence_duration": cfg.silence_duration,
        "has_resume": bool(cfg.resume_text),
        "api_key_set": bool(m.api_key and m.api_key not in ("", "sk-your-api-key-here")),
    }


@router.post("/config")
async def api_update_config(body: ConfigUpdate):
    update_config(body.model_dump(exclude_none=True))
    if body.whisper_model:
        threading.Thread(target=lambda: get_stt_engine().change_model(body.whisper_model), daemon=True).start()
    return {"ok": True}


@router.get("/options")
async def api_options():
    return {
        "positions": POSITION_OPTIONS,
        "languages": LANGUAGE_OPTIONS,
        "whisper_models": WHISPER_MODEL_OPTIONS,
    }


@router.get("/devices")
async def api_devices():
    try:
        devices = AudioCapture.list_devices()
        platform_info = AudioCapture.get_platform_info()
        return {"devices": devices, "platform": platform_info}
    except Exception as e:
        return {"devices": [], "platform": {"platform": "unknown", "needs_virtual_device": False, "instructions": "", "error": str(e)}}


@router.post("/resume")
async def api_upload_resume(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "未选择文件")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "文件大小不能超过 10MB")
    try:
        text = parse_resume_bytes(content, file.filename)
        summary = summarize_resume(text)
        update_config({"resume_text": summary})
        return {"ok": True, "length": len(summary), "preview": summary[:200]}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.delete("/resume")
async def api_delete_resume():
    update_config({"resume_text": None})
    return {"ok": True}


@router.get("/stt/status")
async def api_stt_status():
    engine = get_stt_engine()
    return {"loaded": engine.is_loaded, "loading": engine.is_loading, "model": engine.model_size}


def _check_single_model(index: int):
    from routes.ws import broadcast
    cfg = get_config()
    if index >= len(cfg.models):
        return
    m = cfg.models[index]
    _model_health[index] = "checking"
    broadcast({"type": "model_health", "index": index, "status": "checking"})

    if not m.api_key or m.api_key in ("", "sk-your-api-key-here"):
        _model_health[index] = "error"
        broadcast({"type": "model_health", "index": index, "status": "error", "detail": "未配置 API Key"})
        return

    try:
        client = OpenAI(api_key=m.api_key, base_url=m.api_base_url, timeout=10)
        resp = client.chat.completions.create(
            model=m.model,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1,
            stream=False,
        )
        _model_health[index] = "ok"
        broadcast({"type": "model_health", "index": index, "status": "ok"})
    except Exception as e:
        _model_health[index] = "error"
        detail = str(e)[:120]
        broadcast({"type": "model_health", "index": index, "status": "error", "detail": detail})


def _check_all_models():
    cfg = get_config()
    threads = []
    for i in range(len(cfg.models)):
        t = threading.Thread(target=_check_single_model, args=(i,), daemon=True)
        threads.append(t)
        t.start()
    for t in threads:
        t.join(timeout=15)


@router.post("/models/health")
async def api_check_models_health():
    threading.Thread(target=_check_all_models, daemon=True).start()
    return {"ok": True}


@router.get("/models/health")
async def api_get_models_health():
    return {"health": _model_health}


@router.get("/token/stats")
async def api_token_stats():
    from services.llm import get_token_stats
    return get_token_stats()
