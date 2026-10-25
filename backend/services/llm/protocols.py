"""LLM API protocol layer: chat completions / anthropic messages / responses.

模型配置里的 ``api_type`` 决定走哪种协议：

- ``openai``     – OpenAI 兼容 Chat Completions（POST {base}/chat/completions）
- ``anthropic``  – Anthropic Messages（POST {base}/v1/messages，x-api-key 鉴权）
- ``responses``  – OpenAI Responses（POST {base}/responses）

Base URL 的处理参考 cc-switch 的宽松策略：带不带 /v1、结尾多斜杠都能用——
SDK 路径会先规范化，裸 HTTP 路径按候选列表依次探测（404 自动换下一个）。
"""

import json
import re
from types import SimpleNamespace
from typing import Any, Generator, Optional

import requests

from core.logger import get_logger

_log = get_logger("llm.protocols")

# 连接复用：答题/探测每次都建新连接会重复付 TLS 握手成本，池化后远程
# 调用显著提速（对每题都请求 LLM 的实时链路收益最大）。
_http = requests.Session()
# 默认 urllib3 池 10/host；并行答题（最多 8 路）+ 健康探测会逼近上限，
# 超限时 urllib3 丢弃连接重建，白付握手成本——抬高到 32。
_adapter = requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=32)
_http.mount("https://", _adapter)
_http.mount("http://", _adapter)

API_TYPE_OPENAI = "openai"
API_TYPE_ANTHROPIC = "anthropic"
API_TYPE_RESPONSES = "responses"
API_TYPE_OPTIONS = (API_TYPE_OPENAI, API_TYPE_ANTHROPIC, API_TYPE_RESPONSES)

ANTHROPIC_VERSION = "2023-06-01"

# 形如 /v1 /v2 /v3 /v1beta 的末尾版本段
_VERSION_SEGMENT_RE = re.compile(r"/v\d+[a-z]*$", re.IGNORECASE)

# Anthropic Messages SSE 中需要关心的 event 类型
_ANTHROPIC_TEXT_DELTA = "text_delta"
_ANTHROPIC_THINKING_DELTA = "thinking_delta"


def get_api_type(model_cfg) -> str:
    value = str(getattr(model_cfg, "api_type", "") or "").strip().lower()
    return value if value in API_TYPE_OPTIONS else API_TYPE_OPENAI


# ---------------------------------------------------------------------------
# Base URL normalization & endpoint candidates
# ---------------------------------------------------------------------------

def normalize_api_base_url(url: str, api_type: str = API_TYPE_OPENAI) -> str:
    """Normalize a user-provided base URL so both ``host`` and ``host/v1`` work."""
    base = (url or "").strip().rstrip("/")
    if not base:
        return base
    if api_type == API_TYPE_ANTHROPIC:
        # 我们自己拼 /v1/messages，去掉用户多写的 /v1 避免 /v1/v1
        if base.lower().endswith("/v1"):
            base = base[: -len("/v1")]
        return base
    # openai / responses：SDK 会在 base 后直接拼 endpoint，
    # 没有版本段时补 /v1（用户填 https://api.deepseek.com 也能用）
    if not _VERSION_SEGMENT_RE.search(base):
        base = f"{base}/v1"
    return base


def chat_url_candidates(api_base_url: str, api_type: str = API_TYPE_OPENAI) -> list[str]:
    """Ordered endpoint candidates; raw HTTP paths try them on 404/405."""
    base = (api_base_url or "").strip().rstrip("/")
    if not base:
        return []
    if api_type == API_TYPE_ANTHROPIC:
        if base.lower().endswith("/v1"):
            return [f"{base}/messages"]
        return [f"{base}/v1/messages", f"{base}/messages"]
    endpoint = "/chat/completions" if api_type == API_TYPE_OPENAI else "/responses"
    if _VERSION_SEGMENT_RE.search(base):
        return [f"{base}{endpoint}"]
    return [f"{base}/v1{endpoint}", f"{base}{endpoint}"]


def build_llm_headers(api_type: str, api_key: str, *, bearer: bool = False) -> dict[str, str]:
    from services.llm.streaming import _openai_compat_headers

    headers = {**_openai_compat_headers(), "Content-Type": "application/json"}
    if api_type == API_TYPE_ANTHROPIC and not bearer:
        # 官方首选 x-api-key；部分网关只认 Bearer——由调用方在 401 时用
        # bearer=True 变体重试（双头同发会被严格网关直接 401）。
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = ANTHROPIC_VERSION
    else:
        headers["Authorization"] = f"Bearer {api_key}"
        if api_type == API_TYPE_ANTHROPIC:
            headers["anthropic-version"] = ANTHROPIC_VERSION
    return headers


# ---------------------------------------------------------------------------
# Message conversion (OpenAI shape -> target protocol)
# ---------------------------------------------------------------------------

