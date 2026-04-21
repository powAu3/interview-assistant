import socket
import threading
import time
from typing import Optional
import requests

from fastapi import APIRouter, UploadFile, File, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ValidationError

from core.auth import get_token, is_auth_disabled, is_loopback_host
from core.config import (
    get_config, update_config,
    POSITION_OPTIONS, LANGUAGE_OPTIONS, PRACTICE_AUDIENCE_OPTIONS, WHISPER_MODEL_OPTIONS, STT_PROVIDER_OPTIONS,
    PRACTICE_TTS_PROVIDER_OPTIONS,
    SCREEN_CAPTURE_REGION_OPTIONS,
)
from services.audio import AudioCapture
from services.stt import get_stt_engine, set_whisper_language
from services.tts import get_melo_tts_status
from services.storage.resume_history import (
    MAX_UPLOAD_BYTES as RESUME_UPLOAD_MAX_BYTES,
    add_upload,
    apply_entry,
    delete_entry,
    get_entry_detail,
    get_filename_for_id,
    list_entries,
    update_entry_summary,
)

router = APIRouter()

# 简历上传阈值从 services.storage.resume_history 引入 (单一来源 / DRY)。
# Router 层做流式校验是为了在拿到 Content-Length 或读到超限时立即拒绝,
# 避免恶意客户端发送 GB 级 body 把整个文件读进内存触发 OOM.
_RESUME_UPLOAD_CHUNK = 1 * 1024 * 1024

_model_health: dict[int, str] = {}
_model_health_detail: dict[int, str] = {}


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
    assist_asr_confirm_window_sec: Optional[float] = None
    assist_asr_group_max_wait_sec: Optional[float] = None
    assist_asr_interrupt_running: Optional[bool] = None
    assist_high_churn_short_answer: Optional[bool] = None
    screen_capture_region: Optional[str] = None
    written_exam_mode: Optional[bool] = None
    written_exam_think: Optional[bool] = None
    iflytek_stt_app_id: Optional[str] = None
    iflytek_stt_api_key: Optional[str] = None
    iflytek_stt_api_secret: Optional[str] = None
    practice_tts_provider: Optional[str] = None
    volcengine_tts_appkey: Optional[str] = None
    volcengine_tts_token: Optional[str] = None
    practice_tts_speaker_female: Optional[str] = None
    practice_tts_speaker_male: Optional[str] = None
    melo_tts_cmd: Optional[str] = None
    melo_tts_speed: Optional[float] = None
    # KB (Beta) - 详细字段(min_score / OCR / Vision / chunk_size 等)仍走 config.json
    kb_enabled: Optional[bool] = None
    kb_top_k: Optional[int] = None
    kb_deadline_ms: Optional[int] = None
    kb_asr_deadline_ms: Optional[int] = None


@router.get("/config")
async def api_get_config():
    cfg = get_config()
    m = cfg.get_active_model()
    resume_active_history_id = getattr(cfg, "resume_active_history_id", None)
    return {
        **get_melo_tts_status(),
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
        "iflytek_stt_app_id": cfg.iflytek_stt_app_id or "",
        "iflytek_stt_api_key": cfg.iflytek_stt_api_key or "",
        "iflytek_stt_api_secret": cfg.iflytek_stt_api_secret or "",
        "practice_tts_provider": getattr(cfg, "practice_tts_provider", "melo_local") or "melo_local",
        "volcengine_tts_appkey": getattr(cfg, "volcengine_tts_appkey", "") or "",
        "volcengine_tts_token": getattr(cfg, "volcengine_tts_token", "") or "",
        "practice_tts_speaker_female": getattr(cfg, "practice_tts_speaker_female", "zh_female_qingxin") or "zh_female_qingxin",
        "practice_tts_speaker_male": getattr(cfg, "practice_tts_speaker_male", "zh_male_chunhou") or "zh_male_chunhou",
        "melo_tts_cmd": getattr(cfg, "melo_tts_cmd", "melo") or "melo",
        "melo_tts_speed": float(getattr(cfg, "melo_tts_speed", 1.0) or 1.0),
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
        "assist_asr_confirm_window_sec": max(
            0.0, min(5.0, float(getattr(cfg, "assist_asr_confirm_window_sec", 0.45) or 0.0))
        ),
        "assist_asr_group_max_wait_sec": max(
            0.2, min(8.0, float(getattr(cfg, "assist_asr_group_max_wait_sec", 1.2) or 1.2))
        ),
        "assist_asr_interrupt_running": bool(getattr(cfg, "assist_asr_interrupt_running", True)),
        "assist_high_churn_short_answer": bool(getattr(cfg, "assist_high_churn_short_answer", False)),
        "screen_capture_region": getattr(cfg, "screen_capture_region", "left_half") or "left_half",
        "written_exam_mode": bool(getattr(cfg, "written_exam_mode", False)),
        "written_exam_think": bool(getattr(cfg, "written_exam_think", False)),
        # KB (Beta) - 暴露给前端 SettingsDrawer 调节; 详细配置仍在 config.json 中
        "kb_enabled": bool(getattr(cfg, "kb_enabled", False)),
        "kb_top_k": int(getattr(cfg, "kb_top_k", 4) or 4),
        "kb_deadline_ms": int(getattr(cfg, "kb_deadline_ms", 150) or 150),
        "kb_asr_deadline_ms": int(getattr(cfg, "kb_asr_deadline_ms", 80) or 80),
        "has_resume": bool(cfg.resume_text),
        "resume_active_history_id": resume_active_history_id,
        "resume_active_filename": (
            get_filename_for_id(resume_active_history_id)
            if resume_active_history_id is not None
            else None
        ),
        "api_key_set": bool(m.api_key and m.api_key not in ("", "sk-your-api-key-here")),
    }


