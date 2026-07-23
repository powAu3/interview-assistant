from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

model_health = importlib.import_module("api.common.model_health")


def _model(name: str, model: str, key: str = "sk-test") -> SimpleNamespace:
    return SimpleNamespace(
        name=name,
        api_base_url="https://example.test/v1",
        api_key=key,
        model=model,
        enabled=True,
        supports_vision=False,
        supports_think=False,
        think_enabled_params={},
        think_disabled_params={},
    )


@pytest.fixture(autouse=True)
def clear_health_state():
    model_health._model_health.clear()
    model_health._model_health_detail.clear()
    model_health._model_health_latency.clear()
    model_health._model_health_fingerprint.clear()
    yield
    model_health._model_health.clear()
    model_health._model_health_detail.clear()
    model_health._model_health_latency.clear()
    model_health._model_health_fingerprint.clear()


def test_health_status_is_not_reused_after_models_reorder(monkeypatch: pytest.MonkeyPatch):
    first = _model("first", "model-a")
    second = _model("second", "model-b")
    cfg = SimpleNamespace(models=[first, second])
    monkeypatch.setattr(model_health, "get_config", lambda: cfg)

    fingerprint = model_health.model_health_fingerprint(first)
    assert model_health._store_model_health(0, fingerprint, "error", "old failure", 0)
    assert model_health.get_model_health(0) == "error"

    cfg.models = [second, first]

    assert model_health.get_model_health(0) is None
    snapshot = model_health.get_model_health_snapshot()
    assert 0 not in snapshot["health"]
    assert 0 not in snapshot["detail"]
    assert 0 not in snapshot["fingerprint"]


def test_queued_probe_drops_result_when_index_changes_owner(
    monkeypatch: pytest.MonkeyPatch,
):
    first = _model("first", "model-a")
    second = _model("second", "model-b")
    cfg = SimpleNamespace(models=[first, second])
    submitted: list[tuple[object, tuple[object, ...]]] = []
    events: list[dict] = []

    monkeypatch.setattr(model_health, "get_config", lambda: cfg)
    monkeypatch.setattr(
        model_health,
        "submit_low_priority_background",
        lambda fn, *args: submitted.append((fn, args)) or True,
    )
    monkeypatch.setattr(
        model_health,
        "_probe_basic",
        lambda *_args, **_kwargs: pytest.fail("stale probe must not call provider"),
    )
    ws = importlib.import_module("api.realtime.ws")
    monkeypatch.setattr(ws, "broadcast", events.append)

    assert model_health.start_single_model_check(0) is True
    assert len(submitted) == 1

    cfg.models = [second, first]
    fn, args = submitted[0]
    fn(*args)

    assert events == []
    assert model_health.get_model_health(0) is None


def test_api_key_change_invalidates_existing_health(monkeypatch: pytest.MonkeyPatch):
    model = _model("first", "model-a", key="sk-old")
    cfg = SimpleNamespace(models=[model])
    monkeypatch.setattr(model_health, "get_config", lambda: cfg)

    old_fingerprint = model_health.model_health_fingerprint(model)
    assert model_health._store_model_health(0, old_fingerprint, "ok", "", 123)

    model.api_key = "sk-new"

    assert model_health.get_model_health(0) is None
