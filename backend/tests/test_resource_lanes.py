from __future__ import annotations

import importlib
import importlib.util
import asyncio
import sys
import threading
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def test_resource_lane_rejects_when_running_and_queue_capacity_is_full():
    spec = importlib.util.find_spec("core.resource_lanes")
    assert spec is not None, "core.resource_lanes module is missing"
    resource_lanes = importlib.import_module("core.resource_lanes")

    entered = threading.Event()
    release = threading.Event()
    lane = resource_lanes.ResourceLane(
        "test-low-priority",
        max_workers=1,
        max_pending=0,
    )

    def blocking_task():
        entered.set()
        release.wait(timeout=2)
        return "done"

    first = lane.submit(blocking_task)
    assert entered.wait(timeout=1)

    with pytest.raises(resource_lanes.ResourceLaneBusyError):
        lane.submit(lambda: "should not be queued")

    release.set()
    assert first.result(timeout=1) == "done"
    lane.shutdown()


def test_model_health_checks_are_submitted_to_low_priority_lane(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    submitted: list[tuple[object, tuple[object, ...]]] = []

    def fake_submit(fn, *args):
        submitted.append((fn, args))
        return True

    monkeypatch.setattr(
        model_health,
        "submit_low_priority_background",
        fake_submit,
        raising=False,
    )

    assert model_health.start_single_model_check(2) is True
    assert submitted == [(model_health._check_single_model, (2,))]


def test_resume_optimize_is_submitted_to_low_priority_lane(monkeypatch):
    resume_router = importlib.import_module("api.resume.router")
    submitted: list[tuple[object, tuple[object, ...]]] = []

    def fake_submit(fn, *args):
        submitted.append((fn, args))
        return True

    monkeypatch.setattr(resume_router, "submit_low_priority_background", fake_submit)
    monkeypatch.setattr(resume_router.uuid, "uuid4", lambda: type("U", (), {"hex": "job-1"})())
    monkeypatch.setattr(resume_router, "_resume_opt_current_job_id", None)

    result = asyncio.run(resume_router.api_resume_optimize(resume_router.OptimizeRequest(jd="需要 Redis 经验")))

    assert result == {"ok": True, "job_id": "job-1"}
    assert submitted == [(resume_router._run_optimize, ("需要 Redis 经验", "job-1"))]
    assert resume_router._resume_opt_current_job_id == "job-1"


def test_practice_tts_runs_in_low_priority_lane(monkeypatch):
    practice_router = importlib.import_module("api.practice.router")
    seen: dict[str, object] = {}

    class _Cfg:
        practice_tts_provider = "edge_tts"

    async def fake_run_low_priority(fn, *args, **kwargs):
        seen["fn"] = fn
        seen["args"] = args
        seen["kwargs"] = kwargs
        return {
            "provider": "edge_tts",
            "speaker": "zh-CN-YunxiNeural",
            "audio_base64": "AAAA",
            "content_type": "audio/mpeg",
            "duration": 1.0,
        }

    monkeypatch.setattr(practice_router, "get_config", lambda: _Cfg())
    monkeypatch.setattr(practice_router, "edge_tts_configured", lambda: True)
    monkeypatch.setattr(practice_router, "run_low_priority", fake_run_low_priority)

    result = asyncio.run(
        practice_router.api_practice_tts(
            practice_router.PracticeTtsBody(text="你好", preferred_gender="male")
        )
    )

    assert seen["fn"] is practice_router.synthesize_edge_tts
    assert seen["args"] == ("你好",)
    assert seen["kwargs"] == {
        "preferred_gender": "male",
        "voice": None,
    }
    assert result["ok"] is True
    assert result["provider"] == "edge_tts"
