"""
测试 review 与 assist 生命周期集成
"""
import pytest
from pathlib import Path
import sys
from unittest.mock import MagicMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import review_integration
from services import review_async_analysis
from services.storage import review
from core.session import Session, QAPair


class _FakeConfig:
    """最小化 config 替身, 只暴露 review_enabled"""

    def __init__(self, review_enabled: bool):
        self.review_enabled = review_enabled


def _make_qa_pairs(count: int) -> list[QAPair]:
    return [
        QAPair(
            id=f"qa{i}",
            question=f"问题 {i}",
            answer=f"参考答案 {i}",
            timestamp=1000.0 + i,
            source="asr",
            model_name="gpt-4o",
        )
        for i in range(1, count + 1)
    ]


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

    # 笔试模式无音频设备也应落入复盘
    assert review_integration.should_create_review_session(
        interviewer_device_id=None,
        candidate_device_id=None,
        candidate_asr_enabled=False,
        written_exam_mode=True,
    ) is True


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


def test_written_exam_start_creates_session_without_audio_devices():
    """笔试模式无录音设备时仍创建复盘 session"""
    session_id = review_integration.on_assist_start(
        interviewer_device_id=None,
        candidate_device_id=None,
        candidate_asr_enabled=False,
        written_exam_mode=True,
    )

    assert session_id is not None
    assert review_integration.get_current_review_session_id() == session_id

    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["source"] == "written_exam"
    assert detail["interviewer_capture_enabled"] == 0
    assert detail["candidate_capture_enabled"] == 0


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
            vision_verify_verdict="FAIL",
            vision_verify_reason="截图里的第二个样例不通过",
        ),
        QAPair(id="qa3", question="什么是 CAP？", answer="CAP 是一致性可用性分区容错。", timestamp=3000.0),
        QAPair(id="qa4", question="Redis 持久化方案？", answer="RDB 和 AOF。", timestamp=4000.0),
        QAPair(id="qa5", question="线程和进程区别？", answer="资源隔离与切换开销不同。", timestamp=5000.0),
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
    assert detail["turn_count"] == 5
    assert len(detail["turns"]) == 5
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
    assert turn2["evidence"]["vision_verify"] == {
        "verdict": "FAIL",
        "reason": "截图里的第二个样例不通过",
    }


def test_written_exam_stop_saves_turns_without_candidate_asr(monkeypatch):
    """笔试截图答题没有候选人麦克风时也保存到复盘"""
    monkeypatch.setattr(
        review_integration, "get_config", lambda: _FakeConfig(review_enabled=False)
    )

    session_id = review_integration.on_assist_start(
        interviewer_device_id=None,
        candidate_device_id=None,
        candidate_asr_enabled=False,
        written_exam_mode=True,
    )
    assert session_id is not None

    mock_session = Session()
    mock_session.qa_pairs = [
        QAPair(
            id="qa-screen-1",
            question="截图题：两数之和怎么写？ [📷 附图]",
            answer="用哈希表一次遍历。",
            source="server_screen_single",
            model_name="lite-ark",
        ),
    ]

    ended_session_id = review_integration.on_assist_stop(mock_session)

    assert ended_session_id == session_id
    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["source"] == "written_exam"
    assert detail["status"] == "recorded"
    assert detail["turn_count"] == 1
    assert detail["turns"][0]["qa_id"] == "qa-screen-1"
    assert detail["turns"][0]["candidate_answer_text"] == ""
    assert detail["turns"][0]["reference_answer_text"] == "用哈希表一次遍历。"


def test_written_exam_analysis_worker_uses_written_exam_source(monkeypatch):
    """笔试复盘分析按截图题生成答案模式处理，而不是按候选人口述评分"""
    session_id = review.create_session(
        started_at=1000.0,
        interviewer_enabled=False,
        candidate_enabled=False,
        source="written_exam",
    )
    review.add_turn(
        session_id=session_id,
        qa_id="qa-screen-1",
        seq=1,
        question_text="截图题：两数之和",
        candidate_answer_text="",
        reference_answer_text="用哈希表一次遍历。",
    )

    calls: dict[str, object] = {}

    def fake_analyze_turn(**kwargs):
        calls["turn"] = kwargs
        return {
            "strengths": ["复杂度清晰"],
            "risks": [],
            "evidence": {"review_mode": "written_exam"},
            "scorecard": {"正确性": 8, "完整性": 7, "可提交性": 8},
            "corrected_answer": None,
        }

    def fake_generate_summary(*, turns, review_source):
        calls["summary"] = {"turns": turns, "review_source": review_source}
        return {
            "summary_markdown": "## 笔试答题质量\n\n整体可提交。",
            "strong_points": ["复杂度清晰"],
            "weak_points": [],
        }

    monkeypatch.setattr(review_async_analysis.review_analysis, "analyze_turn", fake_analyze_turn)
    monkeypatch.setattr(review_async_analysis.review_analysis, "generate_summary", fake_generate_summary)

    review_async_analysis._analyze_session_worker(session_id)

    assert calls["turn"]["review_source"] == "written_exam"
    assert calls["turn"]["candidate_answer"] == ""
    assert calls["turn"]["reference_answer"] == "用哈希表一次遍历。"
    assert calls["summary"]["review_source"] == "written_exam"
    assert calls["summary"]["turns"][0]["reference_answer_text"] == "用哈希表一次遍历。"

    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["status"] == "completed"
    assert detail["summary_markdown"].startswith("## 笔试答题质量")
    assert detail["avg_score"] == pytest.approx(23 / 3)


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
    mock_session.qa_pairs = _make_qa_pairs(5)
    mock_session.get_candidate_answer_for_qa = lambda qa_id, max_chars: "候选人回答"

    ended_session_id = review_integration.on_assist_stop(mock_session)
    assert ended_session_id == session_id

    # 4. 验证清理
    assert review_integration.get_current_review_session_id() is None

    # 5. 验证数据持久化
    detail = review.get_session_detail(session_id)
    assert detail["status"] == "analyzing"
    assert detail["turn_count"] == 5
    assert started_analysis == [session_id]


def test_on_assist_stop_records_short_session_without_auto_analysis(monkeypatch):
    monkeypatch.setattr(
        review_integration, "get_config", lambda: _FakeConfig(review_enabled=True)
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
    mock_session.qa_pairs = _make_qa_pairs(3)
    mock_session.get_candidate_answer_for_qa = lambda qa_id, max_chars: f"候选人回答 {qa_id}"

    ended_session_id = review_integration.on_assist_stop(mock_session)

    assert ended_session_id == session_id
    assert started_analysis == []
    detail = review.get_session_detail(session_id)
    assert detail is not None
    assert detail["status"] == "recorded"
    assert detail["turn_count"] == 3


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
