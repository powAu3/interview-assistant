from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Optional

from .constants import ANSWER_MODE_VOICE, PRACTICE_STATUS_IDLE


@dataclass
class PracticeContext:
    position: str
    language: str
    audience: str
    audience_label: str
    resume_text: str
    jd_text: str
    interviewer_style: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "position": self.position,
            "language": self.language,
            "audience": self.audience,
            "audience_label": self.audience_label,
            "resume_text": self.resume_text,
            "jd_text": self.jd_text,
            "interviewer_style": self.interviewer_style,
        }


@dataclass
class PracticePhase:
    phase_id: str
    label: str
    category: str
    focus: list[str] = field(default_factory=list)
    follow_up_budget: int = 0
    answer_mode: str = ANSWER_MODE_VOICE
    question: str = ""
    written_prompt: str = ""
    artifact_notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "phase_id": self.phase_id,
            "label": self.label,
            "category": self.category,
            "focus": list(self.focus),
            "follow_up_budget": self.follow_up_budget,
            "answer_mode": self.answer_mode,
            "question": self.question,
            "written_prompt": self.written_prompt,
            "artifact_notes": list(self.artifact_notes),
        }


@dataclass
class PracticeBlueprint:
    opening_script: str = ""
    phases: list[PracticePhase] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "opening_script": self.opening_script,
            "phases": [phase.to_dict() for phase in self.phases],
        }


@dataclass
class PracticeTurn:
    turn_id: str
    phase_id: str
    phase_label: str
    category: str
    answer_mode: str
    question: str
    prompt_script: str
    stage_prompt: str = ""
    interviewer_signal: str = "warm-open"
    transition_line: str = ""
    written_prompt: str = ""
    artifact_notes: list[str] = field(default_factory=list)
    asked_at: float = field(default_factory=time.time)
    follow_up_of: Optional[str] = None
    transcript: str = ""
    code_text: str = ""
    duration_ms: int = 0
    decision: Optional[str] = None
    decision_reason: str = ""
    evidence: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    scorecard: dict[str, int] = field(default_factory=dict)

    def to_dict(self, reveal_feedback: bool = False) -> dict[str, Any]:
        data = {
            "turn_id": self.turn_id,
            "phase_id": self.phase_id,
            "phase_label": self.phase_label,
            "category": self.category,
            "answer_mode": self.answer_mode,
            "question": self.question,
            "prompt_script": self.prompt_script,
            "stage_prompt": self.stage_prompt,
            "interviewer_signal": self.interviewer_signal,
            "transition_line": self.transition_line,
            "written_prompt": self.written_prompt,
            "artifact_notes": list(self.artifact_notes),
            "asked_at": self.asked_at,
            "follow_up_of": self.follow_up_of,
            "transcript": self.transcript,
            "code_text": self.code_text,
            "duration_ms": self.duration_ms,
        }
        if reveal_feedback:
            data.update(
                {
                    "decision": self.decision,
                    "decision_reason": self.decision_reason,
                    "evidence": list(self.evidence),
                    "strengths": list(self.strengths),
                    "risks": list(self.risks),
                    "scorecard": dict(self.scorecard),
                }
            )
        return data


@dataclass
class PracticeScoreLedgerEntry:
    turn_id: str
    phase_id: str
    decision: str
    scorecard: dict[str, int] = field(default_factory=dict)
    evidence: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    answer_mode: str = ANSWER_MODE_VOICE

    def to_dict(self) -> dict[str, Any]:
        return {
            "turn_id": self.turn_id,
            "phase_id": self.phase_id,
            "decision": self.decision,
            "scorecard": dict(self.scorecard),
            "evidence": list(self.evidence),
            "strengths": list(self.strengths),
            "risks": list(self.risks),
            "answer_mode": self.answer_mode,
        }


@dataclass
class PracticeSession:
    status: str = PRACTICE_STATUS_IDLE
    context: Optional[PracticeContext] = None
    blueprint: Optional[PracticeBlueprint] = None
    current_phase_index: int = 0
    current_turn: Optional[PracticeTurn] = None
    turn_history: list[PracticeTurn] = field(default_factory=list)
    hidden_score_ledger: list[PracticeScoreLedgerEntry] = field(default_factory=list)
    interviewer_persona: dict[str, str] = field(default_factory=dict)
    report_markdown: str = ""
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None

    def to_dict(self, reveal_feedback: bool = False) -> dict[str, Any]:
        return {
            "status": self.status,
            "context": self.context.to_dict() if self.context else None,
            "blueprint": self.blueprint.to_dict() if self.blueprint else None,
            "current_phase_index": self.current_phase_index,
            "current_turn": (
                self.current_turn.to_dict(reveal_feedback=reveal_feedback)
                if self.current_turn
                else None
            ),
            "turn_history": [
                turn.to_dict(reveal_feedback=reveal_feedback) for turn in self.turn_history
            ],
            "interviewer_persona": dict(self.interviewer_persona),
            "report_markdown": self.report_markdown if reveal_feedback else "",
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }
