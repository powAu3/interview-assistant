"""recent_hits 环形缓冲单元测试。"""
from __future__ import annotations

from services.kb.recent_hits import (
    RecentHits,
    global_recent_hits,
    reset_global_recent_hits,
)


def test_ring_buffer_lists_most_recent_first():
    r = RecentHits(capacity=3)
    r.push({"query": "a"})
    r.push({"query": "b"})
    r.push({"query": "c"})
    r.push({"query": "d"})
    items = r.list()
    assert [x["query"] for x in items] == ["d", "c", "b"]


def test_capacity_floor_is_one():
    r = RecentHits(capacity=0)
    r.push({"q": "x"})
    r.push({"q": "y"})
    assert [x["q"] for x in r.list()] == ["y"]


def test_list_with_limit():
    r = RecentHits(capacity=10)
    for i in range(5):
        r.push({"i": i})
    items = r.list(limit=2)
    assert [x["i"] for x in items] == [4, 3]


def test_clear():
    r = RecentHits(capacity=3)
    r.push({"q": "a"})
    r.clear()
    assert r.list() == []


def test_global_singleton_reused():
    reset_global_recent_hits()
    a = global_recent_hits()
    b = global_recent_hits()
    assert a is b


def test_retriever_pushes_into_recent_hits(tmp_path):
    """retrieve 真正执行后应在环形缓冲里留下一条记录 (命中 or 空)。"""
    reset_global_recent_hits()
    from core.config import get_config

    cfg = get_config()
    cfg.kb_enabled = True
    cfg.kb_dir = str(tmp_path / "kb")
    cfg.kb_db_path = str(tmp_path / "kb.sqlite")
    cfg.kb_cache_dir = str(tmp_path / "cache")

    md = tmp_path / "kb" / "redis.md"
    md.parent.mkdir(parents=True, exist_ok=True)
    md.write_text("# Redis\n\n## RDB\n\nRDB 是快照方式\n", encoding="utf-8")

    from services.kb import indexer, retriever

    indexer._store = None
    indexer.reindex()

    hits = retriever.retrieve("RDB 快照", k=3, deadline_ms=500, mode="manual_text")
    assert hits, "期望能命中 RDB 快照"

    recent = global_recent_hits().list()
    assert recent and recent[0]["query"] == "RDB 快照"
    assert recent[0]["mode"] == "manual_text"
    assert recent[0]["hit_count"] == len(hits)
    assert "latency_ms" in recent[0]
    assert "top_section_paths" in recent[0]
    assert recent[0]["timed_out"] is False

    indexer._store = None
