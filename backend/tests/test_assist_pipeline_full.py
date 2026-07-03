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

    def is_alive(self):
        return False

    def join(self, timeout=None):
        return None

    def run(self):
        self.target(*self.args, **self.kwargs)


class _DeferredTimer(_DeferredThread):
    started: list["_DeferredTimer"] = []

    def __init__(self, interval, function, args=None, kwargs=None):
        super().__init__(function, args=tuple(args or ()), kwargs=kwargs or {}, daemon=True)
        self.interval = interval


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
        assist_asr_interrupt_running=False,
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
    pipeline._reset_asr_merge_buffer()
    pipeline._reset_pending_asr_group()
    pipeline._recent_asr_turn_monos = []
    pipeline._commit_buffer.clear()
    pipeline._skipped_commit_seqs.clear()
    pipeline._next_commit_seq = 0
    pipeline._next_submit_seq = 0
    pipeline._task_session_version = 0
    pipeline._interview_thread = None
    pipeline._candidate_thread = None
    pipeline._stop_event.clear()
    pipeline._pause_event.clear()
    pipeline._candidate_flush_event.clear()
    pipeline._flush_stop_event.clear()
    pipeline._candidate_whisper_preload_inflight.clear()
    _DeferredThread.started = []
    _DeferredTimer.started = []

    cfg = _cfg()
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(pipeline, "get_model_health", lambda _idx: None)
    monkeypatch.setattr(pipeline.threading, "Thread", _DeferredThread)
    monkeypatch.setattr(pipeline.threading, "Timer", _DeferredTimer)
    monkeypatch.setattr(pipeline, "_submit_knowledge_record", lambda _q, _a, *_rest: True)
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


def test_running_asr_worker_is_not_cancelled_by_new_asr_turn_by_default(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)

    def fake_stream(*_args, **_kwargs):
        yield ("text", "旧回答继续提交")

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
    assert event_types == ["answer_start", "answer_chunk", "answer_done", "token_update"]
    assert [qa.answer for qa in get_session().qa_pairs] == ["旧回答继续提交"]
    assert pipeline._next_commit_seq == 1
    assert pipeline._in_flight_tasks == {}


def test_running_asr_worker_can_still_be_cancelled_when_interrupt_enabled(
    monkeypatch: pytest.MonkeyPatch,
):
    cfg = _cfg()
    cfg.assist_asr_interrupt_running = True
    cfg.max_parallel_answers = 1
    broadcasts: list[dict] = []
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
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
    assert pipeline._begin_asr_turn() == 2
    _DeferredThread.started[0].run()

    event_types = [event["type"] for event in broadcasts]
    assert event_types == ["answer_start", "answer_cancelled"]
    assert get_session().qa_pairs == []


def test_running_asr_worker_is_not_cancelled_when_parallel_slots_available(
    monkeypatch: pytest.MonkeyPatch,
):
    cfg = _cfg()
    cfg.assist_asr_interrupt_running = True
    cfg.max_parallel_answers = 2
    broadcasts: list[dict] = []
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)

    def fake_stream(*_args, **_kwargs):
        yield ("text", "旧回答应继续提交")

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
    assert pipeline._begin_asr_turn() == 2
    _DeferredThread.started[0].run()

    event_types = [event["type"] for event in broadcasts]
    assert event_types == ["answer_start", "answer_chunk", "answer_done", "token_update"]
    assert [qa.answer for qa in get_session().qa_pairs] == ["旧回答应继续提交"]


def test_late_asr_constraint_tail_updates_deferred_pending_task(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(pipeline, "broadcast", lambda _data: None)
    now_values = iter([100.0, 100.0])
    monkeypatch.setattr(pipeline.time, "monotonic", lambda: next(now_values))

    task = (
        "rules 和 skills 的区别是什么",
        None,
        False,
        "conversation_loopback",
        {
            "origin": "asr",
            "asr_turn_id": 1,
            "utterances": ["rules 和 skills 的区别是什么"],
            "dispatch_after_mono": 101.2,
            "asr_tail_grace_until_mono": 101.2,
        },
    )

    assert pipeline.submit_answer_task(task)
    assert _DeferredThread.started == []
    assert len(_DeferredTimer.started) == 1

    merged = pipeline._append_late_asr_constraint_tail(
        "不要结合项目",
        "conversation_loopback",
        now_mono=100.6,
    )

    assert merged is True
    assert len(pipeline._pending) == 1
    updated_task = pipeline._pending[0][0]
    assert "rules 和 skills 的区别是什么" in updated_task[0]
    assert "不要结合项目" in updated_task[0]
    assert updated_task[4]["utterances"] == [
        "rules 和 skills 的区别是什么",
        "不要结合项目",
    ]


def test_candidate_whisper_preload_runs_in_background(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    calls = {"load": 0}

    class _FakeWhisper:
        @property
        def is_loaded(self):
            return calls["load"] > 0

        def load_model(self):
            calls["load"] += 1

    def fake_get_stt_engine(**kwargs):
        assert kwargs == {
            "provider": "whisper",
            "model_size": "base",
            "language": "auto",
        }
        return _FakeWhisper()

    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)
    monkeypatch.setattr(pipeline, "get_stt_engine", fake_get_stt_engine)

    pipeline._preload_candidate_whisper_async("whisper", "base", "auto")

    assert len(_DeferredThread.started) == 1
    _DeferredThread.started[0].run()

    assert calls["load"] == 1
    assert broadcasts[-1] == {
        "type": "candidate_asr_status",
        "loaded": True,
        "loading": False,
        "provider": "whisper",
    }


def test_candidate_whisper_preload_failure_only_reports_candidate_status(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)
    monkeypatch.setattr(
        pipeline,
        "get_stt_engine",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("candidate model bad")),
    )

    pipeline._preload_candidate_whisper_async("whisper", "base", "auto")
    _DeferredThread.started[0].run()

    assert broadcasts[-1]["type"] == "candidate_asr_status"
    assert broadcasts[-1]["provider"] == "whisper"
    assert broadcasts[-1]["loaded"] is False
    assert "candidate model bad" in broadcasts[-1]["error"]


