"""Prompt polish (2026-04-17): intent ladder + resume two-mode + 首句硬约束 + 高 churn 追问."""
from __future__ import annotations

import pytest
from core.config import get_config
from services.llm import build_system_prompt


@pytest.fixture
def reset_resume():
    cfg = get_config()
    old = cfg.resume_text
    try:
        yield cfg
    finally:
        cfg.resume_text = old


def _asr_prompt(high_churn: bool = False) -> str:
    return build_system_prompt(
        mode="asr_realtime", high_churn_short_answer=high_churn
    )


def _manual_prompt() -> str:
    return build_system_prompt(mode="manual_text")


# ---- 4.1 intent ladder ---------------------------------------------------

def test_asr_realtime_has_intent_ladder_three_tiers():
    p = _asr_prompt(high_churn=False)
    assert "输入判定三档 ladder" in p
    assert "A. 完整" in p
    assert "B. 可猜意图" in p
    assert "C. 纯寒暄" in p
    assert "clarifier" in p or "我可以换个方向" in p


def test_asr_realtime_high_churn_also_has_intent_ladder():
    p = _asr_prompt(high_churn=True)
    assert "输入判定三档 ladder" in p
    assert "B. 可猜意图" in p
    assert "~80" in p or "80 字" in p


def test_asr_realtime_no_longer_uses_information_insufficient_halt():
    p = _asr_prompt(high_churn=False)
    assert "信息不足，先等待更完整的问题" not in p


# ---- 4.2 resume two-mode color ------------------------------------------

def test_prompt_has_resume_two_mode_rule_when_resume_present(reset_resume):
    cfg = reset_resume
    cfg.resume_text = "项目A: 后端重构，Kafka, Redis；2022 字节实习。"
    p = _manual_prompt()
    assert "简历使用规则" in p
    assert "简历深挖题" in p
    assert "简历相关题" in p
    assert "简历无关题" in p


def test_no_resume_rule_when_resume_missing(reset_resume):
    cfg = reset_resume
    cfg.resume_text = None
    p = _manual_prompt()
    assert "简历使用规则" not in p


# ---- 4.3 first-sentence hard constraint ---------------------------------

def test_first_sentence_hard_constraint_in_asr():
    p = _asr_prompt(high_churn=False)
    assert "首句硬约束" in p
    assert "前 20 字" in p
    assert "我理解你问的是" in p


def test_first_sentence_hard_constraint_in_manual_text():
    p = _manual_prompt()
    assert "首句硬约束" in p


# ---- 4.4 high-churn follow-up coherence ---------------------------------

def test_high_churn_branch_has_followup_coherence_rule():
    p = _asr_prompt(high_churn=True)
    assert "追问连贯" in p
    assert "[追问上下文]" in p


def test_normal_asr_still_has_followup_rule():
    p = _asr_prompt(high_churn=False)
    assert "[追问上下文]" in p
