from __future__ import annotations

import time
from typing import Any, Callable

from .constants import (
    ANSWER_MODE_VOICE_CODE,
    DECISION_ADVANCE,
    DECISION_FINISH,
    DECISION_FOLLOW_UP,
    INTERVIEWER_STYLE_CALM,
    PRACTICE_STATUS_AWAITING_ANSWER,
    PRACTICE_STATUS_DEBRIEFING,
    PRACTICE_STATUS_FINISHED,
)
from .models import PracticePhase, PracticeScoreLedgerEntry, PracticeSession, PracticeTurn

TURN_REVIEW_PROMPT = """你是一位真实技术面试官，要根据候选人的回答，决定下一步是追问、换题推进，还是结束整场面试。

## 面试上下文
- 岗位：{position}
- 语言方向：{language}
- 候选人维度：{audience_label}
- 当前阶段：{phase_label} / {category}
- 当前阶段目标：{focus}
- 当前阶段 follow_up_budget：{follow_up_budget}
- 当前阶段已追问次数：{follow_up_count}

## 当前问题
{question}

## 候选人回答（语音转写）
{transcript}

## 候选人代码 / SQL
{code_text}

## 输出要求
严格输出 JSON：
{{
  "decision": "follow_up" | "advance" | "finish",
  "reason": "...",
  "next_question": "...",
  "next_answer_mode": "voice" | "code" | "voice+code",
  "scorecard": {{
    "technical_depth": 0-10,
    "communication": 0-10,
    "job_fit": 0-10,
    "confidence": 0-10
  }},
  "evidence": ["..."],
  "strengths": ["..."],
  "risks": ["..."]
}}

判定规则：
- 回答过短、缺少关键证据、没回答 why/how/验证时，优先 follow_up；
- 当前阶段目标已覆盖，输出 advance；
- 如果已经是最后阶段且回答基本完成，可输出 finish；
- coding 阶段如果没有 code_text 且题目明显要求写代码/SQL，优先 follow_up。"""


def _current_phase(session: PracticeSession) -> PracticePhase:
    if not session.blueprint or not session.blueprint.phases:
        raise ValueError("当前没有可用的面试蓝图")
    index = max(0, min(session.current_phase_index, len(session.blueprint.phases) - 1))
    return session.blueprint.phases[index]


def _phase_follow_up_count(session: PracticeSession, phase_id: str) -> int:
    return sum(1 for turn in session.turn_history if turn.phase_id == phase_id and turn.follow_up_of)


def _fallback_turn_review(session: PracticeSession, phase: PracticePhase, turn: PracticeTurn) -> dict[str, Any]:
    transcript = turn.transcript.strip()
    code_text = turn.code_text.strip()
    short_answer = len(transcript) < 55 and len(code_text) < 12
    missing_code = phase.answer_mode == ANSWER_MODE_VOICE_CODE and not code_text
    follow_up_count = _phase_follow_up_count(session, phase.phase_id)
    lacks_evidence = not any(token in transcript for token in ["因为", "所以", "验证", "监控", "压测", "复盘", "指标", "取舍"])
    project_needs_probe = phase.phase_id == "project" and lacks_evidence
    design_needs_probe = phase.phase_id == "design" and not any(
        token in transcript for token in ["流程", "链路", "容量", "限流", "降级", "风险", "扩展"]
    )

    if (short_answer or missing_code or project_needs_probe or design_needs_probe) and follow_up_count < phase.follow_up_budget:
        if missing_code:
            next_question = "你刚才主要在口头解释，请把关键 SQL / 伪代码补出来，并说明边界处理。"
            next_mode = ANSWER_MODE_VOICE_CODE
        elif project_needs_probe:
            next_question = "我先追问细一点：你当时为什么这么做，怎么验证结果，复盘后会改哪一处？"
            next_mode = phase.answer_mode
        elif design_needs_probe:
            next_question = "先别铺太大，回到主链路本身：核心流程怎么走，最先要压的风险点是什么？"
            next_mode = phase.answer_mode
        else:
            next_question = "你刚才先给了结论，但我想继续追问一下：具体怎么做、怎么验证、结果如何？"
            next_mode = phase.answer_mode
        return {
            "decision": DECISION_FOLLOW_UP,
            "reason": "回答还不够完整，需要继续追问关键证据。",
            "next_question": next_question,
            "next_answer_mode": next_mode,
            "scorecard": {
                "technical_depth": 5,
                "communication": 6,
                "job_fit": 6,
                "confidence": 6,
            },
            "evidence": ["回答偏概括，需要更多细节、证据或实现。"],
            "strengths": ["能先给出方向"],
            "risks": ["细节、证据或取舍说明不足"],
        }

    last_phase = bool(session.blueprint and session.current_phase_index >= len(session.blueprint.phases) - 1)
    return {
        "decision": DECISION_FINISH if last_phase else DECISION_ADVANCE,
        "reason": "当前阶段已经覆盖核心目标，可以推进到下一段。",
        "next_question": "",
        "next_answer_mode": phase.answer_mode,
        "scorecard": {
            "technical_depth": 7,
            "communication": 7,
            "job_fit": 7,
            "confidence": 7,
        },
        "evidence": ["回答覆盖了当前阶段的大部分目标。"],
        "strengths": ["结构基本清晰"],
        "risks": ["可以继续提升回答密度"],
    }