def test_startup_preloads_candidate_whisper_when_enabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_stt_provider = "whisper"
    cfg.candidate_whisper_model = "tiny"
    cfg.candidate_whisper_language = "zh"

    calls: list[tuple[str, str, str]] = []

    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)
    monkeypatch.setattr(
        pipeline,
        "_preload_candidate_whisper_async",
        lambda provider, model, language: calls.append((provider, model, language)),
    )

    pipeline.preload_candidate_asr_if_enabled()

    assert broadcasts == [{"type": "candidate_asr_status", "loaded": False, "loading": True, "provider": "whisper"}]
    assert calls == [("whisper", "tiny", "zh")]


def test_startup_candidate_preload_skips_when_disabled(monkeypatch: pytest.MonkeyPatch):
    cfg = _cfg()
    cfg.candidate_asr_enabled = False
    cfg.candidate_stt_provider = "whisper"
    calls: list[tuple[str, str, str]] = []

    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(
        pipeline,
        "_preload_candidate_whisper_async",
        lambda provider, model, language: calls.append((provider, model, language)),
    )

    pipeline.preload_candidate_asr_if_enabled()

    assert calls == []


def test_stop_waits_for_worker_flush_before_review_archive(monkeypatch: pytest.MonkeyPatch):
    session = get_session()
    session.is_recording = True
    archived_counts: list[int] = []

    class JoinAddsQa:
        def is_alive(self):
            return True

        def join(self, timeout=None):
            session.add_qa(
                "最后 flush 出来的问题",
                "最后生成完成的答案",
                qa_id="qa-final",
            )

    pipeline._interview_thread = JoinAddsQa()
    monkeypatch.setattr(pipeline, "broadcast", lambda _data: None)
    monkeypatch.setattr(pipeline.audio_capture, "stop", lambda owner=None: None)
    monkeypatch.setattr(pipeline._candidate_audio_capture, "stop", lambda owner=None: None)
    monkeypatch.setattr(
        pipeline.review_integration,
        "on_assist_stop",
        lambda archived_session: archived_counts.append(len(archived_session.qa_pairs)),
    )

    pipeline.stop_interview_loop()

    assert archived_counts == [1]


def test_candidate_whisper_preload_deduplicates_inflight_model(monkeypatch: pytest.MonkeyPatch):
    class _LoadedWhisper:
        is_loaded = True

        def load_model(self):
            raise AssertionError("already loaded")

    monkeypatch.setattr(pipeline, "get_stt_engine", lambda **_kwargs: _LoadedWhisper())

    pipeline._preload_candidate_whisper_async("whisper", "base", "auto")
    pipeline._preload_candidate_whisper_async("whisper", "base", "auto")

    assert len(_DeferredThread.started) == 1
    assert ("base", "auto") in pipeline._candidate_whisper_preload_inflight
    _DeferredThread.started[0].run()
    assert pipeline._candidate_whisper_preload_inflight == set()


def test_candidate_audio_start_failure_does_not_block_interviewer_chain(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    review_calls: list[dict] = []

    class _MainAudio:
        SAMPLE_RATE = 16000

        def __init__(self):
            self.start_calls = []
            self.stop_calls = []

        def start(self, device_id, owner=None, **kwargs):
            self.start_calls.append((device_id, owner, kwargs))

        def stop(self, owner=None):
            self.stop_calls.append(owner)

    class _BrokenCandidateAudio(_MainAudio):
        def start(self, device_id, owner=None, **kwargs):
            self.start_calls.append((device_id, owner, kwargs))
            raise RuntimeError("mic unavailable")

    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    main_audio = _MainAudio()
    candidate_audio = _BrokenCandidateAudio()
    session = get_session()

    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(pipeline, "audio_capture", main_audio)
    monkeypatch.setattr(pipeline, "_candidate_audio_capture", candidate_audio)
    monkeypatch.setattr(pipeline, "_device_is_loopback", lambda _device_id: True)
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)
    monkeypatch.setattr(
        pipeline.review_integration,
        "on_assist_start",
        lambda **kwargs: review_calls.append(kwargs),
    )

    pipeline.start_nonblocking(10, 11)

    assert session.is_recording is True
    assert main_audio.start_calls == [(10, "assist", {})]
    assert candidate_audio.start_calls == [(11, "assist-candidate", {"mic_compatibility_mode": True})]
    assert len(_DeferredThread.started) == 1
    assert _DeferredThread.started[0].target is pipeline._interview_worker
    assert any(
        event.get("type") == "candidate_asr_status"
        and event.get("provider") == "off"
        and event.get("safe_degraded") is True
        and "mic unavailable" in event.get("error", "")
        for event in broadcasts
    )
    assert review_calls == [
        {
            "interviewer_device_id": 10,
            "candidate_device_id": None,
            "candidate_asr_enabled": True,
        }
    ]
