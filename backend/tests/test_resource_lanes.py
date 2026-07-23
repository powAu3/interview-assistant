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
    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type("Model", (), {"enabled": False})(),
                type("Model", (), {"enabled": False})(),
                type("Model", (), {"enabled": True})(),
            ]
        },
    )()

    def fake_submit(fn, *args):
        submitted.append((fn, args))
        return True

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(
        model_health,
        "submit_low_priority_background",
        fake_submit,
        raising=False,
    )

    assert model_health.start_single_model_check(2) is True
    assert len(submitted) == 1
    fn, args = submitted[0]
    assert fn is model_health._check_single_model
    assert args[0] == 2
    assert args[1].enabled is True
    assert args[2] == model_health.model_health_fingerprint(cfg.models[2])


def test_all_model_health_checks_skip_disabled_models(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    submitted: list[tuple[object, tuple[object, ...]]] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type("Model", (), {"enabled": True})(),
                type("Model", (), {"enabled": False})(),
                type("Model", (), {"enabled": True})(),
            ]
        },
    )()

    def fake_submit(fn, *args):
        submitted.append((fn, args))
        return True

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health, "submit_low_priority_background", fake_submit)
    model_health._model_health[1] = "error"
    model_health._model_health_detail[1] = "old disabled error"

    assert model_health.start_all_model_checks() is True

    assert [entry[0] for entry in submitted] == [
        model_health._check_single_model,
        model_health._check_single_model,
    ]
    assert [entry[1][0] for entry in submitted] == [0, 2]
    assert [entry[1][2] for entry in submitted] == [
        model_health.model_health_fingerprint(cfg.models[0]),
        model_health.model_health_fingerprint(cfg.models[2]),
    ]
    assert 1 not in model_health._model_health
    assert 1 not in model_health._model_health_detail


def test_model_health_probe_uses_compatible_chat_payload(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    ws = importlib.import_module("api.realtime.ws")
    seen: dict[str, object] = {}

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://example.test/v1",
                        "api_key": "sk-test",
                        "model": "demo-model",
                        "supports_think": True,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen["url"] = url
        seen["headers"] = headers
        seen["json"] = json
        seen["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)
    monkeypatch.setattr(ws, "broadcast", lambda _data: None)

    model_health._check_single_model(0)

    assert seen["url"] == "https://example.test/v1/chat/completions"
    assert seen["json"]["messages"][0]["content"] == "只回复 OK 两个字母，用于连接测试。"
    assert seen["json"]["max_tokens"] == 16
    assert seen["json"]["stream"] is False
    assert "think_mode" not in seen["json"]
    assert "thinking" not in seen["json"]
    assert seen["headers"]["User-Agent"].startswith("python-requests/")


def test_model_health_probe_uses_o_series_token_param(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    ws = importlib.import_module("api.realtime.ws")
    seen: dict[str, object] = {}

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://api.openai.com/v1",
                        "api_key": "sk-test",
                        "model": "o3-mini",
                        "supports_think": True,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post(_url, headers=None, json=None, timeout=None):
        seen["json"] = json
        return FakeResponse()

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)
    monkeypatch.setattr(ws, "broadcast", lambda _data: None)

    model_health._check_single_model(0)

    assert "max_tokens" not in seen["json"]
    assert seen["json"]["max_completion_tokens"] == 16
    assert "reasoning_effort" not in seen["json"]


def test_model_health_probe_rejects_reasoning_leak(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    ws = importlib.import_module("api.realtime.ws")
    events: list[dict] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://example.test/v1",
                        "api_key": "sk-test",
                        "model": "glm-5.1",
                        "supports_think": True,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "OK", "reasoning_content": "thinking"}}]}

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", lambda *_args, **_kwargs: FakeResponse())
    monkeypatch.setattr(ws, "broadcast", events.append)

    model_health._check_single_model(0)

    assert model_health.get_model_health(0) == "error"
    assert "reasoning" in model_health.get_model_health_snapshot()["detail"][0]
    assert events[-1]["status"] == "error"


