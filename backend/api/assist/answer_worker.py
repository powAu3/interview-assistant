"""Answer generation worker for the assist pipeline."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

from core.config import get_config
from core.session import get_session, conversation_lock
from services.stt import classify_followup
from services.llm import (
    PROMPT_MODE_ASR_REALTIME,
    PROMPT_MODE_MANUAL_TEXT,
    PROMPT_MODE_SERVER_SCREEN,
    PROMPT_MODE_WRITTEN_EXAM,
    PromptMode,
    build_system_prompt,
    chat_stream_single_model,
    get_token_stats,
    postprocess_answer_for_mode,
)
from api.assist.scheduler import TaskPayload


@dataclass(frozen=True)
class AnswerWorkerDeps:
    abort_check: Callable[[], bool]
    is_session_current: Callable[[int], bool]
    flush_commit: Callable[[int, Callable[[], None]], None]
    mark_seq_skipped: Callable[[int], None]
    submit_knowledge_record: Callable[[str, str], bool]
    broadcast: Callable[[dict], None]
    logger: Any
    error_logger: Any


def _screen_region_label(region: str) -> str:
    labels = {
        "full": "主显示器全屏",
        "left_half": "主显示器左半屏",
        "right_half": "主显示器右半屏",
        "top_half": "主显示器上半屏",
        "bottom_half": "主显示器下半屏",
    }
    return labels.get(region, "主显示器左半屏")


def prompt_server_screen_code(language: str, region: str) -> str:
    where = _screen_region_label(region)
    return (
        f"下图来自运行本后端的电脑「{where}」的实时画面，可能包含题目描述、输入输出约束或代码片段。\n\n"
        f"请基于图中可见信息作答。若是编程题，代码请优先使用 {language}（SQL 题使用 sql）。\n\n"
        "请尽量按以下顺序组织：题目理解、主方案代码、备选方案代码（1-2 个）、方案对比、思路与复杂度、测试用例设计。\n"
        "如果关键信息看不清，请明确说明缺失项，不要编造；可在合理假设下给出最小可执行方案。"
    )


def prompt_mode_for_task(
    source: str,
    manual_input: bool,
    written_exam: bool = False,
) -> PromptMode:
    if source.startswith("server_screen_"):
        if written_exam:
            return PROMPT_MODE_WRITTEN_EXAM
        return PROMPT_MODE_SERVER_SCREEN
    if manual_input:
        return PROMPT_MODE_MANUAL_TEXT
    return PROMPT_MODE_ASR_REALTIME


def process_question_parallel(
    task: TaskPayload,
    seq: int,
    model_idx: int,
    sess_v: int,
    deps: AnswerWorkerDeps,
):
    question_text, image, manual_input, source, meta = task
    cfg = get_config()
    model_cfg = cfg.models[model_idx]

    written_exam = bool(getattr(cfg, "written_exam_mode", False))
    written_exam_think = bool(getattr(cfg, "written_exam_think", False))
    prompt_mode = prompt_mode_for_task(source, manual_input, written_exam=written_exam)

    kb_hits: list = []
    kb_latency_ms = 0
    kb_degraded = False
    if (
        bool(getattr(cfg, "kb_enabled", False))
        and prompt_mode in set(getattr(cfg, "kb_trigger_modes", []) or [])
        and (question_text or "").strip()
    ):
        try:
            from services.kb.retriever import retrieve as _kb_retrieve

            deadline_ms = (
                int(getattr(cfg, "kb_asr_deadline_ms", 80) or 80)
                if prompt_mode == PROMPT_MODE_ASR_REALTIME
                else int(getattr(cfg, "kb_deadline_ms", 150) or 150)
            )
            t0 = time.monotonic()
            kb_hits = _kb_retrieve(
                question_text,
                k=int(getattr(cfg, "kb_top_k", 4) or 4),
                deadline_ms=deadline_ms,
                mode=prompt_mode,
            )
            kb_latency_ms = int((time.monotonic() - t0) * 1000)
        except Exception as exc:
            deps.error_logger.warning("kb retrieve in answer worker failed: %s", exc)
            kb_hits = []
            kb_degraded = True

    system_prompt = build_system_prompt(
        manual_input=manual_input,
        mode=prompt_mode,
        screen_region=getattr(cfg, "screen_capture_region", "left_half"),
        high_churn_short_answer=bool(meta.get("high_churn_short_answer", False)),
        kb_hits=kb_hits or None,
    )

    if image:
        user_for_llm: Any = [
            {"type": "text", "text": question_text},
            {"type": "image_url", "image_url": {"url": image}},
        ]
    else:
        user_for_llm = question_text

    with conversation_lock:
        session_ref = get_session()
        base_messages = list(session_ref.get_conversation_messages_for_llm())
        last_qa = session_ref.get_last_qa()

    is_followup = False
    if (
        not image
        and last_qa
        and source in ("asr", "manual_text")
        and classify_followup(question_text, last_qa.question, last_qa.answer)
    ):
        is_followup = True
        prev_answer_summary = last_qa.answer[:500]
        user_for_llm = (
            f"[追问上下文] 上一个问题：{last_qa.question}\n"
            f"你上次回答的要点：{prev_answer_summary}\n\n"
            f"现在面试官追问：{question_text}"
        )

    messages_for_llm = base_messages + [{"role": "user", "content": user_for_llm}]

    display_question = question_text + (" [📷 附图]" if image else "")
    qa_id = f"qa-{seq}-{int(time.time() * 1000)}"
    deps.logger.info(
        "ANSWER_START id=%s model=%s source=%s followup=%s q=%r",
        qa_id,
        model_cfg.name,
        source,
        is_followup,
        question_text[:120],
    )
    deps.broadcast(
        {
            "type": "answer_start",
            "id": qa_id,
            "question": display_question,
            "source": source,
            "model_name": model_cfg.name,
            "model_index": model_idx,
        }
    )

    if kb_hits or kb_degraded:
        try:
            from services.kb.ws import build_kb_hits_payload as _kb_payload

            deps.broadcast(
                _kb_payload(
                    qa_id=qa_id,
                    hits=kb_hits,
                    latency_ms=kb_latency_ms,
                    degraded=kb_degraded,
                    excerpt_chars=int(
                        getattr(cfg, "kb_prompt_excerpt_chars", 300) or 300
                    ),
                )
            )
        except Exception as exc:
            deps.error_logger.warning("broadcast kb_hits failed: %s", exc)

    full_answer = ""
    full_think = ""
    exam_think_notified = False
    gen_start = time.monotonic()
    first_token_mono: Optional[float] = None
    try:
        think_override = (
            written_exam_think if prompt_mode == PROMPT_MODE_WRITTEN_EXAM else None
        )
        for chunk_type, chunk_text in chat_stream_single_model(
            model_cfg,
            messages_for_llm,
            system_prompt=system_prompt,
            abort_check=deps.abort_check,
            override_think_mode=think_override,
        ):
            if deps.abort_check():
                break
            if first_token_mono is None:
                first_token_mono = time.monotonic()
            if chunk_type == "think":
                full_think += chunk_text
                if prompt_mode == PROMPT_MODE_WRITTEN_EXAM:
                    if not exam_think_notified:
                        exam_think_notified = True
                        deps.broadcast(
                            {
                                "type": "answer_think_chunk",
                                "id": qa_id,
                                "chunk": "思考中...",
                            }
                        )
                else:
                    deps.broadcast(
                        {
                            "type": "answer_think_chunk",
                            "id": qa_id,
                            "chunk": chunk_text,
                        }
                    )
            else:
                full_answer += chunk_text
                deps.broadcast(
                    {"type": "answer_chunk", "id": qa_id, "chunk": chunk_text}
                )
    except Exception as exc:
        deps.error_logger.error("LLM stream error id=%s: %s", qa_id, exc, exc_info=True)
        err = f"\n\n[生成答案出错: {exc}]"
        full_answer += err
        deps.broadcast({"type": "answer_chunk", "id": qa_id, "chunk": err})

    gen_elapsed = (time.monotonic() - gen_start) * 1000
    first_token_ms = (
        (first_token_mono - gen_start) * 1000 if first_token_mono else gen_elapsed
    )

    if deps.abort_check():
        deps.logger.info("ANSWER_CANCEL id=%s after=%.0fms", qa_id, gen_elapsed)
        deps.broadcast({"type": "answer_cancelled", "id": qa_id})
        deps.mark_seq_skipped(seq)
        return

    full_answer = postprocess_answer_for_mode(full_answer, prompt_mode)

    def _commit():
        if not deps.is_session_current(sess_v):
            return
        session = get_session()
        try:
            with conversation_lock:
                if image:
                    content: list = [{"type": "text", "text": question_text}]
                    content.append({"type": "image_url", "image_url": {"url": image}})
                    session.add_user_message(content)
                else:
                    session.add_user_message(question_text)
                session.add_assistant_message(full_answer)
                session.add_qa(
                    display_question,
                    full_answer,
                    qa_id=qa_id,
                    source=source,
                    model_name=model_cfg.name,
                )
            stats = get_token_stats()
            deps.logger.info(
                "ANSWER_DONE id=%s model=%s first_token=%.0fms total=%.0fms "
                "answer_len=%d think_len=%d tokens_prompt=%d tokens_completion=%d",
                qa_id,
                model_cfg.name,
                first_token_ms,
                gen_elapsed,
                len(full_answer),
                len(full_think),
                stats["prompt"],
                stats["completion"],
            )
            deps.broadcast(
                {
                    "type": "answer_done",
                    "id": qa_id,
                    "question": display_question,
                    "answer": full_answer,
                    "think": full_think,
                    "model_name": model_cfg.name,
                }
            )
            deps.broadcast(
                {
                    "type": "token_update",
                    "prompt": stats["prompt"],
                    "completion": stats["completion"],
                    "total": stats["total"],
                    "by_model": stats.get("by_model", {}),
                }
            )
            if not deps.submit_knowledge_record(question_text, full_answer):
                deps.error_logger.warning(
                    "KNOWLEDGE_ENQUEUE_DROP id=%s question=%r",
                    qa_id,
                    question_text[:80],
                )
            if prompt_mode == PROMPT_MODE_SERVER_SCREEN and image:
                try:
                    from services.vision_verify import schedule_self_verify

                    schedule_self_verify(
                        qa_id=qa_id,
                        answer=full_answer,
                        image_data_url=image,
                        broadcast_callable=deps.broadcast,
                    )
                except Exception as exc:  # noqa: BLE001
                    deps.error_logger.warning(
                        "VISION_VERIFY_SCHEDULE_FAIL id=%s err=%s",
                        qa_id,
                        exc,
                    )
        except Exception:
            deps.broadcast({"type": "answer_cancelled", "id": qa_id})

    deps.flush_commit(seq, _commit)
