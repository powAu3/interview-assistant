from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

practice_service = importlib.import_module("services.practice")
practice_router = importlib.import_module("api.practice.router")


def _run(coro):
    return asyncio.run(coro)


class _FakeModel:
    def __init__(self):
        self.enabled = True
        self.api_key = "test-key"
        self.model = "mock-practice-model"
        self.name = "Mock Practice"


class _FakeCfg:
    def __init__(self):
        self.models = [_FakeModel()]
        self.active_model = 0
        self.position = "后端开发"
        self.language = "Python"
        self.practice_audience = "social"
        self.resume_text = "做过交易系统、缓存治理、告警排障。"


def test_start_practice_session_builds_blueprint_and_first_turn(monkeypatch):
    fake_cfg = _FakeCfg()

    monkeypatch.setattr(practice_service, "get_config", lambda: fake_cfg)
    monkeypatch.setattr(practice_service, "_pick_practice_model", lambda: fake_cfg.models[0], raising=False)
    monkeypatch.setattr(
        practice_service,
        "_request_json_completion",
        lambda *args, **kwargs: {
            "opening_script": "我们开始一场更真实的模拟面试。",
            "phases": [
                {
                    "phase_id": "opening",
                    "label": "开场与岗位匹配",
                    "category": "behavioral",
                    "focus": ["岗位动机", "个人定位"],
                    "follow_up_budget": 0,
                    "answer_mode": "voice",
                    "question": "先用 90 秒介绍一下你自己，并说明为什么想做这个岗位。",
                },
                {
                    "phase_id": "coding",
                    "label": "代码与 SQL",
                    "category": "coding",
                    "focus": ["SQL", "边界处理"],
                    "follow_up_budget": 1,
                    "answer_mode": "voice+code",
                    "question": "请写一段 SQL，统计最近 7 天每个用户的下单次数。",
                    "written_prompt": "给定 orders 表，请统计最近 7 天每个用户的下单次数。",
                    "artifact_notes": ["orders(user_id, created_at, amount)", "只统计最近 7 天", "输出 user_id 与总次数"],
                },
            ],
        },
        raising=False,
    )

    session = practice_service.start_practice_session(
        jd_text="要求熟悉 MySQL、Redis 和交易链路。",
        interviewer_style="supportive_senior",
    )

    assert session.status == "awaiting_answer"
    assert session.context.jd_text == "要求熟悉 MySQL、Redis 和交易链路。"
    assert session.blueprint.opening_script == "我们开始一场更真实的模拟面试。"
    assert [phase.phase_id for phase in session.blueprint.phases] == [
        "opening",
        "project",
        "fundamentals",
        "design",
        "coding",
        "closing",
    ]
    assert session.current_turn is not None
    assert session.current_turn.phase_id == "opening"
    assert session.current_turn.answer_mode == "voice"
    assert "介绍一下你自己" in session.current_turn.question
    assert session.turn_history == []
    assert session.context.interviewer_style == "supportive_senior"
    assert session.interviewer_persona["tone"] == "supportive-senior"
    assert session.current_turn.stage_prompt is not None
    assert "开场" in session.current_turn.stage_prompt
    assert "先轻一点" in session.current_turn.transition_line
    coding_phase = session.blueprint.phases[4]
    assert coding_phase.written_prompt.startswith("给定 orders 表")
    assert "orders(user_id, created_at, amount)" in coding_phase.artifact_notes


