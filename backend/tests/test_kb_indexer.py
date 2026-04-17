from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def setup_kb(tmp_path, monkeypatch):
    kb_dir = tmp_path / "kb"
    kb_dir.mkdir()
    db = tmp_path / "kb.sqlite"

    from core import config as cfg_mod
    cfg = cfg_mod.get_config()
    monkeypatch.setattr(cfg, "kb_dir", str(kb_dir), raising=False)
    monkeypatch.setattr(cfg, "kb_db_path", str(db), raising=False)
    monkeypatch.setattr(cfg, "kb_cache_dir", str(tmp_path / "kb_cache"), raising=False)

    from services.kb import indexer
    indexer.reset()
    yield indexer, kb_dir, db
    indexer.reset()


def test_reindex_creates_schema_and_indexes_md(setup_kb):
    indexer, kb_dir, _ = setup_kb
    (kb_dir / "redis.md").write_text("# Redis\n\nRedis hits", encoding="utf-8")
    info = indexer.reindex()
    assert info["total_docs"] == 1
    assert info["total_chunks"] >= 1
    assert info["reindexed_files"] == 1


def test_reindex_skips_unchanged_file(setup_kb):
    indexer, kb_dir, _ = setup_kb
    (kb_dir / "a.md").write_text("# A\n\ntext", encoding="utf-8")
    indexer.reindex()
    info2 = indexer.reindex()
    assert info2["reindexed_files"] == 0
    assert info2["total_docs"] == 1


def test_reindex_reruns_on_mtime_change(setup_kb):
    indexer, kb_dir, _ = setup_kb
    f = kb_dir / "a.md"
    f.write_text("# A\n\nfirst", encoding="utf-8")
    indexer.reindex()
    # 改内容 + 改 mtime
    f.write_text("# A\n\nsecond version", encoding="utf-8")
    os.utime(f, (f.stat().st_atime, f.stat().st_mtime + 10))
    info = indexer.reindex()
    assert info["reindexed_files"] == 1


def test_reindex_marks_doc_as_failed_on_broken_loader(setup_kb, monkeypatch):
    indexer, kb_dir, _ = setup_kb
    (kb_dir / "a.md").write_text("# A\n\nt", encoding="utf-8")

    from services.kb.loaders import markdown as md_mod

    def boom(self, file_path, *, rel_path):
        raise RuntimeError("boom")

    monkeypatch.setattr(md_mod.MarkdownLoader, "load", boom)
    indexer.reindex()
    docs = indexer.list_docs()
    assert len(docs) == 1
    assert docs[0]["status"] == "failed"
    assert "boom" in (docs[0]["error"] or "")


def test_doc_file_rejected_with_clear_message(setup_kb):
    indexer, kb_dir, _ = setup_kb
    (kb_dir / "legacy.doc").write_bytes(b"fake")
    indexer.reindex()
    docs = {d["path"]: d for d in indexer.list_docs()}
    assert "legacy.doc" in docs
    assert docs["legacy.doc"]["status"] == "failed"
    assert ".docx" in (docs["legacy.doc"]["error"] or "")


def test_remove_file_drops_doc(setup_kb):
    indexer, kb_dir, _ = setup_kb
    (kb_dir / "a.md").write_text("# A\n\nt", encoding="utf-8")
    indexer.reindex()
    os.remove(kb_dir / "a.md")
    indexer.reindex()
    assert indexer.list_docs() == []


def test_unknown_extension_silently_skipped(setup_kb):
    indexer, kb_dir, _ = setup_kb
    (kb_dir / "weird.xyz").write_text("abc", encoding="utf-8")
    (kb_dir / "ok.md").write_text("# A\n\nt", encoding="utf-8")
    info = indexer.reindex()
    assert info["total_docs"] == 1  # weird.xyz 不应进库


def test_cli_list_outputs_indexed_docs(setup_kb, capsys):
    indexer, kb_dir, _ = setup_kb
    (kb_dir / "a.md").write_text("# A\n\nt", encoding="utf-8")
    indexer.reindex()
    from services.kb import cli
    exit_code = cli.main(["list"])
    out = capsys.readouterr().out
    assert exit_code == 0
    assert "a.md" in out
    assert "markdown" in out


def test_cli_reindex_outputs_stats(setup_kb, capsys):
    indexer, kb_dir, _ = setup_kb
    (kb_dir / "a.md").write_text("# A\n\nt", encoding="utf-8")
    from services.kb import cli
    exit_code = cli.main(["reindex"])
    out = capsys.readouterr().out
    assert exit_code == 0
    assert "total_docs" in out
