"""
测试 review 与 assist 生命周期集成
"""
import pytest
from unittest.mock import MagicMock
from services import review_integration
from services.storage import review
from core.session import Session, QAPair


class _FakeConfig:
    """最小化 config 替身, 只暴露 review_enabled"""

    def __init__(self, review_enabled: bool):
        self.review_enabled = review_enabled


@pytest.fixture(autouse=True)
def clean_review_db():
    """清理 review 数据库"""
    import sqlite3
    from services.storage.review import DB_PATH

    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM review_turns")
    conn.execute("DELETE FROM review_sessions")
    conn.execute("DELETE FROM review_profile_snapshots")
    conn.commit()
    conn.close()

    # 重置全局状态
    review_integration._current_review_session_id = None

    yield

    # 清理后
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM review_turns")
    conn.execute("DELETE FROM review_sessions")
    conn.execute("DELETE FROM review_profile_snapshots")
    conn.commit()
    conn.close()
    review_integration._current_review_session_id = None


def test_should_create_review_session():
    """测试创建条件判断"""
    # 正常情况
    assert review_integration.should_create_review_session(
        interviewer_device_id=1,
        candidate_device_id=2,
        candidate_asr_enabled=True,
    ) is True

    # interviewer 设备无效
    assert review_integration.should_create_review_session(
        interviewer_device_id=None,
        candidate_device_id=2,
        candidate_asr_enabled=True,
    ) is False

    # candidate 设备无效
    assert review_integration.should_create_review_session(
        interviewer_device_id=1,
        candidate_device_id=None,
        candidate_asr_enabled=True,
    ) is False

    # ASR 未开启
    assert review_integration.should_create_review_session(
        interviewer_device_id=1,
        candidate_device_id=2,
        candidate_asr_enabled=False,
    ) is False

    # 两个设备相同
    assert review_integration.should_create_review_session(
        interviewer_device_id=1,
        candidate_device_id=1,
        candidate_asr_enabled=True,
    ) is False


def test_on_assist_start_creates_session():
    """测试 assist 启动时创建 session"""
    session_id = review_integration.on_assist_start(
        interviewer_device_id=1,
        candidate_device_id=2,
        candidate_asr_enabled=True,
    )

    assert session_id is not None
    assert session_id > 0
    assert review_integration.get_current_review_session_id() == session_id

    # 验证数据库中存在
    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["status"] == "recording"
    assert detail["interviewer_capture_enabled"] == 1
    assert detail["candidate_capture_enabled"] == 1


def test_on_assist_start_no_session_when_conditions_not_met():
    """测试条件不满足时不创建 session"""
    session_id = review_integration.on_assist_start(
        interviewer_device_id=1,
        candidate_device_id=None,  # 缺少候选人设备
        candidate_asr_enabled=True,
    )

    assert session_id is None
    assert review_integration.get_current_review_session_id() is None


def test_on_assist_stop_saves_turns(monkeypatch):
    """测试 assist 停止时保存 turns (review_enabled=True 自动分析)"""
    monkeypatch.setattr(
        review_integration, "get_config", lambda: _FakeConfig(review_enabled=True)
    )
    started_analysis: list[int] = []
    monkeypatch.setattr(
        review_integration.review_async_analysis,
        "analyze_session_async",
        lambda session_id: started_analysis.append(session_id),
    )
    # 先创建 session
    session_id = review_integration.on_assist_start(
        interviewer_device_id=1,
        candidate_device_id=2,
        candidate_asr_enabled=True,
    )
    assert session_id is not None

    # 模拟 assist session 有 QA pairs
    mock_session = Session()
    mock_session.qa_pairs = [
        QAPair(
            id="qa1",
            question="什么是 Python GIL？",
            answer="GIL 是全局解释器锁，它确保同一时刻只有一个线程执行 Python 字节码。",
            timestamp=1000.0,
            source="asr",
            model_name="gpt-4o",
        ),
        QAPair(
            id="qa2",
            question="Django 和 Flask 有什么区别？",
            answer="Django 是全栈框架，Flask 是轻量级框架。",
            timestamp=2000.0,
            source="asr",
            model_name="gpt-4o",
        ),
    ]

    # Mock get_candidate_answer_for_qa
    mock_session.get_candidate_answer_for_qa = lambda qa_id, max_chars: f"候选人回答 {qa_id}"

    # 停止 assist
    ended_session_id = review_integration.on_assist_stop(mock_session)

    assert ended_session_id == session_id
    assert review_integration.get_current_review_session_id() is None

    # 验证数据库中的 turns
    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["status"] == "analyzing"
    assert detail["turn_count"] == 2
    assert len(detail["turns"]) == 2
    assert started_analysis == [session_id]

    turn1 = detail["turns"][0]
    assert turn1["qa_id"] == "qa1"
    assert turn1["seq"] == 1
    assert turn1["question_text"] == "什么是 Python GIL？"
    assert "GIL 是全局解释器锁" in turn1["reference_answer_text"]
    assert turn1["candidate_answer_text"] == "候选人回答 qa1"

    turn2 = detail["turns"][1]
    assert turn2["qa_id"] == "qa2"
    assert turn2["seq"] == 2