def test_submit_practice_answer_creates_follow_up_turn(monkeypatch):
    fake_cfg = _FakeCfg()
    responses = iter(
        [
            {
                "opening_script": "开始吧。",
                "phases": [
                    {
                        "phase_id": "project",
                        "label": "项目深挖",
                        "category": "project",
                        "focus": ["项目取舍", "线上问题"],
                        "follow_up_budget": 1,
                        "answer_mode": "voice",
                        "question": "讲一个你亲自负责并且线上压力最大的项目。",
                    },
                    {
                        "phase_id": "coding",
                        "label": "代码题",
                        "category": "coding",
                        "focus": ["SQL"],
                        "follow_up_budget": 0,
                        "answer_mode": "voice+code",
                        "question": "补一个 SQL 题。",
                    },
                ],
            },
            {
                "decision": "follow_up",
                "reason": "回答只讲了结果，没有讲验证与复盘。",
                "next_question": "如果现在重做这套方案，你会保留什么、推翻什么？",
                "next_answer_mode": "voice",
                "scorecard": {
                    "technical_depth": 6,
                    "communication": 7,
                    "job_fit": 7,
                    "confidence": 6,
                },
                "evidence": ["提到了项目背景，但没有讲监控指标。"],
                "strengths": ["有明确结果意识"],
                "risks": ["缺少方案复盘"],
            },
        ]
    )

    monkeypatch.setattr(practice_service, "get_config", lambda: fake_cfg)
    monkeypatch.setattr(practice_service, "_pick_practice_model", lambda: fake_cfg.models[0], raising=False)
    monkeypatch.setattr(
        practice_service,
        "_request_json_completion",
        lambda *args, **kwargs: next(responses),
        raising=False,
    )

    session = practice_service.start_practice_session(jd_text="偏交易链路经验。")
    updated = practice_service.submit_practice_answer(
        transcript="我负责过一个高并发交易系统，主要做缓存和降级。",
        code_text="",
        answer_mode="voice",
        duration_ms=48_000,
    )

    assert updated.status == "awaiting_answer"
    assert len(updated.turn_history) == 1
    previous = updated.turn_history[0]
    assert previous.transcript == "我负责过一个高并发交易系统，主要做缓存和降级。"
    assert previous.duration_ms == 48_000
    assert previous.decision == "follow_up"
    assert updated.current_turn is not None
    assert updated.current_turn.follow_up_of == previous.turn_id
    assert "重做这套方案" in updated.current_turn.question
    assert len(updated.hidden_score_ledger) == 1
    assert updated.hidden_score_ledger[0].decision == "follow_up"
    assert updated.current_turn.interviewer_signal in {"probe", "stress-test"}


def test_submit_practice_answer_finishes_with_debrief(monkeypatch):
    fake_cfg = _FakeCfg()
    responses = iter(
        [
            {
                "opening_script": "开始吧。",
                "phases": [
                    {
                        "phase_id": "coding",
                        "label": "代码题",
                        "category": "coding",
                        "focus": ["SQL", "边界"],
                        "follow_up_budget": 0,
                        "answer_mode": "voice+code",
                        "question": "写一段 SQL，统计每个用户最近 7 天的订单数。",
                    }
                ],
            },
            {
                "decision": "finish",
                "reason": "最后一题已完成，可以进入整场复盘。",
                "scorecard": {
                    "technical_depth": 8,
                    "communication": 7,
                    "job_fit": 8,
                    "confidence": 7,
                },
                "evidence": ["SQL 基本正确，解释了 where + group by 思路。"],
                "strengths": ["表达比较清楚"],
                "risks": ["可以再补索引策略"],
            },
        ]
    )

    monkeypatch.setattr(practice_service, "get_config", lambda: fake_cfg)
    monkeypatch.setattr(practice_service, "_pick_practice_model", lambda: fake_cfg.models[0], raising=False)
    monkeypatch.setattr(
        practice_service,
        "_request_json_completion",
        lambda *args, **kwargs: next(responses),
        raising=False,
    )
    monkeypatch.setattr(
        practice_service,
        "_request_text_completion",
        lambda *args, **kwargs: "### 综合 verdict\n- 建议：可进入下一轮，但要补系统设计与复盘表达。\n",
        raising=False,
    )

    practice_service.start_practice_session(jd_text="要求熟悉 SQL。")
    updated = practice_service.submit_practice_answer(
        transcript="我会先过滤 7 天数据，再按 user_id group by。",
        code_text="select user_id, count(*) from orders ...",
        answer_mode="voice+code",
        duration_ms=62_000,
    )

    assert updated.status == "finished"
    assert updated.current_turn is None
    assert len(updated.turn_history) == 1
    assert updated.turn_history[0].code_text.startswith("select user_id")
    assert "综合 verdict" in updated.report_markdown
    assert updated.hidden_score_ledger[0].decision == "finish"