def test_model_health_probe_rejects_doubao_reasoning_tokens(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    ws = importlib.import_module("api.realtime.ws")
    events: list[dict] = []
    seen_payloads: list[dict] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://ark.cn-beijing.volces.com/api/v3",
                        "api_key": "sk-test",
                        "model": "ep-test",
                        "supports_think": False,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [{"message": {"content": "OK"}}],
                "usage": {"completion_tokens_details": {"reasoning_tokens": 5}},
            }

    def fake_post(_url, headers=None, json=None, timeout=None):
        seen_payloads.append(json)
        return FakeResponse()

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)
    monkeypatch.setattr(ws, "broadcast", events.append)

    model_health._check_single_model(0)

    assert seen_payloads[0]["thinking"] == {"type": "disabled"}
    assert seen_payloads[0]["think_mode"] is False
    assert seen_payloads[0]["enable_thinking"] is False
    assert model_health.get_model_health(0) == "error"
    assert "reasoning" in model_health.get_model_health_snapshot()["detail"][0]
    assert events[-1]["status"] == "error"


def test_model_capability_probe_detects_vision_and_gpt_think_params(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    seen_payloads: list[dict] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://api.openai.com/v1",
                        "api_key": "sk-test",
                        "model": "o3-mini",
                        "supports_think": True,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post(_url, headers=None, json=None, timeout=None):
        seen_payloads.append(json)
        return FakeResponse()

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)

    result = model_health.probe_single_model(0)

    assert result["ok"] is True
    assert result["supports_vision"] is True
    assert result["supports_think"] is True
    assert result["think_style"] == "gpt_reasoning_effort"
    assert result["think_params"] == {"reasoning_effort": "low"}
    assert result["think_disabled_params"] == {"thinking": {"type": "disabled"}, "think_mode": False, "enable_thinking": False}
    assert seen_payloads[1]["messages"][0]["content"][1]["type"] == "image_url"
    assert seen_payloads[2]["thinking"]["type"] == "disabled"
    assert seen_payloads[3]["reasoning_effort"] == "low"
    assert "think_mode" not in seen_payloads[3]


def test_model_capability_probe_does_not_treat_no_params_as_strong_model_disable(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    seen_payloads: list[dict] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://api.openai.com/v1",
                        "api_key": "sk-test",
                        "model": "o3-mini",
                        "supports_think": True,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload
            self.status_code = 400 if (
                "thinking" in payload
                or "enable_thinking" in payload
                or "chat_template_kwargs" in payload
            ) else 200

        def json(self):
            if self.status_code >= 400:
                return {"error": "unsupported extra parameter"}
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post(_url, headers=None, json=None, timeout=None):
        seen_payloads.append(json)
        return FakeResponse(json)

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)

    result = model_health.probe_single_model(0)

    assert result["ok"] is True
    assert result["supports_think"] is True
    assert result["think_disabled_params"] == {}
    assert "无需额外参数" not in result["think_disabled_detail"]
    disable_probe_payloads = [
        payload
        for payload in seen_payloads
        if payload.get("messages", [{}])[0].get("content") == "只回复 OK 两个字母，用于关闭思考参数测试。"
    ]
    assert disable_probe_payloads
    assert all(
        "thinking" in payload or "enable_thinking" in payload or "chat_template_kwargs" in payload
        for payload in disable_probe_payloads
    )


def test_model_capability_probe_rejects_disable_when_reasoning_tokens_remain(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    seen_payloads: list[dict] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://api.deepseek.com/v1",
                        "api_key": "sk-test",
                        "model": "deepseek-reasoner",
                        "supports_think": True,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            if self.payload.get("thinking", {}).get("type") == "disabled":
                return {
                    "choices": [{"message": {"content": "OK"}}],
                    "usage": {"completion_tokens_details": {"reasoning_tokens": 3}},
                }
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post(_url, headers=None, json=None, timeout=None):
        seen_payloads.append(json)
        return FakeResponse(json)

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)

    result = model_health.probe_single_model(0)

    assert result["ok"] is True
    assert result["think_disabled_params"] == {
        "enable_thinking": False,
        "chat_template_kwargs": {"enable_thinking": False},
        "think_mode": False,
    }
    assert seen_payloads[2]["thinking"]["type"] == "disabled"
    assert seen_payloads[3]["chat_template_kwargs"] == {"enable_thinking": False}


