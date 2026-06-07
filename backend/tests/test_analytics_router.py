from __future__ import annotations

import asyncio
import importlib
from pathlib import Path
import sys

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

analytics_router = importlib.import_module("api.analytics.router")


def test_knowledge_summary_defaults_to_assist_and_practice(monkeypatch: pytest.MonkeyPatch):
    seen: dict[str, tuple[str, ...]] = {}

    def fake_get_summary(session_types):
        seen["session_types"] = session_types
        return [{"tag": "Redis", "count": 1, "avg_score": 8, "trend": "stable"}]

    monkeypatch.setattr(analytics_router, "get_summary", fake_get_summary)

    result = asyncio.run(analytics_router.api_knowledge_summary())

    assert seen["session_types"] == ("assist", "practice")
    assert result["tags"][0]["tag"] == "Redis"


def test_knowledge_history_defaults_to_assist_and_practice(monkeypatch: pytest.MonkeyPatch):
    seen: dict[str, object] = {}

    def fake_get_history(page, page_size, session_types):
        seen["page"] = page
        seen["page_size"] = page_size
        seen["session_types"] = session_types
        return {"records": [], "total": 0, "page": page, "page_size": page_size}

    monkeypatch.setattr(analytics_router, "get_history", fake_get_history)

    result = asyncio.run(analytics_router.api_knowledge_history(page=2, page_size=10))

    assert seen == {
        "page": 2,
        "page_size": 10,
        "session_types": ("assist", "practice"),
    }
    assert result["page"] == 2