def _parse_data_url(url: str) -> Optional[tuple[str, str]]:
    if not isinstance(url, str) or not url.startswith("data:"):
        return None
    header, _, data = url.partition(",")
    media_type = header[5:].split(";", 1)[0] or "image/png"
    return media_type, data


def convert_messages(messages: list[dict], api_type: str) -> tuple[Optional[str], list[dict]]:
    """Split the system prompt out and convert image parts.

    Returns ``(system_text, messages)``；messages 只含 user/assistant。
    """
    system_parts: list[str] = []
    converted: list[dict] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "user")
        content = msg.get("content")
        if role == "system":
            if isinstance(content, str):
                system_parts.append(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        system_parts.append(str(part.get("text") or ""))
            continue
        if role not in ("user", "assistant"):
            role = "user"
        if isinstance(content, list):
            if role == "assistant":
                text = "\n".join(
                    str(p.get("text") or "")
                    for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                )
                if text.strip():
                    converted.append({"role": role, "content": text})
                continue
            parts: list[dict] = []
            for p in content:
                if not isinstance(p, dict):
                    continue
                if p.get("type") == "text":
                    parts.append({"type": "text", "text": str(p.get("text") or "")})
                elif p.get("type") == "image_url":
                    image_ref = p.get("image_url")
                    image_url = image_ref.get("url") if isinstance(image_ref, dict) else image_ref
                    if not image_url:
                        continue
                    if api_type == API_TYPE_ANTHROPIC:
                        parsed = _parse_data_url(image_url)
                        if parsed:
                            parts.append({
                                "type": "image",
                                "source": {"type": "base64", "media_type": parsed[0], "data": parsed[1]},
                            })
                        else:
                            parts.append({"type": "image", "source": {"type": "url", "url": image_url}})
                    else:  # responses
                        parts.append({"type": "input_image", "image_url": image_url})
            if parts:
                converted.append({"role": role, "content": parts})
        else:
            text = content if isinstance(content, str) else ""
            converted.append({"role": role, "content": text})
    return ("\n".join(system_parts) or None), converted


# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------

def build_chat_payload(
    api_type: str,
    model_id: str,
    messages: list[dict],
    *,
    temperature: float = 0.5,
    max_tokens: int = 4096,
    stream: bool = False,
    think_params: Optional[dict] = None,
    extra: Optional[dict] = None,
) -> dict:
    think_params = think_params or {}
    if api_type == API_TYPE_ANTHROPIC:
        system_text, msgs = convert_messages(messages, api_type)
        payload: dict[str, Any] = {
            "model": model_id,
            # anthropic max_tokens 必填；开启 thinking 时 temperature 必须为 1
            "max_tokens": max(1, int(max_tokens or 1)),
            "messages": msgs,
            "stream": stream,
        }
        if system_text:
            payload["system"] = system_text
        if "thinking" in think_params:
            payload["thinking"] = think_params["thinking"]
            payload["temperature"] = 1
        else:
            payload["temperature"] = temperature
    elif api_type == API_TYPE_RESPONSES:
        system_text, msgs = convert_messages(messages, api_type)
        payload = {
            "model": model_id,
            "input": msgs,
            "max_output_tokens": max(16, int(max_tokens or 16)),
            "stream": stream,
        }
        if system_text:
            payload["instructions"] = system_text
        if "reasoning" in think_params:
            payload["reasoning"] = think_params["reasoning"]
        if temperature is not None:
            payload["temperature"] = temperature
    else:  # openai chat completions（裸 HTTP 降级路径）
        payload = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature,
            **_openai_token_kwargs(max_tokens, think_params),
        }
        if stream:
            payload["stream"] = True
            payload["stream_options"] = {"include_usage": True}
        # 网关风格各异：think 参数整体平铺合并（thinking/think_mode/enable_thinking 等）
        payload.update(think_params)
    if extra:
        payload.update(extra)
    return payload


def _extract_usage(body: dict) -> Optional[SimpleNamespace]:
    usage = body.get("usage") if isinstance(body, dict) else None
    if not isinstance(usage, dict):
        return None
    prompt = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
    completion = usage.get("completion_tokens") or usage.get("output_tokens") or 0
    return SimpleNamespace(prompt_tokens=int(prompt or 0), completion_tokens=int(completion or 0))


def _openai_token_kwargs(max_tokens: int, think_params: dict) -> dict:
    if "reasoning_effort" in think_params:
        return {"max_completion_tokens": max(1, int(max_tokens or 1))}
    return {"max_tokens": max(1, int(max_tokens or 1))}


# ---------------------------------------------------------------------------
# Response text extraction (non-streaming bodies)
# ---------------------------------------------------------------------------

