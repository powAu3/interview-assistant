"""
Tests for review storage (sessions, turns, profile snapshots).
"""
import time
import pytest
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

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


def test_get_current_session_excludes_recorded():
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    review.end_session(session_id, status="recorded")

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


def test_list_sessions_bounds_pagination_inputs():
    """分页参数异常时仍返回有界、可预测的列表。"""
    for _i in range(3):
        review.create_session(
            started_at=time.time(),
            interviewer_enabled=True,
            candidate_enabled=True,
        )

    result = review.list_sessions(page=-4, page_size=0)

    assert result["page"] == 1
    assert result["page_size"] == 1
    assert result["total"] == 3
    assert len(result["items"]) == 1

    result = review.list_sessions(page="bad", page_size=9999)

    assert result["page"] == 1
    assert result["page_size"] == review.MAX_REVIEW_PAGE_SIZE
    assert result["total"] == 3
    assert len(result["items"]) == 3


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


def test_update_turn_analysis_preserves_original_answer_when_corrected():
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    turn_id = review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="Redis 有哪些数据结构？",
        candidate_answer_text="red 地址有字符串和哈希",
        duration_ms=30000,
    )

    review.update_turn_analysis(
        turn_id=turn_id,
        analysis_status="completed",
        strengths=["覆盖了部分结构"],
        risks=[],
        evidence={"asr_correction": {"original": "red 地址有字符串和哈希", "corrected": "Redis 有字符串和哈希"}},
        scorecard={"准确性": 6},
        corrected_answer="Redis 有字符串和哈希",
    )

    turn = review.get_session_detail(session_id)["turns"][0]
    assert turn["candidate_answer_text"] == "Redis 有字符串和哈希"
    assert turn["original_candidate_answer_text"] == "red 地址有字符串和哈希"
    assert turn["evidence"]["asr_correction"]["corrected"] == "Redis 有字符串和哈希"


def test_update_turn_analysis_merges_existing_evidence():
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    turn_id = review.add_turn(
        session_id=session_id,
        qa_id="qa-screen",
        seq=1,
        question_text="截图题怎么修？",
        candidate_answer_text="",
        reference_answer_text="修复边界条件。",
        evidence={
            "vision_verify": {
                "verdict": "FAIL",
                "reason": "第二个样例不通过",
            }
        },
    )

    review.update_turn_analysis(
        turn_id=turn_id,
        analysis_status="completed",
        strengths=["定位到边界"],
        risks=["缺少空输入"],
        evidence={"improvement_advice": "补充空输入和重复值用例"},
        scorecard={"正确性": 6},
    )

    turn = review.get_session_detail(session_id)["turns"][0]
    assert turn["evidence"]["vision_verify"] == {
        "verdict": "FAIL",
        "reason": "第二个样例不通过",
    }
    assert turn["evidence"]["improvement_advice"] == "补充空输入和重复值用例"


def test_update_turn_analysis_status_only_preserves_analysis_fields():
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    turn_id = review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="Redis 缓存击穿怎么处理？",
        candidate_answer_text="加互斥锁和逻辑过期。",
        analysis_status="completed",
        strengths=["覆盖互斥锁"],
        risks=["缺少热点过期说明"],
        evidence={"tags": ["Redis"]},
        scorecard={"准确性": 7},
    )

    review.update_turn_analysis(
        turn_id=turn_id,
        analysis_status="failed",
    )

    turn = review.get_session_detail(session_id)["turns"][0]
    assert turn["analysis_status"] == "failed"
    assert turn["strengths"] == ["覆盖互斥锁"]
    assert turn["risks"] == ["缺少热点过期说明"]
    assert turn["evidence"] == {"tags": ["Redis"]}
    assert turn["scorecard"] == {"准确性": 7}


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


