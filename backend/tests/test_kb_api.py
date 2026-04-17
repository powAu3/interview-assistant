"""KB HTTP API 集成测试 (用 minimal FastAPI app 挂载 router, 避开 main lifespan)。"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def app_client(tmp_path: Path, monkeypatch):
    from core.config import get_config
    from services.kb import indexer
    from services.kb.recent_hits import reset_global_recent_hits
    from api import kb as kb_api

    cfg = get_config()
    monkeypatch.setattr(cfg, "kb_enabled", True, raising=False)
    monkeypatch.setattr(cfg, "kb_dir", str(tmp_path / "kb"), raising=False)
    monkeypatch.setattr(cfg, "kb_db_path", str(tmp_path / "kb.sqlite"), raising=False)
    monkeypatch.setattr(cfg, "kb_cache_dir", str(tmp_path / "kb_cache"), raising=False)
    monkeypatch.setattr(cfg, "kb_min_score", 0.0, raising=False)
    monkeypatch.setattr(cfg, "kb_max_upload_bytes", 1024 * 1024, raising=False)

    kb_dir = Path(cfg.kb_dir)
    kb_dir.mkdir(parents=True, exist_ok=True)
    (kb_dir / "redis.md").write_text(
        "# Redis\n\n## RDB\n\nRedis 支持 RDB 快照持久化。\n", encoding="utf-8"
    )

    indexer._store = None
    reset_global_recent_hits()
    indexer.reindex()

    app = FastAPI()
    app.include_router(kb_api.router, prefix="/api")
    with TestClient(app) as client:
        yield client

    indexer._store = None
    reset_global_recent_hits()


def test_status_ok(app_client):
    r = app_client.get("/api/kb/status")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["total_docs"] >= 1
    assert body["total_chunks"] >= 1
    assert "deps" in body and "docx" in body["deps"]
    assert "trigger_modes" in body


def test_docs_list_ok(app_client):
    r = app_client.get("/api/kb/docs")
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(d["path"] == "redis.md" for d in items)


def test_search_returns_hits(app_client):
    r = app_client.post("/api/kb/search", json={"query": "RDB 持久化", "k": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["hits"], "应命中 RDB 内容"
    assert body["hits"][0]["path"] == "redis.md"
    assert body["hits"][0]["excerpt"]


def test_search_empty_query_returns_no_hits(app_client):
    r = app_client.post("/api/kb/search", json={"query": "  ", "k": 3})
    assert r.status_code == 200
    assert r.json()["hits"] == []


def test_hits_recent_after_search(app_client):
    app_client.post("/api/kb/search", json={"query": "RDB"})
    r = app_client.get("/api/kb/hits/recent")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "search 之后应留下命中记录"
    assert items[0]["query"]


def test_upload_rejects_doc_extension(app_client):
    r = app_client.post(
        "/api/kb/upload",
        files={"file": ("legacy.doc", b"fake", "application/octet-stream")},
    )
    assert r.status_code == 415
    assert ".docx" in r.json()["detail"]


def test_upload_rejects_unknown_extension(app_client):
    r = app_client.post(
        "/api/kb/upload",
        files={"file": ("x.csv", b"a,b,c", "text/csv")},
    )
    assert r.status_code == 415


def test_upload_rejects_oversize(app_client, monkeypatch):
    from core.config import get_config

    monkeypatch.setattr(get_config(), "kb_max_upload_bytes", 5, raising=False)
    r = app_client.post(
        "/api/kb/upload",
        files={"file": ("big.md", b"12345678901234567890", "text/markdown")},
    )
    assert r.status_code == 413


def test_upload_rejects_path_traversal_in_subdir(app_client):
    r = app_client.post(
        "/api/kb/upload",
        data={"subdir": "../../etc"},
        files={"file": ("passwd.md", b"# content", "text/markdown")},
    )
    assert r.status_code == 400


def test_upload_rejects_filename_with_separators(app_client):
    r = app_client.post(
        "/api/kb/upload",
        files={"file": ("a/b.md", b"# x", "text/markdown")},
    )
    assert r.status_code == 400


def test_upload_ok_then_visible_in_docs_and_search(app_client):
    r = app_client.post(
        "/api/kb/upload",
        files={"file": ("redlock.md", "# Redlock\n\n互斥锁实现\n".encode("utf-8"), "text/markdown")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["path"] == "redlock.md"
    assert body["size"] > 0

    docs = app_client.get("/api/kb/docs").json()["items"]
    assert any(d["path"] == "redlock.md" for d in docs)

    s = app_client.post("/api/kb/search", json={"query": "Redlock 互斥"})
    assert any(h["path"] == "redlock.md" for h in s.json()["hits"])


def test_reindex_endpoint_ok(app_client):
    r = app_client.post("/api/kb/reindex", json={})
    assert r.status_code == 200
    body = r.json()
    assert "total_docs" in body


def test_delete_doc_ok(app_client):
    app_client.post(
        "/api/kb/upload",
        files={"file": ("tmp.md", b"# tmp\n\nbody\n", "text/markdown")},
    )
    r = app_client.request("DELETE", "/api/kb/docs", params={"path": "tmp.md"})
    assert r.status_code == 200
    assert r.json()["ok"] is True

    docs = app_client.get("/api/kb/docs").json()["items"]
    assert not any(d["path"] == "tmp.md" for d in docs)


def test_delete_doc_rejects_traversal(app_client):
    r = app_client.request("DELETE", "/api/kb/docs", params={"path": "../etc/x"})
    assert r.status_code == 400


def test_delete_doc_rejects_empty_path(app_client):
    r = app_client.request("DELETE", "/api/kb/docs", params={"path": ""})
    assert r.status_code == 400
