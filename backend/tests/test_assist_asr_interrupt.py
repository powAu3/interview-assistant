from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import importlib
import sys

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.session import get_session, reset_session  # noqa: E402
from services.llm import build_system_prompt  # noqa: E402
from services import stt  # noqa: E402

assist_router = importlib.import_module("api.assist.pipeline")


@pytest.fixture(autouse=True)
def reset_assist_globals(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(assist_router, "broadcast", lambda data: None)
    reset_session()
    assist_router._answer_generation = 0
    assist_router._pending.clear()
    if hasattr(assist_router, "_in_flight_tasks"):
        assist_router._in_flight_tasks.clear()
    if hasattr(assist_router, "_latest_asr_turn_id"):
        assist_router._latest_asr_turn_id = 0
    if hasattr(assist_router, "_pending_asr_group"):
        assist_router._pending_asr_group = None
    assist_router._commit_buffer.clear()
    if hasattr(assist_router, "_skipped_commit_seqs"):
        assist_router._skipped_commit_seqs.clear()
    assist_router._next_commit_seq = 0
    assist_router._next_submit_seq = 0
    assist_router._task_session_version = 0


def _cfg(**overrides):
    base = dict(
        auto_detect=True,
        transcription_min_sig_chars=2,
        assist_asr_confirm_window_sec=0.4,
        assist_asr_group_max_wait_sec=1.0,
        assist_asr_interrupt_running=True,
        assist_high_churn_short_answer=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_classify_asr_question_candidate_ignores_backchannel():
    kind, cleaned = stt.classify_asr_question_candidate("嗯你说得对", 2)
    assert kind == "ignore"
    assert cleaned == "你说得对"

    kind, cleaned = stt.classify_asr_question_candidate("对对对", 2)
    assert kind == "ignore"
    assert cleaned == "对对对"


def test_classify_asr_question_candidate_promotes_short_followups():
    kind, cleaned = stt.classify_asr_question_candidate("死锁呢", 2)
    assert kind == "promote"
    assert cleaned == "死锁呢"

    kind, cleaned = stt.classify_asr_question_candidate("举个例子", 2)
    assert kind == "promote"
    assert cleaned == "举个例子"


def test_build_asr_question_group_text_dedupes_and_keeps_followups():
    text = stt.build_asr_question_group_text(
        ["Redis 持久化讲一下", "再说一下 AOF", "再说一下 AOF"]
    )

    assert "Redis 持久化讲一下" in text
    assert "再说一下 AOF" in text
    assert text.count("再说一下 AOF") == 1


def test_auto_detect_group_flush_ignores_backchannel_and_submits_latest_group(
    monkeypatch: pytest.MonkeyPatch,
):
    session = reset_session()
    submitted: list[tuple] = []
    monkeypatch.setattr(assist_router, "submit_answer_task", lambda task: submitted.append(task))

    cfg = _cfg()
    assist_router._handle_auto_detect_asr_text(
        cfg,
        session,
        "Redis 持久化讲一下",
        "conversation_mic",
        0.0,
    )
    assist_router._handle_auto_detect_asr_text(
        cfg,
        session,
        "嗯你说得对",
        "conversation_mic",
        0.2,
    )
    assist_router._try_flush_asr_question_group(cfg, session, 0.45, False)

    assert len(submitted) == 1
    question_text, _, manual_input, source, meta = submitted[0]
    assert "Redis 持久化讲一下" in question_text
    assert manual_input is False
    assert source == "conversation_mic"
    assert meta["origin"] == "asr"


def test_begin_asr_turn_drops_pending_asr_but_keeps_manual():
    assist_router._latest_asr_turn_id = 1
    assist_router._pending[:] = [
        (("旧 ASR", None, False, "conversation_mic", {"origin": "asr", "asr_turn_id": 1}), 0, 0),
        (("手动问题", None, True, "manual_text", {"origin": "manual"}), 1, 0),
    ]

    turn_id = assist_router._begin_asr_turn()

    assert turn_id == 2
    assert assist_router._pending == [
        (("手动问题", None, True, "manual_text", {"origin": "manual"}), 1, 0)
    ]


def test_mark_seq_skipped_unblocks_later_commits():
    committed: list[str] = []

    assist_router._flush_commit(1, lambda: committed.append("seq1"))
    assist_router._mark_seq_skipped(0)

    assert committed == ["seq1"]
    assert assist_router._next_commit_seq == 2


def test_pick_model_index_prefers_non_physical_busy_model_for_asr(
    monkeypatch: pytest.MonkeyPatch,
):
    class FakeCfg:
        def __init__(self):
            self.models = [
                SimpleNamespace(enabled=True, api_key="k0", supports_vision=False),
                SimpleNamespace(enabled=True, api_key="k1", supports_vision=False),
                SimpleNamespace(enabled=True, api_key="k2", supports_vision=False),
            ]
            self.active_model = 2

        def get_active_model(self):
            return self.models[self.active_model]

    monkeypatch.setattr(assist_router, "get_config", lambda: FakeCfg())
    monkeypatch.setattr(assist_router, "get_model_health", lambda index: None)

    task = ("最新问题", None, False, "conversation_mic", {"origin": "asr", "asr_turn_id": 2})
    picked = assist_router.pick_model_index(task, busy=set(), avoid_models={2})

    assert picked == 0


def test_is_high_churn_asr_submission_respects_toggle_and_recent_activity():
    cfg = _cfg(assist_high_churn_short_answer=False)
    assist_router._recent_asr_turn_monos = [8.2]
    assert assist_router._is_high_churn_asr_submission(cfg, 10.0) is False

    cfg = _cfg(assist_high_churn_short_answer=True)
    assist_router._recent_asr_turn_monos = [8.2]
    assert assist_router._is_high_churn_asr_submission(cfg, 10.0) is True

    assist_router._recent_asr_turn_monos = []
    assist_router._in_flight_tasks[1] = (
        2,
        ("旧问题", None, False, "conversation_mic", {"origin": "asr", "asr_turn_id": 1}),
    )
    assert assist_router._is_high_churn_asr_submission(cfg, 10.0) is True


def test_cancel_answer_work_clears_everything_and_optionally_session_history():
    session = reset_session()
    session.add_transcription("旧转写")
    session.add_qa("旧问题", "旧答案")
    assist_router._pending[:] = [
        (("待处理", None, False, "conversation_mic", {"origin": "asr", "asr_turn_id": 1}), 0, 0)
    ]
    assist_router._pending_asr_group = assist_router.PendingASRGroup(
        source="conversation_mic",
        utterances=["候选组"],
        first_mono=0.0,
        last_mono=0.1,
        has_promote=True,
    )
    assist_router._in_flight_tasks[9] = (
        2,
        ("生成中", None, False, "conversation_mic", {"origin": "asr", "asr_turn_id": 1}),
    )
    assist_router._recent_asr_turn_monos = [1.0, 2.0]
    assist_router._answer_generation = 7

    assist_router.cancel_answer_work(reset_session_data=False)
    assert assist_router._pending == []
    assert assist_router._pending_asr_group is None
    assert assist_router._in_flight_tasks == {}
    assert assist_router._recent_asr_turn_monos == []
    assert assist_router._answer_generation == 8
    assert getattr(get_session(), "transcription_history") == ["旧转写"]
    assert len(get_session().qa_pairs) == 1

    assist_router.cancel_answer_work(reset_session_data=True)
    assert get_session().transcription_history == []
    assert get_session().qa_pairs == []


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

    assert "高 churn 模式" not in normal
    assert "高 churn 模式" in short
    assert "80-180" in short
    assert "输入判定三档 ladder" in normal
    assert "输入判定三档 ladder" in short
    assert "追问连贯规则" in short
