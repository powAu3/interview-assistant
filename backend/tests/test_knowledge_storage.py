from __future__ import annotations

from pathlib import Path
import sys

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.storage import knowledge  # noqa: E402


@pytest.fixture
def isolated_knowledge_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(knowledge, "DB_PATH", str(tmp_path / "knowledge.db"))
    monkeypatch.setattr(knowledge, "extract_tags", lambda _q, _a="", _candidate_answer="": ["Redis"])
    knowledge.init_db()
    knowledge.reset_all()
    return knowledge


def test_assist_history_includes_optional_candidate_answer(isolated_knowledge_db):
    store = isolated_knowledge_db

    store.save_record(
        "assist",
        "Redis 怎么持久化？",
        "助手建议：RDB 和 AOF。",
        qa_id="qa-1",
        tags=["Redis"],
    )
    assert store.update_candidate_answer_for_qa(
        "qa-1",
        "我实际回答了 RDB 快照、AOF 追加日志，以及重写机制。",
        refresh_tags=False,
    )

    history = store.get_history(1, 20, ("assist",))
    assert history["records"][0]["qa_id"] == "qa-1"
    assert history["records"][0]["candidate_answer"] == "我实际回答了 RDB 快照、AOF 追加日志，以及重写机制。"


def test_records_without_candidate_voice_stay_compatible(isolated_knowledge_db):
    store = isolated_knowledge_db

    store.save_record("assist", "MySQL 索引？", "B+ 树。", tags=["MySQL"])

    history = store.get_history(1, 20, ("assist",))
    assert history["records"][0]["qa_id"] == ""
    assert history["records"][0]["candidate_answer"] == ""


def test_candidate_answer_refreshes_tags_from_actual_spoken_answer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(knowledge, "DB_PATH", str(tmp_path / "knowledge.db"))
    seen: list[tuple[str, str, str]] = []

    def fake_extract_tags(question: str, answer: str = "", candidate_answer: str = "") -> list[str]:
        seen.append((question, answer, candidate_answer))
        return ["候选人口述"]

    monkeypatch.setattr(knowledge, "extract_tags", fake_extract_tags)
    knowledge.init_db()
    knowledge.reset_all()
    knowledge.save_record("assist", "讲讲项目", "助手建议：缓存项目。", qa_id="qa-2", tags=["缓存"])

    assert knowledge.update_candidate_answer_for_qa("qa-2", "我实际讲的是风控规则引擎。")

    history = knowledge.get_history(1, 20, ("assist",))
    assert history["records"][0]["tags"] == ["候选人口述"]
    assert seen[-1] == ("讲讲项目", "助手建议：缓存项目。", "我实际讲的是风控规则引擎。")


def test_candidate_answer_refresh_keeps_existing_tags_when_extraction_returns_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(knowledge, "DB_PATH", str(tmp_path / "knowledge.db"))
    monkeypatch.setattr(knowledge, "extract_tags", lambda _q, _a="", _candidate_answer="": [])
    knowledge.init_db()
    knowledge.reset_all()
    knowledge.save_record("assist", "Redis 如何限流？", "助手建议：令牌桶。", qa_id="qa-3", tags=["Redis", "限流"])

    assert knowledge.update_candidate_answer_for_qa("qa-3", "我实际回答了令牌桶和漏桶。")

    history = knowledge.get_history(1, 20, ("assist",))
    assert history["records"][0]["candidate_answer"] == "我实际回答了令牌桶和漏桶。"
    assert history["records"][0]["tags"] == ["Redis", "限流"]
