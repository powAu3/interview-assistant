import socket
import threading
import time
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ValidationError
from openai import OpenAI

from core.config import (
    get_config, update_config,
    POSITION_OPTIONS, LANGUAGE_OPTIONS, PRACTICE_AUDIENCE_OPTIONS, WHISPER_MODEL_OPTIONS, STT_PROVIDER_OPTIONS,
    SCREEN_CAPTURE_REGION_OPTIONS,
)
from services.audio import AudioCapture
from services.stt import get_stt_engine, set_whisper_language
from services.storage.resume_history import (
    add_upload,
    apply_entry,
    delete_entry,
    get_entry_detail,
    get_filename_for_id,
    list_entries,
    update_entry_summary,
)

router = APIRouter()

_model_health: dict[int, str] = {}


def get_model_health(index: int) -> Optional[str]:
    return _model_health.get(index)


class ConfigUpdate(BaseModel):
    models: Optional[list] = None
    max_parallel_answers: Optional[int] = None
    active_model: Optional[int] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    think_mode: Optional[bool] = None
    stt_provider: Optional[str] = None
    whisper_model: Optional[str] = None
    whisper_language: Optional[str] = None
    doubao_stt_app_id: Optional[str] = None
    doubao_stt_access_token: Optional[str] = None
    doubao_stt_resource_id: Optional[str] = None
    doubao_stt_boosting_table_id: Optional[str] = None
    position: Optional[str] = None
    language: Optional[str] = None
    practice_audience: Optional[str] = None
    auto_detect: Optional[bool] = None
    silence_threshold: Optional[float] = None
    silence_duration: Optional[float] = None
    answer_autoscroll_bottom_px: Optional[int] = None
    transcription_min_sig_chars: Optional[int] = None
    assist_transcription_merge_gap_sec: Optional[float] = None
    assist_transcription_merge_max_sec: Optional[float] = None
    screen_capture_region: Optional[str] = None


@router.get("/config")
async def api_get_config():
    cfg = get_config()
    m = cfg.get_active_model()
    resume_active_history_id = getattr(cfg, "resume_active_history_id", None)
    return {
        "models": [
            {
                "name": mdl.name,
                "supports_think": mdl.supports_think,
                "supports_vision": mdl.supports_vision,
                "enabled": getattr(mdl, "enabled", True),
            }
            for mdl in cfg.models
        ],
        "max_parallel_answers": getattr(cfg, "max_parallel_answers", 2),
        "active_model": cfg.active_model,
        "model_name": m.name,
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
        "think_mode": cfg.think_mode,
        "stt_provider": cfg.stt_provider,
        "whisper_model": cfg.whisper_model,
        "whisper_language": cfg.whisper_language,
        "doubao_stt_app_id": cfg.doubao_stt_app_id or "",
        "doubao_stt_access_token": cfg.doubao_stt_access_token or "",
        "doubao_stt_resource_id": cfg.doubao_stt_resource_id or "",
        "doubao_stt_boosting_table_id": cfg.doubao_stt_boosting_table_id or "",
        "position": cfg.position,
        "language": cfg.language,
        "practice_audience": getattr(cfg, "practice_audience", "campus_intern"),
        "auto_detect": cfg.auto_detect,
        "silence_threshold": cfg.silence_threshold,
        "silence_duration": cfg.silence_duration,
        "answer_autoscroll_bottom_px": max(4, min(400, getattr(cfg, "answer_autoscroll_bottom_px", 40))),
        "transcription_min_sig_chars": max(1, min(50, getattr(cfg, "transcription_min_sig_chars", 2))),
        "assist_transcription_merge_gap_sec": max(
            0.0, min(15.0, float(getattr(cfg, "assist_transcription_merge_gap_sec", 2.0) or 0.0))
        ),
        "assist_transcription_merge_max_sec": max(
            1.0, min(120.0, float(getattr(cfg, "assist_transcription_merge_max_sec", 12.0) or 12.0))
        ),
        "screen_capture_region": getattr(cfg, "screen_capture_region", "left_half") or "left_half",
        "has_resume": bool(cfg.resume_text),
        "resume_active_history_id": resume_active_history_id,
        "resume_active_filename": (
            get_filename_for_id(resume_active_history_id)
            if resume_active_history_id is not None
            else None
        ),
        "api_key_set": bool(m.api_key and m.api_key not in ("", "sk-your-api-key-here")),
    }


