from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys
from typing import Any

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
        assist_realtime_max_tokens=720,
        assist_realtime_high_churn_max_tokens=320,
    )


def _deps(
    *,
    broadcasts: list[dict],
    skipped: list[int] | None = None,
    knowledge: list[tuple[str, str, str, str]] | None = None,
    abort_check=lambda: False,
    flush_commit=None,
    mark_seq_skipped=None,
):
    skipped = skipped if skipped is not None else []
    knowledge = knowledge if knowledge is not None else []

    def _flush_commit(seq, apply_fn):
        if flush_commit is not None:
            return flush_commit(seq, apply_fn)
        apply_fn()
        return None

    def _submit_knowledge_record(question, answer, qa_id="", candidate_answer=""):
        knowledge.append((question, answer, qa_id, candidate_answer))
        return True

    return answer_worker.AnswerWorkerDeps(
        abort_check=abort_check,
        is_session_current=lambda _version: True,
        flush_commit=_flush_commit,
        mark_seq_skipped=mark_seq_skipped if mark_seq_skipped is not None else skipped.append,
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
    knowledge: list[tuple[str, str, str, str]] = []

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
    assert knowledge == [("Redis 怎么持久化？", "用 AOF 和 RDB 组合。", broadcasts[0]["id"], "")]

    session = get_session()
    assert len(session.qa_pairs) == 1
    assert session.qa_pairs[0].question == "Redis 怎么持久化？"
    assert session.qa_pairs[0].answer == "用 AOF 和 RDB 组合。"
    assert session.qa_pairs[0].model_name == "模型一"


def test_process_question_parallel_submits_candidate_answer_to_knowledge(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    knowledge: list[tuple[str, str, str, str]] = []
    seen_qa_id: dict[str, str] = {}

    def fake_stream(*_args, **_kwargs):
        yield ("text", "助手参考答案：缓存项目。")

    def flush_commit(_seq, apply_fn):
        answer_start = next(event for event in broadcasts if event["type"] == "answer_start")
        seen_qa_id["id"] = answer_start["id"]
        get_session().add_candidate_transcription(
            "我实际讲的是风控规则引擎。",
            qa_id=answer_start["id"],
            provider="whisper",
        )
        apply_fn()

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("讲讲你做过的项目", None, False, "asr", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts, knowledge=knowledge, flush_commit=flush_commit),
    )

    assert knowledge == [
        (
            "讲讲你做过的项目",
            "助手参考答案：缓存项目。",
            seen_qa_id["id"],
            "我实际讲的是风控规则引擎。",
        )
    ]


def test_process_question_parallel_binds_candidate_window_for_manual_review_recording(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_context_enabled = False
    cfg.review_enabled = False
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(*_args, **_kwargs):
        yield ("text", "助手参考答案。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("讲讲你做过的项目", None, False, "asr", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    answer_start = next(event for event in broadcasts if event["type"] == "answer_start")
    assert get_session().current_candidate_qa_id == answer_start["id"]


def test_process_question_parallel_logs_token_delta_and_uses_realtime_token_cap(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    info_calls: list[tuple[tuple, dict]] = []
    captured: dict[str, object] = {}

    class CaptureLogger(_Logger):
        def info(self, *args, **kwargs):
            info_calls.append((args, kwargs))

    def fake_stream(*_args, **kwargs):
        captured["override_max_tokens"] = kwargs.get("override_max_tokens")
        kwargs["usage_callback"](123, 45, "模型一")
        yield ("text", "回答")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    deps = _deps(broadcasts=broadcasts)
    deps = answer_worker.AnswerWorkerDeps(
        abort_check=deps.abort_check,
        is_session_current=deps.is_session_current,
        flush_commit=deps.flush_commit,
        mark_seq_skipped=deps.mark_seq_skipped,
        submit_knowledge_record=deps.submit_knowledge_record,
        broadcast=deps.broadcast,
        logger=CaptureLogger(),
        error_logger=deps.error_logger,
    )

    answer_worker.process_question_parallel(
        ("Redis 怎么持久化？", None, False, "conversation_mic", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=deps,
    )

    assert captured["override_max_tokens"] == 720
    done_call = next(args for args, _kwargs in info_calls if "ANSWER_DONE" in args[0])
    assert "tokens_prompt_delta" in done_call[0]
    assert 123 in done_call
    assert 45 in done_call


def test_process_question_parallel_uses_global_max_tokens_for_manual_text(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}

    def fake_stream(*_args, **kwargs):
        captured["override_max_tokens"] = kwargs.get("override_max_tokens")
        yield ("text", "回答")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("Redis 怎么持久化？", None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["override_max_tokens"] == 4096


def test_process_question_parallel_uses_high_churn_token_cap(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}

    def fake_stream(*_args, **kwargs):
        captured["override_max_tokens"] = kwargs.get("override_max_tokens")
        yield ("text", "回答")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "那这个怎么验证？",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 2, "high_churn_short_answer": True},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["override_max_tokens"] == 320


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
    assert event_types == ["answer_start", "answer_cancelled"]
    assert skipped == [5]
    assert get_session().qa_pairs == []


def test_process_question_parallel_sanitizes_streamed_answer_chunks(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []

    def fake_stream(*_args, **_kwargs):
        yield ("text", "<thi")
        yield ("text", "nk>草稿</think># 回答\n**用 AOF**")
        yield ("text", " 和 RDB。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("Redis 怎么持久化？", None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    streamed = "".join(
        event["chunk"] for event in broadcasts if event["type"] == "answer_chunk"
    )
    assert "<think>" not in streamed
    assert "草稿" not in streamed
    assert "#" not in streamed
    assert "回答" not in streamed
    assert "**" not in streamed
    assert "用 AOF 和 RDB。" in streamed

    done = next(event for event in broadcasts if event["type"] == "answer_done")
    assert done["answer"] == "用 AOF 和 RDB。"


def test_followup_prompt_uses_candidate_spoken_answer_as_auxiliary_context(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, str] = {}
    session = get_session()
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：我做了通用缓存项目，QPS 提升 20%。",
        qa_id="qa-prev",
        source="asr",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "我实际讲的是风控规则引擎，核心是灰度发布和回滚，误杀率下降了三成。",
        qa_id="qa-prev",
        provider="whisper",
    )
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_context_enabled = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["user"] = messages[-1]["content"]
        yield ("text", "围绕当前追问回答。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("那你刚才说的这个怎么验证？", None, False, "asr", {"origin": "asr", "asr_turn_id": 2}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    prompt = seen["user"]
    assert "候选人麦克风转写（辅助参考，可能有识别误差）" in prompt
    assert "以当前面试官追问和会议音频识别出的题意为主" in prompt
    assert "不要当作逐字稿" in prompt
    assert "风控规则引擎" in prompt
    assert "误杀率下降了三成" in prompt
    assert "助手上一轮建议答案（参考候选人可能听到过的答题方向" in prompt
    assert "通用缓存项目" in prompt


def test_self_contained_concept_followup_disables_resume_context(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    session = get_session()
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：我做了通用缓存项目，QPS 提升 20%。",
        qa_id="qa-prev",
        source="conversation_loopback",
        model_name="模型一",
    )
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "classify_followup", lambda *_args, **_kwargs: True)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "只讲概念。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "另外我单独问一个概念题，rules 和 skills 的区别是什么？不要结合项目，就讲核心区别。",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is False


def test_resume_question_keeps_resume_context_enabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "讲项目。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("讲讲你在项目里怎么做权限模型的？", None, False, "conversation_loopback", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is True


def test_chinese_project_context_keeps_resume_context_enabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "结合项目中权限模型回答。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("讲讲项目中你是怎么拆分权限边界的？", None, False, "conversation_loopback", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is True


def test_chinese_self_intro_keeps_resume_context_enabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "结合简历做自我介绍。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("先简单介绍一下自己。", None, False, "conversation_loopback", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is True


def test_chinese_background_experience_keeps_resume_context_enabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "结合过往经历回答。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("可以讲一下你的过往经历吗？", None, False, "conversation_loopback", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is True


def test_generic_experience_verb_does_not_force_resume_context(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "按网络流程回答。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("一个 HTTP 请求通常会经历哪些过程？", None, False, "conversation_loopback", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is False


def test_generic_project_noun_does_not_force_resume_context(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "按依赖管理最佳实践回答。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("Python 项目通常怎么做依赖管理？", None, False, "conversation_loopback", {"origin": "asr", "asr_turn_id": 1}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is False


@pytest.mark.parametrize(
    "question",
    [
        "rules 和 skills 的区别是什么？不要结合项目，就讲核心区别。",
        "rules 和 skills 的区别是什么？不用结合项目，就讲核心区别。",
        "rules 和 skills 的区别是什么？别参考项目，只讲核心概念。",
        "rules 和 skills 的区别是什么？不用看简历，直接讲概念。",
        "rules 和 skills 的区别是什么？不用参考我的项目，只讲核心概念。",
        "rules 和 skills 的区别是什么？不用看你的简历，直接讲概念。",
        "rules 和 skills 的区别是什么？这个问题跟我的项目没关系。",
        "rules 和 skills 的区别是什么？这个问题与简历没有关系。",
    ],
)
def test_manual_question_negating_project_context_disables_resume(
    monkeypatch: pytest.MonkeyPatch,
    question: str,
):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "只讲概念。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            question,
            None,
            True,
            "manual_text",
            {},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is False


def test_realtime_resume_negation_overrides_project_context_cue(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "项目A: 多租户权限系统。"
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "只讲核心概念。")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "先别结合你刚才的项目了，讲一下 RBAC 和 ABAC 的核心区别。",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 1},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is False


def test_english_resume_question_keeps_resume_context_enabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "Project A: RBAC platform with audit logs."
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "Use the RBAC project.")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "Can you explain how you designed RBAC in your previous project?",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 1},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is True


def test_english_self_intro_keeps_resume_context_enabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "Project A: RBAC platform with audit logs."
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "Use the resume for a concise introduction.")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "Tell me about yourself.",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 1},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is True


def test_english_project_negation_disables_resume_context(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    cfg = _cfg()
    cfg.resume_text = "Project A: RBAC platform with audit logs."
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "Only the concept.")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "Explain RBAC vs ABAC. Do not relate it to my project; just the core concept.",
            None,
            True,
            "manual_text",
            {},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is False


def test_english_short_followup_inherits_previous_resume_context(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured: dict[str, object] = {}
    session = get_session()
    session.add_qa(
        "Tell me about your project experience with RBAC.",
        "I built an RBAC platform with audit logs.",
        qa_id="qa-prev",
        source="conversation_loopback",
        model_name="模型一",
    )
    cfg = _cfg()
    cfg.resume_text = "Project A: RBAC platform with audit logs."
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["include_resume"] = kwargs.get("include_resume")
        return "system"

    def fake_stream(_model_cfg, messages, **_kwargs):
        captured["user"] = messages[-1]["content"]
        yield ("text", "Validate with audit-log tests.")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "How did you validate it?",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["include_resume"] is True
    assert "[追问上下文]" in str(captured["user"])
    assert "Tell me about your project experience with RBAC." in str(captured["user"])


def test_realtime_asr_source_uses_candidate_context_and_opens_next_window(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, str] = {}
    session = get_session()
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：缓存项目。",
        qa_id="qa-prev",
        source="conversation_loopback",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "我实际讲的是风控规则引擎。",
        qa_id="qa-prev",
        provider="whisper",
    )
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_context_enabled = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "classify_followup", lambda *_args, **_kwargs: True)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["user"] = messages[-1]["content"]
        yield ("text", "继续追问。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "那这个怎么验证？",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert "候选人麦克风转写（辅助参考，可能有识别误差）" in seen["user"]
    assert "以当前面试官追问和会议音频识别出的题意为主" in seen["user"]
    assert "风控规则引擎" in seen["user"]
    answer_start = next(event for event in broadcasts if event["type"] == "answer_start")
    assert session.current_candidate_qa_id == answer_start["id"]


def test_candidate_context_waits_for_final_when_partial_already_exists(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, str] = {}
    waited: list[tuple[str, int]] = []
    session = get_session()
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：缓存项目。",
        qa_id="qa-prev",
        source="conversation_loopback",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "我实际讲的是风控",
        qa_id="qa-prev",
        provider="whisper",
        segment_id="cand-1",
        is_final=False,
    )
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_context_enabled = True
    cfg.candidate_context_wait_ms = 250
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "classify_followup", lambda *_args, **_kwargs: True)

    def fake_wait(_session, qa_id, wait_ms):
        waited.append((qa_id, wait_ms))
        _session.add_candidate_transcription(
            "我实际讲的是风控规则引擎，核心是灰度发布和回滚。",
            qa_id=qa_id,
            provider="whisper",
            segment_id="cand-1",
            is_final=True,
        )

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["user"] = messages[-1]["content"]
        yield ("text", "继续追问。")

    monkeypatch.setattr(answer_worker, "_wait_for_candidate_context_if_pending", fake_wait)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "那这个怎么验证？",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert waited == [("qa-prev", 250)]
    assert "风控规则引擎" in seen["user"]
    assert "我实际讲的是风控\n" not in seen["user"]