_MASK_MARKER = "****"


def _mask_api_key(key: str) -> str:
    if not key or key in ("", "sk-your-api-key-here"):
        return ""
    if len(key) <= 8:
        return key[:2] + _MASK_MARKER + key[-1:]
    return key[:3] + _MASK_MARKER + key[-3:]


def _resolve_masked_api_key(x: dict, index: int, old_models: list) -> str:
    """前端用掩码占位符回传 api_key 时，从旧配置恢复真实密钥。

    不能仅用列表下标：删除或重排模型后，下标与旧列表错位会把别人的 key 赋给当前行，
    表现为「保存/测试连接」一直失败。
    """
    name = (x.get("name") or "").strip()
    model_id = (x.get("model") or "").strip()
    base = (x.get("api_base_url") or "").strip()

    def triple_match(m) -> bool:
        return (
            (m.name or "").strip() == name
            and (m.model or "").strip() == model_id
            and (m.api_base_url or "").strip() == base
        )

    strict = [m for m in old_models if triple_match(m)]
    if len(strict) == 1:
        return strict[0].api_key or ""
    if index < len(old_models) and triple_match(old_models[index]):
        return old_models[index].api_key or ""
    loose = [m for m in old_models if (m.name or "").strip() == name and (m.model or "").strip() == model_id]
    if len(loose) == 1:
        return loose[0].api_key or ""
    if index < len(old_models):
        return old_models[index].api_key or ""
    matched = next(
        (m for m in old_models if m.name == x.get("name") and m.model == x.get("model")),
        None,
    )
    return (matched.api_key if matched else "") or ""


@router.get("/config/models-full")
async def api_get_models_full():
    """Return all model fields with masked api_key for frontend editing."""
    cfg = get_config()
    return {
        "models": [
            {
                "name": mdl.name,
                "api_base_url": mdl.api_base_url,
                "api_key": _mask_api_key(mdl.api_key),
                "model": mdl.model,
                "supports_think": mdl.supports_think,
                "supports_vision": mdl.supports_vision,
                "enabled": getattr(mdl, "enabled", True),
                "has_key": bool(mdl.api_key and mdl.api_key not in ("", "sk-your-api-key-here")),
            }
            for mdl in cfg.models
        ],
    }


