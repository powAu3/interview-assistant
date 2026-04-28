from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.session import get_session, reset_session  # noqa: E402
from api.assist import answer_worker, pipeline  # noqa: E402


class _DeferredThread:
    started: list["_DeferredThread"] = []

    def __init__(self, target, args=(), kwargs=None, daemon=None, name=None):
        self.target = target
        self.args = args
        self.kwargs = kwargs or {}
        self.daemon = daemon
        self.name = name

    def start(self):
        self.started.append(self)

    def run(self):
        self.target(*self.args, **self.kwargs)


def _cfg():
    models = [
        SimpleNamespace(
            name="模型一",
            api_key="k1",
            model="fake-1",
            enabled=True,
            supports_vision=False,
        ),
        SimpleNamespace(
            name="模型二",
            api_key="k2",
            model="fake-2",
            enabled=True,
            supports_vision=False,
        ),
    ]
    cfg = SimpleNamespace(
        models=models,
        active_model=0,
        max_parallel_answers=2,
        written_exam_mode=False,
        written_exam_think=False,
        screen_capture_region="left_half",
        kb_enabled=False,
        kb_trigger_modes=[],
        assist_asr_interrupt_running=True,
    )
    cfg.get_active_model = lambda: cfg.models[cfg.active_model]
    return cfg


@pytest.fixture(autouse=True)
def reset_pipeline_state(monkeypatch: pytest.MonkeyPatch):
    reset_session()
    pipeline._answer_generation = 0
    pipeline._pending.clear()
    pipeline._in_flight_tasks.clear()
    pipeline._latest_asr_turn_id = 0
    pipeline._pending_asr_group = None
    pipeline._asr_merge_parts = []
    pipeline._asr_merge_mono_first = None
    pipeline._asr_merge_mono_last = None
    pipeline._recent_asr_turn_monos = []
    pipeline._commit_buffer.clear()
    pipeline._skipped_commit_seqs.clear()
    pipeline._next_commit_seq = 0
    pipeline._next_submit_seq = 0
    pipeline._task_session_version = 0
    pipeline._sync_compat_globals_to_asr_state()
    _DeferredThread.started = []

    cfg = _cfg()
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(pipeline, "get_model_health", lambda _idx: None)
    monkeypatch.setattr(pipeline.threading, "Thread", _DeferredThread)
    monkeypatch.setattr(pipeline, "_submit_knowledge_record", lambda _q, _a: True)
    monkeypatch.setattr(answer_worker, "build_system_prompt", lambda **_kwargs: "system")
    monkeypatch.setattr(
        answer_worker,
        "get_token_stats",
        lambda: {"prompt": 1, "completion": 2, "total": 3, "by_model": {}},
    )


def test_submit_answer_task_runs_through_dispatch_worker_and_commit(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)

    def fake_stream(model_cfg, messages, **_kwargs):
        question = messages[-1]["content"]
        yield ("text", f"{model_cfg.name}:{question}")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    accepted = pipeline.submit_answer_task(
        ("Redis 怎么持久化？", None, True, "manual_text", {"origin": "manual"})
    )

    assert accepted is True
    assert len(_DeferredThread.started) == 1

    _DeferredThread.started[0].run()

    event_types = [event["type"] for event in broadcasts]
    assert event_types == ["answer_start", "answer_chunk", "answer_done", "token_update"]
    assert pipeline._pending == []
    assert pipeline._in_flight_tasks == {}
    assert pipeline._next_submit_seq == 1
    assert pipeline._next_commit_seq == 1

    session = get_session()
    assert [qa.question for qa in session.qa_pairs] == ["Redis 怎么持久化？"]
    assert [qa.answer for qa in session.qa_pairs] == ["模型一:Redis 怎么持久化？"]


def test_parallel_answers_commit_in_submit_order_when_workers_finish_out_of_order(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(pipeline, "broadcast", lambda _data: None)

    def fake_stream(model_cfg, messages, **_kwargs):
        question = messages[-1]["content"]
        yield ("text", f"{model_cfg.name}:{question}")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    assert pipeline.submit_answer_task(
        ("第一个问题", None, True, "manual_text", {"origin": "manual"})
    )
    assert pipeline.submit_answer_task(
        ("第二个问题", None, True, "manual_text", {"origin": "manual"})
    )
    assert len(_DeferredThread.started) == 2

    _DeferredThread.started[1].run()
    assert get_session().qa_pairs == []
    assert pipeline._next_commit_seq == 0

    _DeferredThread.started[0].run()

    session = get_session()
    assert [qa.question for qa in session.qa_pairs] == ["第一个问题", "第二个问题"]
    assert [qa.answer for qa in session.qa_pairs] == [
        "模型一:第一个问题",
        "模型二:第二个问题",
    ]
    assert pipeline._next_commit_seq == 2
    assert pipeline._commit_buffer == {}


def test_stale_asr_worker_is_cancelled_after_new_asr_turn(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)

    def fake_stream(*_args, **_kwargs):
        yield ("text", "旧回答不应提交")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    pipeline._latest_asr_turn_id = 1
    assert pipeline.submit_answer_task(
        (
            "旧 ASR 问题",
            None,
            False,
            "conversation_mic",
            {"origin": "asr", "asr_turn_id": 1},
        )
    )
    assert len(_DeferredThread.started) == 1

    assert pipeline._begin_asr_turn() == 2
    _DeferredThread.started[0].run()

    event_types = [event["type"] for event in broadcasts]
    assert event_types == ["answer_start", "answer_cancelled"]
    assert get_session().qa_pairs == []
    assert pipeline._next_commit_seq == 1
    assert pipeline._in_flight_tasks == {}
