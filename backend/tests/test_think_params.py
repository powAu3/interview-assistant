import pytest
from pathlib import Path
import sys
from types import SimpleNamespace as S

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import services.llm.streaming as streaming
from services.llm.streaming import (
    _detect_think_style,
    _build_think_params,
    _EFFORT_BUDGET,
    _completion_token_kwargs,
    _usage_delta,
    _THINK_DISABLED_BASE_PARAMS,
    _THINK_DISABLED_LOCAL_PARAMS,
    _compact_error_detail,
    _classify_exception,
    LLMTimeout,
)


def _m(model="deepseek-r1", supports_think=True):
    return S(model=model, supports_think=supports_think, api_base_url="https://example.com/v1")


def _c(think_effort="high"):
    return S(think_mode=think_effort != "off", think_effort=think_effort)


class TestDetectThinkStyle:
    def test_gpt_o1(self):
        assert _detect_think_style(_m("o1-preview")) == "gpt"

    def test_gpt_o3(self):
        assert _detect_think_style(_m("o3-mini")) == "gpt"

    def test_gpt_o4(self):
        assert _detect_think_style(_m("o4-mini")) == "gpt"

    def test_gpt_5(self):
        assert _detect_think_style(_m("gpt-5.1")) == "gpt"

    def test_claude(self):
        assert _detect_think_style(_m("claude-3.5-sonnet")) == "claude"

    def test_sonnet(self):
        assert _detect_think_style(_m("sonnet-4")) == "claude"

    def test_haiku(self):
        assert _detect_think_style(_m("haiku-3")) == "claude"

    def test_opus(self):
        assert _detect_think_style(_m("opus-4")) == "claude"

    def test_generic_deepseek(self):
        assert _detect_think_style(_m("deepseek-chat")) == "generic"

    def test_generic_gpt4o(self):
        assert _detect_think_style(_m("gpt-4o-mini")) == "generic"

    def test_empty_model(self):
        assert _detect_think_style(_m("")) == "generic"

    def test_none_model(self):
        assert _detect_think_style(_m(None)) == "generic"


class TestBuildThinkParams:
    def test_no_think_support(self):
        assert _build_think_params(_m(supports_think=False), _c()) == {}

    def test_off_gpt(self):
        r = _build_think_params(_m("o1"), _c("off"))
        assert r == {}

    def test_off_claude(self):
        r = _build_think_params(_m("claude-3"), _c("off"))
        assert r == {}

    def test_off_generic(self):
        r = _build_think_params(_m("deepseek-r1"), _c("off"))
        assert r == _THINK_DISABLED_BASE_PARAMS

    def test_think_mode_false_wins_even_when_effort_is_high(self):
        r = _build_think_params(_m("glm-5.1"), S(think_mode=False, think_effort="high"))
        assert r == _THINK_DISABLED_BASE_PARAMS

    def test_doubao_receives_disable_params_when_off(self):
        model = _m("Doubao-Seed-2.0-pro")
        model.api_base_url = "https://ark.cn-beijing.volces.com/api/v3"
        r = _build_think_params(model, _c("off"))
        assert r == _THINK_DISABLED_BASE_PARAMS

    @pytest.mark.parametrize("effort", ["low", "high"])
    def test_doubao_keeps_enabled_thinking_params_empty_by_default(self, effort):
        model = _m("Doubao-Seed-2.0-pro")
        model.api_base_url = "https://ark.cn-beijing.volces.com/api/v3"
        r = _build_think_params(model, _c(effort))
        assert r == {}

    def test_saved_disabled_params_win_even_without_think_support(self):
        model = _m("auto-reasoner", supports_think=False)
        model.think_disabled_params = {"thinking": {"type": "disabled"}}
        r = _build_think_params(model, _c("off"))
        assert r == {"thinking": {"type": "disabled"}}

    def test_saved_enabled_params_win_over_detected_non_gpt_style(self):
        model = _m("deepseek-r1", supports_think=True)
        model.think_enabled_params = {"thinking": {"type": "enabled", "budget_tokens": 2048}}
        r = _build_think_params(model, _c("high"))
        assert r == {"thinking": {"type": "enabled", "budget_tokens": 2048}}

    def test_gpt_saved_enabled_params_keep_current_effort(self):
        model = _m("o3-mini", supports_think=True)
        model.think_enabled_params = {"reasoning_effort": "low"}
        r = _build_think_params(model, _c("xhigh"))
        assert r == {"reasoning_effort": "xhigh"}

    def test_off_local_runtime_includes_chat_template_disable(self):
        model = _m("glm-5.1")
        model.api_base_url = "http://127.0.0.1:30000/v1"
        r = _build_think_params(model, _c("off"))
        assert r == _THINK_DISABLED_LOCAL_PARAMS

    @pytest.mark.parametrize("effort", ["low", "medium", "high", "xhigh"])
    def test_gpt_effort(self, effort):
        r = _build_think_params(_m("o3-mini"), _c(effort))
        assert r == {"reasoning_effort": effort}

    @pytest.mark.parametrize("effort", ["low", "medium", "high", "xhigh"])
    def test_claude_budget(self, effort):
        r = _build_think_params(_m("claude-3"), _c(effort))
        assert r["thinking"]["type"] == "enabled"
        assert r["thinking"]["budget_tokens"] == min(_EFFORT_BUDGET[effort], 3072)
        assert r["think_mode"] is True

    @pytest.mark.parametrize("effort", ["low", "medium", "high", "xhigh"])
    def test_generic_enabled(self, effort):
        r = _build_think_params(_m("deepseek-r1"), _c(effort))
        assert r == {"thinking": {"type": "enabled"}, "think_mode": True}


