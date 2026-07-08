"""
Review 模块与 Assist 生命周期集成
在 assist start/stop 时自动创建和结束 review session
"""
import time
from typing import Optional

from core.logger import get_logger
from core.session import Session
from core.config import get_config
from services.storage import review
from services import review_async_analysis

logger = get_logger(__name__)

_current_review_session_id: Optional[int] = None


def should_create_review_session(
    interviewer_device_id: Optional[int],
    candidate_device_id: Optional[int],
    candidate_asr_enabled: bool,
    written_exam_mode: bool = False,
) -> bool:
    """
    判断是否应该创建 review session。

    落盘与 LLM 分析解耦: review_enabled 不再阻止创建 session —— 只要录音设备
    配齐就创建并落盘 QA turns, 后续是否自动跑 LLM 复盘由 on_assist_stop 按
    review_enabled 决定 (关闭时置 recorded 状态, 可手动触发)。

    普通语音面试仅当以下条件全部满足才创建:
    1. interviewer 音频设备有效
    2. candidate mic 有效
    3. candidate ASR 开启
    4. 两个设备不同

    笔试模式没有 interviewer 音频设备, 但仍会产生截图题目和答案, 也需要落入
    面试复盘, 因此 written_exam_mode=True 时允许创建无音频采集的 session。
    """
    if written_exam_mode:
        return True
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
    written_exam_mode: bool = False,
) -> Optional[int]:
    """
    Assist 启动时调用，创建 review session
    返回 session_id 或 None
    """
    global _current_review_session_id

    if not should_create_review_session(
        interviewer_device_id,
        candidate_device_id,
        candidate_asr_enabled,
        written_exam_mode=written_exam_mode,
    ):
        logger.info("Review session not created: conditions not met")
        return None

    try:
        session_id = review.create_session(
            started_at=time.time(),
            interviewer_enabled=interviewer_device_id is not None,
            candidate_enabled=(
                candidate_device_id is not None
                and candidate_asr_enabled
                and candidate_device_id != interviewer_device_id
            ),
            source="written_exam" if written_exam_mode else "assist",
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
            evidence = _build_turn_evidence(qa)
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
                evidence=evidence,
            )

        # 结束录制。review_enabled 控制是否立即进入分析队列; 关闭时只落盘为
        # recorded, 保留 ended_at, 等待前端手动触发 (POST /review/sessions/{id}/generate)。
        # completed 只表示分析结果已经生成。
        turn_count = len(session.qa_pairs)
        auto_analyze = bool(get_config().review_enabled) and turn_count >= review.AUTO_REVIEW_SYNC_MIN_TURNS
        review.end_session(
            session_id=session_id,
            status="analyzing" if auto_analyze else "recorded",
            ended_at=time.time(),
        )

        logger.info(
            "Review session ended: session_id=%d, turn_count=%d, auto_analyze=%s",
            session_id,
            turn_count,
            auto_analyze,
        )

        if auto_analyze:
            # 启动后台分析
            review_async_analysis.analyze_session_async(session_id)
        else:
            logger.info(
                "Review session %d recorded (auto-analysis skipped; review_enabled=%s, turn_count=%d, min_turns=%d)",
                session_id,
                bool(get_config().review_enabled),
                turn_count,
                review.AUTO_REVIEW_SYNC_MIN_TURNS,
            )

        return session_id
    except Exception as e:
        logger.error("Failed to end review session %d: %s", session_id, e, exc_info=True)
        return None


def get_current_review_session_id() -> Optional[int]:
    """返回当前进行中的 review session id"""
    return _current_review_session_id


def _build_turn_evidence(qa) -> dict:
    verdict = str(getattr(qa, "vision_verify_verdict", "") or "").strip().upper()
    if verdict not in ("PASS", "FAIL", "UNKNOWN"):
        return {}
    return {
        "vision_verify": {
            "verdict": verdict,
            "reason": str(getattr(qa, "vision_verify_reason", "") or "").strip(),
        },
    }


def on_assist_pause():
    """Assist 暂停时调用，暂不需要特殊处理"""
    pass


def on_assist_resume():
    """Assist 恢复时调用，暂不需要特殊处理"""
    pass
