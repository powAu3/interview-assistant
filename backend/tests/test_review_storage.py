"""
Tests for review storage (sessions, turns, profile snapshots).
"""
import time
import pytest
from services.storage import review


@pytest.fixture(autouse=True)
def clean_review_db():
    """每个测试前重置 review 数据库"""
    import sqlite3
    from services.storage.review import DB_PATH

    # 删除所有数据
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM review_turns")
    conn.execute("DELETE FROM review_sessions")
    conn.execute("DELETE FROM review_profile_snapshots")
    conn.commit()
    conn.close()

    yield

    # 测试后清理
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM review_turns")
    conn.execute("DELETE FROM review_sessions")
    conn.execute("DELETE FROM review_profile_snapshots")
    conn.commit()
    conn.close()


def test_create_session():
    """测试创建 review session"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    assert session_id > 0

    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["id"] == session_id
    assert detail["source"] == "assist"
    assert detail["status"] == "recording"
    assert detail["interviewer_capture_enabled"] == 1
    assert detail["candidate_capture_enabled"] == 1
    assert detail["turn_count"] == 0


def test_get_current_session():
    """测试获取当前进行中的 session"""
    # 初始无当前 session
    current = review.get_current_session()
    assert current is None

    # 创建一个 recording session
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    current = review.get_current_session()
    assert current is not None
    assert current["id"] == session_id
    assert current["status"] == "recording"

    # 结束后不再是 current
    review.end_session(session_id, status="completed")
    current = review.get_current_session()
    assert current is None


def test_add_turn():
    """测试添加 review turn"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    turn_id = review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="请介绍一下你的项目经验",
        candidate_answer_text="我在之前的项目中负责...",
        duration_ms=45000,
    )
    assert turn_id > 0

    detail = review.get_session_detail(session_id)
    assert detail["turn_count"] == 1
    assert len(detail["turns"]) == 1

    turn = detail["turns"][0]
    assert turn["id"] == turn_id
    assert turn["qa_id"] == "qa-001"
    assert turn["seq"] == 1
    assert turn["question_text"] == "请介绍一下你的项目经验"
    assert turn["candidate_answer_text"] == "我在之前的项目中负责..."
    assert turn["duration_ms"] == 45000
    assert turn["analysis_status"] == "pending"


def test_add_multiple_turns():
    """测试添加多个 turn"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    for i in range(3):
        review.add_turn(
            session_id=session_id,
            qa_id=f"qa-{i:03d}",
            seq=i + 1,
            question_text=f"问题 {i+1}",
            candidate_answer_text=f"回答 {i+1}",
            duration_ms=(i + 1) * 30000,
        )

    detail = review.get_session_detail(session_id)
    assert detail["turn_count"] == 3
    assert len(detail["turns"]) == 3

    # 验证顺序
    for i, turn in enumerate(detail["turns"]):
        assert turn["seq"] == i + 1
        assert turn["qa_id"] == f"qa-{i:03d}"


def test_end_session():
    """测试结束 session"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    # 添加几个 turn
    for i in range(2):
        review.add_turn(
            session_id=session_id,
            qa_id=f"qa-{i:03d}",
            seq=i + 1,
            question_text=f"问题 {i+1}",
            candidate_answer_text=f"回答 {i+1}",
            duration_ms=30000,
        )

    review.end_session(
        session_id=session_id,
        status="completed",
        summary_markdown="## 面试总结\n表现良好",
        strong_points=["逻辑清晰", "技术扎实"],
        weak_points=["表达略慢"],
    )

    detail = review.get_session_detail(session_id)
    assert detail["status"] == "completed"
    assert detail["ended_at"] is not None
    assert detail["summary_markdown"] == "## 面试总结\n表现良好"
    assert len(detail["strong_points"]) == 2
    assert len(detail["weak_points"]) == 1


def test_list_sessions():
    """测试列出 sessions"""
    # 创建多个 session
    for i in range(5):
        session_id = review.create_session(
            started_at=time.time(),
            interviewer_enabled=True,
            candidate_enabled=True,
        )
        if i < 3:
            review.end_session(session_id, status="completed")

    result = review.list_sessions(page=1, page_size=10)
    assert result["total"] == 5
    assert len(result["items"]) == 5

    # 测试分页
    result = review.list_sessions(page=1, page_size=2)
    assert result["total"] == 5
    assert len(result["items"]) == 2


def test_session_with_partial_capture():
    """测试采集不完整的 session"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=False,  # 候选人音轨未开启
    )

    review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="测试问题",
        candidate_answer_text="",  # 未采集到回答
        is_partial=True,
        duration_ms=10000,
    )

    review.end_session(session_id, status="partial_capture")

    detail = review.get_session_detail(session_id)
    assert detail["status"] == "partial_capture"
    assert detail["turns"][0]["is_partial"] == 1


def test_turn_with_analysis():
    """测试带分析结果的 turn"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    turn_id = review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="请描述你的技术栈",
        candidate_answer_text="我主要使用 Python 和 React",
        duration_ms=30000,
        analysis_status="completed",
        strengths=["技术栈明确", "表述清晰"],
        risks=["深度不够"],
        evidence={"tech_stack": ["Python", "React"]},
        scorecard={"clarity": 8, "depth": 6, "relevance": 9},
    )

    detail = review.get_session_detail(session_id)
    turn = detail["turns"][0]

    assert turn["analysis_status"] == "completed"
    assert len(turn["strengths"]) == 2
    assert len(turn["risks"]) == 1
    assert "tech_stack" in turn["evidence"]
    assert turn["scorecard"]["clarity"] == 8


def test_nonexistent_session():
    """测试访问不存在的 session"""
    detail = review.get_session_detail(99999)
    assert detail is None


def test_session_turn_count_sync():
    """测试 turn_count 同步更新"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    # 初始 turn_count 为 0
    detail = review.get_session_detail(session_id)
    assert detail["turn_count"] == 0

    # 添加 turn 后自动更新
    review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="问题1",
        candidate_answer_text="回答1",
        duration_ms=30000,
    )

    detail = review.get_session_detail(session_id)
    assert detail["turn_count"] == 1

    # 再添加一个
    review.add_turn(
        session_id=session_id,
        qa_id="qa-002",
        seq=2,
        question_text="问题2",
        candidate_answer_text="回答2",
        duration_ms=40000,
    )

    detail = review.get_session_detail(session_id)
    assert detail["turn_count"] == 2