def test_application_link_syncs_review_todos_and_cleans_rebind(tmp_path, monkeypatch):
    from services.storage import job_tracker as jt

    monkeypatch.setattr(review, "DB_PATH", str(tmp_path / "review.db"))
    monkeypatch.setattr(jt, "DB_PATH", str(tmp_path / "job_tracker.db"))
    review.init_db()
    jt.init_db()

    app1 = jt.create_application({"company": "A 公司", "position": "后端"})
    app2 = jt.create_application({"company": "B 公司", "position": "平台"})
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    turn_id = None
    for idx in range(5):
        created_turn_id = review.add_turn(
            session_id=session_id,
            qa_id=f"qa-{idx:03d}",
            seq=idx + 1,
            question_text=f"问题 {idx + 1}",
            candidate_answer_text=f"回答 {idx + 1}",
        )
        if idx == 0:
            turn_id = created_turn_id
    assert turn_id is not None
    review.update_turn_analysis(
        turn_id=turn_id,
        analysis_status="completed",
        scorecard={"准确性": 5, "深度": 4},
    )
    review.update_session_summary(
        session_id=session_id,
        summary_markdown="总结",
        strong_points=[],
        weak_points=["索引原理展开不足", "缺少验证闭环"],
        avg_score=4.5,
    )

    review.update_session_info(session_id, application_id=app1["id"])
    todos = jt.get_application(app1["id"])["todos"]
    assert [todo["id"] for todo in todos if todo["id"].startswith(f"review-{session_id}-")] == [
        f"review-{session_id}-weak-1",
        f"review-{session_id}-weak-2",
        f"review-{session_id}-turn-{turn_id}",
    ]

    review.update_session_info(session_id, application_id=app1["id"])
    todos_again = jt.get_application(app1["id"])["todos"]
    assert len([todo for todo in todos_again if todo["id"].startswith(f"review-{session_id}-")]) == 3

    review.update_session_info(session_id, application_id=app2["id"])
    assert not [
        todo for todo in jt.get_application(app1["id"])["todos"]
        if todo["id"].startswith(f"review-{session_id}-")
    ]
    assert len([
        todo for todo in jt.get_application(app2["id"])["todos"]
        if todo["id"].startswith(f"review-{session_id}-")
    ]) == 3

    review.update_session_info(session_id, application_id=None)
    assert not [
        todo for todo in jt.get_application(app2["id"])["todos"]
        if todo["id"].startswith(f"review-{session_id}-")
    ]


def test_short_review_does_not_auto_sync_todos_or_summary(tmp_path, monkeypatch):
    from services.storage import job_tracker as jt

    monkeypatch.setattr(review, "DB_PATH", str(tmp_path / "review.db"))
    monkeypatch.setattr(jt, "DB_PATH", str(tmp_path / "job_tracker.db"))
    review.init_db()
    jt.init_db()

    app = jt.create_application({"company": "A 公司", "position": "后端"})
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
    )
    turn_id = review.add_turn(
        session_id=session_id,
        qa_id="qa-001",
        seq=1,
        question_text="测试问题",
        candidate_answer_text="测试回答",
    )
    review.update_turn_analysis(
        turn_id=turn_id,
        analysis_status="completed",
        scorecard={"准确性": 4, "深度": 5},
    )
    review.update_session_summary(
        session_id=session_id,
        summary_markdown="短测试总结",
        strong_points=[],
        weak_points=["仅用于测试"],
        avg_score=4.5,
    )

    review.update_session_info(session_id, application_id=app["id"])

    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["auto_sync_eligible"] is False
    assert jt.get_application(app["id"])["todos"] == []
    summary = review.get_application_review_summaries([app["id"]])[app["id"]]
    assert summary["review_count"] == 0
    assert summary["linked_review_count"] == 1
    assert summary["latest_linked_review_id"] == session_id
    assert summary["latest_review_id"] is None


def test_binding_backfills_default_review_info_and_followup_time(tmp_path, monkeypatch):
    from services.storage import job_tracker as jt

    monkeypatch.setattr(review, "DB_PATH", str(tmp_path / "review.db"))
    monkeypatch.setattr(jt, "DB_PATH", str(tmp_path / "job_tracker.db"))
    review.init_db()
    jt.init_db()

    app = jt.create_application({"company": "ByteDance", "position": "AI Engineer", "stage": "interview1"})
    started_at = time.time() - 60
    ended_at = time.time()
    session_id = review.create_session(
        started_at=started_at,
        interviewer_enabled=True,
        candidate_enabled=True,
        source="manual",
        title="手动复盘",
    )
    review.end_session(session_id, status="recorded", ended_at=ended_at)

    review.update_session_info(session_id, application_id=app["id"])

    detail = review.get_session_detail(session_id)
    linked_app = jt.get_application(app["id"])
    assert detail is not None
    assert detail["title"] == "ByteDance - AI Engineer"
    assert detail["company"] == "ByteDance"
    assert detail["role"] == "AI Engineer"
    assert linked_app is not None
    assert linked_app["next_followup_at"] == pytest.approx(ended_at)


