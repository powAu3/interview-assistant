"""LLM 协议层单测：URL 规范化 / 消息转换 / payload 构建 / SSE 解析。"""

import json
from pathlib import Path
import sys
from unittest.mock import MagicMock, patch

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.llm import protocols
from services.llm.streaming import LLMError


class _Model:
    def __init__(self, api_type="openai", base="https://api.example.com"):
        self.name = "t"
        self.api_base_url = base
        self.api_key = "sk-test"
        self.model = "m-1"
        self.api_type = api_type


# ---------------------------------------------------------------------------
# URL normalization & candidates
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "url,api_type,expected",
    [
        ("https://api.openai.com/v1", "openai", "https://api.openai.com/v1"),
        ("https://api.openai.com/v1/", "openai", "https://api.openai.com/v1"),
        ("https://api.deepseek.com", "openai", "https://api.deepseek.com/v1"),
        ("https://ark.cn-beijing.volces.com/api/v3", "openai", "https://ark.cn-beijing.volces.com/api/v3"),
        ("https://api.anthropic.com", "anthropic", "https://api.anthropic.com"),
        ("https://api.anthropic.com/v1", "anthropic", "https://api.anthropic.com"),
        ("https://api.anthropic.com/v1/", "anthropic", "https://api.anthropic.com"),
        ("https://gateway/api/anthropic", "anthropic", "https://gateway/api/anthropic"),
        ("https://api.openai.com", "responses", "https://api.openai.com/v1"),
    ],
)
def test_normalize_api_base_url(url, api_type, expected):
    assert protocols.normalize_api_base_url(url, api_type) == expected


@pytest.mark.parametrize(
    "url,api_type,expected",
    [
        (
            "https://api.openai.com/v1",
            "openai",
            ["https://api.openai.com/v1/chat/completions"],
        ),
        (
            "https://api.deepseek.com",
            "openai",
            [
                "https://api.deepseek.com/v1/chat/completions",
                "https://api.deepseek.com/chat/completions",
            ],
        ),
        (
            "https://api.anthropic.com",
            "anthropic",
            ["https://api.anthropic.com/v1/messages", "https://api.anthropic.com/messages"],
        ),
        (
            "https://api.anthropic.com/v1",
            "anthropic",
            ["https://api.anthropic.com/v1/messages"],
        ),
        (
            "https://api.openai.com/v1",
            "responses",
            ["https://api.openai.com/v1/responses"],
        ),
        (
            "https://api.openai.com",
            "responses",
            ["https://api.openai.com/v1/responses", "https://api.openai.com/responses"],
        ),
    ],
)
def test_chat_url_candidates(url, api_type, expected):
    assert protocols.chat_url_candidates(url, api_type) == expected


def test_build_llm_headers_anthropic():
    # 默认只发 x-api-key（双头同发会被严格网关 401）；Bearer 由 401 重试路径按需使用
    headers = protocols.build_llm_headers("anthropic", "sk-ant")
    assert headers["x-api-key"] == "sk-ant"
    assert headers["anthropic-version"] == protocols.ANTHROPIC_VERSION
    assert "Authorization" not in headers

    bearer = protocols.build_llm_headers("anthropic", "sk-ant", bearer=True)
    assert bearer["Authorization"] == "Bearer sk-ant"
    assert bearer["anthropic-version"] == protocols.ANTHROPIC_VERSION
    assert "x-api-key" not in bearer


# ---------------------------------------------------------------------------
# Message conversion
# ---------------------------------------------------------------------------

def test_convert_messages_anthropic_extracts_system_and_images():
    messages = [
        {"role": "system", "content": "你是面试助手"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "看图"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,QUJD"}},
            ],
        },
    ]
    system_text, converted = protocols.convert_messages(messages, "anthropic")
    assert system_text == "你是面试助手"
    assert len(converted) == 1
    content = converted[0]["content"]
    assert content[0] == {"type": "text", "text": "看图"}
    assert content[1] == {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": "QUJD"},
    }


def test_convert_messages_responses_maps_image_parts():
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": [{"type": "image_url", "image_url": {"url": "https://x/1.png"}}]},
    ]
    system_text, converted = protocols.convert_messages(messages, "responses")
    assert system_text == "sys"
    assert converted[0]["content"] == [{"type": "input_image", "image_url": "https://x/1.png"}]


# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------

def test_build_chat_payload_anthropic_thinking_forces_temperature_1():
    payload = protocols.build_chat_payload(
        "anthropic",
        "m",
        [{"role": "user", "content": "hi"}],
        temperature=0.5,
        max_tokens=500,
        stream=True,
        think_params={"thinking": {"type": "enabled", "budget_tokens": 1024}},
    )
    assert payload["max_tokens"] == 500
    assert payload["stream"] is True
    assert payload["thinking"]["budget_tokens"] == 1024
    assert payload["temperature"] == 1
    assert "messages" in payload


def test_build_chat_payload_responses_uses_max_output_tokens():
    payload = protocols.build_chat_payload(
        "responses",
        "m",
        [{"role": "system", "content": "s"}, {"role": "user", "content": "hi"}],
        temperature=0.2,
        max_tokens=300,
        stream=False,
        think_params={"reasoning": {"effort": "low"}},
    )
    assert payload["max_output_tokens"] == 300
    assert payload["instructions"] == "s"
    assert payload["reasoning"] == {"effort": "low"}
    assert payload["input"] == [{"role": "user", "content": "hi"}]


# ---------------------------------------------------------------------------
# Reply extraction
# ---------------------------------------------------------------------------

