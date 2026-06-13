import socket
import threading
import time
from pathlib import Path
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
from core.env import env_int
from services.audio import AudioCapture
from services.stt import get_stt_engine, set_whisper_language
from api.common.config_payload import build_config_payload
from api.common.model_health import (
    get_model_health,
    get_model_health_snapshot,
    probe_single_model,
    start_all_model_checks,
    start_single_model_check,
)
from services.storage.resume_history import (
    MAX_UPLOAD_BYTES as RESUME_UPLOAD_MAX_BYTES,
    add_upload,
    apply_entry,
    delete_entry,
    get_entry_detail,
    list_entries,
    update_entry_summary,
)

router = APIRouter()

# 简历上传阈值从 services.storage.resume_history 引入 (单一来源 / DRY)。
# Router 层做流式校验是为了在拿到 Content-Length 或读到超限时立即拒绝,
# 避免恶意客户端发送 GB 级 body 把整个文件读进内存触发 OOM.
_RESUME_UPLOAD_CHUNK = 1 * 1024 * 1024

def _has_enabled_model(models: list) -> bool:
    return any(bool(getattr(model, "enabled", True)) for model in models)


class ConfigUpdate(BaseModel):
    models: Optional[list] = None
    max_parallel_answers: Optional[int] = None
    active_model: Optional[int] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    think_mode: Optional[bool] = None
    think_effort: Optional[str] = None
    stt_provider: Optional[str] = None
    whisper_model: Optional[str] = None
    whisper_language: Optional[str] = None
    whisper_preload: Optional[bool] = None
    doubao_stt_app_id: Optional[str] = None
    doubao_stt_access_token: Optional[str] = None
    doubao_stt_api_key: Optional[str] = None
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
    screen_capture_max_long_edge: Optional[int] = None
    multi_screen_capture_idle_sec: Optional[float] = None
    written_exam_mode: Optional[bool] = None
    written_exam_think: Optional[bool] = None
    generic_stt_api_base_url: Optional[str] = None
    generic_stt_api_key: Optional[str] = None
    generic_stt_model: Optional[str] = None
    generic_stt_custom_headers: Optional[str] = None
    candidate_asr_enabled: Optional[bool] = None
    candidate_stt_provider: Optional[str] = None
    candidate_whisper_model: Optional[str] = None
    candidate_whisper_language: Optional[str] = None
    candidate_remote_stt_enabled: Optional[bool] = None
    candidate_context_enabled: Optional[bool] = None
    candidate_context_wait_ms: Optional[int] = None
    candidate_context_max_chars: Optional[int] = None
    candidate_context_min_chars: Optional[int] = None
    candidate_streaming_asr_enabled: Optional[bool] = None
    candidate_streaming_asr_interval_ms: Optional[int] = None
    candidate_mic_compatibility_mode: Optional[bool] = None
    practice_tts_provider: Optional[str] = None
    edge_tts_voice_female: Optional[str] = None
    edge_tts_voice_male: Optional[str] = None
    edge_tts_rate: Optional[str] = None
    edge_tts_pitch: Optional[str] = None
    volcengine_tts_appkey: Optional[str] = None
    volcengine_tts_token: Optional[str] = None
    practice_tts_speaker_female: Optional[str] = None
    practice_tts_speaker_male: Optional[str] = None
    # KB (Beta) - 详细字段(min_score / OCR / Vision / chunk_size 等)仍走 config.json
    kb_enabled: Optional[bool] = None
    kb_top_k: Optional[int] = None
    kb_deadline_ms: Optional[int] = None
    kb_asr_deadline_ms: Optional[int] = None


_MODEL_API_KEY_KEEP = "__IA_KEEP_EXISTING_API_KEY__"


class ModelListRequest(BaseModel):
    api_base_url: str
    api_key: str
    model_index: Optional[int] = None


_MODEL_LIST_KNOWN_COMPAT_SUFFIXES = (
    "/api/claudecode",
    "/api/anthropic",
    "/apps/anthropic",
    "/api/coding",
    "/claudecode",
    "/anthropic",
    "/step_plan",
    "/coding",
    "/claude",
)