def test_o_series_uses_max_completion_tokens():
    assert _completion_token_kwargs(_m("o3-mini"), 16) == {"max_completion_tokens": 16}


def test_gpt_5_uses_max_completion_tokens():
    assert _completion_token_kwargs(_m("gpt-5.1"), 16) == {"max_completion_tokens": 16}


def test_generic_uses_max_tokens():
    assert _completion_token_kwargs(_m("deepseek-chat"), 16) == {"max_tokens": 16}


def test_usage_delta_handles_cumulative_stream_usage():
    first_prompt, first_completion, previous = _usage_delta(100, 3, (0, 0))
    second_prompt, second_completion, previous = _usage_delta(100, 5, previous)
    third_prompt, third_completion, _previous = _usage_delta(100, 5, previous)

    assert (first_prompt, first_completion) == (100, 3)
    assert (second_prompt, second_completion) == (0, 2)
    assert (third_prompt, third_completion) == (0, 0)


def test_single_model_suppresses_reasoning_when_think_mode_is_false(monkeypatch):
    monkeypatch.setattr(streaming, "get_config", lambda: S(
        think_mode=False,
        think_effort="high",
    ))
    monkeypatch.setattr(streaming, "_broadcast_tokens", lambda: None)

    def fake_stream(_model_cfg, _messages, _cfg):
        yield S(
            choices=[S(delta=S(reasoning_content="不应显示的思考", reasoning=None, content=None))],
            usage=None,
        )
        yield S(
            choices=[S(delta=S(reasoning_content=None, reasoning=None, content="最终答案"))],
            usage=None,
        )

    monkeypatch.setattr(streaming, "_try_stream_with_model", fake_stream)

    chunks = list(streaming.chat_stream_single_model(
        S(name="GLM", model="glm-5.1", supports_think=True, supports_vision=False),
        [{"role": "user", "content": "题目"}],
    ))

    assert chunks == [("text", "最终答案")]


def test_single_model_override_true_promotes_off_effort(monkeypatch):
    captured = {}
    monkeypatch.setattr(streaming, "get_config", lambda: S(
        think_mode=False,
        think_effort="off",
    ))
    monkeypatch.setattr(streaming, "_broadcast_tokens", lambda: None)

    def fake_stream(_model_cfg, _messages, cfg):
        captured["think_mode"] = cfg.think_mode
        captured["think_effort"] = cfg.think_effort
        yield S(
            choices=[S(delta=S(reasoning_content="已开启的思考", reasoning=None, content=None))],
            usage=None,
        )
        yield S(
            choices=[S(delta=S(reasoning_content=None, reasoning=None, content="最终答案"))],
            usage=None,
        )

    monkeypatch.setattr(streaming, "_try_stream_with_model", fake_stream)

    chunks = list(streaming.chat_stream_single_model(
        S(name="GLM", model="glm-5.1", supports_think=True, supports_vision=False),
        [{"role": "user", "content": "题目"}],
        override_think_mode=True,
    ))

    assert captured == {"think_mode": True, "think_effort": "xhigh"}
    assert chunks == [("think", "已开启的思考"), ("text", "最终答案")]


def test_single_model_override_false_forces_off_effort(monkeypatch):
    captured = {}
    monkeypatch.setattr(streaming, "get_config", lambda: S(
        think_mode=True,
        think_effort="high",
    ))
    monkeypatch.setattr(streaming, "_broadcast_tokens", lambda: None)

    def fake_stream(_model_cfg, _messages, cfg):
        captured["think_mode"] = cfg.think_mode
        captured["think_effort"] = cfg.think_effort
        yield S(
            choices=[S(delta=S(reasoning_content="不应显示的思考", reasoning=None, content=None))],
            usage=None,
        )
        yield S(
            choices=[S(delta=S(reasoning_content=None, reasoning=None, content="最终答案"))],
            usage=None,
        )

    monkeypatch.setattr(streaming, "_try_stream_with_model", fake_stream)

    chunks = list(streaming.chat_stream_single_model(
        S(name="GLM", model="glm-5.1", supports_think=True, supports_vision=False),
        [{"role": "user", "content": "题目"}],
        override_think_mode=False,
    ))

    assert captured == {"think_mode": False, "think_effort": "off"}
    assert chunks == [("text", "最终答案")]


