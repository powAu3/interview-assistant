import copy
import json
import threading
from typing import Optional

import requests

from core.config import get_config, model_health_fingerprint
from core.resource_lanes import submit_low_priority_background
from services.llm.streaming import (
    _build_think_params,
    _completion_token_kwargs,
    _detect_think_style,
    _disabled_think_params_for_model,
    _openai_compat_headers,
)

_model_health: dict[int, str] = {}
_model_health_detail: dict[int, str] = {}
_model_health_latency: dict[int, int] = {}
_model_health_fingerprint: dict[int, str] = {}
_model_health_lock = threading.RLock()

_VISION_PROBE_IMAGE_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR42mP4TyJgGNUwqmH4agAAr639H23ooMoAAAAASUVORK5CYII="
)


def _model_label(model_cfg) -> str:
    return (
        f"{getattr(model_cfg, 'api_base_url', '')} "
        f"{getattr(model_cfg, 'name', '')} "
        f"{getattr(model_cfg, 'model', '')}"
    ).lower()


def _is_strong_reasoning_model(model_cfg) -> bool:
    label = _model_label(model_cfg)
    markers = (
        "doubao-seed",
        "doubao2.0",
        "seed-2",
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
    if not reasoning and _has_reasoning_tokens(body):
        reasoning = "reasoning_tokens"
    return text.strip(), str(reasoning or "").strip()


def _has_reasoning_tokens(value: object) -> bool:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "reasoning_tokens":
                try:
                    if int(nested or 0) > 0:
                        return True
                except (TypeError, ValueError):
                    if nested:
                        return True
            elif isinstance(nested, (dict, list)) and _has_reasoning_tokens(nested):
                return True
    elif isinstance(value, list):
        return any(_has_reasoning_tokens(item) for item in value)
    return False


def _clear_model_health(
    index: int,
    expected_fingerprint: Optional[str] = None,
) -> bool:
    with _model_health_lock:
        stored_fingerprint = _model_health_fingerprint.get(index)
        if (
            expected_fingerprint
            and stored_fingerprint
            and stored_fingerprint != expected_fingerprint
        ):
            return False
        _model_health.pop(index, None)
        _model_health_detail.pop(index, None)
        _model_health_latency.pop(index, None)
        _model_health_fingerprint.pop(index, None)
    return True


def _current_model_fingerprint(index: int) -> Optional[str]:
    cfg = get_config()
    if index < 0 or index >= len(cfg.models):
        return None
    return model_health_fingerprint(cfg.models[index])


def _fingerprint_is_current(index: int, fingerprint: str) -> bool:
    return bool(fingerprint) and _current_model_fingerprint(index) == fingerprint


def _store_model_health(
    index: int,
    fingerprint: str,
    status: str,
    detail: str = "",
    latency_ms: int = 0,
) -> bool:
    """Store a result only while the index still owns the probed model."""

    if not _fingerprint_is_current(index, fingerprint):
        return False
    with _model_health_lock:
        # Recheck after taking the state lock so a concurrent config save
        # cannot leave a stale result attached to a reused array index.
        if not _fingerprint_is_current(index, fingerprint):
            return False
        _model_health[index] = status
        _model_health_detail[index] = detail
        _model_health_latency[index] = latency_ms
        _model_health_fingerprint[index] = fingerprint
    return True


def get_model_health(index: int) -> Optional[str]:
    fingerprint = _current_model_fingerprint(index)
    with _model_health_lock:
        if (
            not fingerprint
            or not _fingerprint_is_current(index, fingerprint)
            or _model_health_fingerprint.get(index) != fingerprint
        ):
            _clear_model_health(index)
            return None
        return _model_health.get(index)


def get_model_health_snapshot() -> dict:
    cfg = get_config()
    current = {
        index: model_health_fingerprint(model)
        for index, model in enumerate(cfg.models)
    }
    with _model_health_lock:
        indexes = (
            set(_model_health)
            | set(_model_health_detail)
            | set(_model_health_latency)
            | set(_model_health_fingerprint)
        )
        for index in indexes:
            if _model_health_fingerprint.get(index) != current.get(index):
                _clear_model_health(index)
        return {
            "health": dict(_model_health),
            "detail": dict(_model_health_detail),
            "latency": dict(_model_health_latency),
            "fingerprint": dict(_model_health_fingerprint),
        }


def _build_headers(model) -> dict:
    return {
        **_openai_compat_headers(),
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


def _probe_basic(model, *, reject_reasoning: bool = True) -> tuple[bool, str, int]:
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
    if reject_reasoning and reasoning:
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


def _disable_think_probe_candidates(model) -> list[tuple[str, dict]]:
    style = _detect_think_style(model)
    requires_explicit_disable = _is_strong_reasoning_model(model)
    saved_disabled = getattr(model, "think_disabled_params", None) or {}
    if not isinstance(saved_disabled, dict):
        saved_disabled = {}
    ordered = [
        ("saved_disabled", saved_disabled),
        ("model_default_disable", _disabled_think_params_for_model(model, style)),
        ("generic_thinking_disabled", {"thinking": {"type": "disabled"}, "think_mode": False, "enable_thinking": False}),
        (
            "local_enable_thinking_false",
            {
                "enable_thinking": False,
                "chat_template_kwargs": {"enable_thinking": False},
                "think_mode": False,
            },
        ),
    ]
    if not _is_strong_reasoning_model(model):
        ordered.append(("no_params", {}))
    seen: set[str] = set()
    unique: list[tuple[str, dict]] = []
    for name, params in ordered:
        if requires_explicit_disable and not params:
            continue
        key = json.dumps(params, sort_keys=True, ensure_ascii=False) if params else "{}"
        if key in seen:
            continue
        seen.add(key)
        unique.append((name, params))
    return unique


def _probe_disable_think(model) -> tuple[dict, str]:
    messages = [{"role": "user", "content": "只回复 OK 两个字母，用于关闭思考参数测试。"}]
    last_detail = ""
    requires_explicit_disable = _is_strong_reasoning_model(model)
    for style, params in _disable_think_probe_candidates(model):
        payload = _chat_payload(model, messages, 16, params)
        try:
            body, _latency_ms = _post_chat(model, payload, timeout=12)
            text, reasoning = _extract_health_probe_text_and_reasoning(body)
            if text and not reasoning:
                if params:
                    return params, f"关闭 Think 参数已确认：{style}"
                if requires_explicit_disable:
                    last_detail = "强推理模型未验证到显式关闭 Think 参数"
                    continue
                return {}, "关闭 Think 无需额外参数"
            if reasoning:
                last_detail = f"{style} 仍返回 reasoning"
        except Exception as e:
            detail = str(e)[:160]
            last_detail = detail
            if _is_expected_param_error(detail):
                continue
    return {}, last_detail or "未检测到可靠的显式关闭 Think 参数"


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
    think_disabled_params: Optional[dict] = None,
    vision_detail: str = "",
    think_detail: str = "",
    think_disabled_detail: str = "",
) -> dict:
    return {
        "ok": ok,
        "detail": detail,
        "latency_ms": latency_ms,
        "supports_vision": supports_vision,
        "supports_think": supports_think,
        "think_style": think_style,
        "think_params": think_params or {},
        "think_disabled_params": think_disabled_params or {},
        "vision_detail": vision_detail,
        "think_detail": think_detail,
        "think_disabled_detail": think_disabled_detail,
    }


def probe_single_model(index: int) -> dict:
    cfg = get_config()
    if index < 0 or index >= len(cfg.models):
        raise ValueError(f"模型 index {index} 超出范围")
    model = copy.deepcopy(cfg.models[index])
    fingerprint = model_health_fingerprint(model)
    if getattr(model, "enabled", True) is False:
        if _fingerprint_is_current(index, fingerprint):
            _clear_model_health(index, fingerprint)
        return _probe_result(False, detail="模型已停用")
    if not model.api_key or model.api_key in ("", "sk-your-api-key-here"):
        _store_model_health(index, fingerprint, "error", "未配置 API Key", 0)
        return _probe_result(False, detail="未配置 API Key")
    try:
        _ok, _detail, latency_ms = _probe_basic(model, reject_reasoning=False)
        _store_model_health(index, fingerprint, "ok", "", latency_ms)
    except Exception as e:
        detail = str(e)[:120]
        _store_model_health(index, fingerprint, "error", detail, 0)
        return _probe_result(False, detail=detail)
    supports_vision, vision_detail = _probe_vision(model)
    think_disabled_params, think_disabled_detail = _probe_disable_think(model)
    supports_think, think_style, think_params, think_detail = _probe_think(model)
    return _probe_result(
        True,
        detail=_detail,
        latency_ms=latency_ms,
        supports_vision=supports_vision,
        supports_think=supports_think,
        think_style=think_style,
        think_params=think_params,
        think_disabled_params=think_disabled_params,
        vision_detail=vision_detail,
        think_detail=think_detail,
        think_disabled_detail=think_disabled_detail,
    )


def _check_single_model(
    index: int,
    model_snapshot=None,
    expected_fingerprint: Optional[str] = None,
):
    from api.realtime.ws import broadcast

    if model_snapshot is None:
        cfg = get_config()
        if index < 0 or index >= len(cfg.models):
            return
        model = copy.deepcopy(cfg.models[index])
    else:
        model = model_snapshot
    fingerprint = expected_fingerprint or model_health_fingerprint(model)
    if not _fingerprint_is_current(index, fingerprint):
        return
    if getattr(model, "enabled", True) is False:
        _clear_model_health(index, fingerprint)
        return
    if _store_model_health(index, fingerprint, "checking", "", 0):
        broadcast(
            {
                "type": "model_health",
                "index": index,
                "status": "checking",
                "model_fingerprint": fingerprint,
            }
        )
    else:
        return

    if not model.api_key or model.api_key in ("", "sk-your-api-key-here"):
        if _store_model_health(index, fingerprint, "error", "未配置 API Key", 0):
            broadcast(
                {
                    "type": "model_health",
                    "index": index,
                    "status": "error",
                    "detail": "未配置 API Key",
                    "model_fingerprint": fingerprint,
                }
            )
        return

    try:
        _ok, _detail, latency_ms = _probe_basic(model)
        if _store_model_health(index, fingerprint, "ok", "", latency_ms):
            broadcast(
                {
                    "type": "model_health",
                    "index": index,
                    "status": "ok",
                    "latency_ms": latency_ms,
                    "model_fingerprint": fingerprint,
                }
            )
    except Exception as e:
        detail = str(e)[:120]
        if _store_model_health(index, fingerprint, "error", detail, 0):
            broadcast(
                {
                    "type": "model_health",
                    "index": index,
                    "status": "error",
                    "detail": detail,
                    "latency_ms": 0,
                    "model_fingerprint": fingerprint,
                }
            )


def start_all_model_checks() -> bool:
    cfg = get_config()
    accepted = 0
    enabled_indexes = [
        i
        for i, model in enumerate(cfg.models)
        if getattr(model, "enabled", True) is not False
    ]
    disabled_indexes = set(range(len(cfg.models))) - set(enabled_indexes)
    stale_indexes = set(_model_health) - set(range(len(cfg.models)))
    for i in disabled_indexes | stale_indexes:
        _clear_model_health(i)
    for i in enabled_indexes:
        if start_single_model_check(i):
            accepted += 1
        else:
            fingerprint = model_health_fingerprint(cfg.models[i])
            _store_model_health(
                i,
                fingerprint,
                "error",
                "后台队列繁忙，请稍后重试",
                0,
            )
    return accepted > 0 or not enabled_indexes


def start_single_model_check(index: int) -> bool:
    cfg = get_config()
    if index < 0 or index >= len(cfg.models):
        return False
    model = copy.deepcopy(cfg.models[index])
    fingerprint = model_health_fingerprint(model)
    if getattr(model, "enabled", True) is False:
        if _fingerprint_is_current(index, fingerprint):
            _clear_model_health(index, fingerprint)
        return True
    return submit_low_priority_background(
        _check_single_model,
        index,
        model,
        fingerprint,
    )
