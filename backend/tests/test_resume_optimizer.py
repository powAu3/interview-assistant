from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

resume_optimizer = importlib.import_module("services.resume_optimizer")
resume_router = importlib.import_module("api.resume.router")


class _FakeCfg:
    resume_text = "负责接口优化\n建设缓存治理"

    def get_active_model(self):
        return SimpleNamespace(model="fake-model")


def test_resume_optimizer_marks_rewrite_suggestions_without_line_references(monkeypatch):
    calls = {"stream": 0}

    monkeypatch.setattr(resume_optimizer, "get_config", lambda: _FakeCfg())
    monkeypatch.setattr(resume_optimizer, "get_client", lambda: object())
    monkeypatch.setattr(
        resume_optimizer,
        "_non_stream_chat",
        lambda *args, **kwargs: '{"must_have":["Redis"],"nice_to_have":[],"soft_skills":[]}',
    )

    def fake_stream(*args, **kwargs):
        calls["stream"] += 1
        if calls["stream"] == 1:
            yield '### ✅ 命中能力\n- **Redis** — L2 / "建设缓存治理"'
            return
        yield "#### 建议 1 — 强化量化结果\n- 改写: 主导接口优化并降低延迟。"

    monkeypatch.setattr(resume_optimizer, "_stream_chat", fake_stream)

    output = "".join(resume_optimizer.optimize_resume_stream("需要 Redis 经验"))

    assert "需人工确认" in output
    assert "缺少行号引用" in output


def test_resume_optimizer_accepts_rewrite_suggestions_with_line_references(monkeypatch):
    calls = {"stream": 0}

    monkeypatch.setattr(resume_optimizer, "get_config", lambda: _FakeCfg())
    monkeypatch.setattr(resume_optimizer, "get_client", lambda: object())
    monkeypatch.setattr(
        resume_optimizer,
        "_non_stream_chat",
        lambda *args, **kwargs: '{"must_have":["Redis"],"nice_to_have":[],"soft_skills":[]}',
    )

    def fake_stream(*args, **kwargs):
        calls["stream"] += 1
        if calls["stream"] == 1:
            yield '### ✅ 命中能力\n- **Redis** — L2 / "建设缓存治理"'
            return
        yield '#### 建议 1 — 强化量化结果\n- 引用: **L1** / "负责接口优化"\n- 改写: 主导接口优化。'

    monkeypatch.setattr(resume_optimizer, "_stream_chat", fake_stream)

    output = "".join(resume_optimizer.optimize_resume_stream("需要 Redis 经验"))

    assert "缺少行号引用" not in output


def test_resume_opt_router_stops_broadcasting_stale_job_chunks(monkeypatch):
    events: list[dict] = []

    monkeypatch.setattr(resume_router, "broadcast", lambda payload: events.append(payload))

    def fake_stream(_jd: str):
        yield "old-visible"
        resume_router._resume_opt_current_job_id = "job-new"
        yield "old-stale"

    monkeypatch.setattr(resume_router, "optimize_resume_stream", fake_stream)
    monkeypatch.setattr(resume_router, "_resume_opt_current_job_id", "job-old")

    resume_router._run_optimize("需要 Redis 经验", "job-old")

    assert [event["type"] for event in events] == ["resume_opt_start", "resume_opt_chunk"]
    assert all(event["job_id"] == "job-old" for event in events)
    assert events[1]["chunk"] == "old-visible"