def _ends_with_version_segment(url: str) -> bool:
    last = url.rsplit("/", 1)[-1]
    return len(last) > 1 and last.startswith("v") and last[1:].isdigit()


def _strip_known_model_list_compat_suffix(base_url: str) -> str:
    for suffix in _MODEL_LIST_KNOWN_COMPAT_SUFFIXES:
        if base_url.endswith(suffix):
            return base_url[: -len(suffix)].rstrip("/")
    return ""


def _model_list_url_candidates(api_base_url: str) -> list[str]:
    base = (api_base_url or "").strip().rstrip("/")
    if not base:
        return []
    candidates: list[str] = []
    if _ends_with_version_segment(base):
        candidates.append(f"{base}/models")
        if not base.endswith("/v1"):
            candidates.append(f"{base}/v1/models")
    else:
        candidates.append(f"{base}/v1/models")

    stripped = _strip_known_model_list_compat_suffix(base)
    if stripped and "://" in stripped:
        candidates.append(f"{stripped}/v1/models")
        candidates.append(f"{stripped}/models")

    unique: list[str] = []
    for url in candidates:
        if url not in unique:
            unique.append(url)
    return unique


def _model_list_error_body(response: requests.Response) -> str:
    try:
        text = response.text
    except Exception:
        text = ""
    return text[:512] + ("..." if len(text) > 512 else "")


def _extract_remote_models(body: object) -> list[dict[str, str | None]]:
    if isinstance(body, dict):
        data = body.get("data", body.get("models", []))
    else:
        data = body
    models_by_id: dict[str, dict[str, str | None]] = {}
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                model_id = item.get("id")
                owned_by = item.get("owned_by", item.get("ownedBy"))
            else:
                model_id = getattr(item, "id", None)
                owned_by = getattr(item, "owned_by", getattr(item, "ownedBy", None))
            if not isinstance(model_id, str) or not model_id.strip():
                continue
            clean_id = model_id.strip()
            clean_owner = owned_by.strip() if isinstance(owned_by, str) and owned_by.strip() else None
            current = models_by_id.get(clean_id)
            if current is None:
                models_by_id[clean_id] = {"id": clean_id, "owned_by": clean_owner}
            elif not current.get("owned_by") and clean_owner:
                current["owned_by"] = clean_owner
    return sorted(models_by_id.values(), key=lambda model: model["id"].lower())


def _list_remote_models(api_base_url: str, api_key: str) -> dict:
    candidates = _model_list_url_candidates(api_base_url)
    if not candidates:
        raise RuntimeError("API Base URL 不能为空")
    last_not_found = ""
    for url in candidates:
        response = requests.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        if response.status_code in (404, 405):
            last_not_found = f"HTTP {response.status_code}: {_model_list_error_body(response)}"
            continue
        if response.status_code >= 400:
            raise RuntimeError(f"HTTP {response.status_code}: {_model_list_error_body(response)}")
        try:
            body = response.json()
        except Exception as exc:
            raise RuntimeError(f"模型列表响应不是 JSON: {exc}") from exc
        return {"models": _extract_remote_models(body)}
    raise RuntimeError(last_not_found or "未找到可用的模型列表接口")



@router.get("/config")
async def api_get_config():
    return build_config_payload(get_config())


_LEGACY_STT_PROVIDER_MAP = {"iflytek": "generic"}