def extract_reply_text(body: object, api_type: str) -> tuple[str, str]:
    """Return ``(text, reasoning)`` from a non-streaming response body."""
    if not isinstance(body, dict):
        return "", ""
    if api_type == API_TYPE_ANTHROPIC:
        texts, thinkings = [], []
        for block in body.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                texts.append(str(block.get("text") or ""))
            elif block.get("type") == "thinking":
                thinkings.append(str(block.get("thinking") or ""))
        return "".join(texts).strip(), "".join(thinkings).strip()
    if api_type == API_TYPE_RESPONSES:
        texts, thinkings = [], []
        for item in body.get("output") or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "reasoning":
                for part in item.get("summary") or []:
                    if isinstance(part, dict) and part.get("text"):
                        thinkings.append(str(part["text"]))
                continue
            for part in item.get("content") or []:
                if isinstance(part, dict) and part.get("type") == "output_text":
                    texts.append(str(part.get("text") or ""))
        return "".join(texts).strip(), "".join(thinkings).strip()
    # openai
    choices = body.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return "", ""
    message = choices[0].get("message") if isinstance(choices[0].get("message"), dict) else {}
    content = message.get("content", "")
    if isinstance(content, list):
        content = "".join(
            str(p.get("text") or "")
            for p in content
            if isinstance(p, dict) and p.get("type") == "text"
        )
    reasoning = message.get("reasoning_content") or message.get("reasoning") or ""
    return (str(content or "")).strip(), str(reasoning or "").strip()


# ---------------------------------------------------------------------------
# Raw HTTP: status mapping + SSE streaming
# ---------------------------------------------------------------------------

def raise_for_llm_status(status_code: int, body_text: str) -> None:
    """Map an HTTP >=400 response to the typed LLM error taxonomy."""
    from services.llm.streaming import (
        LLMAuthError,
        LLMContextExceeded,
        LLMError,
        LLMRateLimit,
        LLMServerError,
    )

    text = str(body_text)[:200]
    if status_code in (401, 403):
        raise LLMAuthError(f"HTTP {status_code}: {text}")
    if status_code == 429:
        raise LLMRateLimit(f"HTTP {status_code}: {text}")
    if status_code == 400 and ("context" in text.lower() or "token" in text.lower()):
        raise LLMContextExceeded(f"HTTP {status_code}: {text}")
    if 500 <= status_code < 600:
        raise LLMServerError(f"HTTP {status_code}: {text}")
    raise LLMError(f"HTTP {status_code}: {text}")


def _iter_sse_lines(resp: requests.Response) -> Generator[str, None, None]:
    for raw_line in resp.iter_lines(decode_unicode=False):
        if not raw_line:
            continue
        line = raw_line.decode("utf-8", errors="replace")
        if line:
            yield line


def _openai_chunk(obj: dict) -> SimpleNamespace:
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
    usage_obj = (
        SimpleNamespace(
            prompt_tokens=usage.get("prompt_tokens") or 0,
            completion_tokens=usage.get("completion_tokens") or 0,
        )
        if usage
        else None
    )
    return SimpleNamespace(choices=chunk_choices, usage=usage_obj)


def _anthropic_chunk(obj: dict) -> SimpleNamespace:
    event_type = obj.get("type")
    content = None
    reasoning = None
    usage_obj = None
    if event_type == "error":
        err = obj.get("error") or {}
        from services.llm.streaming import LLMError

        raise LLMError(f"anthropic stream error: {str(err.get('message') or obj)[:200]}")
    if event_type == "content_block_delta":
        delta = obj.get("delta") or {}
        if delta.get("type") == _ANTHROPIC_TEXT_DELTA:
            content = delta.get("text")
        elif delta.get("type") == _ANTHROPIC_THINKING_DELTA:
            reasoning = delta.get("thinking")
    elif event_type == "message_start":
        message = obj.get("message") or {}
        usage = message.get("usage") or {}
        usage_obj = SimpleNamespace(
            prompt_tokens=usage.get("input_tokens") or 0,
            completion_tokens=usage.get("output_tokens") or 0,
        )
    elif event_type == "message_delta":
        usage = obj.get("usage") or {}
        # output_tokens 是累计值，_usage_delta 会处理
        usage_obj = SimpleNamespace(
            prompt_tokens=usage.get("input_tokens") or 0,
            completion_tokens=usage.get("output_tokens") or 0,
        )
    if content is None and reasoning is None and usage_obj is None:
        return SimpleNamespace(choices=[], usage=None)
    delta = SimpleNamespace(content=content, reasoning_content=reasoning, reasoning=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)], usage=usage_obj)


