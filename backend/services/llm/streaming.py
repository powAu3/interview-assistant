"""LLM client management, token tracking, and streaming generation."""

import threading
from openai import OpenAI
import openai
from typing import Callable, Generator, Optional
from core.config import get_config


# ---------------------------------------------------------------------------
# Client helpers
# ---------------------------------------------------------------------------

def get_client() -> OpenAI:
    cfg = get_config()
    m = cfg.get_active_model()
    return OpenAI(api_key=m.api_key, base_url=m.api_base_url)


def get_client_for_model(model_cfg) -> OpenAI:
    return OpenAI(api_key=model_cfg.api_key, base_url=model_cfg.api_base_url)


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


def vision_extract_text(image_base64_list: list[str]) -> str:
    cfg = get_config()
    model = None
    for m in cfg.models:
        if m.supports_vision and m.api_key and m.api_key not in ("", "sk-your-api-key-here"):
            model = m
            break
    if not model:
        raise ValueError(
            "上传 PDF 简历需要先配置支持识图的模型。请在「设置」中选择并保存一个带「识图」的模型及 API Key 后再试；"
            "或改为上传 DOCX / TXT 格式的简历。"
        )
    parts = [{"type": "text", "text": RESUME_VISION_PROMPT}]
    for b64 in image_base64_list:
        if b64.startswith("data:"):
            url = b64
        else:
            url = f"data:image/png;base64,{b64}"
        parts.append({"type": "image_url", "image_url": {"url": url}})
    client = get_client_for_model(model)
    try:
        r = client.chat.completions.create(
            model=model.model,
            messages=[{"role": "user", "content": parts}],
            max_tokens=4096,
            temperature=0,
        )
        return (r.choices[0].message.content or "").strip()
    except Exception as e:
        raise ValueError(f"识图模型解析失败: {e}") from e


# ---------------------------------------------------------------------------
# Token tracking
# ---------------------------------------------------------------------------

_RETRYABLE_ERRORS = (
    openai.RateLimitError,
    openai.APIConnectionError,
    openai.APITimeoutError,
    openai.InternalServerError,
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


def _build_think_params(model_cfg, cfg) -> dict:
    if not model_cfg.supports_think:
        return {}
    think_type = "enabled" if cfg.think_mode else "disabled"
    return {
        "thinking": {"type": think_type},
        "think_mode": bool(cfg.think_mode),
    }


def _try_stream_with_model(model_cfg, full_messages, cfg):
    client = get_client_for_model(model_cfg)
    extra_kwargs: dict = {}
    think_params = _build_think_params(model_cfg, cfg)
    if think_params:
        extra_kwargs["extra_body"] = think_params
    extra_kwargs["stream_options"] = {"include_usage": True}
    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=full_messages,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        stream=True,
        **extra_kwargs,
    )
    return response


def chat_stream(
    messages: list[dict],
    system_prompt: Optional[str] = None,
    abort_check: Optional[Callable[[], bool]] = None,
) -> Generator[tuple[str, str], None, None]:
    """Yields (chunk_type, text) tuples. chunk_type is 'think' or 'text'."""
    from api.realtime.ws import broadcast

    cfg = get_config()
    active_model = cfg.get_active_model()
    clean_messages = _sanitize_messages(messages, active_model.supports_vision)
    full_messages = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(clean_messages)
    models_to_try = [active_model]
    for i, m in enumerate(cfg.models):
        if i != cfg.active_model and m.api_key and m.api_key not in ("", "sk-your-api-key-here"):
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
            for chunk in response:
                if abort_check and abort_check():
                    return
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
                    if reasoning:
                        yield ("think", reasoning)
                    if delta.content:
                        yield ("text", delta.content)
                if hasattr(chunk, "usage") and chunk.usage:
                    _add_tokens(
                        chunk.usage.prompt_tokens or 0,
                        chunk.usage.completion_tokens or 0,
                        model.name,
                    )
                    _broadcast_tokens()
            return

        except _RETRYABLE_ERRORS as e:
            last_error = e
            continue
        except Exception as e:
            yield ("text", f"\n\n[LLM 错误: {str(e)}]")
            return

    yield ("text", f"\n\n[所有模型均不可用: {str(last_error)}]")


def chat_stream_single_model(
    model_cfg,
    messages: list[dict],
    system_prompt: Optional[str] = None,
    abort_check: Optional[Callable[[], bool]] = None,
) -> Generator[tuple[str, str], None, None]:
    """仅使用指定模型流式输出，不做跨模型降级（供并行答题）。"""
    cfg = get_config()
    clean_messages = _sanitize_messages(messages, model_cfg.supports_vision)
    full_messages: list = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(clean_messages)
    model_name = model_cfg.name
    try:
        response = _try_stream_with_model(model_cfg, full_messages, cfg)
        for chunk in response:
            if abort_check and abort_check():
                return
            if chunk.choices:
                delta = chunk.choices[0].delta
                reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
                if reasoning:
                    yield ("think", reasoning)
                if delta.content:
                    yield ("text", delta.content)
            if hasattr(chunk, "usage") and chunk.usage:
                _add_tokens(
                    chunk.usage.prompt_tokens or 0,
                    chunk.usage.completion_tokens or 0,
                    model_name,
                )
                _broadcast_tokens()
    except Exception as e:
        yield ("text", f"\n\n[LLM 错误: {str(e)}]")