def test_single_model_raises_typed_error_instead_of_emitting_error_as_answer(monkeypatch):
    monkeypatch.setattr(streaming, "get_config", lambda: S(
        think_mode=False,
        think_effort="off",
    ))

    def failing_stream(_model_cfg, _messages, _cfg):
        raise LLMTimeout("provider timeout")
        yield  # keep this a generator for the same protocol as the real stream

    monkeypatch.setattr(streaming, "_try_stream_with_model", failing_stream)

    with pytest.raises(LLMTimeout):
        list(streaming.chat_stream_single_model(
            S(name="GLM", model="glm-5.1", supports_think=True, supports_vision=False),
            [{"role": "user", "content": "题目"}],
        ))


def test_chat_stream_override_true_promotes_off_effort(monkeypatch):
    active_model = S(
        name="GLM",
        model="glm-5.1",
        supports_think=True,
        supports_vision=False,
    )
    captured = {}
    monkeypatch.setattr(streaming, "get_config", lambda: S(
        think_mode=False,
        think_effort="off",
        active_model=0,
        models=[active_model],
        get_active_model=lambda: active_model,
    ))
    monkeypatch.setattr(streaming, "_broadcast_tokens", lambda: None)

    def fake_stream(_model_cfg, _messages, cfg):
        captured["think_mode"] = cfg.think_mode
        captured["think_effort"] = cfg.think_effort
        yield S(
            choices=[S(delta=S(reasoning_content="通用路径思考", reasoning=None, content=None))],
            usage=None,
        )
        yield S(
            choices=[S(delta=S(reasoning_content=None, reasoning=None, content="最终答案"))],
            usage=None,
        )

    monkeypatch.setattr(streaming, "_try_stream_with_model", fake_stream)

    chunks = list(streaming.chat_stream(
        [{"role": "user", "content": "题目"}],
        override_think_mode=True,
    ))

    assert captured == {"think_mode": True, "think_effort": "xhigh"}
    assert chunks == [("think", "通用路径思考"), ("text", "最终答案")]


def test_chat_stream_override_false_forces_off_effort(monkeypatch):
    active_model = S(
        name="GLM",
        model="glm-5.1",
        supports_think=True,
        supports_vision=False,
    )
    captured = {}
    monkeypatch.setattr(streaming, "get_config", lambda: S(
        think_mode=True,
        think_effort="high",
        active_model=0,
        models=[active_model],
        get_active_model=lambda: active_model,
    ))
    monkeypatch.setattr(streaming, "_broadcast_tokens", lambda: None)

    def fake_stream(_model_cfg, _messages, cfg):
        captured["think_mode"] = cfg.think_mode
        captured["think_effort"] = cfg.think_effort
        yield S(
            choices=[S(delta=S(reasoning_content="不应显示的思考", reasoning=None, content=None))],
            usage=None,
        )
        yield S(
            choices=[S(delta=S(reasoning_content=None, reasoning=None, content="最终答案"))],
            usage=None,
        )

    monkeypatch.setattr(streaming, "_try_stream_with_model", fake_stream)

    chunks = list(streaming.chat_stream(
        [{"role": "user", "content": "题目"}],
        override_think_mode=False,
    ))

    assert captured == {"think_mode": False, "think_effort": "off"}
    assert chunks == [("text", "最终答案")]


def test_closed_generic_reasoning_model_sends_disable_params_to_sdk(monkeypatch):
    captured = {}

    class _Completions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return iter(())

    client = S(chat=S(completions=_Completions()))
    model = S(name="DeepSeek", model="deepseek-reasoner", supports_think=False, supports_vision=False)
    cfg = S(think_mode=False, think_effort="off", max_tokens=16, temperature=0.2)

    monkeypatch.setattr(streaming, "get_client_for_model", lambda _model: client)

    list(streaming._try_stream_with_model(model, [{"role": "user", "content": "题目"}], cfg))

    assert captured["extra_body"] == _THINK_DISABLED_BASE_PARAMS


def test_http_fallback_merges_disable_params(monkeypatch):
    captured = {}

    class FakeStreamResponse:
        status_code = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def iter_lines(self, decode_unicode=False):
            yield b"data: [DONE]"

    def fake_post(_url, headers=None, json=None, stream=False, timeout=None):
        captured["json"] = json
        captured["stream"] = stream
        return FakeStreamResponse()

    monkeypatch.setattr(streaming.requests, "post", fake_post)
    model = S(api_base_url="https://example.test/v1", api_key="k", model="deepseek-reasoner")
    cfg = S(max_tokens=16, temperature=0.2)

    list(streaming._stream_via_http(model, [{"role": "user", "content": "题目"}], cfg, _THINK_DISABLED_BASE_PARAMS))

    assert captured["stream"] is True
    assert captured["json"]["thinking"] == {"type": "disabled"}
    assert captured["json"]["think_mode"] is False
    assert captured["json"]["enable_thinking"] is False


def test_provider_html_challenge_error_is_compacted_for_interview_logs():
    import requests

    error = requests.exceptions.RequestException(
        "<!doctype html><html>Just a moment...</html>" * 1000
    )

    detail = _compact_error_detail(error)
    classified = _classify_exception(error)

    assert detail == "provider returned an HTML challenge page"
    assert str(classified) == detail
    assert len(str(classified)) < 100
