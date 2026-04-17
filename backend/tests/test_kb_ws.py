"""kb/ws.py payload builder 单测。"""
from __future__ import annotations

from services.kb.types import KBHit
from services.kb.ws import build_kb_hits_payload


def test_payload_basic_shape():
    hits = [
        KBHit(path="a.md", section_path="A > x", text="hello world", score=0.5),
        KBHit(
            path="b.pdf",
            section_path="B > p2",
            text="some long text " * 20,
            score=0.3,
            page=2,
            origin="ocr",
        ),
    ]
    p = build_kb_hits_payload(
        qa_id="qa-1",
        hits=hits,
        latency_ms=42,
        degraded=False,
        excerpt_chars=30,
    )
    assert p["type"] == "kb_hits"
    assert p["scope"] == "global"
    assert p["qa_id"] == "qa-1"
    assert p["latency_ms"] == 42
    assert p["degraded"] is False
    assert p["hit_count"] == 2
    assert p["hits"][0]["path"] == "a.md"
    assert p["hits"][0]["score"] == 0.5
    assert len(p["hits"][1]["excerpt"]) <= 31  # 30 + 末尾 …
    assert p["hits"][1]["origin"] == "ocr"
    assert p["hits"][1]["page"] == 2


def test_payload_empty_hits_returns_zero_count():
    p = build_kb_hits_payload(
        qa_id="qa-2",
        hits=[],
        latency_ms=120,
        degraded=True,
        excerpt_chars=300,
    )
    assert p["hit_count"] == 0
    assert p["hits"] == []
    assert p["degraded"] is True


def test_payload_accepts_iterable_generator():
    def _gen():
        yield KBHit(path="x.md", section_path="X", text="a", score=1.0)

    p = build_kb_hits_payload(
        qa_id="qa-3",
        hits=_gen(),
        latency_ms=10,
        degraded=False,
        excerpt_chars=50,
    )
    assert p["hit_count"] == 1
    assert p["hits"][0]["path"] == "x.md"
