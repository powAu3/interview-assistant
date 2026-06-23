"""
Tests for review API endpoints.
"""
import time
import pytest
from fastapi.testclient import TestClient
from main import app
from services.storage import review


client = TestClient(app)


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


def test_list_sessions_empty():
    """测试空列表"""
    resp = client.get("/api/review/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []


def test_list_sessions_with_data():
    """测试有数据的列表"""
    # 创建几个 session
    for i in range(3):
        session_id = review.create_session(
            started_at=time.time(),
            interviewer_enabled=True,
            candidate_enabled=True,
        )
        review.add_turn(
            session_id=session_id,
            qa_id=f"qa-{i:03d}",
            seq=1,
            question_text=f"问题 {i+1}",
            candidate_answer_text=f"回答 {i+1}",
            duration_ms=30000,
        )
        if i < 2:
            review.end_session(session_id, status="completed")

    resp = client.get("/api/review/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert len(data["items"]) == 3

    # 验证返回字段
    item = data["items"][0]
    assert "id" in item
    assert "status" in item
    assert "started_at" in item
    assert "turn_count" in item


def test_list_sessions_pagination():
    """测试分页"""
    # 创建 5 个 session
    for i in range(5):
        review.create_session(
            started_at=time.time(),
            interviewer_enabled=True,
            candidate_enabled=True,
        )

    # 第一页
    resp = client.get("/api/review/sessions?page=1&page_size=2")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert len(data["items"]) == 2

    # 第二页
    resp = client.get("/api/review/sessions?page=2&page_size=2")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert len(data["items"]) == 2

    # 第三页
    resp = client.get("/api/review/sessions?page=3&page_size=2")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert len(data["items"]) == 1


def test_get_session_detail():
    """测试获取 session 详情"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    # 添加 turn
    review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="测试问题",
        candidate_answer_text="测试回答",
        duration_ms=30000,
    )

    review.end_session(
        session_id=session_id,
        status="completed",
        summary_markdown="## 总结\n表现良好",
    )

    resp = client.get(f"/api/review/sessions/{session_id}")
    assert resp.status_code == 200
    data = resp.json()

    assert data["id"] == session_id
    assert data["status"] == "completed"
    assert data["turn_count"] == 1
    assert data["summary_markdown"] == "## 总结\n表现良好"
    assert len(data["turns"]) == 1

    turn = data["turns"][0]
    assert turn["qa_id"] == "qa-001"
    assert turn["question_text"] == "测试问题"
    assert turn["candidate_answer_text"] == "测试回答"


def test_get_session_detail_not_found():
    """测试获取不存在的 session"""
    resp = client.get("/api/review/sessions/99999")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_get_current_session_none():
    """测试无当前 session"""
    resp = client.get("/api/review/current")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session"] is None


def test_get_current_session_active():
    """测试有进行中的 session"""
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    resp = client.get("/api/review/current")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session"] is not None
    assert data["session"]["id"] == session_id
    assert data["session"]["status"] == "recording"


def test_get_profile():
    """测试获取长期画像"""
    resp = client.get("/api/review/profile")
    assert resp.status_code == 200
    data = resp.json()

    # 验证返回结构
    assert "session_count" in data
    assert "summary" in data
    assert "strengths" in data
    assert "weaknesses" in data
    assert "behavior_traits" in data
    assert "domain_mastery" in data
    assert "trend" in data

    # 初始状态
    assert data["session_count"] == 0
    assert data["summary"] is None
    assert data["strengths"] == []


def test_session_lifecycle():
    """测试完整的 session 生命周期"""
    # 1. 无当前 session
    resp = client.get("/api/review/current")
    assert resp.json()["session"] is None

    # 2. 创建 session（通过 storage 层，模拟 assist 创建）
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    # 3. 有当前 session
    resp = client.get("/api/review/current")
    assert resp.json()["session"]["id"] == session_id

    # 4. 添加 turn
    review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="问题1",
        candidate_answer_text="回答1",
        duration_ms=30000,
    )

    # 5. 查看详情
    resp = client.get(f"/api/review/sessions/{session_id}")
    assert resp.status_code == 200
    assert resp.json()["turn_count"] == 1

    # 6. 结束 session
    review.end_session(session_id, status="completed")

    # 7. 不再是当前 session
    resp = client.get("/api/review/current")
    assert resp.json()["session"] is None

    # 8. 出现在列表中
    resp = client.get("/api/review/sessions")
    assert resp.json()["total"] == 1