def test_extract_reply_text_anthropic():
    body = {
        "content": [
            {"type": "thinking", "thinking": "让我想想"},
            {"type": "text", "text": "答案是 42"},
        ],
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }
    text, reasoning = protocols.extract_reply_text(body, "anthropic")
    assert text == "答案是 42"
    assert reasoning == "让我想想"


def test_extract_reply_text_responses():
    body = {
        "output": [
            {"type": "reasoning", "summary": [{"type": "summary_text", "text": "推理中"}]},
            {"type": "message", "content": [{"type": "output_text", "text": "OK"}]},
        ],
        "usage": {"input_tokens": 7, "output_tokens": 2},
    }
    text, reasoning = protocols.extract_reply_text(body, "responses")
    assert text == "OK"
    assert reasoning == "推理中"


# ---------------------------------------------------------------------------
# SSE parsers
# ---------------------------------------------------------------------------

def test_anthropic_chunk_parsing():
    chunk = protocols._anthropic_chunk({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "你好"}})
    assert chunk.choices[0].delta.content == "你好"
    chunk = protocols._anthropic_chunk({"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "思考"}})
    assert chunk.choices[0].delta.reasoning_content == "思考"
    chunk = protocols._anthropic_chunk({"type": "message_delta", "usage": {"output_tokens": 9}})
    assert chunk.usage.completion_tokens == 9
    empty = protocols._anthropic_chunk({"type": "content_block_start"})
    assert not empty.choices and empty.usage is None


def test_responses_chunk_parsing():
    chunk = protocols._responses_chunk({"type": "response.output_text.delta", "delta": "OK"})
    assert chunk.choices[0].delta.content == "OK"
    chunk = protocols._responses_chunk({
        "type": "response.completed",
        "response": {"usage": {"input_tokens": 3, "output_tokens": 4}},
    })
    assert chunk.usage.prompt_tokens == 3 and chunk.usage.completion_tokens == 4
    with pytest.raises(LLMError):
        protocols._responses_chunk({
            "type": "response.failed",
            "response": {"error": {"message": "boom"}},
        })


# ---------------------------------------------------------------------------
# Raw HTTP paths
# ---------------------------------------------------------------------------

def _fake_response(status_code=200, lines=None, json_body=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body if json_body is not None else {}
    resp.text = ""
    resp.iter_lines.return_value = [
        (line.encode("utf-8") if isinstance(line, str) else line) for line in (lines or [])
    ]
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def test_post_chat_stream_tries_url_candidates_on_404():
    responses = [
        _fake_response(status_code=404),
        _fake_response(lines=[
            "data: " + json.dumps({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "嗨"}}),
            "data: " + json.dumps({"type": "message_stop"}),
        ]),
    ]
    with patch.object(protocols, "_http") as mock_http:
        mock_http.post.side_effect = responses
        chunks = list(
            protocols.post_chat_stream(
                "https://gw.example.com", "anthropic", "sk-x",
                {"model": "m", "messages": [], "stream": True},
            )
        )
    assert mock_http.post.call_count == 2
    assert mock_http.post.call_args_list[0].args[0] == "https://gw.example.com/v1/messages"
    assert mock_http.post.call_args_list[1].args[0] == "https://gw.example.com/messages"
    assert any(c.choices and c.choices[0].delta.content == "嗨" for c in chunks)


def test_post_chat_stream_openai_done_marker():
    resp = _fake_response(lines=[
        "data: " + json.dumps({"choices": [{"delta": {"content": "A"}}]}),
        "data: [DONE]",
    ])
    with patch.object(protocols, "_http") as mock_http:
        mock_http.post.return_value = resp
        chunks = list(
            protocols.post_chat_stream(
                "https://api.example.com/v1", "openai", "sk-x",
                {"model": "m", "messages": [], "stream": True},
            )
        )
    assert chunks and chunks[0].choices[0].delta.content == "A"


def test_post_chat_blocking_maps_auth_error():
    resp = _fake_response(status_code=401)
    with patch.object(protocols, "_http") as mock_http:
        mock_http.post.return_value = resp
        with pytest.raises(Exception) as exc_info:
            protocols.post_chat_blocking(
                "https://api.example.com/v1", "openai", "sk-x", {"model": "m"}
            )
    assert "401" in str(exc_info.value)


def test_get_api_type_invalid_falls_back_to_openai():
    assert protocols.get_api_type(_Model(api_type="bogus")) == "openai"
    assert protocols.get_api_type(_Model(api_type="")) == "openai"
    assert protocols.get_api_type(_Model(api_type="anthropic")) == "anthropic"


def test_post_chat_stream_retries_bearer_variant_on_401():
    seen_headers = []
    responses = [
        _fake_response(status_code=401),
        _fake_response(lines=[
            "data: " + json.dumps({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "ok"}}),
            "data: " + json.dumps({"type": "message_stop"}),
        ]),
    ]

    def fake_post(url, headers=None, **_kwargs):
        seen_headers.append(headers)
        resp = responses[len(seen_headers) - 1]
        resp.__enter__ = lambda self=resp: self
        return resp

    with patch.object(protocols, "_http") as mock_http:
        mock_http.post.side_effect = fake_post
        chunks = list(
            protocols.post_chat_stream(
                "https://gw.example.com", "anthropic", "sk-ant",
                {"model": "m", "messages": [], "stream": True},
            )
        )
    assert len(seen_headers) == 2
    assert "x-api-key" in seen_headers[0] and "Authorization" not in seen_headers[0]
    assert "Authorization" in seen_headers[1] and "x-api-key" not in seen_headers[1]
    assert any(c.choices and c.choices[0].delta.content == "ok" for c in chunks)
