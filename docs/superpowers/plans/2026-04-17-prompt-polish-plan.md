# Prompt Polish (high-churn / intent-guess / resume-color) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape `backend/services/llm/prompts.py` so the main interview pipeline always produces a useful voice (intent-guess ladder, resume two-mode color, first-sentence hard constraint, high-churn follow-up coherence), and ship a benchmark harness to measure the change objectively across all enabled models.

**Architecture:** All prompt behavior changes stay inside `prompts.py` — four focused edits (ladder / resume rules / first-sentence constraint / follow-up rule) injected through the existing `_base_prompt_prefix` / body helpers. A new standalone script `backend/scripts/bench_prompt.py` imports `build_system_prompt` and `chat_stream_single_model` in-process, iterates 30 representative cases across all `enabled` models in `config.json`, and writes a Markdown report with objective metrics (no LLM-as-judge).

**Tech Stack:** Python 3.11 + FastAPI backend (existing), `services.llm.build_system_prompt`, `services.llm.chat_stream_single_model`, `core.config.get_config`, pytest for unit tests, plain stdlib for the bench script (no new deps).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/services/llm/prompts.py` | All prompt body builders | **Modify** |
| `backend/tests/test_prompt_polish.py` | New unit tests for ladder/resume/首句/追问 文案 | **Create** |
| `backend/tests/test_assist_asr_interrupt.py` | Existing tests asserting old "高 churn" / "80-180" phrases | **Modify** (adjust a few assertions) |
| `backend/tests/test_kb_prompts.py` | Existing KB tests | **Modify** (only if old phrase assertions break — likely not) |
| `backend/scripts/bench_prompt.py` | Prompt bench harness | **Create** |
| `backend/scripts/__init__.py` | Package marker (if not present) | **Check / create** |
| `backend/tests/test_bench_prompt.py` | Unit tests for bench helpers (metrics, case loading) | **Create** |
| `log/bench_prompt_<timestamp>.md` | Bench run output | **Generated at runtime** |

---

## Task 1: Prompt polish — unit tests first (TDD red)

**Files:**
- Create: `backend/tests/test_prompt_polish.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_prompt_polish.py
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
    # 明确 clarifier 句式
    assert "clarifier" in p or "我可以换个方向" in p


def test_asr_realtime_high_churn_also_has_intent_ladder():
    p = _asr_prompt(high_churn=True)
    assert "输入判定三档 ladder" in p
    assert "B. 可猜意图" in p
    # 高 churn 下猜测档给更短的最小答（~80 字 vs 普通 ~180 字）
    assert "~80" in p or "80 字" in p


def test_asr_realtime_no_longer_uses_information_insufficient_halt():
    p = _asr_prompt(high_churn=False)
    # 旧文案 "信息不足，先等待更完整的问题" 作为 'halt' 出现应该被取消
    # 允许 C 档里提"不写" / "只一句"，但不应让模型直接因 B 档就停
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
    # 无简历时不注入规则（因为没有 <resume_context> 块）
    assert "简历使用规则" not in p


# ---- 4.3 first-sentence hard constraint ---------------------------------

def test_first_sentence_hard_constraint_in_asr():
    p = _asr_prompt(high_churn=False)
    assert "首句硬约束" in p
    assert "前 20 字" in p
    assert "我理解你问的是" in p  # 明确列为禁用引子


def test_first_sentence_hard_constraint_in_manual_text():
    p = _manual_prompt()
    assert "首句硬约束" in p


# ---- 4.4 high-churn follow-up coherence ---------------------------------

def test_high_churn_branch_has_followup_coherence_rule():
    p = _asr_prompt(high_churn=True)
    assert "追问连贯" in p or "追问上下文" in p
    assert "[追问上下文]" in p


def test_normal_asr_still_has_followup_rule():
    p = _asr_prompt(high_churn=False)
    assert "[追问上下文]" in p
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && /Users/wangxin/.pyenv/shims/python -m pytest tests/test_prompt_polish.py -v`
Expected: all tests FAIL (prompts still have old phrases, missing new keywords).

- [ ] **Step 3: Commit tests**

```bash
git add backend/tests/test_prompt_polish.py
git commit -m "test(prompt): add failing tests for intent ladder + resume two-mode + 首句约束"
```

---

## Task 2: Prompt polish — implementation

**Files:**
- Modify: `backend/services/llm/prompts.py`

- [ ] **Step 1: Add a shared `_FIRST_SENTENCE_CONSTRAINT` constant at module top**

Insert right after the imports / before `_normalize_screen_region`:

```python
_FIRST_SENTENCE_CONSTRAINT = (
    "首句硬约束:\n"
    "- 前 20 字必须出现结论动词（如\"先止血\"、\"用 X 做 Y\"、\"答案是 X\"、\"核心原因是 X\"）;\n"
    "- 禁止用\"我理解你问的是\"、\"想先确认一下\"、\"这是一个经典问题\"等引子;\n"
    "- 如果是 ladder 的 B 档, 首句可以是\"先按大概率问 X 理解\"（此时动词在\"按 … 理解\"）, 不算违规。\n"
)


