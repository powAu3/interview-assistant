import pytest
from types import SimpleNamespace as S

from services.llm.streaming import (
    _detect_think_style,
    _build_think_params,
    _EFFORT_BUDGET,
)


def _m(model="deepseek-r1", supports_think=True):
    return S(model=model, supports_think=supports_think)


def _c(think_effort="high"):
    return S(think_effort=think_effort)


class TestDetectThinkStyle:
    def test_gpt_o1(self):
        assert _detect_think_style(_m("o1-preview")) == "gpt"

    def test_gpt_o3(self):
        assert _detect_think_style(_m("o3-mini")) == "gpt"

    def test_gpt_o4(self):
        assert _detect_think_style(_m("o4-mini")) == "gpt"

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
        assert r == {"reasoning_effort": "off", "think_mode": False}

    def test_off_claude(self):
        r = _build_think_params(_m("claude-3"), _c("off"))
        assert r == {"thinking": {"type": "disabled"}, "think_mode": False}

    def test_off_generic(self):
        r = _build_think_params(_m("deepseek-r1"), _c("off"))
        assert r == {"thinking": {"type": "disabled"}, "think_mode": False}

    @pytest.mark.parametrize("effort", ["low", "medium", "high"])
    def test_gpt_effort(self, effort):
        r = _build_think_params(_m("o3-mini"), _c(effort))
        assert r == {"reasoning_effort": effort, "think_mode": True}

    @pytest.mark.parametrize("effort", ["low", "medium", "high"])
    def test_claude_budget(self, effort):
        r = _build_think_params(_m("claude-3"), _c(effort))
        assert r["thinking"]["type"] == "enabled"
        assert r["thinking"]["budget_tokens"] == _EFFORT_BUDGET[effort]
        assert r["think_mode"] is True

    @pytest.mark.parametrize("effort", ["low", "medium", "high"])
    def test_generic_enabled(self, effort):
        r = _build_think_params(_m("deepseek-r1"), _c(effort))
        assert r == {"thinking": {"type": "enabled"}, "think_mode": True}
