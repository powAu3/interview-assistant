from typing import Optional

import requests

from core.config import get_config
from core.resource_lanes import submit_low_priority_background
from services.llm.streaming import _build_think_params, _completion_token_kwargs, _detect_think_style, _is_doubao_model

_model_health: dict[int, str] = {}
_model_health_detail: dict[int, str] = {}
_model_health_latency: dict[int, int] = {}

_VISION_PROBE_IMAGE_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def _model_label(model_cfg) -> str:
    return f"{getattr(model_cfg, 'api_base_url', '')} {getattr(model_cfg, 'model', '')}".lower()


def _is_strong_reasoning_model(model_cfg) -> bool:
    if _is_doubao_model(model_cfg):
        return False
    label = _model_label(model_cfg)
    markers = (
        "gpt-5",
        " o1",
        "/o1",
        "o1-",
        " o3",
        "/o3",
        "o3-",
        " o4",
        "/o4",
        "o4-",
        "claude",
        "sonnet",
        "haiku",
        "opus",
        "reasoning",
        "reasoner",
        "thinking",
        "deepseek-r1",
        "deepseek-reasoner",
        "qwq",
        "qwen3",
        "glm-4.5",
        "glm-z1",
        "glm-5",
        "gemini-2.5",
        "gemini-3",
        "grok-4",
    )
    return any(marker in f" {label}" for marker in markers)


def _is_expected_param_error(detail: str) -> bool:
    lowered = detail.lower()
    return any(
        marker in lowered
        for marker in (
            "unsupported",
            "unknown",
            "unrecognized",
            "invalid",
            "extra",
            "not support",
            "does not support",
            "不支持",
            "未知",
            "无效",
            "参数",
        )
    )


def _extract_health_probe_text_and_reasoning(body: object) -> tuple[str, str]:
    if not isinstance(body, dict):
        return "", ""
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return "", ""
    first = choices[0] if isinstance(choices[0], dict) else {}
    message = first.get("message") if isinstance(first.get("message"), dict) else {}
    delta = first.get("delta") if isinstance(first.get("delta"), dict) else {}
    content = message.get("content", first.get("text", ""))
    if isinstance(content, list):
        text_parts = [
            str(part.get("text") or "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        text = "".join(text_parts)
    else:
        text = str(content or "")
    reasoning = (
        message.get("reasoning_content")
        or message.get("reasoning")
        or delta.get("reasoning_content")
        or delta.get("reasoning")
        or ""
    )
    return text.strip(), str(reasoning or "").strip()


def get_model_health(index: int) -> Optional[str]:
    return _model_health.get(index)


def get_model_health_snapshot() -> dict:
    return {"health": _model_health, "detail": _model_health_detail, "latency": _model_health_latency}


def _build_headers(model) -> dict:
    return {
        "Authorization": f"Bearer {model.api_key}",
        "Content-Type": "application/json",
    }


def _chat_url(model) -> str:
    base = (model.api_base_url or "").rstrip("/")
    return f"{base}/chat/completions"


def _chat_payload(model, messages: list, max_tokens: int, extra: Optional[dict] = None) -> dict:
    payload = {
        "model": model.model,
        "messages": messages,
        "stream": False,
        **_completion_token_kwargs(model, max_tokens),
    }
    if extra:
        payload.update(extra)
    return payload


def _post_chat(model, payload: dict, timeout: int = 12) -> tuple[dict, int]:
    import time as _time

    t0 = _time.monotonic()
    response = requests.post(
        _chat_url(model),
        headers=_build_headers(model),
        json=payload,
        timeout=timeout,
    )
    latency_ms = int((_time.monotonic() - t0) * 1000)
    if response.status_code >= 400:
        try:
            body = response.json()
        except Exception:
            body = response.text
        raise RuntimeError(f"HTTP {response.status_code}: {str(body)[:200]}")
    try:
        body = response.json()
    except Exception:
        body = {}
    return body, latency_ms


def _probe_basic(model) -> tuple[bool, str, int]:
    payload = _chat_payload(
        model,
        [{"role": "user", "content": "只回复 OK 两个字母，用于连接测试。"}],
        16,
        _build_think_params(
            model,
            type("HealthCfg", (), {"think_mode": False, "think_effort": "off"})(),
        ),
    )
    body, latency_ms = _post_chat(model, payload, timeout=12)
    text, reasoning = _extract_health_probe_text_and_reasoning(body)
    if reasoning and not _is_doubao_model(model):
        raise RuntimeError("关闭思考后仍返回 reasoning，已暂不参与答题")
    if not text:
        raise RuntimeError("连接成功但模型未返回正文")
    return True, "", latency_ms


def _probe_vision(model) -> tuple[bool, str]:
    payload = _chat_payload(
        model,
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "这是一张测试图。只回复 OK。"},
                    {"type": "image_url", "image_url": {"url": _VISION_PROBE_IMAGE_DATA_URL}},
                ],
            }
        ],
        16,
        _build_think_params(
            model,
            type("HealthCfg", (), {"think_mode": False, "think_effort": "off"})(),
        ),
    )
    try:
        body, _latency_ms = _post_chat(model, payload, timeout=18)
        text, _reasoning = _extract_health_probe_text_and_reasoning(body)
        if not text:
            return False, "识图请求成功但返回空正文"
        return True, "识图请求成功"
    except Exception as e:
        return False, str(e)[:160]


