from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api.assist import answer_worker


class _Logger:
    def info(self, *a, **kw): pass
    def warning(self, *a, **kw): pass
    def error(self, *a, **kw): pass


def _cfg(written_exam_mode=False, written_exam_think=False):
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
        written_exam_mode=written_exam_mode,
        written_exam_think=written_exam_think,
        screen_capture_region="left_half",
        kb_enabled=False,
        kb_trigger_modes=[],
    )


def _deps(broadcasts, skipped=None):
    skipped = skipped if skipped is not None else []
    return answer_worker.AnswerWorkerDeps(
        abort_check=lambda: False,
        is_session_current=lambda _v: True,
        flush_commit=lambda _s, fn: fn(),
        mark_seq_skipped=skipped.append,
        submit_knowledge_record=lambda _q, _a, *_rest: True,
        broadcast=broadcasts.append,
        logger=_Logger(),
        error_logger=_Logger(),
    )


@pytest.mark.parametrize("source,expect_override", [
    ("server_screen_0", True),
    ("server_screen_multi", True),
    ("manual_text", None),
    ("asr", None),
    (None, None),
])
def test_think_override_only_for_server_screen(monkeypatch, source, expect_override):
    monkeypatch.setattr(answer_worker, "get_config", lambda: _cfg(
        written_exam_mode=True, written_exam_think=True,
    ))
    monkeypatch.setattr(answer_worker, "build_system_prompt", lambda **_kw: "sys")
    monkeypatch.setattr(answer_worker, "get_token_stats", lambda: {
        "prompt": 0, "completion": 0, "total": 0, "by_model": {},
    })

    captured = {}

    def fake_stream(model_cfg, messages, **kwargs):
        captured["override_think_mode"] = kwargs.get("override_think_mode")
        yield ("text", "答案")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)
    from core.session import reset_session
    reset_session()

    broadcasts = []
    answer_worker.process_question_parallel(
        ("题目", None, True, source, {"origin": source or "test"}),
        seq=0, model_idx=0, sess_v=0, deps=_deps(broadcasts),
    )

    assert captured["override_think_mode"] == expect_override


def test_think_override_disabled_when_written_exam_think_false(monkeypatch):
    monkeypatch.setattr(answer_worker, "get_config", lambda: _cfg(
        written_exam_mode=True, written_exam_think=False,
    ))
    monkeypatch.setattr(answer_worker, "build_system_prompt", lambda **_kw: "sys")
    monkeypatch.setattr(answer_worker, "get_token_stats", lambda: {
        "prompt": 0, "completion": 0, "total": 0, "by_model": {},
    })

    captured = {}

    def fake_stream(model_cfg, messages, **kwargs):
        captured["override_think_mode"] = kwargs.get("override_think_mode")
        yield ("text", "答案")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)
    from core.session import reset_session
    reset_session()

    broadcasts = []
    answer_worker.process_question_parallel(
        ("题目", None, True, "server_screen_0", {"origin": "server_screen"}),
        seq=0, model_idx=0, sess_v=0, deps=_deps(broadcasts),
    )

    assert captured["override_think_mode"] == False


def test_no_think_override_when_not_written_exam(monkeypatch):
    monkeypatch.setattr(answer_worker, "get_config", lambda: _cfg(
        written_exam_mode=False, written_exam_think=True,
    ))
    monkeypatch.setattr(answer_worker, "build_system_prompt", lambda **_kw: "sys")
    monkeypatch.setattr(answer_worker, "get_token_stats", lambda: {
        "prompt": 0, "completion": 0, "total": 0, "by_model": {},
    })

    captured = {}

    def fake_stream(model_cfg, messages, **kwargs):
        captured["override_think_mode"] = kwargs.get("override_think_mode")
        yield ("text", "答案")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)
    from core.session import reset_session
    reset_session()

    broadcasts = []
    answer_worker.process_question_parallel(
        ("题目", None, True, "server_screen_0", {"origin": "server_screen"}),
        seq=0, model_idx=0, sess_v=0, deps=_deps(broadcasts),
    )

    assert captured["override_think_mode"] is None


@pytest.mark.parametrize("meta_value,expect", [
    (True, True),
    (False, False),
])
def test_meta_override_think_mode_beats_written_exam_think(monkeypatch, meta_value, expect):
    monkeypatch.setattr(answer_worker, "get_config", lambda: _cfg(
        written_exam_mode=True, written_exam_think=not meta_value,
    ))
    monkeypatch.setattr(answer_worker, "build_system_prompt", lambda **_kw: "sys")
    monkeypatch.setattr(answer_worker, "get_token_stats", lambda: {
        "prompt": 0, "completion": 0, "total": 0, "by_model": {},
    })

    captured = {}

    def fake_stream(model_cfg, messages, **kwargs):
        captured["override_think_mode"] = kwargs.get("override_think_mode")
        yield ("text", "答案")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)
    from core.session import reset_session
    reset_session()

    broadcasts = []
    answer_worker.process_question_parallel(
        (
            "题目",
            None,
            True,
            "server_screen_0",
            {"origin": "server_screen", "override_think_mode": meta_value},
        ),
        seq=0, model_idx=0, sess_v=0, deps=_deps(broadcasts),
    )

    assert captured["override_think_mode"] is expect


def test_meta_override_think_mode_works_outside_written_exam(monkeypatch):
    monkeypatch.setattr(answer_worker, "get_config", lambda: _cfg(
        written_exam_mode=False, written_exam_think=False,
    ))
    monkeypatch.setattr(answer_worker, "build_system_prompt", lambda **_kw: "sys")
    monkeypatch.setattr(answer_worker, "get_token_stats", lambda: {
        "prompt": 0, "completion": 0, "total": 0, "by_model": {},
    })

    captured = {}

    def fake_stream(model_cfg, messages, **kwargs):
        captured["override_think_mode"] = kwargs.get("override_think_mode")
        yield ("text", "答案")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)
    from core.session import reset_session
    reset_session()

    broadcasts = []
    answer_worker.process_question_parallel(
        (
            "题目",
            None,
            True,
            "manual_text",
            {"origin": "manual", "override_think_mode": True},
        ),
        seq=0, model_idx=0, sess_v=0, deps=_deps(broadcasts),
    )

    assert captured["override_think_mode"] is True


def test_model_idx_out_of_range_reports_error_and_advances_commit_queue(monkeypatch):
    monkeypatch.setattr(answer_worker, "get_config", lambda: _cfg())
    monkeypatch.setattr(answer_worker, "build_system_prompt", lambda **_kw: "sys")
    monkeypatch.setattr(answer_worker, "get_token_stats", lambda: {
        "prompt": 0, "completion": 0, "total": 0, "by_model": {},
    })

    broadcasts = []
    skipped = []

    answer_worker.process_question_parallel(
        ("题目", None, True, "manual_text", {"origin": "manual"}),
        seq=4, model_idx=5, sess_v=0, deps=_deps(broadcasts, skipped),
    )

    assert skipped == [4]
    assert broadcasts == [
        {
            "type": "answer_error",
            "id": broadcasts[0]["id"],
            "stage": "generation",
            "message": "答题模型配置已变更，请重新提交问题。",
        }
    ]
