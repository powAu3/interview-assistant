from __future__ import annotations

from pathlib import Path
import importlib
import sys
from types import SimpleNamespace

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

exam_test = importlib.import_module("api.assist.exam_test")
pipeline = importlib.import_module("api.assist.pipeline")


def test_select_exam_preflight_model_requires_vision(monkeypatch: pytest.MonkeyPatch):
    cfg = SimpleNamespace(
        active_model=0,
        models=[
            SimpleNamespace(name="text", enabled=True, supports_vision=False, api_key="sk"),
            SimpleNamespace(name="vision", enabled=True, supports_vision=True, api_key="sk"),
        ],
    )
    monkeypatch.setattr(exam_test, "get_model_health", lambda idx: None)

    idx, model = exam_test.select_exam_preflight_model(cfg)

    assert idx == 1
    assert model.name == "vision"


def test_exam_preflight_task_uses_real_server_screen_worker_shape():
    cfg = SimpleNamespace(
        screen_capture_region="left_half",
        language="Python",
    )

    task = exam_test._exam_preflight_task(
        cfg,
        "data:image/png;base64,fake",
        "preflight-1",
    )

    text, image, manual_input, source, meta = task
    assert "实时画面" in text
    assert "固定链路检测用截图代码题" in text
    assert image == "data:image/png;base64,fake"
    assert manual_input is True
    assert source == "server_screen_exam_preflight"
    assert meta == {
        "origin": "server_screen",
        "image_count": 1,
        "exam_preflight": True,
        "exam_preflight_id": "preflight-1",
    }


def test_run_exam_preflight_broadcasts_steps_and_status(monkeypatch: pytest.MonkeyPatch):
    events: list[dict] = []
    cfg = SimpleNamespace(
        active_model=0,
        models=[SimpleNamespace(name="vision", enabled=True, supports_vision=True, api_key="sk")],
    )
    monkeypatch.setattr(exam_test, "broadcast", lambda data: events.append(data))
    monkeypatch.setattr(exam_test, "get_config", lambda: cfg)
    monkeypatch.setattr(exam_test, "build_fixed_code_question_image_data_url", lambda: "data:image/png;base64,fake")
    monkeypatch.setattr(exam_test, "get_model_health", lambda idx: None)
    monkeypatch.setattr(pipeline, "pick_model_index", lambda task, busy: 0)

    submitted: list[tuple] = []

    def fake_submit(task):
        submitted.append(task)
        return True

    monkeypatch.setattr(pipeline, "submit_answer_task", fake_submit)

    exam_test._run_exam_preflight()

    status = exam_test.get_exam_preflight_status()
    assert status["running"] is True
    assert status["question"] == exam_test.EXAM_PREFLIGHT_QUESTION
    assert status["steps"]["screenshot"]["status"] == "pass"
    assert status["steps"]["submit"]["status"] == "running"
    assert status["steps"]["llm"]["status"] == "running"
    assert submitted
    assert submitted[0][3] == "server_screen_exam_preflight"
    preflight_id = status["preflight_id"]
    assert submitted[0][4]["exam_preflight_id"] == preflight_id

    exam_test.record_exam_preflight_answer_event({
        "type": "answer_start",
        "id": "qa-preflight",
        "exam_preflight_id": preflight_id,
        "model_name": "vision",
    })
    exam_test.record_exam_preflight_answer_event({
        "type": "answer_done",
        "id": "qa-preflight",
        "exam_preflight_id": preflight_id,
        "answer": "```python\ndef two_sum(nums, target):\n    return []\n```",
        "model_name": "vision",
        "first_token_ms": 100,
        "total_ms": 500,
    })

    status = exam_test.get_exam_preflight_status()
    assert status["running"] is False
    assert status["qa_id"] == "qa-preflight"
    assert status["steps"]["submit"]["status"] == "pass"
    assert status["steps"]["llm"]["status"] == "pass"
    assert "def two_sum" in status["steps"]["llm"]["answer"]
    assert any(event.get("type") == "exam_preflight_step" for event in events)
    assert any(event.get("step") == "done" for event in events)