@router.post("/config")
async def api_update_config(body: ConfigUpdate):
    from core.config import ModelConfig

    d = body.model_dump(exclude_none=True)
    try:
        if "models" in d:
            cfg = get_config()
            raw_models = []
            for i, x in enumerate(d["models"]):
                if not isinstance(x, dict):
                    continue
                if _MASK_MARKER in (x.get("api_key") or ""):
                    x["api_key"] = _resolve_masked_api_key(x, i, cfg.models)
                raw_models.append(ModelConfig(**x))
            d["models"] = raw_models
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
        if "assist_asr_confirm_window_sec" in d:
            d["assist_asr_confirm_window_sec"] = max(
                0.0, min(5.0, float(d["assist_asr_confirm_window_sec"]))
            )
        if "assist_asr_group_max_wait_sec" in d:
            d["assist_asr_group_max_wait_sec"] = max(
                0.2, min(8.0, float(d["assist_asr_group_max_wait_sec"]))
            )
        # 非法 enum 值必须明确报错: 静默 pop 会让前端以为保存成功,
        # 但实际配置没变, 用户看到的 UI 状态与后端不一致 (P0 #3 in CR)。
        # 例外: 空字符串视为「重置回默认」, pop 而不是 422, 兼容前端清空字段的语义。
        if d.get("screen_capture_region") == "":
            d.pop("screen_capture_region", None)
        elif "screen_capture_region" in d and d["screen_capture_region"] not in SCREEN_CAPTURE_REGION_OPTIONS:
            raise HTTPException(
                422,
                f"screen_capture_region 必须是 {list(SCREEN_CAPTURE_REGION_OPTIONS)} 之一",
            )
        if d.get("practice_audience") == "":
            d.pop("practice_audience", None)
        elif "practice_audience" in d and d["practice_audience"] not in PRACTICE_AUDIENCE_OPTIONS:
            raise HTTPException(
                422,
                f"practice_audience 必须是 {list(PRACTICE_AUDIENCE_OPTIONS)} 之一",
            )
        if d.get("practice_tts_provider") == "":
            d.pop("practice_tts_provider", None)
        elif "practice_tts_provider" in d and d["practice_tts_provider"] not in PRACTICE_TTS_PROVIDER_OPTIONS:
            raise HTTPException(
                422,
                f"practice_tts_provider 必须是 {list(PRACTICE_TTS_PROVIDER_OPTIONS)} 之一",
            )
        if "practice_tts_speaker_female" in d:
            d["practice_tts_speaker_female"] = str(d["practice_tts_speaker_female"]).strip()
        if "practice_tts_speaker_male" in d:
            d["practice_tts_speaker_male"] = str(d["practice_tts_speaker_male"]).strip()
        if "melo_tts_cmd" in d:
            d["melo_tts_cmd"] = str(d["melo_tts_cmd"]).strip()
        if "melo_tts_speed" in d:
            d["melo_tts_speed"] = max(0.6, min(1.8, float(d["melo_tts_speed"])))
        if "kb_top_k" in d:
            d["kb_top_k"] = max(1, min(20, int(d["kb_top_k"])))
        if "kb_deadline_ms" in d:
            d["kb_deadline_ms"] = max(20, min(2000, int(d["kb_deadline_ms"])))
        if "kb_asr_deadline_ms" in d:
            d["kb_asr_deadline_ms"] = max(20, min(1000, int(d["kb_asr_deadline_ms"])))
        await run_in_threadpool(update_config, d)
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
async def api_network_info(request: Request):
    """Return LAN IP and port so the frontend can render a scannable QR code.

    若 LAN 鉴权开启,环回访问会在 URL 中追加 ``?t=<token>``,扫码后手机端
    可自动写入 sessionStorage 并附在后续请求里。LAN 客户端拿到的是不带
    token 的 URL,自身就拒绝访问,从而避免凭证泄露。
    """
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
    base = f"http://{ip}:{port}"
    client_host = request.client.host if request.client else None
    url = base
    auth_required = not is_auth_disabled()
    if auth_required and is_loopback_host(client_host):
        url = f"{base}/?t={get_token()}"
    return {
        "ip": ip,
        "port": port,
        "url": url,
        "auth_required": auth_required,
    }


