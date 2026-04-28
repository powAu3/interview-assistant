from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.session import get_session, reset_session  # noqa: E402
from api.assist import answer_worker  # noqa: E402


class _Logger:
    def info(self, *args, **kwargs):
        pass

    def warning(self, *args, **kwargs):
        pass

    def error(self, *args, **kwargs):
        pass


def _cfg():
    return SimpleNamespace(
        models=[
            SimpleNamespace(
                name="模型一",
                api_key="k",
                model="fake",
                enabled=True,
                supports_vision=False,
            )
        ],
        written_exam_mode=False,
        written_exam_think=False,
        screen_capture_region="left_half",
        kb_enabled=False,
        kb_trigger_modes=[],
    )


def _deps(
    *,
    broadcasts: list[dict],
    skipped: list[int] | None = None,
    knowledge: list[tuple[str, str]] | None = None,
    abort_check=lambda: False,
    flush_commit=None,
):
    skipped = skipped if skipped is not None else []
    knowledge = knowledge if knowledge is not None else []

    def _flush_commit(seq, apply_fn):
        if flush_commit is not None:
            return flush_commit(seq, apply_fn)
        apply_fn()
        return None

    def _submit_knowledge_record(question, answer):
        knowledge.append((question, answer))
        return True

    return answer_worker.AnswerWorkerDeps(
        abort_check=abort_check,
        is_session_current=lambda _version: True,
        flush_commit=_flush_commit,
        mark_seq_skipped=skipped.append,
        submit_knowledge_record=_submit_knowledge_record,
        broadcast=broadcasts.append,
        logger=_Logger(),
        error_logger=_Logger(),
    )


@pytest.fixture(autouse=True)
def reset_worker_state(monkeypatch: pytest.MonkeyPatch):
    reset_session()
    monkeypatch.setattr(answer_worker, "get_config", _cfg)
    monkeypatch.setattr(answer_worker, "build_system_prompt", lambda **_kwargs: "system")
    monkeypatch.setattr(
        answer_worker,
        "get_token_stats",
        lambda: {"prompt": 3, "completion": 5, "total": 8, "by_model": {}},
    )


def test_process_question_parallel_streams_and_commits_answer(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    knowledge: list[tuple[str, str]] = []

    def fake_stream(*_args, **_kwargs):
        yield ("think", "先判断场景")
        yield ("text", "用 AOF 和 RDB 组合。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("Redis 怎么持久化？", None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts, knowledge=knowledge),
    )

    event_types = [event["type"] for event in broadcasts]
    assert event_types == [
        "answer_start",
        "answer_think_chunk",
        "answer_chunk",
        "answer_done",
        "token_update",
    ]
    assert broadcasts[0]["model_name"] == "模型一"
    assert broadcasts[3]["answer"] == "用 AOF 和 RDB 组合。"
    assert broadcasts[3]["think"] == "先判断场景"
    assert knowledge == [("Redis 怎么持久化？", "用 AOF 和 RDB 组合。")]

    session = get_session()
    assert len(session.qa_pairs) == 1
    assert session.qa_pairs[0].question == "Redis 怎么持久化？"
    assert session.qa_pairs[0].answer == "用 AOF 和 RDB 组合。"
    assert session.qa_pairs[0].model_name == "模型一"


def test_process_question_parallel_marks_seq_skipped_when_aborted(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    skipped: list[int] = []
    state = {"aborted": False}

    def fake_stream(*_args, **_kwargs):
        yield ("text", "部分答案")
        state["aborted"] = True
        yield ("text", "不应提交")

    def fail_flush_commit(_seq, _apply_fn):
        raise AssertionError("aborted worker must not enter commit queue")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("Kafka 顺序性？", None, False, "asr", {"origin": "asr", "asr_turn_id": 1}),
        seq=5,
        model_idx=0,
        sess_v=0,
        deps=_deps(
            broadcasts=broadcasts,
            skipped=skipped,
            abort_check=lambda: state["aborted"],
            flush_commit=fail_flush_commit,
        ),
    )

    event_types = [event["type"] for event in broadcasts]
    assert event_types == ["answer_start", "answer_chunk", "answer_cancelled"]
    assert skipped == [5]
    assert get_session().qa_pairs == []