def test_fallback_review_escalates_when_code_phase_has_no_code(monkeypatch):
    fake_cfg = _FakeCfg()
    calls = iter(
        [
            {
                "opening_script": "开始吧。",
                "phases": [
                    {
                        "phase_id": "coding",
                        "label": "代码题",
                        "category": "coding",
                        "focus": ["SQL", "边界"],
                        "follow_up_budget": 2,
                        "answer_mode": "voice+code",
                        "question": "请写 SQL。",
                    }
                ],
            },
            RuntimeError("llm unavailable"),
        ]
    )
    monkeypatch.setattr(practice_service, "get_config", lambda: fake_cfg)
    monkeypatch.setattr(practice_service, "_pick_practice_model", lambda: fake_cfg.models[0], raising=False)
    monkeypatch.setattr(
        practice_service,
        "_request_json_completion",
        lambda *args, **kwargs: (
            value if not isinstance(value := next(calls), Exception) else (_ for _ in ()).throw(value)
        ),
        raising=False,
    )

    session = practice_service.start_practice_session(jd_text="熟悉 SQL。")
    session.current_phase_index = 4
    session.current_turn = practice_service._make_turn(session.blueprint.phases[4])  # type: ignore[attr-defined]
    updated = practice_service.submit_practice_answer(
        transcript="我会按用户分组统计。",
        code_text="",
        answer_mode="voice+code",
        duration_ms=24000,
    )

    assert updated.status == "awaiting_answer"
    assert updated.current_turn is not None
    assert updated.current_turn.follow_up_of == updated.turn_history[0].turn_id
    assert "补出来" in updated.current_turn.question or "SQL" in updated.current_turn.question


def test_generate_route_broadcasts_new_status_sequence(monkeypatch):
    class _InlineThread:
        def __init__(self, target=None, args=(), kwargs=None, daemon=None):
            self._target = target
            self._args = args
            self._kwargs = kwargs or {}

        def start(self):
            if self._target:
                self._target(*self._args, **self._kwargs)

    fake_session = practice_service.PracticeSession(
        status="awaiting_answer",
        context=practice_service.PracticeContext(
            position="后端开发",
            language="Python",
            audience="social",
            audience_label="社招",
            resume_text="有高并发项目经验",
            jd_text="熟悉 Redis、MySQL",
            interviewer_style="calm_pressing",
        ),
        blueprint=practice_service.PracticeBlueprint(
            opening_script="开始吧。",
            phases=[
                practice_service.PracticePhase(
                    phase_id="opening",
                    label="开场",
                    category="behavioral",
                    focus=["岗位匹配"],
                    follow_up_budget=0,
                    answer_mode="voice",
                    question="介绍一下你自己。",
                )
            ],
        ),
        current_turn=practice_service.PracticeTurn(
            turn_id="turn-1",
            phase_id="opening",
            phase_label="开场",
            category="behavioral",
            answer_mode="voice",
            question="介绍一下你自己。",
            prompt_script="介绍一下你自己。",
        ),
    )

    events: list[dict] = []

    monkeypatch.setattr(practice_router, "threading", type("T", (), {"Thread": _InlineThread}))
    monkeypatch.setattr(
        practice_router,
        "start_practice_session",
        lambda jd_text="", interviewer_style="": fake_session,
        raising=False,
    )
    monkeypatch.setattr(practice_router, "broadcast", lambda payload: events.append(payload))

    result = _run(practice_router.api_practice_generate({"jd_text": "熟悉 Redis、MySQL"}))

    assert result == {"ok": True}
    assert [e["status"] for e in events if e.get("type") == "practice_status"] == [
        "preparing",
        "interviewer_speaking",
        "awaiting_answer",
    ]
    snapshots = [e for e in events if e.get("type") == "practice_session"]
    assert len(snapshots) == 1
    assert snapshots[0]["session"]["context"]["jd_text"] == "熟悉 Redis、MySQL"
