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
        assert r == {}

    def test_think_mode_false_wins_even_when_effort_is_high(self):
        r = _build_think_params(_m("glm-5.1"), S(think_mode=False, think_effort="high"))
        assert r == _THINK_DISABLED_BASE_PARAMS

    def test_off_local_runtime_includes_chat_template_disable(self):
        model = _m("glm-5.1")
        model.api_base_url = "http://127.0.0.1:30000/v1"
        r = _build_think_params(model, _c("off"))
        assert r == _THINK_DISABLED_LOCAL_PARAMS

    @pytest.mark.parametrize("effort", ["low", "medium", "high"])
    def test_gpt_effort(self, effort):
        r = _build_think_params(_m("o3-mini"), _c(effort))
        assert r == {"reasoning_effort": effort}

    @pytest.mark.parametrize("effort", ["low", "medium", "high"])
    def test_claude_budget(self, effort):
        r = _build_think_params(_m("claude-3"), _c(effort))
        assert r["thinking"]["type"] == "enabled"
        assert r["thinking"]["budget_tokens"] == min(_EFFORT_BUDGET[effort], 3072)
        assert r["think_mode"] is True

    @pytest.mark.parametrize("effort", ["low", "medium", "high"])
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
