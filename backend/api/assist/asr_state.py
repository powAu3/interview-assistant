"""ASR merge and question-group state machine for interview assist."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from services.stt import (
    build_asr_question_group_text,
    classify_asr_question_candidate,
    is_viable_asr_question_group,
    join_transcription_fragments,
    transcription_for_publish,
)
from api.assist.scheduler import TaskPayload


@dataclass
class PendingASRGroup:
    source: str
    utterances: list[str] = field(default_factory=list)
    first_mono: float = 0.0
    last_mono: float = 0.0
    has_promote: bool = False


class AssistAsrStateMachine:
    def __init__(
        self,
        *,
        broadcast: Callable[[dict], None],
        submit_answer_task: Callable[[TaskPayload], bool],
        begin_asr_turn: Callable[[], int],
        record_asr_turn: Callable[[float], None],
        is_high_churn_submission: Callable[[Any, float], bool],
        logger,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.broadcast = broadcast
        self.submit_answer_task = submit_answer_task
        self.begin_asr_turn = begin_asr_turn
        self.record_asr_turn = record_asr_turn
        self.is_high_churn_submission = is_high_churn_submission
        self.logger = logger
        self.clock = clock
        self.merge_parts: list[str] = []
        self.merge_mono_first: Optional[float] = None
        self.merge_mono_last: Optional[float] = None
        self.pending_group: Optional[PendingASRGroup] = None

    def reset_merge_buffer(self):
        self.merge_parts = []
        self.merge_mono_first = None
        self.merge_mono_last = None

    def reset_pending_group(self):
        self.pending_group = None

    def flush_question_group_now(self, cfg, session) -> None:
        group = self.pending_group
        if group is None:
            return
        self.pending_group = None
        if not is_viable_asr_question_group(
            group.utterances,
            getattr(cfg, "transcription_min_sig_chars", 2),
        ):
            return
        question_text = build_asr_question_group_text(group.utterances)
        if not question_text:
            return
        now_mono = self.clock()
        high_churn_short = self.is_high_churn_submission(cfg, now_mono)
        turn_id = self.begin_asr_turn()
        self.record_asr_turn(now_mono)
        self.logger.info(
            "ASR_QUESTION turn=%d utterances=%d churn=%s text=%r",
            turn_id, len(group.utterances), high_churn_short,
            question_text[:150],
        )
        self.submit_answer_task(
            (
                question_text,
                None,
                False,
                group.source,
                {
                    "origin": "asr",
                    "asr_turn_id": turn_id,
                    "utterances": list(group.utterances),
                    "high_churn_short_answer": high_churn_short,
                },
            )
        )

    def try_flush_question_group(self, cfg, session, now_mono: float, force: bool = False) -> None:
        group = self.pending_group
        if group is None:
            return
        confirm = _asr_confirm_window_sec(cfg)
        fast_confirm = _asr_fast_confirm_sec(cfg)
        max_wait = _asr_group_max_wait_sec(cfg)
        since_last = now_mono - group.last_mono
        age = now_mono - group.first_mono
        if force or age >= max_wait:
            self.flush_question_group_now(cfg, session)
        elif group.has_promote and len(group.utterances) == 1 and since_last >= fast_confirm:
            self.flush_question_group_now(cfg, session)
        elif group.has_promote and since_last >= confirm:
            self.flush_question_group_now(cfg, session)
        elif not group.has_promote and since_last >= confirm * 2:
            self.flush_question_group_now(cfg, session)

    def handle_auto_detect_asr_text(self, cfg, session, pub: str, source: str, now_mono: float) -> None:
        self.try_flush_question_group(cfg, session, now_mono, False)
        kind, cleaned = classify_asr_question_candidate(
            pub,
            getattr(cfg, "transcription_min_sig_chars", 2),
        )
        if not cleaned:
            return
        if kind == "ignore" and self.pending_group is None:
            return
        if self.pending_group is None:
            self.pending_group = PendingASRGroup(
                source=source,
                utterances=[cleaned],
                first_mono=now_mono,
                last_mono=now_mono,
                has_promote=(kind == "promote"),
            )
        else:
            self.pending_group.utterances.append(cleaned)
            self.pending_group.last_mono = now_mono
            self.pending_group.source = source
            self.pending_group.has_promote = self.pending_group.has_promote or kind == "promote"

    def flush_merge_buffer_now(self, cfg, session) -> None:
        if not self.merge_parts:
            return
        parts = list(self.merge_parts)
        self.merge_parts.clear()
        self.merge_mono_first = None
        self.merge_mono_last = None
        merged_raw = join_transcription_fragments(parts)
        min_sig = getattr(cfg, "transcription_min_sig_chars", 2)
        pub = transcription_for_publish(merged_raw, min_sig)
        if not pub:
            return
        session.add_transcription(pub)
        self.broadcast({"type": "transcription", "text": pub})
        if cfg.auto_detect:
            source = (
                "conversation_loopback"
                if session.capture_is_loopback
                else "conversation_mic"
            )
            self.handle_auto_detect_asr_text(cfg, session, pub, source, self.clock())

    def try_flush_merge_buffer(self, cfg, session, now_mono: float, force: bool = False) -> None:
        if not self.merge_parts:
            return
        gap = float(getattr(cfg, "assist_transcription_merge_gap_sec", 2.0) or 0.0)
        max_wait = float(getattr(cfg, "assist_transcription_merge_max_sec", 12.0) or 12.0)
        if max_wait < 1.0:
            max_wait = 12.0
        if force:
            self.flush_merge_buffer_now(cfg, session)
            return
        if gap <= 0:
            return
        if self.merge_mono_last is None:
            return
        since_last = now_mono - self.merge_mono_last
        burst_age = (now_mono - self.merge_mono_first) if self.merge_mono_first is not None else 0.0
        if since_last >= gap or burst_age >= max_wait:
            self.flush_merge_buffer_now(cfg, session)

    def append_transcription_fragment(
        self,
        cfg,
        session,
        pub: str,
        now_mono: float,
        force_flush_tail: bool = False,
    ) -> None:
        gap = float(getattr(cfg, "assist_transcription_merge_gap_sec", 2.0) or 0.0)
        if gap <= 0:
            session.add_transcription(pub)
            self.broadcast({"type": "transcription", "text": pub})
            if cfg.auto_detect:
                source = (
                    "conversation_loopback"
                    if session.capture_is_loopback
                    else "conversation_mic"
                )
                self.handle_auto_detect_asr_text(cfg, session, pub, source, now_mono)
            return
        if not self.merge_parts:
            self.merge_mono_first = now_mono
        self.merge_parts.append(pub)
        self.merge_mono_last = now_mono
        if force_flush_tail:
            self.flush_merge_buffer_now(cfg, session)
        else:
            self.try_flush_merge_buffer(cfg, session, now_mono, False)


def _asr_confirm_window_sec(cfg) -> float:
    confirm = float(getattr(cfg, "assist_asr_confirm_window_sec", 0.45) or 0.0)
    return max(0.0, min(5.0, confirm))


def _asr_group_max_wait_sec(cfg) -> float:
    max_wait = float(getattr(cfg, "assist_asr_group_max_wait_sec", 1.2) or 0.0)
    return max(0.2, min(8.0, max_wait))


def _asr_fast_confirm_sec(cfg) -> float:
    fast = float(getattr(cfg, "assist_asr_fast_confirm_sec", 0.2) or 0.0)
    return max(0.1, min(2.0, fast))


def asr_interrupt_running(cfg) -> bool:
    return bool(getattr(cfg, "assist_asr_interrupt_running", True))
