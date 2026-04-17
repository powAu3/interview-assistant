from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.kb.store import KBStore  # noqa: E402
from services.kb.types import Chunk  # noqa: E402


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as d:
        s = KBStore(db_path=str(Path(d) / "kb.sqlite"))
        s.init_schema()
        yield s


def test_init_schema_creates_tables(store: KBStore):
    tables = store.list_tables()
    assert {"kb_doc", "kb_chunk", "kb_attachment", "kb_fts"}.issubset(tables)


def test_upsert_doc_and_read_back(store: KBStore):
    doc_id = store.upsert_doc(
        path="redis/persistence.md",
        mtime=1000.0,
        size=123,
        loader="markdown",
        title="Redis 持久化",
    )
    assert doc_id > 0
    rows = store.list_docs()
    assert len(rows) == 1
    assert rows[0]["id"] == doc_id
    assert rows[0]["path"] == "redis/persistence.md"
    assert rows[0]["status"] == "ok"
    assert rows[0]["chunk_count"] == 0


def test_upsert_doc_is_idempotent(store: KBStore):
    a = store.upsert_doc("a.md", 1.0, 10, "markdown", "A")
    b = store.upsert_doc("a.md", 2.0, 20, "markdown", "A2")
    assert a == b
    row = store.get_doc("a.md")
    assert row is not None
    assert row["mtime"] == 2.0
    assert row["size"] == 20
    assert row["title"] == "A2"


def test_replace_chunks_and_fts_match(store: KBStore):
    doc_id = store.upsert_doc("a.md", 1.0, 1, "markdown", "A")
    store.replace_chunks(
        doc_id,
        [
            Chunk(section_path="A > RDB", text="RDB 是快照持久化方式", ord=0),
            Chunk(section_path="A > AOF", text="AOF 是追加日志方式", ord=1),
        ],
    )
    hits = store.fts_search("RDB", limit=5)
    assert any("RDB" in h["text"] for h in hits)
    assert all("path" in h and "section_path" in h for h in hits)


def test_replace_chunks_overrides_old(store: KBStore):
    doc_id = store.upsert_doc("a.md", 1.0, 1, "markdown", "A")
    store.replace_chunks(doc_id, [Chunk("A > x", "hello world", 0)])
    store.replace_chunks(doc_id, [Chunk("A > y", "bye world", 0)])
    hits = store.fts_search("hello", limit=5)
    assert hits == []
    hits2 = store.fts_search("bye", limit=5)
    assert len(hits2) == 1


def test_delete_doc_cascades_chunks_and_fts(store: KBStore):
    doc_id = store.upsert_doc("a.md", 1.0, 1, "markdown", "A")
    store.replace_chunks(doc_id, [Chunk("A > x", "helloKB content", 0)])
    store.delete_doc("a.md")
    assert store.list_docs() == []
    assert store.fts_search("helloKB", limit=5) == []


def test_set_status_failed(store: KBStore):
    store.upsert_doc("broken.pdf", 1.0, 1, "pdf", None)
    store.set_status("broken.pdf", "failed", "pypdf parse error")
    row = store.list_docs()[0]
    assert row["status"] == "failed"
    assert row["error"] == "pypdf parse error"


def test_stats_reflects_counts(store: KBStore):
    doc_id = store.upsert_doc("a.md", 10.0, 1, "markdown", "A")
    store.replace_chunks(
        doc_id,
        [Chunk("A > 1", "alpha", 0), Chunk("A > 2", "beta", 1)],
    )
    s = store.stats()
    assert s["total_docs"] == 1
    assert s["total_chunks"] == 2
    assert s["last_mtime"] == 10.0