@router.post("/config")
async def api_update_config(body: ConfigUpdate):
    from core.config import ModelConfig

    d = body.model_dump(exclude_none=True)
    try:
        if "models" in d:
            d["models"] = [ModelConfig(**x) if isinstance(x, dict) else x for x in d["models"]]
            if not d["models"]:
                raise HTTPException(400, "至少保留一个模型")
        if "max_parallel_answers" in d:
            d["max_parallel_answers"] = max(1, min(8, int(d["max_parallel_answers"])))
        if "answer_autoscroll_bottom_px" in d:
            d["answer_autoscroll_bottom_px"] = max(4, min(400, int(d["answer_autoscroll_bottom_px"])))
        if "transcription_min_sig_chars" in d:
            d["transcription_min_sig_chars"] = max(1, min(50, int(d["transcription_min_sig_chars"])))
        if "assist_transcription_merge_gap_sec" in d:
            d["assist_transcription_merge_gap_sec"] = max(
                0.0, min(15.0, float(d["assist_transcription_merge_gap_sec"]))
            )
        if "assist_transcription_merge_max_sec" in d:
            d["assist_transcription_merge_max_sec"] = max(
                1.0, min(120.0, float(d["assist_transcription_merge_max_sec"]))
            )
        if "screen_capture_region" in d and d["screen_capture_region"] not in SCREEN_CAPTURE_REGION_OPTIONS:
            d.pop("screen_capture_region", None)
        if "practice_audience" in d and d["practice_audience"] not in PRACTICE_AUDIENCE_OPTIONS:
            d.pop("practice_audience", None)
        update_config(d)
    except HTTPException:
        raise
    except (TypeError, ValueError, ValidationError) as e:
        raise HTTPException(400, str(e)) from e
    if body.whisper_language is not None:
        set_whisper_language(body.whisper_language)
    if body.whisper_model is not None:
        engine = get_stt_engine()
        new_model = body.whisper_model
        if hasattr(engine, "change_model"):
            threading.Thread(target=lambda: engine.change_model(new_model), daemon=True).start()
    return {"ok": True}


@router.get("/network-info")
async def api_network_info():
    """Return LAN IP and port so the frontend can render a scannable QR code."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = "127.0.0.1"
    # Read PORT from env (set by start.py), fallback to 18080
    import os
    port = int(os.environ.get("PORT", 18080))
    return {"ip": ip, "port": port, "url": f"http://{ip}:{port}"}


@router.get("/options")
async def api_options():
    return {
        "positions": POSITION_OPTIONS,
        "languages": LANGUAGE_OPTIONS,
        "practice_audiences": PRACTICE_AUDIENCE_OPTIONS,
        "stt_providers": STT_PROVIDER_OPTIONS,
        "whisper_models": WHISPER_MODEL_OPTIONS,
        "screen_capture_regions": SCREEN_CAPTURE_REGION_OPTIONS,
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
    try:
        return add_upload(content, file.filename)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/resume")
async def api_delete_resume():
    update_config({"resume_text": None, "resume_active_history_id": None})
    return {"ok": True}


@router.get("/resume/history")
async def api_resume_history():
    return {"items": list_entries(), "max": 10}


class ResumeHistoryUpdateBody(BaseModel):
    summary: str = ""


@router.get("/resume/history/{entry_id}")
async def api_resume_history_detail(entry_id: int):
    try:
        return get_entry_detail(entry_id)
    except FileNotFoundError:
        raise HTTPException(404, "记录不存在")


@router.put("/resume/history/{entry_id}")
async def api_resume_history_update(entry_id: int, body: ResumeHistoryUpdateBody):
    try:
        return update_entry_summary(entry_id, body.summary)
    except FileNotFoundError:
        raise HTTPException(404, "记录不存在")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/resume/history/{entry_id}/apply")
async def api_resume_history_apply(entry_id: int):
    """在线程池执行，避免大 PDF 解析阻塞事件循环导致其它请求（含预览）卡死。"""
    try:
        return await run_in_threadpool(apply_entry, entry_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.delete("/resume/history/{entry_id}")
async def api_resume_history_delete(entry_id: int):
    delete_entry(entry_id)
    return {"ok": True}


@router.get("/stt/status")
async def api_stt_status():
    engine = get_stt_engine()
    return {"loaded": engine.is_loaded, "loading": engine.is_loading, "model": engine.model_size}


def _check_single_model(index: int):
    from api.realtime.ws import broadcast
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


@router.post("/config/models-layout")
async def api_models_layout(body: dict):
    """调整模型顺序、开关与并行路数，不丢失各模型 api_key。"""
    cfg = get_config()
    order = body.get("order")
    if order is not None and isinstance(order, list):
        models = []
        seen = set()
        for i in order:
            if isinstance(i, int) and 0 <= i < len(cfg.models) and i not in seen:
                models.append(cfg.models[i])
                seen.add(i)
        for i, m in enumerate(cfg.models):
            if i not in seen:
                models.append(m)
    else:
        models = list(cfg.models)
    enabled = body.get("enabled")
    if isinstance(enabled, list):
        for i in range(min(len(enabled), len(models))):
            models[i] = models[i].model_copy(update={"enabled": bool(enabled[i])})
    mp = body.get("max_parallel_answers")
    updates: dict = {"models": [m.model_dump() for m in models]}
    if mp is not None:
        updates["max_parallel_answers"] = max(1, min(8, int(mp)))
    active = cfg.active_model
    client_active = body.get("active_model")
    # 前端在重排后传入新列表中的优先模型下标，避免同名同 endpoint 模型时 next() 匹配到错误项
    if (
        isinstance(client_active, int)
        and not isinstance(client_active, bool)
        and len(models) > 0
    ):
        ca = int(client_active)
        if 0 <= ca < len(models):
            updates["active_model"] = ca
    elif order is not None and isinstance(order, list) and order:
        try:
            old = cfg.models[active] if 0 <= active < len(cfg.models) else None
            if old:
                updates["active_model"] = next(
                    (
                        j
                        for j, m in enumerate(models)
                        if m.name == old.name
                        and m.model == old.model
                        and m.api_base_url == old.api_base_url
                    ),
                    min(active, len(models) - 1),
                )
            else:
                updates["active_model"] = min(active, len(models) - 1)
        except Exception:
            updates["active_model"] = 0
    update_config(updates)
    return {"ok": True}
