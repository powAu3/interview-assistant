"""
Tests for review API endpoints.
"""
import time
import importlib
import pytest
from fastapi.testclient import TestClient
from main import app
from services.storage import review


client = TestClient(app)
review_router = importlib.import_module("api.review.router")


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


def test_create_manual_review_from_transcript(monkeypatch):
    started_analysis: list[int] = []
    monkeypatch.setattr(
        review_router.review_async_analysis,
        "analyze_session_async",
        lambda session_id: started_analysis.append(session_id),
    )

    resp = client.post("/api/review/sessions/manual", json={
        "title": "手动导入复盘",
        "company": "ACME",
        "role": "后端开发",
        "transcript": "面试官: Redis 有哪些数据结构？\n候选人: red 地址有字符串和哈希。\nQ2: 怎么做缓存穿透？\nA2: 用布隆过滤器和空值缓存。",
    })

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "started"
    assert data["turn_count"] == 2
    assert started_analysis == [data["session_id"]]

    detail = review.get_session_detail(data["session_id"])
    assert detail["source"] == "manual"
    assert detail["status"] == "analyzing"
    assert detail["company"] == "ACME"
    assert detail["role"] == "后端开发"
    assert detail["turns"][0]["question_text"] == "Redis 有哪些数据结构？"
    assert "red 地址" in detail["turns"][0]["candidate_answer_text"]


def test_create_manual_review_rejects_unstructured_text():
    resp = client.post("/api/review/sessions/manual", json={
        "transcript": "今天聊得还行，但是没有问答标记。",
    })

    assert resp.status_code == 400
    assert "问答结构" in resp.json()["detail"]


def test_asr_correction_test_endpoint(monkeypatch):
    monkeypatch.setattr(
        review_router.review_analysis,
        "run_asr_correction_check",
        lambda question, candidate_answer: {
            "ok": True,
            "model_name": "lite-ark",
            "model": "doubao-seed-2-0-lite-260428",
            "original": candidate_answer,
            "corrected": "Redis",
            "changed": True,
            "detail": "纠错完成",
        },
    )

    resp = client.post("/api/review/asr-correction-test", json={
        "question": "Redis 是什么？",
        "answer": "red 地址",
    })

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["model_name"] == "lite-ark"
    assert data["corrected"] == "Redis"


def test_asr_correction_test_endpoint_returns_model_error(monkeypatch):
    monkeypatch.setattr(
        review_router.review_analysis,
        "run_asr_correction_check",
        lambda question, candidate_answer: {
            "ok": False,
            "model_name": "lite-ark",
            "model": "doubao-seed-2-0-lite-260428",
            "original": candidate_answer,
            "corrected": candidate_answer,
            "changed": False,
            "detail": "Your request was blocked",
        },
    )

    resp = client.post("/api/review/asr-correction-test", json={"answer": "red 地址"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert "blocked" in data["detail"]


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


def test_generate_starts_for_completed_session_without_analysis(monkeypatch):
    """历史 completed 可能只是录制结束，缺少分析内容时仍应允许手动生成。"""
    started_analysis: list[int] = []
    monkeypatch.setattr(
        review_router.review_async_analysis,
        "analyze_session_async",
        lambda session_id: started_analysis.append(session_id),
    )

    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="问题1",
        candidate_answer_text="回答1",
        duration_ms=30000,
    )
    review.end_session(session_id, status="completed")

    resp = client.post(f"/api/review/sessions/{session_id}/generate")

    assert resp.status_code == 200
    assert resp.json()["status"] == "started"
    assert started_analysis == [session_id]


def test_generate_returns_done_for_completed_session_with_analysis(monkeypatch):
    started_analysis: list[int] = []
    monkeypatch.setattr(
        review_router.review_async_analysis,
        "analyze_session_async",
        lambda session_id: started_analysis.append(session_id),
    )

    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    review.end_session(
        session_id=session_id,
        status="completed",
        summary_markdown="## 总结\n表现良好",
    )

    resp = client.post(f"/api/review/sessions/{session_id}/generate")

    assert resp.status_code == 200
    assert resp.json()["status"] == "done"
    assert started_analysis == []
