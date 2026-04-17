from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.kb.chunker import chunk_doc  # noqa: E402
from services.kb.types import RawDoc, RawSection  # noqa: E402


def _doc(sections: list[tuple[str, str]], title: str = "A") -> RawDoc:
    return RawDoc(
        path="a.md",
        title=title,
        loader="markdown",
        sections=[RawSection(section_path=sp, text=t) for sp, t in sections],
    )


def test_single_short_section_becomes_single_chunk():
    d = _doc([("A > x", "hello world")])
    chunks = chunk_doc(d, max_chars=800)
    assert len(chunks) == 1
    assert chunks[0].section_path == "A > x"
    assert chunks[0].ord == 0
    assert chunks[0].text == "hello world"


def test_long_section_hard_split_into_multiple_chunks():
    d = _doc([("A > y", "一二三四五六七八九十" * 200)])
    chunks = chunk_doc(d, max_chars=800)
    assert len(chunks) >= 2
    assert all(len(c.text) <= 800 for c in chunks)
    assert [c.ord for c in chunks] == list(range(len(chunks)))


def test_multi_section_ord_continuous_across_sections():
    d = _doc([("A > 1", "hello"), ("A > 2", "world"), ("A > 3", "!!")])
    chunks = chunk_doc(d, max_chars=800)
    assert [c.ord for c in chunks] == [0, 1, 2]
    assert [c.section_path for c in chunks] == ["A > 1", "A > 2", "A > 3"]


def test_short_code_block_kept_as_single_atom():
    code = "```\nprint('hi')\n```"
    d = _doc([("A > code", code)])
    chunks = chunk_doc(d, max_chars=800)
    assert len(chunks) == 1
    assert chunks[0].text.startswith("```")
    assert chunks[0].text.endswith("```")


def test_code_block_too_long_gets_truncated():
    code = "```\n" + ("line\n" * 400) + "```"
    d = _doc([("A > code", code)])
    chunks = chunk_doc(d, max_chars=800)
    joined = "\n".join(c.text for c in chunks)
    assert "```" in joined
    assert "[截断]" in joined


def test_preserves_page_and_origin_from_section():
    d = RawDoc(
        path="a.pdf",
        title="A",
        loader="pdf",
        sections=[
            RawSection("A > Page 3", "scanned words", page=3, origin="ocr"),
        ],
    )
    chunks = chunk_doc(d, max_chars=800)
    assert chunks[0].page == 3
    assert chunks[0].origin == "ocr"


def test_empty_doc_returns_empty_list():
    assert chunk_doc(_doc([])) == []


def test_plain_text_around_code_block_split_correctly():
    text = "before text\n\n```\ncode\n```\n\nafter text"
    d = _doc([("A > mix", text)])
    chunks = chunk_doc(d, max_chars=800)
    assert len(chunks) == 3
    assert chunks[0].text == "before text"
    assert chunks[1].text.startswith("```") and "code" in chunks[1].text
    assert chunks[2].text == "after text"