def _responses_chunk(obj: dict) -> SimpleNamespace:
    event_type = obj.get("type") or ""
    content = None
    reasoning = None
    usage_obj = None
    if event_type == "response.output_text.delta":
        content = obj.get("delta")
    elif event_type in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
        reasoning = obj.get("delta")
    elif event_type in ("response.completed", "response.incomplete"):
        response = obj.get("response") or {}
        usage = response.get("usage") or {}
        usage_obj = SimpleNamespace(
            prompt_tokens=usage.get("input_tokens") or 0,
            completion_tokens=usage.get("output_tokens") or 0,
        )
    elif event_type == "response.failed":
        response = obj.get("response") or {}
        err = response.get("error") or {}
        from services.llm.streaming import LLMError

        raise LLMError(f"responses failed: {str(err.get('message') or err)[:200]}")
    if content is None and reasoning is None and usage_obj is None:
        return SimpleNamespace(choices=[], usage=None)
    delta = SimpleNamespace(content=content, reasoning_content=reasoning, reasoning=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)], usage=usage_obj)


_CHUNK_PARSERS = {
    API_TYPE_OPENAI: _openai_chunk,
    API_TYPE_ANTHROPIC: _anthropic_chunk,
    API_TYPE_RESPONSES: _responses_chunk,
}


def post_chat_stream(
    api_base_url: str,
    api_type: str,
    api_key: str,
    payload: dict,
    *,
    timeout: tuple[float, float] = (10, 90),
) -> Generator[SimpleNamespace, None, None]:
    """POST a streaming chat request, trying URL candidates on 404/405."""
    candidates = chat_url_candidates(api_base_url, api_type)
    if not candidates:
        from services.llm.streaming import LLMError

        raise LLMError("API Base URL 不能为空")
    # anthropic：x-api-key 优先，401/403 时同 URL 换 Bearer 变体重试
    header_variants = [build_llm_headers(api_type, api_key)]
    if api_type == API_TYPE_ANTHROPIC:
        header_variants.append(build_llm_headers(api_type, api_key, bearer=True))
    parser = _CHUNK_PARSERS.get(api_type, _openai_chunk)
    last_not_found = ""
    for url in candidates:
        for headers in header_variants:
            with _http.post(url, headers=headers, json=payload, stream=True, timeout=timeout) as resp:
                if resp.status_code in (401, 403) and headers is not header_variants[-1]:
                    continue
                if resp.status_code in (404, 405):
                    last_not_found = f"HTTP {resp.status_code}: {resp.text[:200]}"
                    break
                if resp.status_code >= 400:
                    try:
                        body = resp.json()
                    except Exception:
                        body = resp.text
                    raise_for_llm_status(resp.status_code, str(body))
                for line in _iter_sse_lines(resp):
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        if data == "[DONE]":
                            break
                        continue
                    try:
                        obj = json.loads(data)
                    except Exception:
                        continue
                    chunk = parser(obj)
                    if chunk.choices or chunk.usage:
                        yield chunk
                    if api_type == API_TYPE_ANTHROPIC and obj.get("type") == "message_stop":
                        break
                    if api_type == API_TYPE_RESPONSES and obj.get("type") == "response.completed":
                        break
                return
    from services.llm.streaming import LLMError

    raise LLMError(last_not_found or "未找到可用的对话接口地址")


def post_chat_blocking(
    api_base_url: str,
    api_type: str,
    api_key: str,
    payload: dict,
    *,
    timeout: tuple[float, float] = (10, 120),
) -> SimpleNamespace:
    """POST a non-streaming request and normalize to the OpenAI response shape."""
    candidates = chat_url_candidates(api_base_url, api_type)
    if not candidates:
        from services.llm.streaming import LLMError

        raise LLMError("API Base URL 不能为空")
    header_variants = [build_llm_headers(api_type, api_key)]
    if api_type == API_TYPE_ANTHROPIC:
        header_variants.append(build_llm_headers(api_type, api_key, bearer=True))
    last_not_found = ""
    for url in candidates:
        for headers in header_variants:
            response = _http.post(url, headers=headers, json=payload, timeout=timeout)
            if response.status_code in (401, 403) and headers is not header_variants[-1]:
                continue
            if response.status_code in (404, 405):
                last_not_found = f"HTTP {response.status_code}: {response.text[:200]}"
                break
            if response.status_code >= 400:
                try:
                    body = response.json()
                except Exception:
                    body = response.text
                raise_for_llm_status(response.status_code, str(body))
            try:
                data = response.json()
            except Exception:
                from services.llm.streaming import LLMProtocolError

                raise LLMProtocolError(f"响应不是 JSON: {response.text[:200]}")
            text, reasoning = extract_reply_text(data, api_type)
            message = SimpleNamespace(content=text, reasoning_content=reasoning or None)
            usage_obj = _extract_usage(data)
            return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage_obj)
    from services.llm.streaming import LLMError

    raise LLMError(last_not_found or "未找到可用的对话接口地址")