@router.get("/options")
async def api_options():
    return {
        "positions": POSITION_OPTIONS,
        "languages": LANGUAGE_OPTIONS,
        "practice_audiences": PRACTICE_AUDIENCE_OPTIONS,
        "practice_tts_providers": PRACTICE_TTS_PROVIDER_OPTIONS,
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
async def api_upload_resume(request: Request, file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "未选择文件")

    # 早期拦截: 若客户端声明的 Content-Length 已经超限, 直接 413, 不读 body.
    try:
        declared = int(request.headers.get("content-length") or "0")
    except ValueError:
        declared = 0
    if declared > RESUME_UPLOAD_MAX_BYTES:
        raise HTTPException(413, "文件大小不能超过 10MB")

    # 流式累积: chunked 编码或 Content-Length 缺失/伪造时, 累计超限就立即终止读取。
    # max_iters 是 robustness 兜底: 防御异常 file.read 实现 (例如返回 size=0 的非空 chunk)
    # 无限循环, 实际 starlette UploadFile 不会出现这种情况。
    max_iters = (RESUME_UPLOAD_MAX_BYTES // _RESUME_UPLOAD_CHUNK) + 2
    chunks: list[bytes] = []
    total = 0
    for _ in range(max_iters):
        chunk = await file.read(_RESUME_UPLOAD_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > RESUME_UPLOAD_MAX_BYTES:
            raise HTTPException(413, "文件大小不能超过 10MB")
        chunks.append(chunk)
    else:
        # for-else: 跑满 max_iters 仍没退出, 视为读取异常
        raise HTTPException(500, "上传读取异常")
    content = b"".join(chunks)

    try:
        return await run_in_threadpool(add_upload, content, file.filename)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@router.delete("/resume")
async def api_delete_resume():
    await run_in_threadpool(
        update_config, {"resume_text": None, "resume_active_history_id": None}
    )
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
    _model_health_detail[index] = ""
    broadcast({"type": "model_health", "index": index, "status": "checking"})

    if not m.api_key or m.api_key in ("", "sk-your-api-key-here"):
        _model_health[index] = "error"
        _model_health_detail[index] = "未配置 API Key"
        broadcast({"type": "model_health", "index": index, "status": "error", "detail": "未配置 API Key"})
        return

    try:
        # SDK 在部分环境会抛出 pydantic by_alias 兼容异常；检测链路改为原始 HTTP 更稳。
        base = (m.api_base_url or "").rstrip("/")
        url = f"{base}/chat/completions"
        headers = {
            "Authorization": f"Bearer {m.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": m.model,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
            "stream": False,
        }
        r = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=12,
        )
        if r.status_code >= 400:
            try:
                body = r.json()
            except Exception:
                body = r.text
            raise RuntimeError(f"HTTP {r.status_code}: {str(body)[:120]}")
        _model_health[index] = "ok"
        _model_health_detail[index] = ""
        broadcast({"type": "model_health", "index": index, "status": "ok"})
    except Exception as e:
        _model_health[index] = "error"
        detail = str(e)[:120]
        _model_health_detail[index] = detail
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
    return {"health": _model_health, "detail": _model_health_detail}


@router.post("/models/health/{index}")
async def api_check_single_model_health(index: int):
    """Check health of a single model by index (run in background thread)."""
    cfg = get_config()
    if index < 0 or index >= len(cfg.models):
        raise HTTPException(400, f"模型 index {index} 超出范围")
    threading.Thread(target=_check_single_model, args=(index,), daemon=True).start()
    return {"ok": True}


@router.post("/stt/test")
async def api_stt_test():
    """Test current STT engine connectivity with credential pre-checks."""
    cfg = get_config()
    if cfg.stt_provider == "doubao":
        if not cfg.doubao_stt_access_token:
            return {"ok": False, "detail": "豆包 Access Token 未配置"}
        if not cfg.doubao_stt_app_id:
            return {"ok": False, "detail": "豆包 App ID 未配置"}
    elif cfg.stt_provider == "iflytek":
        if not cfg.iflytek_stt_app_id:
            return {"ok": False, "detail": "讯飞 APPID 未配置"}
        if not cfg.iflytek_stt_api_key:
            return {"ok": False, "detail": "讯飞 APIKey 未配置"}
        if not cfg.iflytek_stt_api_secret:
            return {"ok": False, "detail": "讯飞 APISecret 未配置"}
    import numpy as _np
    try:
        engine = get_stt_engine()
        sr = 16000
        duration_sec = 1.5
        silence = _np.zeros(int(sr * duration_sec), dtype=_np.float32)
        result = engine.transcribe(silence, sample_rate=sr)
        if result is None:
            return {"ok": False, "detail": "引擎返回空结果，请检查配置"}
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "detail": str(e)[:200]}


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
            # 必须显式排除 bool: Python 中 isinstance(True, int) 为 True,
            # 否则前端误传 [True, False, 0, 1] 时 True/False 会被当成 1/0,
            # 导致模型顺序被悄悄改写或直接丢失.
            if (
                isinstance(i, int)
                and not isinstance(i, bool)
                and 0 <= i < len(cfg.models)
                and i not in seen
            ):
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
        try:
            updates["max_parallel_answers"] = max(1, min(8, int(mp)))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="max_parallel_answers must be an integer")
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
    await run_in_threadpool(update_config, updates)
    return {"ok": True}
