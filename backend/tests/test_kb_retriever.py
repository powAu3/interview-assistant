from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def setup_retriever(tmp_path, monkeypatch):
    from core import config as cfg_mod
    from services.kb import indexer, retriever

    kb_dir = tmp_path / "kb"
    kb_dir.mkdir()
    (kb_dir / "redis.md").write_text(
        "# Redis 持久化\n\n## RDB\n\nRDB 是 Redis 快照持久化方式。\n\n## AOF\n\nAOF 追加日志。",
        encoding="utf-8",
    )

    cfg = cfg_mod.get_config()
    monkeypatch.setattr(cfg, "kb_dir", str(kb_dir), raising=False)
    monkeypatch.setattr(cfg, "kb_db_path", str(tmp_path / "kb.sqlite"), raising=False)
    monkeypatch.setattr(cfg, "kb_enabled", True, raising=False)
    monkeypatch.setattr(cfg, "kb_min_score", 0.0, raising=False)
    monkeypatch.setattr(cfg, "kb_asr_min_query_chars", 6, raising=False)
    monkeypatch.setattr(
        cfg,
        "kb_trigger_modes",
        ["asr_realtime", "manual_text", "written_exam"],
        raising=False,
    )

    indexer.reset()
    indexer.reindex()
    retriever.reset()
    yield retriever
    indexer.reset()


def test_keyword_hit(setup_retriever):
    hits = setup_retriever.retrieve("RDB 快照", k=3, deadline_ms=500)
    assert hits, "应至少命中 1 条"
    assert any("RDB" in h.text for h in hits)
    assert all(h.section_path for h in hits)
    assert all(h.path == "redis.md" for h in hits)


def test_disabled_returns_empty(setup_retriever, monkeypatch):
    from core.config import get_config
    monkeypatch.setattr(get_config(), "kb_enabled", False, raising=False)
    assert setup_retriever.retrieve("RDB", k=3, deadline_ms=500) == []


def test_mode_not_in_trigger_modes_returns_empty(setup_retriever, monkeypatch):
    from core.config import get_config
    monkeypatch.setattr(get_config(), "kb_trigger_modes", ["manual_text"], raising=False)
    hits = setup_retriever.retrieve("RDB", k=3, deadline_ms=500, mode="asr_realtime")
    assert hits == []


def test_short_asr_query_early_return(setup_retriever):
    hits = setup_retriever.retrieve("嗯", k=3, deadline_ms=80, mode="asr_realtime")
    assert hits == []


def test_noisy_asr_query_normalized(setup_retriever, monkeypatch):
    """含大量 ASR 噪声词; 归一化后应至少剩 'RDB 快照持久化' 足够触发检索。"""
    from core.config import get_config
    # 让这条 query 归一化后有效字符 (RDB+快照持久化=8) 超过默认 min_chars
    monkeypatch.setattr(get_config(), "kb_asr_min_query_chars", 6, raising=False)
    hits = setup_retriever.retrieve(
        "呃 那个 RDB 快照持久化 呃", k=3, deadline_ms=500, mode="asr_realtime"
    )
    assert hits


def test_empty_query_returns_empty(setup_retriever):
    assert setup_retriever.retrieve("   ", k=3, deadline_ms=500) == []


def test_manual_text_ignores_asr_min_chars(setup_retriever, monkeypatch):
    """manual_text 模式不受 kb_asr_min_query_chars 限制。"""
    from core.config import get_config
    monkeypatch.setattr(get_config(), "kb_asr_min_query_chars", 100, raising=False)
    hits = setup_retriever.retrieve("RDB", k=3, deadline_ms=500, mode="manual_text")
    assert hits


def test_long_cjk_query_partial_match(setup_retriever):
    """长 CJK query 不应因为多了几个 bigram 失配就整段命中失败。

    回归用例: 2026-04-17 真实 smoke 中发现 "Redis 快照持久化方式" 比
    "Redis 快照持久化" 多 bigrams ['化方', '方式'] 而 chunk 没这两个词,
    AND 语义把整个 query 撞空。修复后改成 OR 让 bm25 去排序。
    """
    hits = setup_retriever.retrieve(
        "Redis 快照持久化方式是什么", k=3, deadline_ms=500, mode="manual_text"
    )
    assert hits, "长 CJK query 应允许部分 bigram 匹配, 否则真实问答永远 0 命中"
    assert any("RDB" in h.text or "快照" in h.text for h in hits)


def test_deadline_enforced(setup_retriever, monkeypatch):
    """人为让 fts_search sleep，验证 deadline 到期返回空。"""
    from services.kb import store as store_mod

    def slow(self, *args, **kwargs):
        time.sleep(0.3)
        return []

    monkeypatch.setattr(store_mod.KBStore, "fts_search", slow)
    t0 = time.monotonic()
    hits = setup_retriever.retrieve("RDB", k=3, deadline_ms=50)
    elapsed_ms = (time.monotonic() - t0) * 1000
    assert hits == []
    # 允许 watchdog 再等 50ms 让子线程退出 + 一点调度延迟
    assert elapsed_ms < 250, f"deadline 超时保护失效, 实际 {elapsed_ms:.0f}ms"
