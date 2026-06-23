"""
后台分析任务：异步分析 review session
"""
import threading
from typing import Optional

from core.config import get_config
from core.logger import get_logger
from services.storage import review
from services import review_analysis

logger = get_logger(__name__)


def analyze_session_async(session_id: int):
    """
    异步分析 session
    在后台线程中执行，不阻塞主流程
    """
    thread = threading.Thread(
        target=_analyze_session_worker,
        args=(session_id,),
        daemon=True,
    )
    thread.start()
    logger.info("Started background analysis for session_id=%d", session_id)


def _analyze_session_worker(session_id: int):
    """
    分析 worker
    1. 逐题分析
    2. 生成整场总结
    3. 更新数据库
    """
    try:
        logger.info("Analyzing session_id=%d", session_id)

        # 标记为分析中
        review.update_session_status(session_id, "analyzing")

        # 获取 session detail
        detail = review.get_session_detail(session_id)
        if not detail:
            logger.error("Session %d not found", session_id)
            return

        turns = detail.get("turns", [])
        if not turns:
            logger.info("Session %d has no turns, mark as completed", session_id)
            review.update_session_status(session_id, "completed")
            return

        # 逐题分析
        analyzed_turns = []
        for turn in turns:
            if turn["is_partial"]:
                logger.info("Skip partial turn: session_id=%d, turn_id=%d", session_id, turn["id"])
                continue

            try:
                result = review_analysis.analyze_turn(
                    question=turn["question_text"],
                    candidate_answer=turn["candidate_answer_text"],
                    reference_answer=turn.get("reference_answer_text", ""),
                    code_text=turn.get("code_text", ""),
                )

                # 更新 turn
                review.update_turn_analysis(
                    turn_id=turn["id"],
                    analysis_status="completed",
                    strengths=result.get("strengths", []),
                    risks=result.get("risks", []),
                    evidence=result.get("evidence", {}),
                    scorecard=result.get("scorecard", {}),
                )

                analyzed_turns.append({
                    **turn,
                    "strengths": result.get("strengths", []),
                    "risks": result.get("risks", []),
                    "scorecard": result.get("scorecard", {}),
                })

                logger.info("Analyzed turn: session_id=%d, turn_id=%d", session_id, turn["id"])

            except Exception as e:
                logger.error(
                    "Failed to analyze turn: session_id=%d, turn_id=%d, error=%s",
                    session_id,
                    turn["id"],
                    e,
                    exc_info=True,
                )
                review.update_turn_analysis(
                    turn_id=turn["id"],
                    analysis_status="failed",
                )

        # 生成整场总结
        if analyzed_turns:
            try:
                summary_result = review_analysis.generate_summary(
                    turns=analyzed_turns,
                )

                # 计算平均分
                all_scores = []
                for t in analyzed_turns:
                    scorecard = t.get("scorecard", {})
                    if scorecard:
                        all_scores.extend(scorecard.values())
                avg_score = sum(all_scores) / len(all_scores) if all_scores else None

                # 更新 session
                review.update_session_summary(
                    session_id=session_id,
                    summary_markdown=summary_result.get("summary_markdown", ""),
                    strong_points=summary_result.get("strong_points", []),
                    weak_points=summary_result.get("weak_points", []),
                    avg_score=avg_score,
                )

                logger.info("Generated summary for session_id=%d", session_id)

            except Exception as e:
                logger.error(
                    "Failed to generate summary: session_id=%d, error=%s",
                    session_id,
                    e,
                    exc_info=True,
                )

        # 标记为完成
        review.update_session_status(session_id, "completed")
        logger.info("Analysis completed for session_id=%d", session_id)

    except Exception as e:
        logger.error(
            "Analysis worker failed: session_id=%d, error=%s",
            session_id,
            e,
            exc_info=True,
        )
        try:
            review.update_session_status(session_id, "analysis_failed")
        except Exception:
            pass
