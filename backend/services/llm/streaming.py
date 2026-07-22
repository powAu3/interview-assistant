"""LLM client management, token tracking, and streaming generation."""

import threading
import json
import re
from types import SimpleNamespace
from openai import OpenAI
import openai
import requests
from typing import Callable, Generator, Optional
from core.config import get_config
from core.logger import get_logger

_log = get_logger("llm.streaming")


# ---------------------------------------------------------------------------
# LLM exception taxonomy (internal use; keeps yield protocol unchanged)
# ---------------------------------------------------------------------------

class LLMError(Exception):
    """Base for all LLM-layer exceptions. ``user_msg`` is shown to end-users."""

    user_msg: str = "调用大模型失败，请稍后重试。"

    def __init__(self, message: str, *, cause: Optional[BaseException] = None):
        super().__init__(message)
        self.cause = cause


class LLMTimeout(LLMError):
    user_msg = "大模型响应超时（请检查网络或更换模型）。"


class LLMAuthError(LLMError):
    user_msg = "大模型鉴权失败（请检查 API Key）。"


class LLMRateLimit(LLMError):
    user_msg = "大模型触发限流，请稍后重试或切换模型。"


class LLMContextExceeded(LLMError):
    user_msg = "上下文超长，请清空会话或缩短问题后重试。"


class LLMServerError(LLMError):
    user_msg = "大模型服务端异常（5xx），稍后重试。"


class LLMConnectionError(LLMError):
    user_msg = "无法连接大模型服务（请检查网络/代理）。"


class LLMProtocolError(LLMError):
    user_msg = "大模型返回格式异常。"


def _compact_error_detail(error: BaseException, max_chars: int = 240) -> str:
    """Keep provider diagnostics useful without logging an HTML challenge page."""
    raw = str(error or "").strip()
    response = getattr(error, "response", None)
    status = getattr(error, "status_code", None) or getattr(response, "status_code", None)
    lowered = raw.lower()
    if any(marker in lowered for marker in ("<!doctype html", "<html", "just a moment", "cloudflare")):
        status_text = f"HTTP {status} " if status else ""
        return f"{status_text}provider returned an HTML challenge page"
    compact = re.sub(r"\s+", " ", raw)
    if len(compact) > max_chars:
        return compact[: max_chars - 1].rstrip() + "…"
    return compact or error.__class__.__name__


def _classify_exception(e: BaseException) -> LLMError:
    """Map any underlying SDK/HTTP exception to a typed LLMError."""
    if isinstance(e, LLMError):
        return e
    if isinstance(e, openai.APITimeoutError):
        return LLMTimeout(_compact_error_detail(e), cause=e)
    if isinstance(e, openai.AuthenticationError):
        return LLMAuthError(_compact_error_detail(e), cause=e)
    if isinstance(e, openai.PermissionDeniedError):
        return LLMAuthError(_compact_error_detail(e), cause=e)
    if isinstance(e, openai.RateLimitError):
        return LLMRateLimit(_compact_error_detail(e), cause=e)
    if isinstance(e, openai.BadRequestError):
        msg = str(e).lower()
        if "context" in msg or "maximum context" in msg or "token" in msg:
            return LLMContextExceeded(_compact_error_detail(e), cause=e)
        return LLMError(_compact_error_detail(e), cause=e)
    if isinstance(e, openai.InternalServerError):
        return LLMServerError(_compact_error_detail(e), cause=e)
    if isinstance(e, openai.APIConnectionError):
        return LLMConnectionError(_compact_error_detail(e), cause=e)
    if isinstance(e, requests.exceptions.Timeout):
        return LLMTimeout(_compact_error_detail(e), cause=e)
    if isinstance(e, requests.exceptions.ConnectionError):
        return LLMConnectionError(_compact_error_detail(e), cause=e)
    if isinstance(e, requests.exceptions.RequestException):
        return LLMConnectionError(_compact_error_detail(e), cause=e)
    return LLMError(_compact_error_detail(e), cause=e)


# ---------------------------------------------------------------------------
# Client helpers (pooled by api_key + base_url)
# ---------------------------------------------------------------------------

_client_cache: dict[tuple[str, str], OpenAI] = {}
_client_cache_lock = threading.Lock()