def _review_current_turn(
    session: PracticeSession,
    phase: PracticePhase,
    turn: PracticeTurn,
    *,
    practice_audience_meta: Callable[[str], tuple[str, str, str]],
    pick_practice_model: Callable[[], Any],
    request_json_completion: Callable[..., dict[str, Any]],
) -> dict[str, Any]:
    audience_label, _, _ = practice_audience_meta(session.context.audience if session.context else "campus_intern")
    prompt = TURN_REVIEW_PROMPT.format(
        position=session.context.position if session.context else "岗位",
        language=session.context.language if session.context else "语言",
        audience_label=audience_label,
        phase_label=phase.label,
        category=phase.category,
        focus=" / ".join(phase.focus),
        follow_up_budget=phase.follow_up_budget,
        follow_up_count=_phase_follow_up_count(session, phase.phase_id),
        question=turn.question,
        transcript=turn.transcript or "（无）",
        code_text=turn.code_text or "（无）",
    )
    try:
        raw = request_json_completion(pick_practice_model(), prompt, max_tokens=1600)
        if not raw:
            raise ValueError("empty turn review")
        return raw
    except Exception:
        return _fallback_turn_review(session, phase, turn)


def _apply_turn_review(
    session: PracticeSession,
    phase: PracticePhase,
    turn: PracticeTurn,
    review: dict[str, Any],
    *,
    make_turn: Callable[..., PracticeTurn],
    normalize_answer_mode: Callable[..., str],
    generate_debrief_report: Callable[[PracticeSession], str],
) -> PracticeSession:
    decision = str(review.get("decision") or DECISION_ADVANCE).strip().lower()
    if decision not in {DECISION_FOLLOW_UP, DECISION_ADVANCE, DECISION_FINISH}:
        decision = DECISION_ADVANCE

    turn.decision = decision
    turn.decision_reason = str(review.get("reason") or "").strip()
    turn.evidence = [str(item) for item in (review.get("evidence") or []) if str(item).strip()]
    turn.strengths = [str(item) for item in (review.get("strengths") or []) if str(item).strip()]
    turn.risks = [str(item) for item in (review.get("risks") or []) if str(item).strip()]
    scorecard = review.get("scorecard") or {}
    if not isinstance(scorecard, dict):
        scorecard = {}
    turn.scorecard = {
        str(key): max(0, min(10, int(value)))
        for key, value in scorecard.items()
        if str(key).strip()
    }
    session.turn_history.append(turn)
    session.hidden_score_ledger.append(
        PracticeScoreLedgerEntry(
            turn_id=turn.turn_id,
            phase_id=turn.phase_id,
            decision=decision,
            scorecard=dict(turn.scorecard),
            evidence=list(turn.evidence),
            strengths=list(turn.strengths),
            risks=list(turn.risks),
            answer_mode=turn.answer_mode,
        )
    )

    follow_up_count = _phase_follow_up_count(session, phase.phase_id)
    if decision == DECISION_FOLLOW_UP and follow_up_count <= phase.follow_up_budget:
        session.current_turn = make_turn(
            phase,
            question=str(review.get("next_question") or phase.question),
            follow_up_of=turn.turn_id,
            answer_mode=normalize_answer_mode(review.get("next_answer_mode"), phase.answer_mode),
            interviewer_style=session.context.interviewer_style if session.context else INTERVIEWER_STYLE_CALM,
        )
        session.status = PRACTICE_STATUS_AWAITING_ANSWER
        return session

    is_last_phase = bool(session.blueprint and session.current_phase_index >= len(session.blueprint.phases) - 1)
    if decision == DECISION_FINISH or is_last_phase:
        session.current_turn = None
        session.status = PRACTICE_STATUS_DEBRIEFING
        session.report_markdown = generate_debrief_report(session)
        session.finished_at = time.time()
        session.status = PRACTICE_STATUS_FINISHED
        return session

    session.current_phase_index += 1
    next_phase = _current_phase(session)
    session.current_turn = make_turn(
        next_phase,
        question=str(review.get("next_question") or next_phase.question).strip(),
        answer_mode=normalize_answer_mode(review.get("next_answer_mode"), next_phase.answer_mode),
        interviewer_style=session.context.interviewer_style if session.context else INTERVIEWER_STYLE_CALM,
    )
    session.status = PRACTICE_STATUS_AWAITING_ANSWER
    return session