def test_binding_terminal_application_does_not_backfill_followup_time(tmp_path, monkeypatch):
    from services.storage import job_tracker as jt

    monkeypatch.setattr(review, "DB_PATH", str(tmp_path / "review.db"))
    monkeypatch.setattr(jt, "DB_PATH", str(tmp_path / "job_tracker.db"))
    review.init_db()
    jt.init_db()

    app = jt.create_application({"company": "ByteDance", "position": "AI Engineer", "stage": "interview2_rejected"})
    started_at = time.time() - 60
    ended_at = time.time()
    session_id = review.create_session(
        started_at=started_at,
        interviewer_enabled=True,
        candidate_enabled=True,
        source="manual",
        title="手动复盘",
    )
    review.end_session(session_id, status="recorded", ended_at=ended_at)

    review.update_session_info(session_id, application_id=app["id"])

    detail = review.get_session_detail(session_id)
    linked_app = jt.get_application(app["id"])
    assert detail is not None
    assert detail["title"] == "ByteDance - AI Engineer"
    assert detail["company"] == "ByteDance"
    assert detail["role"] == "AI Engineer"
    assert linked_app is not None
    assert linked_app["next_followup_at"] is None


def test_application_patch_backfills_linked_review_defaults(tmp_path, monkeypatch):
    from services.storage import job_tracker as jt

    monkeypatch.setattr(review, "DB_PATH", str(tmp_path / "review.db"))
    monkeypatch.setattr(jt, "DB_PATH", str(tmp_path / "job_tracker.db"))
    review.init_db()
    jt.init_db()

    app = jt.create_application({"company": "新公司", "position": "岗位"})
    session_id = review.create_session(
        started_at=time.time(),
        interviewer_enabled=True,
        candidate_enabled=True,
        source="manual",
        title="手动复盘",
        application_id=app["id"],
    )

    jt.patch_application(app["id"], {"company": "OpenAI", "position": "Research Engineer"})

    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["title"] == "OpenAI - Research Engineer"
    assert detail["company"] == "OpenAI"
    assert detail["role"] == "Research Engineer"


def test_application_review_summary_uses_latest_session(tmp_path, monkeypatch):
    from services.storage import job_tracker as jt

    monkeypatch.setattr(review, "DB_PATH", str(tmp_path / "review.db"))
    monkeypatch.setattr(jt, "DB_PATH", str(tmp_path / "job_tracker.db"))
    review.init_db()
    jt.init_db()

    app = jt.create_application({"company": "A 公司", "position": "后端"})
    old_id = review.create_session(time.time() - 100, True, True, application_id=app["id"])
    for idx in range(5):
        review.add_turn(
            session_id=old_id,
            qa_id=f"old-{idx}",
            seq=idx + 1,
            question_text=f"旧问题 {idx + 1}",
            candidate_answer_text=f"旧回答 {idx + 1}",
        )
    review.end_session(old_id, status="completed", ended_at=time.time() - 90)
    review.update_session_summary(old_id, "old", [], [], avg_score=5.0)
    latest_id = review.create_session(time.time() - 10, True, True, application_id=app["id"])
    for idx in range(5):
        review.add_turn(
            session_id=latest_id,
            qa_id=f"latest-{idx}",
            seq=idx + 1,
            question_text=f"新问题 {idx + 1}",
            candidate_answer_text=f"新回答 {idx + 1}",
        )
    review.end_session(latest_id, status="completed", ended_at=time.time())
    review.update_session_summary(latest_id, "latest", [], [], avg_score=8.0)

    summary = review.get_application_review_summaries([app["id"]])[app["id"]]

    assert summary["review_count"] == 2
    assert summary["linked_review_count"] == 2
    assert summary["latest_review_id"] == latest_id
    assert summary["latest_linked_review_id"] == latest_id
    assert summary["latest_avg_score"] == 8.0