@router.get("/config/models-full")
async def api_get_models_full():
    """Return model fields for local frontend editing without echoing secrets."""
    cfg = get_config()
    return {
        "models": [
            {
                "name": mdl.name,
                "api_base_url": mdl.api_base_url,
                "api_key": "",
                "model": mdl.model,
                "supports_think": mdl.supports_think,
                "supports_vision": mdl.supports_vision,
                "enabled": getattr(mdl, "enabled", True),
                "think_enabled_params": getattr(mdl, "think_enabled_params", {}) or {},
                "think_disabled_params": getattr(mdl, "think_disabled_params", {}) or {},
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
            raw_models = []
            current_models = list(get_config().models)
            for idx, x in enumerate(d["models"]):
                if not isinstance(x, dict):
                    continue
                if x.get("api_key") == _MODEL_API_KEY_KEEP:
                    source_idx = x.get("model_original_index", idx)
                    try:
                        source_idx = int(source_idx)
                    except (TypeError, ValueError):
                        source_idx = idx
                    existing = current_models[source_idx].api_key if 0 <= source_idx < len(current_models) else ""
                    x = {**x, "api_key": existing}
                x.pop("model_original_index", None)
                raw_models.append(ModelConfig(**x))
            d["models"] = raw_models
            if not d["models"]:
                raise HTTPException(400, "至少保留一个模型")
            if not _has_enabled_model(d["models"]):
                raise HTTPException(422, "至少启用一个模型")
        if d.get("stt_provider") in _LEGACY_STT_PROVIDER_MAP:
            raise HTTPException(
                422,
                f"stt_provider={d['stt_provider']} 已废弃，请改用 {_LEGACY_STT_PROVIDER_MAP[d['stt_provider']]} 或 whisper",
            )
        if d.get("stt_provider") == "":
            d.pop("stt_provider", None)
        elif "stt_provider" in d and d["stt_provider"] not in STT_PROVIDER_OPTIONS:
            raise HTTPException(
                422,
                f"stt_provider 必须是 {list(STT_PROVIDER_OPTIONS)} 之一",
            )
        if d.get("candidate_stt_provider") in _LEGACY_STT_PROVIDER_MAP:
            raise HTTPException(
                422,
                f"candidate_stt_provider={d['candidate_stt_provider']} 已废弃，请改用 whisper",
            )
        if d.get("candidate_stt_provider") == "":
            d.pop("candidate_stt_provider", None)
        elif "candidate_stt_provider" in d and d["candidate_stt_provider"] not in STT_PROVIDER_OPTIONS:
            raise HTTPException(
                422,
                f"candidate_stt_provider 必须是 {list(STT_PROVIDER_OPTIONS)} 之一",
            )
        if d.get("candidate_stt_provider") in ("doubao", "generic") and not bool(d.get("candidate_remote_stt_enabled", get_config().candidate_remote_stt_enabled)):
            d["candidate_stt_provider"] = "whisper"
        if "candidate_whisper_model" in d:
            d["candidate_whisper_model"] = str(d["candidate_whisper_model"]).strip()
        if "candidate_whisper_language" in d:
            d["candidate_whisper_language"] = str(d["candidate_whisper_language"]).strip()
        if "candidate_context_wait_ms" in d:
            d["candidate_context_wait_ms"] = max(0, min(2000, int(d["candidate_context_wait_ms"])))
        if "candidate_context_max_chars" in d:
            d["candidate_context_max_chars"] = max(100, min(4000, int(d["candidate_context_max_chars"])))
        if "candidate_context_min_chars" in d:
            d["candidate_context_min_chars"] = max(1, min(100, int(d["candidate_context_min_chars"])))
        if "candidate_streaming_asr_interval_ms" in d:
            d["candidate_streaming_asr_interval_ms"] = max(800, min(5000, int(d["candidate_streaming_asr_interval_ms"])))
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
        if "multi_screen_capture_idle_sec" in d:
            d["multi_screen_capture_idle_sec"] = max(
                1.0, min(60.0, float(d["multi_screen_capture_idle_sec"]))
            )
        if "think_effort" in d:
            val = str(d["think_effort"]).strip().lower()
            if val not in ("off", "low", "medium", "high", "xhigh"):
                raise HTTPException(422, "think_effort 必须是 off/low/medium/high/xhigh 之一")
            d["think_effort"] = val
            if val == "off" and d.get("think_mode", True) is True:
                d["think_mode"] = False
            elif val != "off" and d.get("think_mode", False) is False:
                d["think_mode"] = True
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
        if "edge_tts_voice_female" in d:
            d["edge_tts_voice_female"] = str(d["edge_tts_voice_female"]).strip()
        if "edge_tts_voice_male" in d:
            d["edge_tts_voice_male"] = str(d["edge_tts_voice_male"]).strip()
        if "edge_tts_rate" in d:
            d["edge_tts_rate"] = str(d["edge_tts_rate"]).strip()
        if "edge_tts_pitch" in d:
            d["edge_tts_pitch"] = str(d["edge_tts_pitch"]).strip()
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
    port = env_int("PORT", 18080, minimum=1)
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
    try:
        engine = get_stt_engine()
        return {"loaded": engine.is_loaded, "loading": engine.is_loading, "model": engine.model_size}
    except Exception as e:
        return {"loaded": False, "loading": False, "model": get_config().stt_provider, "detail": str(e)[:200]}


@router.post("/models/health")
async def api_check_models_health():
    if not start_all_model_checks():
        raise HTTPException(429, "后台低优先级队列繁忙，请稍后重试")
    return {"ok": True}


@router.get("/models/health")
async def api_get_models_health():
    return get_model_health_snapshot()


@router.post("/models/list")
async def api_list_remote_models(body: ModelListRequest):
    api_base_url = (body.api_base_url or "").strip()
    api_key = (body.api_key or "").strip()
    if api_key == _MODEL_API_KEY_KEEP and body.model_index is not None:
        cfg = get_config()
        idx = int(body.model_index)
        api_key = cfg.models[idx].api_key if 0 <= idx < len(cfg.models) else ""
    if not api_base_url:
        raise HTTPException(400, "API Base URL 不能为空")
    if not api_key or api_key == "sk-your-api-key-here":
        raise HTTPException(400, "API Key 不能为空")
    try:
        return await run_in_threadpool(_list_remote_models, api_base_url, api_key)
    except Exception as e:
        raise HTTPException(502, f"获取模型列表失败: {e}") from e


@router.post("/models/health/{index}")
async def api_check_single_model_health(index: int):
    """Check health of a single model by index (run in background thread)."""
    cfg = get_config()
    if index < 0 or index >= len(cfg.models):
        raise HTTPException(400, f"模型 index {index} 超出范围")
    if not start_single_model_check(index):
        raise HTTPException(429, "后台低优先级队列繁忙，请稍后重试")
    return {"ok": True}


@router.post("/models/probe/{index}")
async def api_probe_single_model(index: int):
    """Check connectivity and synchronously probe model capabilities."""
    cfg = get_config()
    if index < 0 or index >= len(cfg.models):
        raise HTTPException(400, f"模型 index {index} 超出范围")
    try:
        return await run_in_threadpool(probe_single_model, index)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/stt/test")
async def api_stt_test():
    """Test current STT engine connectivity with credential pre-checks."""
    cfg = get_config()
    if cfg.stt_provider == "iflytek":
        return {"ok": False, "detail": "讯飞 STT 已下线，请改为通用 ASR 或 Whisper"}
    if cfg.stt_provider == "doubao":
        doubao_api_key = getattr(cfg, "doubao_stt_api_key", "") or ""
        doubao_access_token = cfg.doubao_stt_access_token or ""
        if not doubao_api_key and not doubao_access_token:
            return {"ok": False, "detail": "豆包 API Key 或 Access Token 未配置"}
        if not doubao_api_key and not cfg.doubao_stt_app_id:
            return {"ok": False, "detail": "豆包 App ID 未配置（新版控制台请填 API Key）"}
    elif cfg.stt_provider == "generic":
        generic_api_key = getattr(cfg, "generic_stt_api_key", "") or ""
        if not getattr(cfg, "generic_stt_api_base_url", ""):
            return {"ok": False, "detail": "通用 ASR Base URL 未配置"}
        if not generic_api_key:
            return {"ok": False, "detail": "通用 ASR API Key 未配置"}
        if not getattr(cfg, "generic_stt_model", ""):
            return {"ok": False, "detail": "通用 ASR Model 未配置"}
    try:
        engine = get_stt_engine()
        from services.audio import load_wav_file
        wav_path = Path(__file__).resolve().parents[2] / "assets" / "preflight_phrase.wav"
        if wav_path.exists():
            audio, sr = load_wav_file(wav_path)
        else:
            import numpy as _np
            sr = 16000
            audio = _np.zeros(int(sr * 1.5), dtype=_np.float32)
        result = engine.transcribe(audio, sample_rate=sr)
        if not (result or "").strip():
            return {"ok": False, "detail": "引擎返回空文本，请检查接口兼容性或模型配置"}
        return {"ok": True, "text": result}
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
    if models and not _has_enabled_model(models):
        raise HTTPException(status_code=422, detail="至少启用一个模型")
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
