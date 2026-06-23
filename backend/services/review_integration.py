"""
Review 模块与 Assist 生命周期集成
在 assist start/stop 时自动创建和结束 review session
"""
import time
from typing import Optional

from core.logger import get_logger
from core.session import Session
from services.storage import review
from services import review_async_analysis

logger = get_logger(__name__)

_current_review_session_id: Optional[int] = None


def should_create_review_session(
    interviewer_device_id: Optional[int],
    candidate_device_id: Optional[int],
    candidate_asr_enabled: bool,
) -> bool:
    """
    判断是否应该创建 review session
    只有同时满足以下条件才记录：
    1. interviewer 音频设备有效
    2. candidate mic 有效
    3. candidate ASR 开启
    4. 两个设备不同
    """
    if interviewer_device_id is None:
        return False
    if candidate_device_id is None:
        return False
    if not candidate_asr_enabled:
        return False
    if interviewer_device_id == candidate_device_id:
        return False
    return True


def on_assist_start(
    interviewer_device_id: Optional[int],
    candidate_device_id: Optional[int],
    candidate_asr_enabled: bool,
) -> Optional[int]:
    """
    Assist 启动时调用，创建 review session
    返回 session_id 或 None
    """
    global _current_review_session_id

    if not should_create_review_session(
        interviewer_device_id, candidate_device_id, candidate_asr_enabled
    ):
        logger.info("Review session not created: conditions not met")
        return None

    try:
        session_id = review.create_session(
            started_at=time.time(),
            interviewer_enabled=True,
            candidate_enabled=True,
        )
        _current_review_session_id = session_id
        logger.info("Review session created: session_id=%d", session_id)
        return session_id
    except Exception as e:
        logger.error("Failed to create review session: %s", e, exc_info=True)
        return None


def on_assist_stop(session: Session) -> Optional[int]:
    """
    Assist 停止时调用，结束 review session 并保存所有 turns
    返回已结束的 session_id 或 None
    """
    global _current_review_session_id

    if _current_review_session_id is None:
        return None

    session_id = _current_review_session_id
    _current_review_session_id = None

    try:
        # 保存所有 QA turns
        for idx, qa in enumerate(session.qa_pairs, start=1):
            candidate_answer = session.get_candidate_answer_for_qa(qa.id, max_chars=2000)
            review.add_turn(
                session_id=session_id,
                qa_id=qa.id,
                seq=idx,
                question_text=qa.question,
                candidate_answer_text=candidate_answer,
                reference_answer_text=qa.answer,  # LLM 给出的参考答案
                duration_ms=0,  # 暂时无法精确计算每题时长
                is_partial=False,
                analysis_status="pending",
            )

        # 结束 session
        review.end_session(
            session_id=session_id,
            ended_at=time.time(),
        )

        logger.info(
            "Review session ended: session_id=%d, turn_count=%d",
            session_id,
            len(session.qa_pairs),
        )

        # 启动后台分析
        review_async_analysis.analyze_session_async(session_id)

        return session_id
    except Exception as e:
        logger.error("Failed to end review session %d: %s", session_id, e, exc_info=True)
        return None


def get_current_review_session_id() -> Optional[int]:
    """返回当前进行中的 review session id"""
    return _current_review_session_id


def on_assist_pause():
    """Assist 暂停时调用，暂不需要特殊处理"""
    pass


def on_assist_resume():
    """Assist 恢复时调用，暂不需要特殊处理"""
    pass