def _think_probe_candidates(model) -> list[tuple[str, dict]]:
    style = _detect_think_style(model)
    ordered: list[tuple[str, dict]] = []
    if style == "gpt":
        ordered.append(("gpt_reasoning_effort", {"reasoning_effort": "low"}))
    elif style == "claude":
        ordered.append(("claude_thinking_budget", {"thinking": {"type": "enabled", "budget_tokens": 102}, "think_mode": True}))
    ordered.extend(
        [
            ("generic_thinking", {"thinking": {"type": "enabled"}, "think_mode": True}),
            (
                "local_enable_thinking",
                {
                    "enable_thinking": True,
                    "chat_template_kwargs": {"enable_thinking": True},
                    "think_mode": True,
                },
            ),
        ]
    )
    seen: set[str] = set()
    unique: list[tuple[str, dict]] = []
    for name, params in ordered:
        if name not in seen:
            seen.add(name)
            unique.append((name, params))
    return unique


def _probe_think(model) -> tuple[bool, str, dict, str]:
    if not _is_strong_reasoning_model(model):
        return False, "", {}, "模型名未显示为推理模型，未自动开启 Think"
    messages = [{"role": "user", "content": "请用最短思考回答：1+1 等于几？最后只输出 2。"}]
    last_detail = ""
    for style, params in _think_probe_candidates(model):
        payload = _chat_payload(model, messages, 64, params)
        try:
            body, _latency_ms = _post_chat(model, payload, timeout=12)
            text, reasoning = _extract_health_probe_text_and_reasoning(body)
            if reasoning or _is_strong_reasoning_model(model):
                return True, style, params, "Think 参数已接受"
            if text:
                last_detail = f"{style} 参数被接受，但未返回 reasoning"
        except Exception as e:
            detail = str(e)[:160]
            last_detail = detail
            if not _is_expected_param_error(detail):
                continue
    return False, "", {}, last_detail or "未检测到可用 Think 参数"


def _probe_result(
    ok: bool,
    detail: str = "",
    latency_ms: int = 0,
    supports_vision: bool = False,
    supports_think: bool = False,
    think_style: str = "",
    think_params: Optional[dict] = None,
    vision_detail: str = "",
    think_detail: str = "",
) -> dict:
    return {
        "ok": ok,
        "detail": detail,
        "latency_ms": latency_ms,
        "supports_vision": supports_vision,
        "supports_think": supports_think,
        "think_style": think_style,
        "think_params": think_params or {},
        "vision_detail": vision_detail,
        "think_detail": think_detail,
    }


def probe_single_model(index: int) -> dict:
    cfg = get_config()
    if index < 0 or index >= len(cfg.models):
        raise ValueError(f"模型 index {index} 超出范围")
    model = cfg.models[index]
    if getattr(model, "enabled", True) is False:
        _model_health.pop(index, None)
        _model_health_detail.pop(index, None)
        _model_health_latency.pop(index, None)
        return _probe_result(False, detail="模型已停用")
    if not model.api_key or model.api_key in ("", "sk-your-api-key-here"):
        _model_health[index] = "error"
        _model_health_detail[index] = "未配置 API Key"
        _model_health_latency[index] = 0
        return _probe_result(False, detail="未配置 API Key")
    try:
        _ok, _detail, latency_ms = _probe_basic(model)
        _model_health[index] = "ok"
        _model_health_detail[index] = ""
        _model_health_latency[index] = latency_ms
    except Exception as e:
        detail = str(e)[:120]
        _model_health[index] = "error"
        _model_health_detail[index] = detail
        _model_health_latency[index] = 0
        return _probe_result(False, detail=detail)
    supports_vision, vision_detail = _probe_vision(model)
    supports_think, think_style, think_params, think_detail = _probe_think(model)
    return _probe_result(
        True,
        detail=_detail,
        latency_ms=latency_ms,
        supports_vision=supports_vision,
        supports_think=supports_think,
        think_style=think_style,
        think_params=think_params,
        vision_detail=vision_detail,
        think_detail=think_detail,
    )


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
        _ok, _detail, latency_ms = _probe_basic(model)
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
