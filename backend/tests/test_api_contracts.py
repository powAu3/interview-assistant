from __future__ import annotations

import asyncio
from pathlib import Path
import importlib
import sys

import pytest
from fastapi import HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

main_mod = importlib.import_module("main")
assist_routes = importlib.import_module("api.assist.routes")


def test_is_path_within_dir_rejects_same_prefix_sibling(tmp_path: Path):
    safe_dir = tmp_path / "dist"
    sibling_dir = tmp_path / "dist-evil"
    safe_dir.mkdir()
    sibling_dir.mkdir()

    assert main_mod._is_path_within_dir(safe_dir, sibling_dir / "index.html") is False


def test_api_start_rejects_non_integer_device_id():
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(assist_routes.api_start({"device_id": "abc"}))

    assert exc_info.value.status_code == 400
    assert "device_id" in str(exc_info.value.detail)


def test_api_ask_returns_error_when_no_answer_model_available(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(assist_routes, "submit_answer_task", lambda task: False)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            assist_routes.api_ask(assist_routes.ManualQuestion(text="解释一下 CAP 定理"))
        )

    assert exc_info.value.status_code == 503
    assert "模型" in str(exc_info.value.detail)


def test_api_ask_from_server_screens_submits_multi_image_task(monkeypatch: pytest.MonkeyPatch):
    submitted = []

    monkeypatch.setattr("services.llm.has_vision_model", lambda: True)
    monkeypatch.setattr(assist_routes, "pick_model_index", lambda task, busy: 0)
    monkeypatch.setattr(assist_routes, "cancel_answer_work", lambda reset_session_data=False: None)
    monkeypatch.setattr(assist_routes, "submit_answer_task", lambda task: submitted.append(task) or True)

    res = asyncio.run(
        assist_routes.api_ask_from_server_screens(
            assist_routes.MultiServerScreenQuestion(images=["data:image/png;base64,a", "data:image/png;base64,b"])
        )
    )

    assert res == {"ok": True}
    assert len(submitted) == 1
    text, images, manual, source, meta = submitted[0]
    assert "2 张连续截图" in text
    assert images == ["data:image/png;base64,a", "data:image/png;base64,b"]
    assert manual is True
    assert source == "server_screen_multi"
    assert meta["image_count"] == 2