def test_model_capability_probe_prefers_saved_disable_params(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    seen_payloads: list[dict] = []
    saved_disabled = {"custom_disable": True}

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://api.openai.com/v1",
                        "api_key": "sk-test",
                        "model": "o3-mini",
                        "supports_think": True,
                        "think_disabled_params": saved_disabled,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post(_url, headers=None, json=None, timeout=None):
        seen_payloads.append(json)
        return FakeResponse()

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)

    result = model_health.probe_single_model(0)

    assert result["think_disabled_params"] == saved_disabled
    assert seen_payloads[2]["custom_disable"] is True


def test_model_capability_probe_tries_doubao_thinking_by_display_name(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    seen_payloads: list[dict] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://ark.cn-beijing.volces.com/api/v3",
                        "api_key": "sk-test",
                        "name": "Doubao-Seed-2.0-pro",
                        "model": "ep-20260313172145-4rstj",
                        "supports_think": True,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post(_url, headers=None, json=None, timeout=None):
        seen_payloads.append(json)
        return FakeResponse()

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)

    result = model_health.probe_single_model(0)

    assert result["ok"] is True
    assert result["supports_think"] is True
    assert result["think_style"] == "generic_thinking"
    assert result["think_params"] == {"thinking": {"type": "enabled"}, "think_mode": True}
    assert result["think_disabled_params"] == {"thinking": {"type": "disabled"}, "think_mode": False, "enable_thinking": False}
    assert seen_payloads[2]["thinking"]["type"] == "disabled"
    assert seen_payloads[3]["thinking"]["type"] == "enabled"


def test_model_capability_probe_keeps_generic_model_think_off_without_signal(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    seen_payloads: list[dict] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://example.test/v1",
                        "api_key": "sk-test",
                        "model": "gpt-4o-mini",
                        "supports_think": True,
                    },
                )()
            ]
        },
    )()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post(_url, headers=None, json=None, timeout=None):
        seen_payloads.append(json)
        return FakeResponse()

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post)

    result = model_health.probe_single_model(0)

    assert result["ok"] is True
    assert result["supports_vision"] is True
    assert result["supports_think"] is False
    assert result["think_params"] == {}
    assert result["think_disabled_params"] == {}
    assert len(seen_payloads) == 3
    assert "thinking" not in seen_payloads[2]
    assert "think_mode" not in seen_payloads[2]


def test_model_capability_probe_detects_deepseek_reasoner_generic_thinking(monkeypatch):
    model_health = importlib.import_module("api.common.model_health")
    seen_payloads: list[dict] = []

    cfg = type(
        "Cfg",
        (),
        {
            "models": [
                type(
                    "Model",
                    (),
                    {
                        "enabled": True,
                        "api_base_url": "https://api.deepseek.com/v1",
                        "api_key": "sk-test",
                        "model": "deepseek-reasoner",
                        "supports_think": False,
                    },
                )()
            ]
        },
    )()

    class BasicResponse:
        status_code = 200

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            if self.payload.get("thinking", {}).get("type") == "enabled":
                return {"choices": [{"message": {"content": "2", "reasoning_content": "short reasoning"}}]}
            return {"choices": [{"message": {"content": "OK"}}]}

    def fake_post_without_basic_reasoning(_url, headers=None, json=None, timeout=None):
        seen_payloads.append(json)
        return BasicResponse(json)

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(model_health.requests, "post", fake_post_without_basic_reasoning)

    result = model_health.probe_single_model(0)

    assert result["ok"] is True
    assert result["supports_think"] is True
    assert result["think_style"] == "generic_thinking"
    assert result["think_params"] == {"thinking": {"type": "enabled"}, "think_mode": True}
    assert result["think_disabled_params"] == {"thinking": {"type": "disabled"}, "think_mode": False, "enable_thinking": False}


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
