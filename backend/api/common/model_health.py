from typing import Optional

import requests

from core.config import get_config
from core.resource_lanes import submit_low_priority_background

_model_health: dict[int, str] = {}
_model_health_detail: dict[int, str] = {}
_model_health_latency: dict[int, int] = {}


def get_model_health(index: int) -> Optional[str]:
    return _model_health.get(index)


def get_model_health_snapshot() -> dict:
    return {"health": _model_health, "detail": _model_health_detail, "latency": _model_health_latency}


def _check_single_model(index: int):
    from api.realtime.ws import broadcast

    cfg = get_config()
    if index >= len(cfg.models):
        return
    model = cfg.models[index]
    if getattr(model, "enabled", True) is False:
        _model_health.pop(index, None)
        _model_health_detail.pop(index, None)
        _model_health_latency.pop(index, None)
        return
    _model_health[index] = "checking"
    _model_health_detail[index] = ""
    _model_health_latency[index] = 0
    broadcast({"type": "model_health", "index": index, "status": "checking"})

    if not model.api_key or model.api_key in ("", "sk-your-api-key-here"):
        _model_health[index] = "error"
        _model_health_detail[index] = "未配置 API Key"
        _model_health_latency[index] = 0
        broadcast({"type": "model_health", "index": index, "status": "error", "detail": "未配置 API Key"})
        return

    try:
        # SDK 在部分环境会抛出 pydantic by_alias 兼容异常；检测链路改为原始 HTTP 更稳。
        base = (model.api_base_url or "").rstrip("/")
        url = f"{base}/chat/completions"
        headers = {
            "Authorization": f"Bearer {model.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model.model,
            "messages": [{"role": "user", "content": "请回复“ok”，用于连接测试。"}],
            "max_tokens": 16,
            "stream": False,
        }
        import time as _time
        t0 = _time.monotonic()
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=12,
        )
        latency_ms = int((_time.monotonic() - t0) * 1000)
        if response.status_code >= 400:
            try:
                body = response.json()
            except Exception:
                body = response.text
            raise RuntimeError(f"HTTP {response.status_code}: {str(body)[:120]}")
        _model_health[index] = "ok"
        _model_health_detail[index] = ""
        _model_health_latency[index] = latency_ms
        broadcast({"type": "model_health", "index": index, "status": "ok", "latency_ms": latency_ms})
    except Exception as e:
        latency_ms_val = _model_health_latency.get(index, 0)
        _model_health[index] = "error"
        detail = str(e)[:120]
        _model_health_detail[index] = detail
        broadcast({"type": "model_health", "index": index, "status": "error", "detail": detail, "latency_ms": latency_ms_val})


def start_all_model_checks() -> bool:
    cfg = get_config()
    accepted = 0
    enabled_indexes = [
        i
        for i, model in enumerate(cfg.models)
        if getattr(model, "enabled", True) is not False
    ]
    disabled_indexes = set(range(len(cfg.models))) - set(enabled_indexes)
    for i in disabled_indexes:
        _model_health.pop(i, None)
        _model_health_detail.pop(i, None)
        _model_health_latency.pop(i, None)
    for i in enabled_indexes:
        if start_single_model_check(i):
            accepted += 1
        else:
            _model_health[i] = "error"
            _model_health_detail[i] = "后台队列繁忙，请稍后重试"
    return accepted > 0 or not enabled_indexes


def start_single_model_check(index: int) -> bool:
    cfg = get_config()
    if index < 0:
        return False
    if index < len(cfg.models) and getattr(cfg.models[index], "enabled", True) is False:
        _model_health.pop(index, None)
        _model_health_detail.pop(index, None)
        _model_health_latency.pop(index, None)
        return True
    return submit_low_priority_background(_check_single_model, index)
