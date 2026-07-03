from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.session import reset_session  # noqa: E402
from api.assist.asr_state import AssistAsrStateMachine  # noqa: E402


class _Logger:
    def info(self, *args, **kwargs):
        pass


def _cfg(**overrides):
    base = dict(
        auto_detect=True,
        transcription_min_sig_chars=2,
        assist_asr_confirm_window_sec=0.4,
        assist_asr_fast_confirm_sec=0.2,
        assist_asr_group_max_wait_sec=1.0,
        assist_transcription_merge_gap_sec=0,
        assist_transcription_merge_max_sec=12.0,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_question_group_flush_submits_asr_task_with_turn_metadata():
    submitted: list[tuple] = []
    recorded: list[float] = []
    turn_ids = iter([7])
    state = AssistAsrStateMachine(
        broadcast=lambda _data: None,
        submit_answer_task=lambda task: submitted.append(task) or True,
        begin_asr_turn=lambda: next(turn_ids),
        record_asr_turn=recorded.append,
        is_high_churn_submission=lambda _cfg, _now: False,
        logger=_Logger(),
        clock=lambda: 10.0,
    )
    session = reset_session()

    state.handle_auto_detect_asr_text(
        _cfg(),
        session,
        "Redis 持久化讲一下",
        "conversation_mic",
        now_mono=0.0,
    )
    state.try_flush_question_group(_cfg(), session, now_mono=0.45)

    assert len(submitted) == 1
    question_text, image, manual_input, source, meta = submitted[0]
    assert "Redis 持久化讲一下" in question_text
    assert image is None
    assert manual_input is False
    assert source == "conversation_mic"
    assert meta["origin"] == "asr"
    assert meta["asr_turn_id"] == 7
    assert meta["utterances"] == ["Redis 持久化讲一下"]
    assert meta["high_churn_short_answer"] is False
    assert recorded == [10.0]
    assert state.pending_group is None


def test_append_transcription_fragment_broadcasts_and_feeds_auto_detect_when_unmerged():
    broadcasts: list[dict] = []
    state = AssistAsrStateMachine(
        broadcast=broadcasts.append,
        submit_answer_task=lambda _task: True,
        begin_asr_turn=lambda: 1,
        record_asr_turn=lambda _now: None,
        is_high_churn_submission=lambda _cfg, _now: False,
        logger=_Logger(),
        clock=lambda: 10.0,
    )
    session = reset_session()
    session.capture_is_loopback = False

    state.append_transcription_fragment(
        _cfg(assist_transcription_merge_gap_sec=0),
        session,
        "Kafka 如何保证顺序",
        now_mono=3.0,
    )

    assert session.transcription_history == ["Kafka 如何保证顺序"]
    assert broadcasts == [{"type": "transcription", "text": "Kafka 如何保证顺序"}]
    assert state.pending_group is not None
    assert state.pending_group.source == "conversation_mic"
    assert state.pending_group.utterances == ["Kafka 如何保证顺序"]


def test_constraint_tail_is_merged_with_previous_question_before_fast_confirm():
    submitted: list[tuple] = []
    state = AssistAsrStateMachine(
        broadcast=lambda _data: None,
        submit_answer_task=lambda task: submitted.append(task) or True,
        begin_asr_turn=lambda: 8,
        record_asr_turn=lambda _now: None,
        is_high_churn_submission=lambda _cfg, _now: False,
        logger=_Logger(),
        clock=lambda: 2.0,
    )
    session = reset_session()
    cfg = SimpleNamespace(
        auto_detect=True,
        transcription_min_sig_chars=2,
        assist_asr_confirm_window_sec=0.4,
        assist_asr_group_max_wait_sec=1.2,
        assist_transcription_merge_gap_sec=0,
        assist_transcription_merge_max_sec=12.0,
    )

    state.handle_auto_detect_asr_text(
        cfg,
        session,
        "rules 和 skills 的区别是什么",
        "conversation_loopback",
        now_mono=0.0,
    )
    state.handle_auto_detect_asr_text(
        cfg,
        session,
        "不要结合项目",
        "conversation_loopback",
        now_mono=0.3,
    )
    state.try_flush_question_group(cfg, session, now_mono=0.9)

    assert len(submitted) == 1
    question_text = submitted[0][0]
    assert "rules 和 skills 的区别是什么" in question_text
    assert "不要结合项目" in question_text


def test_late_constraint_tail_is_merged_before_question_flush():
    submitted: list[tuple] = []
    state = AssistAsrStateMachine(
        broadcast=lambda _data: None,
        submit_answer_task=lambda task: submitted.append(task) or True,
        begin_asr_turn=lambda: len(submitted) + 1,
        record_asr_turn=lambda _now: None,
        is_high_churn_submission=lambda _cfg, _now: False,
        logger=_Logger(),
        clock=lambda: 5.0,
    )
    session = reset_session()
    cfg = _cfg(
        assist_asr_confirm_window_sec=0.4,
        assist_asr_fast_confirm_sec=0.8,
        assist_asr_group_max_wait_sec=3.0,
    )

    state.handle_auto_detect_asr_text(
        cfg,
        session,
        "rules 和 skills 的区别是什么",
        "conversation_loopback",
        now_mono=0.0,
    )
    state.handle_auto_detect_asr_text(
        cfg,
        session,
        "不要结合项目",
        "conversation_loopback",
        now_mono=0.95,
    )
    assert submitted == []

    state.handle_auto_detect_asr_text(
        cfg,
        session,
        "pipeline 里怎么做 retry 和 timeout",
        "conversation_loopback",
        now_mono=1.6,
    )

    assert len(submitted) == 1
    question_text = submitted[0][0]
    assert "rules 和 skills 的区别是什么" in question_text
    assert "不要结合项目" in question_text
    assert state.pending_group is not None
    assert state.pending_group.utterances == ["pipeline 里怎么做 retry 和 timeout"]