def test_followup_prompt_uses_anchor_only_when_question_is_self_contained(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, Any] = {}
    session = get_session()
    session.add_user_message("上一轮用户问题")
    session.add_assistant_message("上一轮助手答案")
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：我做了通用缓存项目，QPS 提升 20%。",
        qa_id="qa-prev",
        source="conversation_loopback",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "我实际讲的是风控规则引擎，核心是灰度发布和回滚，误杀率下降了三成。",
        qa_id="qa-prev",
        provider="whisper",
    )
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_context_enabled = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "classify_followup", lambda *_args, **_kwargs: True)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["messages"] = messages
        seen["user"] = messages[-1]["content"]
        yield ("text", "围绕当前完整追问回答。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "你刚才说到权限是动态获取的，那 token 过期以后怎么续期和重试？",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    prompt = seen["user"]
    assert "只把上一轮当作主题锚点" in prompt
    assert "助手上一轮建议答案" not in prompt
    assert "候选人麦克风转写（辅助参考" not in prompt
    assert "风控规则引擎" not in prompt
    assert seen["messages"] == [{"role": "user", "content": prompt}]


def test_followup_prompt_uses_inline_context_without_repeating_base_history(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, Any] = {}
    session = get_session()
    session.add_user_message("更早之前的问题")
    session.add_assistant_message("更早之前的答案")
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：缓存项目。",
        qa_id="qa-prev",
        source="conversation_loopback",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "我实际讲的是风控规则引擎。",
        qa_id="qa-prev",
        provider="whisper",
    )
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_context_enabled = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "classify_followup", lambda *_args, **_kwargs: True)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["messages"] = messages
        seen["user"] = messages[-1]["content"]
        yield ("text", "继续追问。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "那这个怎么验证？",
            None,
            False,
            "conversation_loopback",
            {"origin": "asr", "asr_turn_id": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert "候选人麦克风转写（辅助参考，可能有识别误差）" in seen["user"]
    assert seen["messages"] == [{"role": "user", "content": seen["user"]}]


def test_non_followup_prompt_can_include_candidate_spoken_background(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, str] = {}
    session = get_session()
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：我做了通用缓存项目。",
        qa_id="qa-prev",
        source="asr",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "我实际讲的是风控规则引擎，里面用了灰度发布和规则回滚。",
        qa_id="qa-prev",
        provider="whisper",
    )
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_context_enabled = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "classify_followup", lambda *_args, **_kwargs: False)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["user"] = messages[-1]["content"]
        yield ("text", "普通问题回答。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("风控规则冲突怎么处理？", None, False, "asr", {"origin": "asr", "asr_turn_id": 2}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    prompt = seen["user"]
    assert "[候选人回答辅助背景]" in prompt
    assert "候选人上一轮麦克风转写（可能有识别误差）" in prompt
    assert "风控规则引擎" in prompt
    assert "以当前面试官问题为主" in prompt
    assert "不要把转写当成逐字事实" in prompt
    assert "现在面试官问题：风控规则冲突怎么处理？" in prompt


def test_non_followup_prompt_skips_unrelated_candidate_spoken_background(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, str] = {}
    session = get_session()
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：我做了通用缓存项目。",
        qa_id="qa-prev",
        source="asr",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "我实际讲的是风控规则引擎，里面用了灰度发布和规则回滚。",
        qa_id="qa-prev",
        provider="whisper",
    )
    cfg = _cfg()
    cfg.candidate_asr_enabled = True
    cfg.candidate_context_enabled = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)
    monkeypatch.setattr(answer_worker, "classify_followup", lambda *_args, **_kwargs: False)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["user"] = messages[-1]["content"]
        yield ("text", "普通问题回答。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("MySQL 索引为什么用 B+ 树？", None, False, "asr", {"origin": "asr", "asr_turn_id": 2}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    prompt = seen["user"]
    assert prompt == "MySQL 索引为什么用 B+ 树？"
    assert "[候选人回答辅助背景]" not in prompt
    assert "风控规则引擎" not in prompt


def test_followup_prompt_uses_legacy_context_when_candidate_context_disabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, str] = {}
    session = get_session()
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：缓存项目。",
        qa_id="qa-prev",
        source="asr",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "真实口述：风控规则引擎。",
        qa_id="qa-prev",
        provider="whisper",
    )

    cfg = _cfg()
    cfg.candidate_context_enabled = False
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["user"] = messages[-1]["content"]
        yield ("text", "旧逻辑回答。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("那刚才这个怎么验证？", None, False, "asr", {"origin": "asr", "asr_turn_id": 2}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    prompt = seen["user"]
    assert "你上次回答的要点：助手建议答案：缓存项目。" in prompt
    assert "候选人麦克风转写" not in prompt
    assert "风控规则引擎" not in prompt
    assert session.current_candidate_qa_id == ""


def test_short_followup_keeps_tail_of_long_previous_answer(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, str] = {}
    session = get_session()
    long_answer = (
        "开头结论：先用 Redis 缓存热点配置。"
        + "中间展开：按业务域拆分权限、缓存键和降级策略。" * 18
        + "最终验证：用 trace_id 串联灰度命中、回滚开关和误杀率看板。"
    )
    session.add_qa(
        "讲讲你做过的风控项目",
        long_answer,
        qa_id="qa-prev",
        source="asr",
        model_name="模型一",
    )

    cfg = _cfg()
    cfg.candidate_context_enabled = False
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["user"] = messages[-1]["content"]
        yield ("text", "验证回答。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("那这个怎么验证？", None, False, "asr", {"origin": "asr", "asr_turn_id": 2}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    prompt = seen["user"]
    assert "你上次回答的要点：开头结论" in prompt
    assert "最终验证：用 trace_id 串联灰度命中、回滚开关和误杀率看板" in prompt
    assert len(prompt) < len(long_answer) + 160


def test_followup_prompt_uses_legacy_context_when_candidate_asr_disabled(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    seen: dict[str, str] = {}
    session = get_session()
    session.add_qa(
        "讲讲你做过的项目",
        "助手建议答案：缓存项目。",
        qa_id="qa-prev",
        source="asr",
        model_name="模型一",
    )
    session.add_candidate_transcription(
        "真实口述：风控规则引擎。",
        qa_id="qa-prev",
        provider="whisper",
    )

    cfg = _cfg()
    cfg.candidate_asr_enabled = False
    cfg.candidate_context_enabled = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **_kwargs):
        seen["user"] = messages[-1]["content"]
        yield ("text", "旧逻辑回答。")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("那刚才这个怎么验证？", None, False, "asr", {"origin": "asr", "asr_turn_id": 2}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    prompt = seen["user"]
    assert "你上次回答的要点：助手建议答案：缓存项目。" in prompt
    assert "候选人麦克风转写" not in prompt
    assert "风控规则引擎" not in prompt


def test_process_question_parallel_flushes_clean_tail_before_error(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []

    def fake_stream(*_args, **_kwargs):
        yield ("text", "用 AOF")
        raise RuntimeError("boom")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("Redis 怎么持久化？", None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    chunks = [event["chunk"] for event in broadcasts if event["type"] == "answer_chunk"]
    assert chunks[0] == "用 AOF"
    assert len(chunks) == 1
    error = next(event for event in broadcasts if event["type"] == "answer_error")
    assert error["stage"] == "generation"
    assert error["message"] == "生成答案失败，请稍后重试。"
    assert not any(event["type"] == "answer_done" for event in broadcasts)
    assert get_session().qa_pairs == []


def test_process_question_parallel_flushes_batched_chunks_before_error(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []

    class PassthroughSanitizer:
        def push(self, chunk: str) -> str:
            return chunk

        def finish(self) -> str:
            return ""

    def fake_stream(*_args, **_kwargs):
        yield ("text", "chunk-1")
        yield ("text", "chunk-2")
        raise RuntimeError("boom")

    monkeypatch.setattr(answer_worker, "create_answer_stream_sanitizer", lambda _mode: PassthroughSanitizer())
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("Redis 怎么持久化？", None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    chunks = [event["chunk"] for event in broadcasts if event["type"] == "answer_chunk"]
    assert chunks[0] == "chunk-1chunk-2"
    assert len(chunks) == 1
    error = next(event for event in broadcasts if event["type"] == "answer_error")
    assert error["stage"] == "generation"
    assert error["message"] == "生成答案失败，请稍后重试。"
    assert not any(event["type"] == "answer_done" for event in broadcasts)
    assert get_session().qa_pairs == []


def test_process_question_parallel_exposes_typed_llm_error_without_persisting_it(
    monkeypatch: pytest.MonkeyPatch,
):
    from services.llm import LLMTimeout

    broadcasts: list[dict] = []

    def fake_stream(*_args, **_kwargs):
        yield ("text", "已生成的部分")
        raise LLMTimeout("provider timeout")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("超时的问题？", None, True, "manual_text", {"origin": "manual"}),
        seq=3,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    error = next(event for event in broadcasts if event["type"] == "answer_error")
    assert error["stage"] == "generation"
    assert error["message"] == "大模型响应超时（请检查网络或更换模型）。"
    assert "provider timeout" not in error["message"]
    assert not any(event["type"] == "answer_done" for event in broadcasts)
    assert get_session().qa_pairs == []


def test_process_question_parallel_broadcasts_answer_error_when_commit_fails(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []

    def fake_stream(*_args, **_kwargs):
        yield ("text", "正常答案")

    def _raise_db_down(_m):
        raise RuntimeError("db down")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)
    _sess = get_session()
    monkeypatch.setattr(_sess, "add_user_message", _raise_db_down)

    answer_worker.process_question_parallel(
        ("保存失败的问题？", None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    event_types = [event["type"] for event in broadcasts]
    assert "answer_error" in event_types
    err_event = next(e for e in broadcasts if e["type"] == "answer_error")
    assert err_event["id"] is not None
    assert err_event["stage"] == "persistence"
    assert "保存失败" in err_event["message"]
    assert get_session().qa_pairs == []
    assert get_session().conversation_history == []


def test_process_question_parallel_no_deadlock_when_commit_fails_under_lock(
    monkeypatch: pytest.MonkeyPatch,
):
    import threading

    broadcasts: list[dict] = []
    commit_lock = threading.Lock()
    deadlock_detected = threading.Event()

    def fake_stream(*_args, **_kwargs):
        yield ("text", "正常答案")

    def _raise_db_down(_m):
        raise RuntimeError("db down")

    def _flush_commit_simulating_production(seq, apply_fn):
        with commit_lock:
            apply_fn()

    def _mark_seq_skipped_simulating_production(seq):
        try:
            acquired = commit_lock.acquire(timeout=2)
            if not acquired:
                deadlock_detected.set()
                return
            commit_lock.release()
        except Exception:
            deadlock_detected.set()

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)
    _sess = get_session()
    monkeypatch.setattr(_sess, "add_user_message", _raise_db_down)

    answer_worker.process_question_parallel(
        ("死锁测试？", None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(
            broadcasts=broadcasts,
            flush_commit=_flush_commit_simulating_production,
            mark_seq_skipped=_mark_seq_skipped_simulating_production,
        ),
    )

    assert not deadlock_detected.is_set(), "Deadlock detected: mark_seq_skipped tried to re-acquire commit_lock"
    assert "answer_error" in [e["type"] for e in broadcasts]


def test_process_question_parallel_sends_multiple_images_to_vision_model(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    captured = {}

    def fake_stream(_model_cfg, messages, **_kwargs):
        captured["content"] = messages[-1]["content"]
        yield ("text", "多图答案")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "多图题面",
            ["data:image/png;base64,a", "data:image/png;base64,b"],
            True,
            "server_screen_multi",
            {"origin": "server_screen", "image_count": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    content = captured["content"]
    assert content[0] == {"type": "text", "text": "多图题面"}
    assert [part["image_url"]["url"] for part in content[1:]] == [
        "data:image/png;base64,a",
        "data:image/png;base64,b",
    ]
    done = next(event for event in broadcasts if event["type"] == "answer_done")
    assert "多图 x2" in done["question"]
    assert "image_url" not in str(get_session().conversation_history)
    assert get_session().conversation_history[0]["content"] == "多图题面 [图片已省略 x2]"


def test_process_question_parallel_passes_all_images_to_self_verify(
    monkeypatch: pytest.MonkeyPatch,
):
    broadcasts: list[dict] = []
    scheduled: list[dict] = []

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "多图答案")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    import services.vision_verify as vision_verify

    monkeypatch.setattr(
        vision_verify,
        "schedule_self_verify",
        lambda **kwargs: scheduled.append(kwargs),
    )

    answer_worker.process_question_parallel(
        (
            "多图题面",
            ["data:image/png;base64,a", "data:image/png;base64,b"],
            True,
            "server_screen_multi",
            {"origin": "server_screen", "image_count": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert len(scheduled) == 1
    assert scheduled[0]["image_data_url"] == [
        "data:image/png;base64,a",
        "data:image/png;base64,b",
    ]


def test_written_exam_request_does_not_include_history(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured = {}
    session = get_session()
    session.add_user_message("上一道笔试题")
    session.add_assistant_message("上一题答案")
    cfg = _cfg()
    cfg.written_exam_mode = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **_kwargs):
        captured["messages"] = messages
        captured["override_think_mode"] = _kwargs.get("override_think_mode")
        yield ("text", "当前题答案")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "当前笔试题",
            ["data:image/png;base64,current"],
            True,
            "server_screen_left",
            {"origin": "server_screen", "image_count": 1},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert len(captured["messages"]) == 1
    assert captured["messages"][0]["role"] == "user"
    assert captured["messages"][0]["content"][0] == {"type": "text", "text": "当前笔试题"}
    assert captured["messages"][0]["content"][1]["image_url"]["url"] == "data:image/png;base64,current"
    assert "上一道笔试题" not in str(captured["messages"])


def test_written_exam_screenshot_injects_recent_qa_as_revision_context(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured = {}
    session = get_session()
    session.add_user_message("普通历史不应进入")
    session.add_assistant_message("普通历史答案不应进入")
    session.add_qa(
        "代码题：输出最短路径 [图片已省略 x1]",
        "```python\ndef solve():\n    print(0)\n```",
        source="server_screen_left",
        model_name="模型一",
    )
    cfg = _cfg()
    cfg.written_exam_mode = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **_kwargs):
        captured["messages"] = messages
        yield ("text", "```python\ndef solve():\n    print(1)\n```")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "截图显示用例没过：expected=1 actual=0",
            ["data:image/png;base64,failcase"],
            True,
            "server_screen_multi",
            {"origin": "server_screen", "image_count": 1},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    content = captured["messages"][0]["content"]
    text = content[0]["text"]
    assert len(captured["messages"]) == 1
    assert "[笔试连续截图上下文]" in text
    assert "当前截图优先级最高" in text
    assert "失败用例" in text
    assert "修正后的完整可提交代码" in text
    assert "代码题：输出最短路径" in text
    assert "print(0)" in text
    assert "expected=1 actual=0" in text
    assert "普通历史不应进入" not in text
    assert content[1]["image_url"]["url"] == "data:image/png;base64,failcase"


def test_written_exam_screenshot_schedules_self_verify_with_all_images(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    scheduled: list[dict] = []
    cfg = _cfg()
    cfg.written_exam_mode = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, _messages, **_kwargs):
        yield ("text", "```python\ndef solve():\n    print('ok')\n```")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    import services.vision_verify as vision_verify

    monkeypatch.setattr(
        vision_verify,
        "schedule_self_verify",
        lambda **kwargs: scheduled.append(kwargs),
    )

    answer_worker.process_question_parallel(
        (
            "两张笔试截图题面",
            ["data:image/png;base64,first", "data:image/png;base64,second"],
            True,
            "server_screen_multi",
            {"origin": "server_screen", "image_count": 2},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert len(scheduled) == 1
    assert scheduled[0]["image_data_url"] == [
        "data:image/png;base64,first",
        "data:image/png;base64,second",
    ]
    assert scheduled[0]["answer"].startswith("```python")


def test_written_exam_revision_context_compacts_previous_screen_prompt(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured = {}
    session = get_session()
    previous_prompt = answer_worker.prompt_server_screen_code("Python", "left_half")
    session.add_qa(
        previous_prompt + " [📷 附图]",
        "```python\ndef solve():\n    print('old')\n```",
        source="server_screen_left",
        model_name="模型一",
    )
    cfg = _cfg()
    cfg.written_exam_mode = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **_kwargs):
        captured["messages"] = messages
        yield ("text", "```python\ndef solve():\n    print('new')\n```")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "截图显示上一版未通过",
            ["data:image/png;base64,failcase"],
            True,
            "server_screen_left",
            {"origin": "server_screen", "image_count": 1},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    text = captured["messages"][0]["content"][0]["text"]
    assert "上一张截图题面（无 OCR 文本，以上一版答案和当前截图为准）" in text
    assert "下图来自运行本后端" not in text
    assert "请基于图中可见信息作答" not in text
    assert "print('old')" in text
    assert "截图显示上一版未通过" in text


def test_written_exam_screenshot_ignores_non_screen_qa_revision_context(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured = {}
    session = get_session()
    session.add_qa(
        "普通面试题：Redis 怎么持久化？",
        "用 AOF 和 RDB。",
        source="manual_text",
        model_name="模型一",
    )
    cfg = _cfg()
    cfg.written_exam_mode = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **_kwargs):
        captured["messages"] = messages
        yield ("text", "```python\ndef solve():\n    pass\n```")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        (
            "当前是全新的笔试截图题",
            ["data:image/png;base64,current"],
            True,
            "server_screen_left",
            {"origin": "server_screen", "image_count": 1},
        ),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    content = captured["messages"][0]["content"]
    assert content[0]["text"] == "当前是全新的笔试截图题"
    assert "Redis" not in str(captured["messages"])
    assert "AOF" not in str(captured["messages"])
    assert content[1]["image_url"]["url"] == "data:image/png;base64,current"


def test_written_exam_manual_input_uses_exam_mode_and_no_history(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured = {}
    session = get_session()
    session.add_user_message("上一道题")
    session.add_assistant_message("上一题答案")
    cfg = _cfg()
    cfg.written_exam_mode = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["prompt_mode"] = kwargs["mode"]
        return "system"

    def fake_stream(_model_cfg, messages, **_kwargs):
        captured["messages"] = messages
        yield ("text", "填空答案")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    answer_worker.process_question_parallel(
        ("手动输入的笔试题", None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["prompt_mode"] == answer_worker.PROMPT_MODE_WRITTEN_EXAM
    assert captured["messages"] == [{"role": "user", "content": "手动输入的笔试题"}]


def test_written_exam_code_question_chain_is_isolated(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    captured = {}
    session = get_session()
    session.add_user_message("上一道选择题")
    session.add_assistant_message("A. Redis")
    cfg = _cfg()
    cfg.written_exam_mode = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_prompt(**kwargs):
        captured["prompt_mode"] = kwargs["mode"]
        return "system"

    def fake_stream(_model_cfg, messages, **_kwargs):
        captured["messages"] = messages
        yield ("text", "```python\n# 哈希表一次遍历 O(n)\ndef two_sum(nums, target):\n    return []\n```")

    monkeypatch.setattr(answer_worker, "build_system_prompt", fake_prompt)
    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)

    question = "代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。"
    answer_worker.process_question_parallel(
        (question, None, True, "manual_text", {"origin": "manual"}),
        seq=0,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts),
    )

    assert captured["prompt_mode"] == answer_worker.PROMPT_MODE_WRITTEN_EXAM
    assert captured["messages"] == [{"role": "user", "content": question}]
    assert "上一道选择题" not in str(captured["messages"])

    start = next(event for event in broadcasts if event["type"] == "answer_start")
    done = next(event for event in broadcasts if event["type"] == "answer_done")
    assert start["question"] == question
    assert start["source"] == "manual_text"
    assert done["question"] == question
    assert "def two_sum" in done["answer"]


def test_exam_preflight_worker_events_do_not_pollute_session(monkeypatch: pytest.MonkeyPatch):
    broadcasts: list[dict] = []
    knowledge: list[tuple[str, str, str, str]] = []
    recorded: list[dict] = []
    cfg = _cfg()
    cfg.written_exam_mode = True
    cfg.models[0].supports_vision = True
    monkeypatch.setattr(answer_worker, "get_config", lambda: cfg)

    def fake_stream(_model_cfg, messages, **kwargs):
        assert kwargs["override_think_mode"] is False
        assert messages[0]["content"][1]["image_url"]["url"] == "data:image/png;base64,fake"
        yield ("text", "```python\ndef two_sum(nums, target):\n    return []\n```")

    monkeypatch.setattr(answer_worker, "chat_stream_single_model", fake_stream)
    import api.assist.exam_test as exam_test

    monkeypatch.setattr(exam_test, "record_exam_preflight_answer_event", recorded.append)

    answer_worker.process_question_parallel(
        (
            "固定截图题",
            "data:image/png;base64,fake",
            True,
            "server_screen_exam_preflight",
            {
                "origin": "server_screen",
                "image_count": 1,
                "exam_preflight": True,
                "exam_preflight_id": "preflight-1",
            },
        ),
        seq=9,
        model_idx=0,
        sess_v=0,
        deps=_deps(broadcasts=broadcasts, knowledge=knowledge),
    )

    event_types = [event["type"] for event in broadcasts]
    assert event_types == ["answer_start", "answer_chunk", "answer_done", "token_update"]
    assert all(event.get("exam_preflight_id") == "preflight-1" for event in broadcasts[:3])
    assert [event["type"] for event in recorded] == ["answer_start", "answer_chunk", "answer_done"]
    assert knowledge == []
    session = get_session()
    assert session.qa_pairs == []
    assert session.conversation_history == []