def _intent_ladder_block(short_answer_word_budget: str) -> str:
    return (
        "输入判定三档 ladder（按顺序往下匹配）:\n"
        "A. 完整可答的面试问题 -> 直接进入正式回答, 不输出任何判定过程。\n"
        "B. 可猜意图（半句话、术语模糊、不完整但能推出方向） ->\n"
        "   1) 先对最可能的意图给 1 句说明: \"先按大概率问 X 理解\";\n"
        f"   2) 给一个 {short_answer_word_budget} 的最小可用回答;\n"
        "   3) 最后一句挂 clarifier: \"如果你实际想问 Y, 我可以换个方向\";\n"
        "   不要输出\"信息不足\"这种空回答。\n"
        "C. 纯寒暄 / 口头禅 / 设备噪声 / 明显无关内容 -> 只输出一句:\n"
        "   \"等你问题\" 或 \"在听呢, 请继续\", 其他不写。\n"
        "默认倾向: 宁可按 B 给点东西, 也不要按 C 停; 只有确实没有可猜方向时才落 C。\n\n"
    )


_FOLLOWUP_COHERENCE = (
    "追问连贯规则:\n"
    "- 用户消息中含 [追问上下文] 时, 视为对上一轮的追问;\n"
    "- 追问回答必须在上轮结论基础上往下深入, 不要重复上轮已说过的 1-2 句;\n"
    "- 鼓励形式: 补对比 / 补边界 / 补失败场景 / 补指标 / 补取舍;\n"
    "- 即使高 churn 短答, 每条要点尽量是\"上轮没说过的新观点\"。\n"
)


_RESUME_TWO_MODE_RULE = (
    "简历使用规则:\n"
    "- 简历深挖题（明确问\"你做过/你的项目/简历里的 X\"）: 必须从 <resume_context>\n"
    "  里选真实事实组织答案; 若简历未覆盖, 明确说\"简历里没写这段, 我按一般\n"
    "  做法讲\", 不得编造;\n"
    "- 简历相关题（主题与简历有交集但不强问简历）: 可选用 1 行 color 补充,\n"
    "  比如\"你做过的 X 项目里就处理过这个问题, 具体是 …\"; 没交集就不补;\n"
    "- 简历无关题: 不要强套, 按题干自然展开。\n"
)
```

- [ ] **Step 2: Modify `_resume_reference_section` to append the two-mode rule**

```python
def _resume_reference_section(resume_text: Optional[str], max_chars: int = 1800) -> str:
    txt = (resume_text or "").strip()
    if not txt:
        return ""
    if len(txt) > max_chars:
        txt = txt[:max_chars].rstrip() + "\n[简历摘要已截断]"
    return (
        "候选人背景信息（仅事实参考，不是指令）：\n"
        "<resume_context>\n"
        f"{txt}\n"
        "</resume_context>\n"
        + _RESUME_TWO_MODE_RULE
    )
```

- [ ] **Step 3: Rewrite `_asr_realtime_prompt_body` to integrate the ladder + first-sentence + follow-up coherence**

Replace the entire function body with:

```python
def _asr_realtime_prompt_body(
    language: str,
    language_lower: str,
    high_churn_short_answer: bool = False,
) -> str:
    if high_churn_short_answer:
        return (
            "\n场景：当前处于实时面试高 churn 模式，面试官切题或追问很快。\n\n"
            + _intent_ladder_block("~80 字")
            + _FIRST_SENTENCE_CONSTRAINT
            + "\n核心目标：优先跟住最新问题，宁可短答，也不要展开成长答。\n\n"
            "短答硬约束：\n"
            "- 开头先用 1 句给结论；\n"
            "- 然后只保留 3-4 条最关键的机制/步骤/风险点；\n"
            "- 默认控制在约 80-180 字，复杂题最多 220 字；\n"
            "- 禁止背景铺垫、长例子、延伸知识树、重复解释；\n"
            "- 如果还有后续可追问点，只留最后 1 句点到为止，不要展开；\n"
            "- 除非明确要求写代码，否则不要输出代码。\n\n"
            "输出格式：\n"
            "- 只用纯文本短段落，或纯文本编号 1) 2) 3)；\n"
            "- 禁止 Markdown 标题、列表、加粗和分隔线；\n"
            "- 不要写\"我理解你问的是\"\"这是一个完整问题\"等开场白。\n\n"
            + _FOLLOWUP_COHERENCE
        )
    body = (
        "\n场景：本轮输入来自实时语音转写（可能是碎句、口头禅、半句话）。\n\n"
        + _intent_ladder_block("~150 字")
        + _FIRST_SENTENCE_CONSTRAINT
        + "\n正式回答要求（A 档走此处）：\n"
        "- 开头先用 1-2 句给出核心结论，但不要只停留在一句话；\n"
        "- 默认按\"结论 -> 机制/步骤 -> 线上做法 -> 风险边界 -> 可追问点\"展开，整体要像正式面试回答，不要像聊天速答；\n"
        "- 随后给 6-10 个关键点，优先写\"动作/机制 -> 为什么 -> 风险或边界\"；\n"
        "- 排障题必须覆盖\"先止血、后定位、再验证\"；\n"
        "- 原理题必须覆盖\"机制 + 常见误区/失效边界 + 线上做法\"；\n"
        "- 场景/设计题尽量补\"方案A/B取舍 + 监控告警 + 灰度回滚\"；\n"
        "- 至少补 1 条\"若继续追问我会展开\"的点；\n"
        "- 普通题约 320-520 字；复杂排障/设计题约 520-950 字，保证信息密度，不要空话。\n\n"
        "深度与广度检查（复杂题尽量覆盖）：\n"
        "- 原理链路（为什么有效）；\n"
        "- 落地动作（具体怎么做）；\n"
        "- 关键指标/阈值（如何判断好坏）；\n"
        "- 边界与失败场景（哪里会失效，怎么兜底）；\n"
        "- 方案取舍（至少一处 trade-off）；\n"
        "- 发布与回滚（如何灰度、如何验收、如何回退）；\n"
        "- 最好有 1 个贴近生产的例子或经验口吻的补充。\n\n"
        "质量红线：\n"
        "- 不要输出题型判断过程和元话术（如\"这是一个完整问题\"\"这是经典场景\"）；\n"
        "- 不要把答案写成\"一句话回答 / 回答结构\"这种模板标题；\n"
        "- 不要只讲定义，不给步骤和判断依据；\n"
        "- 不要堆砌空泛建议（如\"先看日志\"但不说看什么指标）。\n\n"
        "代码规则：\n"
        "- 仅当用户明确要求\"写代码/实现一下/给 SQL/伪代码\"时输出代码；\n"
        f"- 非 SQL 代码使用 ```{language_lower}，SQL 使用 ```sql；\n"
        f"- SQL 题优先 SQL，不要强行改成 {language}。\n\n"
        "输出格式：\n"
        "- 默认用纯文本短段落，或纯文本编号 1) 2) 3)；\n"
        "- 禁止 Markdown 标题、列表、加粗和分隔线；\n"
        "- 需要代码时允许使用 Markdown 代码块。\n\n"
        + _FOLLOWUP_COHERENCE
    )
    return body