def test_on_assist_stop_no_session():
    """测试没有活跃 session 时停止"""
    mock_session = Session()
    ended_session_id = review_integration.on_assist_stop(mock_session)
    assert ended_session_id is None


def test_full_lifecycle(monkeypatch):
    """测试完整生命周期 (review_enabled=True 自动分析)"""
    monkeypatch.setattr(
        review_integration, "get_config", lambda: _FakeConfig(review_enabled=True)
    )
    started_analysis: list[int] = []
    monkeypatch.setattr(
        review_integration.review_async_analysis,
        "analyze_session_async",
        lambda session_id: started_analysis.append(session_id),
    )
    # 1. Start
    session_id = review_integration.on_assist_start(
        interviewer_device_id=1,
        candidate_device_id=2,
        candidate_asr_enabled=True,
    )
    assert session_id is not None

    # 2. 检查当前 session
    current = review_integration.get_current_review_session_id()
    assert current == session_id

    # 3. Stop with data
    mock_session = Session()
    mock_session.qa_pairs = [
        QAPair(id="qa1", question="Q1", answer="A1", timestamp=1000.0),
    ]
    mock_session.get_candidate_answer_for_qa = lambda qa_id, max_chars: "候选人回答"

    ended_session_id = review_integration.on_assist_stop(mock_session)
    assert ended_session_id == session_id

    # 4. 验证清理
    assert review_integration.get_current_review_session_id() is None

    # 5. 验证数据持久化
    detail = review.get_session_detail(session_id)
    assert detail["status"] == "analyzing"
    assert detail["turn_count"] == 1
    assert started_analysis == [session_id]


def test_on_assist_stop_recorded_when_review_disabled(monkeypatch):
    """review_enabled=False: 仍创建 session 并落盘 turns, 但不自动分析, 状态 recorded"""
    monkeypatch.setattr(
        review_integration, "get_config", lambda: _FakeConfig(review_enabled=False)
    )
    started_analysis: list[int] = []
    monkeypatch.setattr(
        review_integration.review_async_analysis,
        "analyze_session_async",
        lambda session_id: started_analysis.append(session_id),
    )

    session_id = review_integration.on_assist_start(
        interviewer_device_id=1,
        candidate_device_id=2,
        candidate_asr_enabled=True,
    )
    assert session_id is not None

    mock_session = Session()
    mock_session.qa_pairs = [
        QAPair(id="qa1", question="Q1", answer="A1", timestamp=1000.0),
    ]
    mock_session.get_candidate_answer_for_qa = lambda qa_id, max_chars: "候选人回答"

    ended_session_id = review_integration.on_assist_stop(mock_session)
    assert ended_session_id == session_id

    # 不自动分析
    assert started_analysis == []

    detail = review.get_session_detail(session_id)
    assert detail is not None
    # 落盘为 recorded, 等待手动触发
    assert detail["status"] == "recorded"
    assert detail["turn_count"] == 1
    assert len(detail["turns"]) == 1
    assert detail["ended_at"] is not None
