"""Unit tests for bench_prompt helpers (no LLM API calls)."""
from __future__ import annotations

import pytest

from scripts.bench_prompt import (
    BENCH_CASES,
    RESUME_FIXTURE,
    RESUME_KEYWORDS,
    has_info_insufficient_phrase,
    has_preamble_phrase,
    first_sentence_is_compliant,
    resume_keyword_hits,
    ngram_overlap_3,
    word_count_cn,
)


def test_bench_cases_has_30_balanced():
    cats = [c["category"] for c in BENCH_CASES]
    assert len(BENCH_CASES) == 30
    for cat in ("complete", "guessable", "smalltalk", "resume_deepdive", "followup"):
        assert cats.count(cat) == 6, f"{cat} should have 6 cases"


def test_bench_cases_have_required_fields():
    for c in BENCH_CASES:
        assert {"id", "category", "input", "mode", "high_churn", "context"}.issubset(c.keys())
        assert c["mode"] in ("asr_realtime", "manual_text")
        assert isinstance(c["high_churn"], bool)


def test_resume_fixture_present():
    assert "Kafka" in RESUME_FIXTURE
    assert "字节" in RESUME_FIXTURE


def test_has_info_insufficient_phrase():
    assert has_info_insufficient_phrase("信息不足，先等待更完整的问题")
    assert has_info_insufficient_phrase("暂时信息不足")
    assert not has_info_insufficient_phrase("Redis 的 RDB 是快照")


def test_has_preamble_phrase():
    assert has_preamble_phrase("我理解你问的是 Redis 的持久化")
    assert has_preamble_phrase("想先确认一下你指的是什么")
    assert has_preamble_phrase("这是一个经典问题")
    assert not has_preamble_phrase("先止血：把 Redis 切到主从")


def test_first_sentence_is_compliant():
    assert first_sentence_is_compliant("用 Redis 做缓存穿透防护")
    assert first_sentence_is_compliant("先止血再定位根因")
    assert first_sentence_is_compliant("答案是使用 AOF")
    assert first_sentence_is_compliant("先按大概率问 Redis 持久化来理解")
    assert not first_sentence_is_compliant("我理解你问的是 Redis")
    assert not first_sentence_is_compliant("想先确认一下")


def test_first_sentence_compliant_handles_empty():
    assert first_sentence_is_compliant("") is True
    assert first_sentence_is_compliant("   ") is True


def test_resume_keyword_hits():
    kws = ["Kafka", "字节", "Redis"]
    answer = "你之前在字节做过 Kafka 的迁移，类似场景我会……"
    assert resume_keyword_hits(answer, kws) == 2
    assert resume_keyword_hits("", kws) == 0


def test_resume_keywords_constant_covers_deepdive_topics():
    assert "Kafka" in RESUME_KEYWORDS
    assert "字节" in RESUME_KEYWORDS
    assert "Redis" in RESUME_KEYWORDS


def test_ngram_overlap_3_identifies_repeat():
    prev = "Redis 的 RDB 是内存快照，每隔一段时间刷盘"
    same = "Redis 的 RDB 是内存快照，每隔一段时间刷盘"
    different = "追问关键是 AOF 的写入时机和持久化强度"
    assert ngram_overlap_3(prev, same) > 0.9
    assert ngram_overlap_3(prev, different) < 0.35
    assert ngram_overlap_3("", prev) == 0.0


def test_word_count_cn_counts_chinese_and_english():
    assert word_count_cn("Redis 的 RDB 是快照") >= 5
    assert word_count_cn("") == 0
    assert word_count_cn("纯中文测试") == 5