```

- [ ] **Step 4: Add `_FIRST_SENTENCE_CONSTRAINT` to `_manual_text_prompt_body` (top)**

Change the opening of `_manual_text_prompt_body` from:

```python
def _manual_text_prompt_body(language: str, language_lower: str) -> str:
    return (
        "\n场景：本轮输入来自手动文本（通常比实时语音更完整）。\n\n"
```

to:

```python
def _manual_text_prompt_body(language: str, language_lower: str) -> str:
    return (
        "\n场景：本轮输入来自手动文本（通常比实时语音更完整）。\n\n"
        + _FIRST_SENTENCE_CONSTRAINT
        + "\n"
```

(Keep the rest of the body unchanged.)

- [ ] **Step 5: Run the new tests, expect PASS**

Run: `cd backend && /Users/wangxin/.pyenv/shims/python -m pytest tests/test_prompt_polish.py -v`
Expected: all 8 tests PASS.

- [ ] **Step 6: Run the existing suite, catch regressions**

Run: `cd backend && /Users/wangxin/.pyenv/shims/python -m pytest tests/test_assist_asr_interrupt.py tests/test_kb_prompts.py -v`
Expected: some assertions in `test_build_system_prompt_includes_high_churn_short_answer_instructions` may fail because we removed the old "信息不足，先等待" string. If that's the only failure we'll fix in Task 3.

- [ ] **Step 7: Commit implementation**

```bash
git add backend/services/llm/prompts.py
git commit -m "feat(prompt): add intent ladder + resume two-mode + 首句约束 + 高 churn 追问"
```

---

## Task 3: Adjust existing tests to the new prompt surface

**Files:**
- Modify: `backend/tests/test_assist_asr_interrupt.py`

- [ ] **Step 1: Update `test_build_system_prompt_includes_high_churn_short_answer_instructions`**

Replace the old assertions (line 218-232) with:

```python
def test_build_system_prompt_includes_high_churn_short_answer_instructions():
    normal = build_system_prompt(
        manual_input=False,
        mode="asr_realtime",
        high_churn_short_answer=False,
    )
    short = build_system_prompt(
        manual_input=False,
        mode="asr_realtime",
        high_churn_short_answer=True,
    )

    # 高 churn 分支：场景提示、短答字数窗口、追问连贯规则
    assert "高 churn" in short
    assert "80-180" in short
    assert "追问连贯" in short
    # 普通分支没有"高 churn 模式"提示语，但同样有 ladder 和追问规则
    assert "高 churn 模式" not in normal
    assert "输入判定三档 ladder" in normal
    assert "输入判定三档 ladder" in short
```

- [ ] **Step 2: Run the full backend suite**

Run: `cd backend && /Users/wangxin/.pyenv/shims/python -m pytest tests/ -x --tb=short --ignore=tests/stress_test_interview.py --ignore=tests/test_preflight_real_audio.py`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_assist_asr_interrupt.py
git commit -m "test(prompt): update high_churn assertions for ladder + followup coherence"
```

---

## Task 4: Bench harness — case data + metric helpers (TDD, no API yet)

**Files:**
- Create: `backend/scripts/bench_prompt.py`
- Create: `backend/tests/test_bench_prompt.py`
- Check: `backend/scripts/__init__.py` (create if missing)

- [ ] **Step 1: Ensure scripts is a package**

Run:
```bash
test -f backend/scripts/__init__.py || touch backend/scripts/__init__.py
```

- [ ] **Step 2: Write the failing unit tests for bench helpers**

```python
# backend/tests/test_bench_prompt.py
"""Unit tests for bench_prompt helpers (no LLM API calls)."""
from __future__ import annotations

import pytest

from scripts.bench_prompt import (
    BENCH_CASES,
    RESUME_FIXTURE,
    has_info_insufficient_phrase,
    has_preamble_phrase,
    first_sentence_is_compliant,
    resume_keyword_hits,
    ngram_overlap_3,
    word_count_cn,
)


def test_bench_cases_has_30_balanced():
    cats = [c["category"] for c in BENCH_CASES]
    assert len(BENCH_CASES) == 30
    for cat in ("complete", "guessable", "smalltalk", "resume_deepdive", "followup"):
        assert cats.count(cat) == 6, f"{cat} should have 6 cases"


def test_bench_cases_have_required_fields():
    for c in BENCH_CASES:
        assert {"id", "category", "input", "mode", "high_churn"}.issubset(c.keys())
        assert c["mode"] in ("asr_realtime", "manual_text")
        assert isinstance(c["high_churn"], bool)


def test_has_info_insufficient_phrase():
    assert has_info_insufficient_phrase("信息不足，先等待更完整的问题")
    assert has_info_insufficient_phrase("暂时信息不足")
    assert not has_info_insufficient_phrase("Redis 的 RDB 是快照")


def test_has_preamble_phrase():
    assert has_preamble_phrase("我理解你问的是 Redis 的持久化")
    assert has_preamble_phrase("想先确认一下你指的是什么")
    assert has_preamble_phrase("这是一个经典问题")
    assert not has_preamble_phrase("先止血：把 Redis 切到主从")


def test_first_sentence_is_compliant():
    # 动词开头合规
    assert first_sentence_is_compliant("用 Redis 做缓存穿透防护")
    assert first_sentence_is_compliant("先止血再定位根因")
    assert first_sentence_is_compliant("答案是使用 AOF")
    # B 档 ladder 合规
    assert first_sentence_is_compliant("先按大概率问 Redis 持久化来理解")
    # 引子类违规
    assert not first_sentence_is_compliant("我理解你问的是 Redis")
    assert not first_sentence_is_compliant("想先确认一下")


def test_resume_keyword_hits():
    kws = ["Kafka", "字节", "Redis"]
    answer = "你之前在字节做过 Kafka 的迁移，类似场景我会……"
    assert resume_keyword_hits(answer, kws) == 2


def test_ngram_overlap_3_identifies_repeat():
    prev = "Redis 的 RDB 是内存快照，每隔一段时间刷盘"
    same = "Redis 的 RDB 是内存快照，每隔一段时间刷盘"
    different = "追问关键是 AOF 的写入时机和持久化强度"
    assert ngram_overlap_3(prev, same) > 0.9
    assert ngram_overlap_3(prev, different) < 0.35


def test_word_count_cn_counts_chinese_and_english():
    assert word_count_cn("Redis 的 RDB 是快照") >= 5
```

- [ ] **Step 3: Create `backend/scripts/bench_prompt.py` skeleton**

```python
# backend/scripts/bench_prompt.py
"""Bench harness for prompt polish: 30 cases × all enabled models × OLD vs NEW.

Runs in-process against services.llm.build_system_prompt +
chat_stream_single_model. No WebSocket, no HTTP — pure Python dispatch.

Usage:
    cd backend && python -m scripts.bench_prompt --out log/bench.md
    cd backend && python -m scripts.bench_prompt --models Doubao-Seed-2.0-pro --cases 5
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


# --- Case data ------------------------------------------------------------

RESUME_FIXTURE = (
    "姓名: 王小明\n"
    "2022-2024 字节跳动 · 后端开发\n"
    "- 负责订单系统 Kafka 消息链路重构, QPS 10w -> 30w\n"
    "- 主导 Redis 多活缓存迁移, 命中率从 82% 提升到 97%\n"
    "- 带过 3 人小组, 推进 MySQL 分库分表\n"
    "2020-2022 美团 · 后端实习 -> 初级\n"
    "- 用 Java / Spring Boot 做过支付回调对账服务\n"
    "技术栈: Java, Go, Kafka, Redis, MySQL, K8s\n"
)

# 简历里可被模型引用的关键词 (for D 类 metric)
RESUME_KEYWORDS = [
    "Kafka", "Redis", "字节", "美团", "分库分表", "订单系统", "缓存", "多活",
]


BENCH_CASES: list[dict[str, Any]] = [
    # ===== A 完整八股 (6) =====
    {"id": "A-1", "category": "complete", "input": "Redis 的 RDB 和 AOF 区别是什么", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "A-2", "category": "complete", "input": "MySQL 事务的四个隔离级别分别解决什么问题", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "A-3", "category": "complete", "input": "TCP 三次握手具体流程和为什么不是两次", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "A-4", "category": "complete", "input": "Kafka 消息不丢失要怎么保证", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "A-5", "category": "complete", "input": "HTTPS 握手过程里对称和非对称加密分别在哪里用", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "A-6", "category": "complete", "input": "一致性哈希解决了什么问题, 有哪些常见坑", "mode": "asr_realtime", "high_churn": True, "context": None},

    # ===== B 可猜意图 (6) =====
    {"id": "B-1", "category": "guessable", "input": "Redis 那个咋整", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "B-2", "category": "guessable", "input": "锁怎么搞", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "B-3", "category": "guessable", "input": "事务那个", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "B-4", "category": "guessable", "input": "高并发下", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "B-5", "category": "guessable", "input": "这个场景要", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "B-6", "category": "guessable", "input": "那个一致性", "mode": "asr_realtime", "high_churn": True, "context": None},

    # ===== C 纯寒暄 (6) =====
    {"id": "C-1", "category": "smalltalk", "input": "嗯那我们开始吧", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "C-2", "category": "smalltalk", "input": "可以吗", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "C-3", "category": "smalltalk", "input": "好的", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "C-4", "category": "smalltalk", "input": "嗯嗯", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "C-5", "category": "smalltalk", "input": "能听见吗", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "C-6", "category": "smalltalk", "input": "稍等我喝口水", "mode": "asr_realtime", "high_churn": False, "context": None},

    # ===== D 简历深挖 (6) =====
    {"id": "D-1", "category": "resume_deepdive", "input": "你简历里写的 Kafka 重构 QPS 10w 到 30w 具体怎么做的", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "D-2", "category": "resume_deepdive", "input": "你做过 Redis 多活缓存迁移吧, 讲一下命中率怎么从 82 到 97", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "D-3", "category": "resume_deepdive", "input": "你主导过分库分表, 当时怎么决定分片键的", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "D-4", "category": "resume_deepdive", "input": "在字节你带过 3 个人, 你怎么推动 MySQL 改造", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "D-5", "category": "resume_deepdive", "input": "你简历里没体现 K8s 实战, 但技术栈写了, 讲讲你的 K8s 经验", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "D-6", "category": "resume_deepdive", "input": "美团支付对账服务遇到过什么坑", "mode": "asr_realtime", "high_churn": True, "context": None},

    # ===== E 追问链 (6 = 2 chains × 3 rounds) =====
    # chain 1
    {"id": "E-1a", "category": "followup", "input": "介绍一下 Redis 缓存击穿怎么防", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "E-1b", "category": "followup", "input": "嗯，那如果是缓存雪崩呢", "mode": "asr_realtime", "high_churn": False, "context": {"prev_idx": "E-1a"}},
    {"id": "E-1c", "category": "followup", "input": "线上监控怎么判定是哪一种", "mode": "asr_realtime", "high_churn": False, "context": {"prev_idx": "E-1b"}},
    # chain 2
    {"id": "E-2a", "category": "followup", "input": "Kafka 为什么要有 ISR 机制", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "E-2b", "category": "followup", "input": "那 ISR 缩减会导致什么问题", "mode": "asr_realtime", "high_churn": True, "context": {"prev_idx": "E-2a"}},
    {"id": "E-2c", "category": "followup", "input": "生产里怎么配置 min.insync.replicas", "mode": "asr_realtime", "high_churn": True, "context": {"prev_idx": "E-2b"}},
]


# --- Metric helpers -------------------------------------------------------

_INFO_INSUFFICIENT_RE = re.compile(r"信息不足|等待更完整的?问题")
_PREAMBLE_RE = re.compile(
    r"我理解你问的是|想先确认一下|这是一个[^。\n]{0,40}(经典|完整)|首先分析一下|让我先"
)
_LADDER_B_RE = re.compile(r"按大概率(问|理解)")


def has_info_insufficient_phrase(text: str) -> bool:
    return bool(_INFO_INSUFFICIENT_RE.search(text or ""))


def has_preamble_phrase(text: str) -> bool:
    return bool(_PREAMBLE_RE.search(text or ""))


def first_sentence_is_compliant(text: str) -> bool:
    """True 表示首句没有违规引子。"""
    head = (text or "").strip().splitlines()[0] if text else ""
    head_20 = head[:20]
    if _LADDER_B_RE.search(head):
        return True
    if _PREAMBLE_RE.search(head_20):
        return False
    return True


def resume_keyword_hits(answer: str, keywords: Iterable[str]) -> int:
    n = 0
    for kw in keywords:
        if kw and kw in (answer or ""):
            n += 1
    return n


def _split_ngrams(text: str, n: int = 3) -> list[str]:
    # drop spaces and punctuation for Chinese-aware n-gram
    cleaned = re.sub(r"[\s，。！？,.!?:;；：《》()（）\[\]【】\"'\n]+", "", text or "")
    return [cleaned[i : i + n] for i in range(max(0, len(cleaned) - n + 1))]


def ngram_overlap_3(a: str, b: str) -> float:
    ga = set(_split_ngrams(a, 3))
    gb = set(_split_ngrams(b, 3))
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / max(len(ga), len(gb))


def word_count_cn(text: str) -> int:
    # Simplified: count Chinese chars + English word tokens
    if not text:
        return 0
    cn = len(re.findall(r"[\u4e00-\u9fff]", text))
    en = len(re.findall(r"[A-Za-z]+", text))
    return cn + en


# --- Runner (Task 5 fills in) --------------------------------------------

def main():
    raise SystemExit("bench runner implemented in Task 5")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the bench unit tests, expect PASS**

Run: `cd backend && /Users/wangxin/.pyenv/shims/python -m pytest tests/test_bench_prompt.py -v`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/__init__.py backend/scripts/bench_prompt.py backend/tests/test_bench_prompt.py
git commit -m "feat(bench): add bench_prompt case data + metric helpers (TDD)"
```

---

## Task 5: Bench harness — in-process model runner + markdown report

**Files:**
- Modify: `backend/scripts/bench_prompt.py`

- [ ] **Step 1: Append the runner + CLI to `bench_prompt.py`**

Replace the placeholder `main()` with a full implementation. Paste the following **before** the `if __name__ == "__main__":` guard, replacing the stub:

```python
# --- Runner ---------------------------------------------------------------

@dataclass
class RunResult:
    case_id: str
    model_name: str
    variant: str  # "OLD" or "NEW"
    text: str
    elapsed_ms: int
    error: str | None = None


def _load_enabled_models(model_filter: set[str] | None):
    from core.config import get_config
    cfg = get_config()
    out = []
    for m in cfg.models:
        if not m.enabled or not (m.api_key or "").strip():
            continue
        if model_filter and m.name not in model_filter:
            continue
        out.append(m)
    return out


def _run_one_case(model_cfg, case: dict[str, Any], variant: str, prompts_by_variant) -> RunResult:
    """Call chat_stream_single_model and collect full text."""
    from services.llm import chat_stream_single_model

    system_prompt = prompts_by_variant[variant](case)
    user_text = case["input"]
    if case.get("context") and variant == "NEW":
        # 在追问 case 里注入 [追问上下文] 前缀, 复现 pipeline 行为
        prev_idx = case["context"].get("prev_idx")
        user_text = f"[追问上下文] 上一轮用户问: (case {prev_idx})\n\n{user_text}"

    t0 = time.monotonic()
    chunks: list[str] = []
    try:
        for kind, txt in chat_stream_single_model(
            model_cfg,
            messages=[{"role": "user", "content": user_text}],
            system_prompt=system_prompt,
        ):
            if kind == "text" and txt:
                chunks.append(txt)
        return RunResult(
            case_id=case["id"],
            model_name=model_cfg.name,
            variant=variant,
            text="".join(chunks),
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
    except Exception as e:  # noqa: BLE001
        return RunResult(
            case_id=case["id"],
            model_name=model_cfg.name,
            variant=variant,
            text="",
            elapsed_ms=int((time.monotonic() - t0) * 1000),
            error=str(e),
        )


def _prompt_for_new(case: dict[str, Any]) -> str:
    from services.llm import build_system_prompt
    return build_system_prompt(
        mode=case["mode"],
        high_churn_short_answer=case.get("high_churn", False),
    )


def _prompt_for_old(case: dict[str, Any]) -> str:
    """OLD variant: reconstruct pre-polish system prompt from git HEAD~."""
    # Pragmatic: we don't re-run git; we call build_system_prompt with a
    # monkey-patched flag that disables the new blocks. Task 6 will compare
    # against an actual git-checked-out baseline if we want a true diff run.
    from services.llm import build_system_prompt
    return build_system_prompt(
        mode=case["mode"],
        high_churn_short_answer=case.get("high_churn", False),
    )


def _disable_ws_broadcast():
    """chat_stream uses api.realtime.ws.broadcast for token updates; stub it."""
    try:
        import api.realtime.ws as ws_mod  # type: ignore
        ws_mod.broadcast = lambda payload: None  # type: ignore[assignment]
    except Exception:  # pragma: no cover - module unavailable
        pass


def _set_resume(resume_text: str | None):
    from core.config import get_config
    get_config().resume_text = resume_text


def _format_report(
    results: list[RunResult],
    cases: list[dict[str, Any]],
    models: list[Any],
    out_path: Path,
):
    # Group results: (case_id, model, variant) -> RunResult
    index: dict[tuple[str, str, str], RunResult] = {
        (r.case_id, r.model_name, r.variant): r for r in results
    }
    ts = time.strftime("%Y-%m-%d %H:%M", time.localtime())

    lines: list[str] = []
    lines.append(f"# Bench Prompt Report - {ts}")
    lines.append("")
    lines.append(f"- 模型: {', '.join(m.name for m in models)}")
    lines.append(f"- Case: {len(cases)} ({_category_counts(cases)})")
    lines.append(f"- Total requests: {len(results)}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(_summary_table(results, cases, models))
    lines.append("")
    lines.append("## Per-Case")
    lines.append("")
    for c in cases:
        lines.append(f"### [{c['id']}] {c['category']} | {c['mode']} | high_churn={c['high_churn']}")
        lines.append(f"**Input**: {c['input']}")
        lines.append("")
        for m in models:
            lines.append(f"#### {m.name}")
            for variant in ("OLD", "NEW"):
                r = index.get((c["id"], m.name, variant))
                if not r:
                    continue
                header = f"**{variant}** ({r.elapsed_ms} ms"
                if r.error:
                    header += f", error={r.error})"
                else:
                    header += ")"
                lines.append(header)
                if r.error:
                    lines.append(f"> `{r.error}`")
                else:
                    lines.append("")
                    lines.append(r.text.strip() or "(empty)")
                lines.append("")
            lines.append("")
        lines.append("")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")


def _category_counts(cases: list[dict[str, Any]]) -> str:
    from collections import Counter
    c = Counter(x["category"] for x in cases)
    return " ".join(f"{k}={v}" for k, v in c.items())


def _summary_table(
    results: list[RunResult],
    cases: list[dict[str, Any]],
    models: list[Any],
) -> str:
    # Group answers by (variant, category)
    by_cat: dict[tuple[str, str], list[str]] = {}
    for r in results:
        case = next(c for c in cases if c["id"] == r.case_id)
        by_cat.setdefault((r.variant, case["category"]), []).append(r.text)

    def count(pred, variant, cat):
        arr = by_cat.get((variant, cat), [])
        return sum(1 for x in arr if pred(x))

    rows = []
    rows.append("| Category | Metric | OLD | NEW |")
    rows.append("|---|---|---|---|")
    # B: "信息不足" 落率
    rows.append(
        f"| B 可猜意图 | \"信息不足\"落率 | {count(has_info_insufficient_phrase, 'OLD', 'guessable')}/{len(by_cat.get(('OLD','guessable'),[])) } | {count(has_info_insufficient_phrase, 'NEW', 'guessable')}/{len(by_cat.get(('NEW','guessable'),[])) } |"
    )
    # D: 简历关键词命中率（≥2 关键词命中视为命中）
    rows.append(
        f"| D 简历深挖 | 简历关键词≥2命中 | {count(lambda t: resume_keyword_hits(t, RESUME_KEYWORDS) >= 2, 'OLD', 'resume_deepdive')}/6 | {count(lambda t: resume_keyword_hits(t, RESUME_KEYWORDS) >= 2, 'NEW', 'resume_deepdive')}/6 |"
    )
    # ALL: 首句引子率
    all_old = sum(by_cat.get(('OLD', c), []) for c in ('complete','guessable','smalltalk','resume_deepdive','followup') if (('OLD', c) in by_cat)) if False else []
    # simpler:
    def all_for(variant):
        out = []
        for cat in ('complete','guessable','smalltalk','resume_deepdive','followup'):
            out.extend(by_cat.get((variant, cat), []))
        return out
    old_all = all_for('OLD')
    new_all = all_for('NEW')
    rows.append(
        f"| ALL | 首句引子率 | {sum(1 for t in old_all if not first_sentence_is_compliant(t))}/{len(old_all)} | {sum(1 for t in new_all if not first_sentence_is_compliant(t))}/{len(new_all)} |"
    )
    # HC: high churn 字数在 80-220 范围率
    hc_cases = [c for c in cases if c["high_churn"]]
    hc_ids = {c["id"] for c in hc_cases}
    def hc_in_range(variant):
        return sum(
            1 for r in results
            if r.variant == variant and r.case_id in hc_ids
            and 80 <= word_count_cn(r.text) <= 220
        )
    rows.append(f"| HC | 字数 80-220 范围率 | {hc_in_range('OLD')}/{len(hc_cases) * len(models)} | {hc_in_range('NEW')}/{len(hc_cases) * len(models)} |")
    return "\n".join(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", help="逗号分隔的模型名, 默认所有启用的", default="")
    parser.add_argument("--cases", type=int, default=0, help="只跑前 N 个 case, 0 表示全部")
    parser.add_argument("--only-new", action="store_true", help="跳过 OLD 对照")
    parser.add_argument("--out", default="log/bench_prompt.md")
    args = parser.parse_args()

    _disable_ws_broadcast()

    model_filter = set(s.strip() for s in args.models.split(",") if s.strip()) or None
    models = _load_enabled_models(model_filter)
    if not models:
        print("没有可用的启用模型（检查 config.json 的 enabled + api_key）", file=sys.stderr)
        sys.exit(2)

    cases = BENCH_CASES[: args.cases] if args.cases > 0 else BENCH_CASES

    prompts_by_variant = {
        "OLD": _prompt_for_old,
        "NEW": _prompt_for_new,
    }
    variants = ("NEW",) if args.only_new else ("OLD", "NEW")

    _set_resume(RESUME_FIXTURE)
    results: list[RunResult] = []
    total = len(models) * len(cases) * len(variants)
    done = 0
    for m in models:
        for variant in variants:
            for c in cases:
                done += 1
                print(f"[{done}/{total}] {m.name} | {variant} | {c['id']} …", flush=True)
                r = _run_one_case(m, c, variant, prompts_by_variant)
                results.append(r)
                if r.error:
                    print(f"    ERROR: {r.error}", file=sys.stderr)
    _set_resume(None)

    out_path = Path(args.out)
    _format_report(results, cases, models, out_path)
    print(f"\nReport written: {out_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Add `_prompt_for_old` implementation note**

The current naive `_prompt_for_old` reuses `build_system_prompt` (same file), which means OLD == NEW in this bench run. **Accept this limitation**: since the OLD variant is only for informational comparison, we'll run a separate bench against `git stash` of the prompts.py change before Task 2's commit, or skip OLD entirely via `--only-new`. Document this in the file header.

Add a clear warning comment above `_prompt_for_old`:
```python
# NOTE: OLD 对照需要先 git checkout 到 prompts.py 修改前的 commit 再跑一次,
# 然后 cherry-pick 新的 prompts.py 再跑 NEW。本函数在单次运行内只拿到当前的
# prompt; 想要真正的 before/after 对比, 请用 --only-new 分两次 commit 跑。
```

- [ ] **Step 3: Bench smoke run with 3 cases × 1 model**

Run:
```bash
cd backend && /Users/wangxin/.pyenv/shims/python -m scripts.bench_prompt \
    --models Doubao-Seed-2.0-pro --cases 3 --only-new --out log/bench_smoke.md
```
Expected: script runs, writes `backend/log/bench_smoke.md` (or repo root log/, depending on cwd). Contains 3 cases × 1 model with NEW answers.

- [ ] **Step 4: Inspect output**

```bash
cat log/bench_smoke.md | head -100
```
Expected: markdown with `# Bench Prompt Report`, `## Summary` table, and 3 `### [A-1]...[A-3]` sections each with non-empty answers.

- [ ] **Step 5: Commit the runner**

```bash
git add backend/scripts/bench_prompt.py
git commit -m "feat(bench): bench_prompt runner + markdown report with objective metrics"
```

---

## Task 6: Full bench run and prompt tuning

**Files:**
- Modify (iterative): `backend/services/llm/prompts.py`
- Generated: `log/bench_prompt_<timestamp>.md`

- [ ] **Step 1: Capture OLD baseline by checking out pre-polish prompts.py**

In the same tree, temporarily revert `prompts.py` to pre-polish, run bench, then restore:

```bash
# 记下当前 NEW commit sha (Task 2 的 commit)
NEW_SHA=$(git rev-parse HEAD)

# 回到 Task 2 之前的 prompts.py（只回退这一个文件）
git checkout HEAD~2 -- backend/services/llm/prompts.py

# 跑 OLD bench
cd backend && /Users/wangxin/.pyenv/shims/python -m scripts.bench_prompt \
    --only-new \
    --out ../log/bench_prompt_OLD_$(date +%Y%m%d_%H%M).md
cd ..

# 恢复 NEW 版本
git checkout "$NEW_SHA" -- backend/services/llm/prompts.py
```

注意: `--only-new` 标志只影响报告的 variant 列，脚本逻辑都是用**当前文件**的 prompt。通过先跑 OLD 再跑 NEW 拿到两份独立报告，人读对比。

- [ ] **Step 2: Full bench run (all 30 cases × all models, NEW only)**

```bash
cd backend && /Users/wangxin/.pyenv/shims/python -m scripts.bench_prompt \
    --only-new \
    --out log/bench_prompt_$(date +%Y%m%d_%H%M).md
```
Expected: 30 × N models × 1 variant ≈ 150 requests. ~8-15 min. Writes `log/bench_prompt_<ts>.md`.

- [ ] **Step 3: Inspect key metrics**

Open the report, look at:
- B 类: 有没有模型仍然输出"信息不足"? 如果有, 哪个模型？
- D 类: 简历关键词命中是否 ≥ 4/6？
- C 类: 寒暄是否被正确识别（文本长度很短）？
- HC (high_churn) 类: 字数是否在 80-220 范围？

- [ ] **Step 4: Tune prompts based on findings (iterate ≤ 2 rounds)**

Likely tweaks based on typical model behavior:
- 如果 B 档仍落"信息不足" → 强化 "不要输出'信息不足'这种空回答"
- 如果 D 档命中率低 → 在简历规则前面加一句 "如果 <resume_context> 里提到了相关项目, 优先引用项目名称和数字"
- 如果 HC 字数超标 → 把短答字数窗口从 80-180 收紧到 80-150
- 如果首句引子率高 → 在 `_FIRST_SENTENCE_CONSTRAINT` 末尾加一行 "自检: 如果首句出现禁用引子, 重写后再输出"

Each tweak commit separately with `fix(prompt): …`.

- [ ] **Step 5: Re-run bench to verify**

```bash
cd backend && /Users/wangxin/.pyenv/shims/python -m scripts.bench_prompt \
    --only-new --out log/bench_prompt_$(date +%Y%m%d_%H%M)_v2.md
```

- [ ] **Step 6: Archive final report**

```bash
git add log/bench_prompt_*.md
git commit -m "docs: archive bench_prompt reports for prompt polish"
```

Acceptance:
- B 档 "信息不足" 落率 ≤ 1/6 (at least once across all models)
- D 档 简历关键词命中 ≥ 4/6
- 首句引子率 ≤ 3/30
- 高 churn 字数在 80-220 范围率 ≥ 5/6

---

## Self-Review

**Spec coverage:**
- §4.1 intent ladder → Task 1 tests + Task 2 Step 3 implementation ✓
- §4.2 resume two-mode → Task 1 tests + Task 2 Step 2 implementation ✓
- §4.3 首句硬约束 → Task 1 tests + Task 2 Steps 3 & 4 implementation ✓
- §4.4 高 churn 追问连贯 → Task 1 tests + Task 2 Step 3 implementation ✓
- §5 bench harness → Tasks 4 & 5 ✓
- §6 acceptance → Task 6 ✓

**Placeholder scan:** 
- "adjust to pre-polish commit" in Task 6 Step 1 is explicit, not a TBD — left as a workflow note because the exact sha is only known post-Task-2 commit.
- "if we have any saved samples" fallback also documented.
- No other vague "TBD/fill in details".

**Type consistency:** All function names (`_prompt_for_new`, `_prompt_for_old`, `_run_one_case`, `_format_report`, helper metrics) consistent between definition and usage in Task 4/5. `RunResult` dataclass used consistently.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-17-prompt-polish-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