def _openai_compat_headers() -> dict[str, str]:
    # Some OpenAI-compatible gateways block the OpenAI SDK's default User-Agent.
    return {"User-Agent": f"python-requests/{requests.__version__}"}


def get_client() -> OpenAI:
    cfg = get_config()
    m = cfg.get_active_model()
    return get_client_for_model(m)


def get_client_for_model(model_cfg) -> OpenAI:
    key = (model_cfg.api_key, model_cfg.api_base_url)
    with _client_cache_lock:
        client = _client_cache.get(key)
        if client is None:
            client = OpenAI(
                api_key=model_cfg.api_key,
                base_url=model_cfg.api_base_url,
                default_headers=_openai_compat_headers(),
            )
            _client_cache[key] = client
        return client


def has_vision_model() -> bool:
    cfg = get_config()
    for m in cfg.models:
        if m.supports_vision and m.api_key and m.api_key not in ("", "sk-your-api-key-here"):
            return True
    return False


RESUME_VISION_PROMPT = """以下是一份简历的页面图片（可能为扫描件或截图）。请将每页中的文字完整、准确地识别并输出为纯文本。

要求：
- 按页顺序合并输出，多页之间用空行分隔；
- 保留原有段落与换行，不要合并成一大段；
- 只输出识别出的文字内容，不要添加「识别结果」「如下」等标题或解释；
- 专有名词、英文、数字、日期保持原样；
- 若某页无文字或无法识别，可输出空行或省略该页，不要编造内容。"""


