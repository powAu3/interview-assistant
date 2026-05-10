"""Prompt polish (2026-04-17): intent ladder + resume two-mode + 首句硬约束 + 高 churn 追问."""
from __future__ import annotations

import pytest
from core.config import get_config
from services.llm import build_system_prompt, create_answer_stream_sanitizer


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
    assert "第一句直接给结论" in p
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


# ---- 4.5 candidate voice / anti-template polish -------------------------

def test_asr_prompt_asks_for_candidate_voice_not_template_headings():
    p = _asr_prompt(high_churn=False)
    assert "真人候选人口吻" in p
    assert "结论先行" in p
    assert "不要把这些当标题" in p


def test_asr_high_churn_keeps_oral_short_answer_shape():
    p = _asr_prompt(high_churn=True)
    assert "像现场接一句话" in p
    assert "默认 80-180 字" in p


def test_manual_prompt_warns_not_to_emit_template_labels():
    p = _manual_prompt()
    assert "真人候选人口吻" in p
    assert "不要输出题型模板标题" in p


def test_stream_sanitizer_removes_split_think_tags():
    s = create_answer_stream_sanitizer("manual_text")
    chunks = ["<thi", "nking>内部思考</thinking>用 AOF", " 和 RDB。"]
    out = "".join(s.push(c) for c in chunks) + s.finish()
    assert out == "用 AOF 和 RDB。"


def test_stream_sanitizer_cleans_manual_markdown_and_meta_preface():
    s = create_answer_stream_sanitizer("manual_text")
    out = s.push("这是一个经典问题。\n# 回答\n**核心**是先止血。") + s.finish()
    assert "这是一个经典问题" not in out
    assert "#" not in out
    assert "回答" not in out
    assert "**" not in out
    assert "核心是先止血。" in out


def test_stream_sanitizer_keeps_screen_markdown_but_removes_think():
    s = create_answer_stream_sanitizer("server_screen_code")
    out = s.push("<analysis>草稿</analysis># 题目理解\n正文") + s.finish()
    assert "草稿" not in out
    assert "# 题目理解" in out