def _vision_via_http(model_cfg, messages: list[dict]) -> str:
    """Raw HTTP fallback for vision calls when SDK has pydantic issues."""
    base = (model_cfg.api_base_url or "").rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        **_openai_compat_headers(),
        "Authorization": f"Bearer {model_cfg.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_cfg.model,
        "messages": messages,
        "max_tokens": 4096,
        "temperature": 0,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=(10, 120))
    if resp.status_code >= 400:
        raise RuntimeError(f"Vision HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()


def vision_extract_text(image_base64_list: list[str]) -> str:
    cfg = get_config()
    model = None
    for m in cfg.models:
        if m.supports_vision and m.api_key and m.api_key not in ("", "sk-your-api-key-here"):
            model = m
            break
    if not model:
        raise ValueError(
            "\u4e0a\u4f20 PDF \u7b80\u5386\u9700\u8981\u5148\u914d\u7f6e\u652f\u6301\u8bc6\u56fe\u7684\u6a21\u578b\u3002"
            "\u8bf7\u5728\u300c\u8bbe\u7f6e\u300d\u4e2d\u9009\u62e9\u5e76\u4fdd\u5b58\u4e00\u4e2a\u5e26\u300c\u8bc6\u56fe\u300d"
            "\u7684\u6a21\u578b\u53ca API Key \u540e\u518d\u8bd5\uff1b"
            "\u6216\u6539\u4e3a\u4e0a\u4f20 DOCX / TXT \u683c\u5f0f\u7684\u7b80\u5386\u3002"
        )
    parts: list[dict] = [{"type": "text", "text": RESUME_VISION_PROMPT}]
    for b64 in image_base64_list:
        if b64.startswith("data:"):
            img_url = b64
        else:
            img_url = f"data:image/png;base64,{b64}"
        parts.append({"type": "image_url", "image_url": {"url": img_url}})
    vision_messages = [{"role": "user", "content": parts}]
    client = get_client_for_model(model)
    try:
        r = client.chat.completions.create(
            model=model.model,
            messages=vision_messages,
            max_tokens=4096,
            temperature=0,
        )
        return (r.choices[0].message.content or "").strip()
    except TypeError as e:
        if "by_alias" not in str(e):
            raise ValueError(f"\u8bc6\u56fe\u6a21\u578b\u89e3\u6790\u5931\u8d25: {e}") from e
        _log.warning("Vision SDK failed (by_alias), fallback to HTTP: %s", e)
        return _vision_via_http(model, vision_messages)
    except Exception as e:
        raise ValueError(f"\u8bc6\u56fe\u6a21\u578b\u89e3\u6790\u5931\u8d25: {e}") from e


# ---------------------------------------------------------------------------
# Token tracking
# ---------------------------------------------------------------------------

_RETRYABLE_ERRORS = (
    openai.RateLimitError,
    openai.APIConnectionError,
    openai.APITimeoutError,
    openai.InternalServerError,
    requests.exceptions.Timeout,
    requests.exceptions.ConnectionError,
    LLMTimeout,
    LLMRateLimit,
    LLMServerError,
    LLMConnectionError,
)

_token_stats: dict = {"prompt": 0, "completion": 0, "total": 0, "by_model": {}}
_token_lock = threading.Lock()


def get_token_stats() -> dict:
    with _token_lock:
        return {
            "prompt": _token_stats["prompt"],
            "completion": _token_stats["completion"],
            "total": _token_stats["total"],
            "by_model": dict(_token_stats.get("by_model", {})),
        }


def _add_tokens(prompt: int, completion: int, model_name: Optional[str] = None):
    with _token_lock:
        _token_stats["prompt"] += prompt
        _token_stats["completion"] += completion
        _token_stats["total"] += prompt + completion
        if model_name:
            bm = _token_stats.setdefault("by_model", {})
            cur = bm.setdefault(model_name, {"prompt": 0, "completion": 0})
            cur["prompt"] += prompt
            cur["completion"] += completion


def _broadcast_tokens():
    from api.realtime.ws import broadcast
    with _token_lock:
        broadcast(
            {
                "type": "token_update",
                "prompt": _token_stats["prompt"],
                "completion": _token_stats["completion"],
                "total": _token_stats["total"],
                "by_model": dict(_token_stats.get("by_model", {})),
            }
        )


# ---------------------------------------------------------------------------
# Streaming generation
# ---------------------------------------------------------------------------

def _sanitize_messages(messages: list[dict], supports_vision: bool) -> list[dict]:
    if supports_vision:
        return messages
    sanitized = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            texts = []
            has_image = False
            for part in content:
                if part.get("type") == "text":
                    texts.append(part["text"])
                elif part.get("type") == "image_url":
                    has_image = True
            text = "\n".join(texts)
            if has_image:
                text += "\n[注意: 图片已省略，当前模型不支持图片识别]"
            sanitized.append({"role": msg["role"], "content": text})
        else:
            sanitized.append(msg)
    return sanitized


_EFFORT_BUDGET = {
    "low": 1024,
    "medium": 4096,
    "high": 10240,
    "xhigh": 16384,
}

_THINK_DISABLED_BASE_PARAMS = {
    "thinking": {"type": "disabled"},
    "think_mode": False,
    "enable_thinking": False,
}

_THINK_DISABLED_LOCAL_PARAMS = {
    **_THINK_DISABLED_BASE_PARAMS,
    "chat_template_kwargs": {"enable_thinking": False},
}


_GENERIC_REASONING_MARKERS = (
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


def _is_doubao_model(model_cfg) -> bool:
    base_url = (getattr(model_cfg, "api_base_url", "") or "").lower()
    model_name = (getattr(model_cfg, "model", "") or "").lower()
    return "doubao" in model_name or "volces" in base_url or "ark" in base_url


def _is_generic_reasoning_model(model_cfg) -> bool:
    label = (
        f"{getattr(model_cfg, 'api_base_url', '')} "
        f"{getattr(model_cfg, 'name', '')} "
        f"{getattr(model_cfg, 'model', '')}"
    ).lower()
    return any(marker in label for marker in _GENERIC_REASONING_MARKERS)


def _disabled_think_params_for_model(model_cfg, style: str) -> dict:
    base_url = (getattr(model_cfg, "api_base_url", "") or "").lower()
    model_name = (getattr(model_cfg, "model", "") or "").lower()
    if _is_doubao_model(model_cfg):
        return dict(_THINK_DISABLED_BASE_PARAMS)
    if "localhost" in base_url or "127.0.0.1" in base_url or "sglang" in base_url:
        return dict(_THINK_DISABLED_LOCAL_PARAMS)
    if "glm" in model_name or "bigmodel" in base_url or (style == "generic" and _is_generic_reasoning_model(model_cfg)):
        return dict(_THINK_DISABLED_BASE_PARAMS)
    return {}


def _model_dict_param(model_cfg, name: str) -> dict:
    value = getattr(model_cfg, name, None) or {}
    return dict(value) if isinstance(value, dict) else {}


def _copy_config_with_updates(cfg, updates: dict):
    if hasattr(cfg, "model_copy"):
        return cfg.model_copy(update=updates)
    data = dict(getattr(cfg, "__dict__", {}) or {})
    data.update(updates)
    return SimpleNamespace(**data)


def _completion_token_kwargs(model_cfg, max_tokens: int) -> dict:
    token_limit = max(1, int(max_tokens or 1))
    if _detect_think_style(model_cfg) == "gpt":
        return {"max_completion_tokens": token_limit}
    return {"max_tokens": token_limit}


def _claude_thinking_budget(effort: str, max_tokens: int) -> int:
    token_limit = max(2, int(max_tokens or 2))
    requested = _EFFORT_BUDGET.get(effort, 4096)
    visible_answer_reserve = min(1024, max(1, token_limit // 4))
    return max(1, min(requested, token_limit - visible_answer_reserve))


def _usage_delta(prompt_tokens: int, completion_tokens: int, previous: tuple[int, int]) -> tuple[int, int, tuple[int, int]]:
    prompt_tokens = int(prompt_tokens or 0)
    completion_tokens = int(completion_tokens or 0)
    previous_prompt, previous_completion = previous
    if prompt_tokens >= previous_prompt and completion_tokens >= previous_completion:
        return (
            prompt_tokens - previous_prompt,
            completion_tokens - previous_completion,
            (prompt_tokens, completion_tokens),
        )
    return prompt_tokens, completion_tokens, (prompt_tokens, completion_tokens)

def _detect_think_style(model_cfg) -> str:
    """Detect which thinking parameter format the model expects.

    Returns:
        'gpt'   – OpenAI o-series / GPT reasoning models (use reasoning_effort)
        'claude' – Anthropic Claude extended thinking (use thinking.budget_tokens)
        'generic' – generic OpenAI-compatible (use thinking.type)
    """
    name = (model_cfg.model or "").lower()
    if name.startswith("gpt-5") or name.startswith("o1") or name.startswith("o3") or name.startswith("o4"):
        return "gpt"
    if "claude" in name or "sonnet" in name or "haiku" in name or "opus" in name:
        return "claude"
    return "generic"


def _build_think_params(model_cfg, cfg) -> dict:
    effort = cfg.think_effort
    style = _detect_think_style(model_cfg)
    if not getattr(cfg, "think_mode", False) or effort == "off":
        saved_disabled = _model_dict_param(model_cfg, "think_disabled_params")
        if saved_disabled:
            return saved_disabled
        return _disabled_think_params_for_model(model_cfg, style)
    saved_enabled = _model_dict_param(model_cfg, "think_enabled_params")
    if saved_enabled and style != "gpt":
        return saved_enabled
    if not model_cfg.supports_think:
        return {}
    if _is_doubao_model(model_cfg):
        return {}
    if style == "gpt":
        params = dict(saved_enabled)
        params["reasoning_effort"] = effort
        return params
    if style == "claude":
        budget = _claude_thinking_budget(effort, getattr(cfg, "max_tokens", 4096))
        return {
            "thinking": {"type": "enabled", "budget_tokens": budget},
            "think_mode": True,
        }
    return {
        "thinking": {"type": "enabled"},
        "think_mode": True,
    }


def _should_emit_think(model_cfg, cfg) -> bool:
    return bool(
        model_cfg.supports_think
        and getattr(cfg, "think_mode", False)
        and getattr(cfg, "think_effort", "off") != "off"
    )


def _try_stream_with_model(model_cfg, full_messages, cfg):
    client = get_client_for_model(model_cfg)
    extra_kwargs: dict = {}
    think_params = _build_think_params(model_cfg, cfg)
    if think_params:
        extra_kwargs["extra_body"] = think_params
    extra_kwargs["stream_options"] = {"include_usage": True}
    token_kwargs = _completion_token_kwargs(model_cfg, cfg.max_tokens)
    try:
        response = client.chat.completions.create(
            model=model_cfg.model,
            messages=full_messages,
            temperature=cfg.temperature,
            stream=True,
            **token_kwargs,
            **extra_kwargs,
        )
        return response
    except TypeError as e:
        # 某些环境中 openai-sdk + pydantic 组合会在解析流式响应时抛 by_alias 异常。
        if "by_alias" not in str(e):
            raise
        _log.warning("SDK stream failed, fallback to HTTP stream model=%s err=%s", model_cfg.name, e)
        return _stream_via_http(model_cfg, full_messages, cfg, think_params)


def _stream_via_http(model_cfg, full_messages, cfg, think_params):
    base = (model_cfg.api_base_url or "").rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        **_openai_compat_headers(),
        "Authorization": f"Bearer {model_cfg.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_cfg.model,
        "messages": full_messages,
        "temperature": cfg.temperature,
        "stream": True,
        "stream_options": {"include_usage": True},
        **_completion_token_kwargs(model_cfg, cfg.max_tokens),
    }
    if think_params:
        payload.update(think_params)
    # timeout=(connect, read): read 是「两次 byte 之间」的间隔上限，
    # 而非整体响应时长，正好适合长流式（避免 60s 总超时硬截断）。
    with requests.post(url, headers=headers, json=payload, stream=True, timeout=(10, 90)) as resp:
        if resp.status_code >= 400:
            try:
                body = resp.json()
            except Exception:
                body = resp.text
            text = str(body)[:200]
            if resp.status_code in (401, 403):
                raise LLMAuthError(f"HTTP {resp.status_code}: {text}")
            if resp.status_code == 429:
                raise LLMRateLimit(f"HTTP {resp.status_code}: {text}")
            if resp.status_code == 400 and ("context" in text.lower() or "token" in text.lower()):
                raise LLMContextExceeded(f"HTTP {resp.status_code}: {text}")
            if 500 <= resp.status_code < 600:
                raise LLMServerError(f"HTTP {resp.status_code}: {text}")
            raise LLMError(f"HTTP {resp.status_code}: {text}")
        for raw_line in resp.iter_lines(decode_unicode=False):
            if not raw_line:
                continue
            line = raw_line.decode("utf-8", errors="replace")
            if not line:
                continue
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                obj = json.loads(data)
            except Exception:
                continue
            choices = obj.get("choices") or []
            usage = obj.get("usage")
            if choices:
                delta_obj = choices[0].get("delta") or {}
                delta = SimpleNamespace(
                    content=delta_obj.get("content"),
                    reasoning_content=delta_obj.get("reasoning_content"),
                    reasoning=delta_obj.get("reasoning"),
                )
                chunk_choices = [SimpleNamespace(delta=delta)]
            else:
                chunk_choices = []
            if usage:
                usage_obj = SimpleNamespace(
                    prompt_tokens=usage.get("prompt_tokens") or 0,
                    completion_tokens=usage.get("completion_tokens") or 0,
                )
            else:
                usage_obj = None
            yield SimpleNamespace(choices=chunk_choices, usage=usage_obj)


def _config_with_think_override(cfg, override_think_mode: Optional[bool]):
    if override_think_mode is None:
        return cfg
    updates = {"think_mode": override_think_mode}
    if override_think_mode and getattr(cfg, "think_effort", "off") == "off":
        updates["think_effort"] = "xhigh"
    elif not override_think_mode:
        updates["think_effort"] = "off"
    return _copy_config_with_updates(cfg, updates)


def chat_stream(
    messages: list[dict],
    system_prompt: Optional[str] = None,
    abort_check: Optional[Callable[[], bool]] = None,
    override_think_mode: Optional[bool] = None,
) -> Generator[tuple[str, str], None, None]:
    """Yields (chunk_type, text) tuples. chunk_type is 'think' or 'text'."""
    from api.realtime.ws import broadcast

    cfg = _config_with_think_override(get_config(), override_think_mode)
    active_model = cfg.get_active_model()
    clean_messages = _sanitize_messages(messages, active_model.supports_vision)
    full_messages = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(clean_messages)
    models_to_try = [active_model]
    for i, m in enumerate(cfg.models):
        if i != cfg.active_model and m.enabled and m.api_key and m.api_key not in ("", "sk-your-api-key-here"):
            models_to_try.append(m)

    last_error = None
    for idx, model in enumerate(models_to_try):
        try:
            if idx > 0:
                full_messages_adj = _sanitize_messages(full_messages, model.supports_vision)
                broadcast({
                    "type": "model_fallback",
                    "from": models_to_try[idx - 1].name,
                    "to": model.name,
                    "reason": str(last_error)[:80],
                })
            else:
                full_messages_adj = full_messages

            response = _try_stream_with_model(model, full_messages_adj, cfg)
            last_usage = (0, 0)
            for chunk in response:
                if abort_check and abort_check():
                    return
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
                    if reasoning and _should_emit_think(model, cfg):
                        yield ("think", reasoning)
                    if delta.content:
                        yield ("text", delta.content)
                if hasattr(chunk, "usage") and chunk.usage:
                    prompt_delta, completion_delta, last_usage = _usage_delta(
                        chunk.usage.prompt_tokens or 0,
                        chunk.usage.completion_tokens or 0,
                        last_usage,
                    )
                    _add_tokens(prompt_delta, completion_delta, model.name)
                    _broadcast_tokens()
            return

        except _RETRYABLE_ERRORS as e:
            err = _classify_exception(e)
            _log.warning(
                "LLM retryable error model=%s kind=%s: %s",
                model.name, type(err).__name__, err,
            )
            last_error = err
            continue
        except Exception as e:
            err = _classify_exception(e)
            _log.error(
                "LLM fatal error model=%s kind=%s: %s",
                model.name, type(err).__name__, err, exc_info=True,
            )
            yield ("text", f"\n\n[{err.user_msg}]")
            return

    if last_error is None:
        _log.error("All models exhausted with unknown reason")
        yield ("text", "\n\n[所有模型均不可用，请稍后重试。]")
    else:
        _log.error(
            "All models exhausted kind=%s: %s",
            type(last_error).__name__, last_error,
        )
        yield ("text", f"\n\n[{last_error.user_msg}]")


def chat_stream_single_model(
    model_cfg,
    messages: list[dict],
    system_prompt: Optional[str] = None,
    abort_check: Optional[Callable[[], bool]] = None,
    override_think_mode: Optional[bool] = None,
    usage_callback: Optional[Callable[[int, int, str], None]] = None,
    override_max_tokens: Optional[int] = None,
) -> Generator[tuple[str, str], None, None]:
    """仅使用指定模型流式输出，不做跨模型降级（供并行答题）。"""
    cfg = _config_with_think_override(get_config(), override_think_mode)
    if override_max_tokens is not None:
        cfg = _copy_config_with_updates(cfg, {"max_tokens": max(1, int(override_max_tokens))})
    clean_messages = _sanitize_messages(messages, model_cfg.supports_vision)
    full_messages: list = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(clean_messages)
    model_name = model_cfg.name
    try:
        emit_think = _should_emit_think(model_cfg, cfg)
        response = _try_stream_with_model(model_cfg, full_messages, cfg)
        last_usage = (0, 0)
        for chunk in response:
            if abort_check and abort_check():
                return
            if chunk.choices:
                delta = chunk.choices[0].delta
                reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
                if reasoning and emit_think:
                    yield ("think", reasoning)
                if delta.content:
                    yield ("text", delta.content)
            if hasattr(chunk, "usage") and chunk.usage:
                prompt_tokens, completion_tokens, last_usage = _usage_delta(
                    chunk.usage.prompt_tokens or 0,
                    chunk.usage.completion_tokens or 0,
                    last_usage,
                )
                _add_tokens(prompt_tokens, completion_tokens, model_name)
                if usage_callback:
                    usage_callback(prompt_tokens, completion_tokens, model_name)
                _broadcast_tokens()
    except Exception as e:
        err = _classify_exception(e)
        _log.error(
            "LLM single-model error model=%s kind=%s: %s",
            model_name, type(err).__name__, _compact_error_detail(err),
        )
        # Keep transport failures out of the answer text. The answer worker
        # needs a terminal error state so a failed request is not persisted or
        # presented as a successful answer card.
        if err is e:
            raise
        raise err from None
