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
    create_answer_stream_sanitizer,
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
    submit_knowledge_record: Callable[[str, str, str, str], bool]
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


def _normalize_task_images(image: Any) -> list[str]:
    if isinstance(image, list):
        return [str(x) for x in image if x]
    if image:
        return [str(image)]
    return []


def _image_payload_chars(images: list[str]) -> int:
    return sum(len(img or "") for img in images)


def _message_text_chars(messages: list[dict]) -> int:
    total = 0
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            total += len(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    total += len(str(part.get("text") or ""))
    return total


def _candidate_context_settings(cfg) -> tuple[bool, int, int, int]:
    enabled = bool(getattr(cfg, "candidate_asr_enabled", False)) and bool(
        getattr(cfg, "candidate_context_enabled", True)
    )
    return (
        enabled,
        max(0, min(2000, int(getattr(cfg, "candidate_context_wait_ms", 200) or 0))),
        max(100, min(4000, int(getattr(cfg, "candidate_context_max_chars", 900) or 900))),
        max(1, min(100, int(getattr(cfg, "candidate_context_min_chars", 6) or 6))),
    )


def _history_context_options(prompt_mode: PromptMode, written_exam: bool) -> dict[str, Any]:
    if written_exam:
        return {
            "profile": "written_none",
            "turns": 0,
            "max_chars_per_message": 0,
            "include_summary": False,
            "total_char_budget": 0,
        }
    if prompt_mode == PROMPT_MODE_ASR_REALTIME:
        return {
            "profile": "asr_light",
            "turns": 2,
            "max_chars_per_message": 700,
            "include_summary": False,
            "total_char_budget": 1800,
        }
    if prompt_mode == PROMPT_MODE_SERVER_SCREEN:
        return {
            "profile": "screen_light",
            "turns": 1,
            "max_chars_per_message": 700,
            "include_summary": False,
            "total_char_budget": 900,
        }
    if prompt_mode == PROMPT_MODE_MANUAL_TEXT:
        return {
            "profile": "manual_balanced",
            "turns": 3,
            "max_chars_per_message": 900,
            "include_summary": True,
            "total_char_budget": 2600,
        }
    return {
        "profile": "default",
        "turns": None,
        "max_chars_per_message": None,
        "include_summary": True,
        "total_char_budget": None,
    }


def _max_tokens_for_prompt(prompt_mode: PromptMode, cfg) -> int:
    return max(1, int(getattr(cfg, "max_tokens", 4096) or 4096))


def _wait_for_candidate_context_if_pending(session_ref, qa_id: str, wait_ms: int) -> None:
    if wait_ms <= 0 or not qa_id:
        return
    deadline = time.monotonic() + (wait_ms / 1000.0)
    while time.monotonic() < deadline:
        if not getattr(session_ref, "has_candidate_asr_pending_for_qa", lambda *_args, **_kwargs: False)(qa_id):
            return
        time.sleep(0.025)


def _supports_candidate_context_source(source: str, meta: dict[str, Any]) -> bool:
    if source == "manual_text":
        return True
    if source in ("asr", "conversation_loopback", "conversation_mic"):
        return True
    return meta.get("origin") == "asr"


def prompt_mode_for_task(
    source: str,
    manual_input: bool,
    written_exam: bool = False,
) -> PromptMode:
    if written_exam:
        return PROMPT_MODE_WRITTEN_EXAM
    if (source or "").startswith("server_screen_"):
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
    if model_idx < 0 or model_idx >= len(cfg.models):
        return
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

    images = _normalize_task_images(image)

    if images:
        user_for_llm: Any = [
            {"type": "text", "text": question_text},
        ]
        for data_url in images:
            user_for_llm.append({"type": "image_url", "image_url": {"url": data_url}})
    else:
        user_for_llm = question_text

    with conversation_lock:
        session_ref = get_session()
        if written_exam:
            base_messages = []
            history_stats = {"messages": 0, "history_messages": 0, "stripped_images": 0}
        else:
            history_options = _history_context_options(prompt_mode, written_exam)
            base_messages = list(session_ref.get_conversation_messages_for_llm(**history_options))
            history_stats = dict(getattr(session_ref, "last_llm_history_stats", {}) or {})
        last_qa = session_ref.get_last_qa()
        candidate_context_enabled, candidate_wait_ms, candidate_max_chars, candidate_min_chars = _candidate_context_settings(cfg)
        candidate_source_ok = _supports_candidate_context_source(source, meta)
        should_use_candidate_context = bool(
            not written_exam
            and not images
            and last_qa
            and candidate_source_ok
            and candidate_context_enabled
        )
        actual_spoken_answer = (
            session_ref.get_candidate_answer_for_qa(last_qa.id, max_chars=candidate_max_chars)
            if last_qa
            and should_use_candidate_context
            else ""
        )

    if should_use_candidate_context and last_qa and not actual_spoken_answer:
        _wait_for_candidate_context_if_pending(session_ref, last_qa.id, candidate_wait_ms)
        with conversation_lock:
            actual_spoken_answer = session_ref.get_candidate_answer_for_qa(
                last_qa.id,
                max_chars=candidate_max_chars,
            )
    if len(actual_spoken_answer.strip()) < candidate_min_chars:
        actual_spoken_answer = ""
    candidate_context_chars = len(actual_spoken_answer[:candidate_max_chars]) if actual_spoken_answer else 0

    is_followup = False
    if (
        not written_exam
        and not images
        and last_qa
        and _supports_candidate_context_source(source, meta)
        and classify_followup(question_text, last_qa.question, actual_spoken_answer or last_qa.answer[:500])
    ):
        is_followup = True
        prev_answer_budget = max(200, min(500, candidate_max_chars // 2))
        prev_answer_summary = last_qa.answer[:prev_answer_budget]
        if not candidate_context_enabled:
            user_for_llm = (
                f"[追问上下文] 上一个问题：{last_qa.question}\n"
                f"你上次回答的要点：{prev_answer_summary}\n\n"
                f"现在面试官追问：{question_text}"
            )
        else:
            actual_block = (
                f"候选人麦克风转写（辅助参考，可能有识别误差）：{actual_spoken_answer[:candidate_max_chars]}\n"
                if actual_spoken_answer
                else "候选人麦克风转写：未启用或未捕获到；本轮按旧逻辑仅参考助手建议答案。\n"
            )
            user_for_llm = (
                f"[追问上下文] 上一个问题：{last_qa.question}\n"
                f"{actual_block}"
                f"助手上一轮建议答案（参考候选人可能听到过的答题方向，不代表候选人照读）：{prev_answer_summary}\n"
                "追问回答规则：以当前面试官追问和会议音频识别出的题意为主；"
                "候选人麦克风转写用于理解上一轮回答大意，但不要当作逐字稿。"
                "如果转写内容明显识别错、与当前追问冲突或不自然，请降权使用，不要强行套入。\n\n"
                f"现在面试官追问：{question_text}"
            )
    elif should_use_candidate_context and last_qa and actual_spoken_answer:
        user_for_llm = (
            f"[候选人回答辅助背景] 上一个问题：{last_qa.question}\n"
            f"候选人上一轮麦克风转写（可能有识别误差）：{actual_spoken_answer[:candidate_max_chars]}\n"
            "使用规则：这段转写可帮助延续候选人上一轮回答的大意、项目线索和技术关键词；"
            "以当前面试官问题为主，如果当前问题与上一轮无关，或转写明显不准，请忽略或弱化它。"
            "不得假设候选人照读了助手上一轮建议答案，也不要把转写当成逐字事实。\n\n"
            f"现在面试官问题：{question_text}"
        )

    with conversation_lock:
        session_ref.close_candidate_answer_window()

    messages_for_llm = base_messages + [{"role": "user", "content": user_for_llm}]
    deps.logger.info(
        "LLM_INPUT_STATS source=%s prompt_mode=%s written_exam=%s image_count=%d "
        "image_payload_chars=%d history_used=%s history_profile=%s history_messages=%d "
        "historical_images_stripped=%d history_text_raw_chars=%d "
        "history_text_trimmed_chars=%d candidate_context_chars=%d "
        "message_count=%d text_chars=%d",
        source,
        prompt_mode,
        written_exam,
        len(images),
        _image_payload_chars(images),
        bool(base_messages),
        str(history_stats.get("profile", "default")),
        int(history_stats.get("history_messages", 0) or 0),
        int(history_stats.get("stripped_images", 0) or 0),
        int(history_stats.get("raw_text_chars", 0) or 0),
        int(history_stats.get("trimmed_text_chars", 0) or 0),
        candidate_context_chars,
        len(messages_for_llm),
        _message_text_chars(messages_for_llm),
    )

    if len(images) > 1:
        display_question = f"{question_text} [📷 多图 x{len(images)}]"
    else:
        display_question = question_text + (" [📷 附图]" if images else "")
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
    if not images and _supports_candidate_context_source(source, meta) and candidate_context_enabled:
        with conversation_lock:
            get_session().open_candidate_answer_window(qa_id)

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

    raw_full_answer = ""
    stream_sanitizer = create_answer_stream_sanitizer(prompt_mode)
    full_think = ""
    token_prompt_delta = 0
    token_completion_delta = 0

    def _record_usage(prompt_tokens: int, completion_tokens: int, _model_name: str) -> None:
        nonlocal token_prompt_delta, token_completion_delta
        token_prompt_delta += int(prompt_tokens or 0)
        token_completion_delta += int(completion_tokens or 0)

    exam_think_notified = False
    gen_start = time.monotonic()
    first_token_mono: Optional[float] = None
    try:
        think_override = (
            written_exam_think if prompt_mode == PROMPT_MODE_WRITTEN_EXAM and (source or "").startswith("server_screen_")
            else None
        )
        for chunk_type, chunk_text in chat_stream_single_model(
            model_cfg,
            messages_for_llm,
            system_prompt=system_prompt,
            abort_check=deps.abort_check,
            override_think_mode=think_override,
            usage_callback=_record_usage,
            override_max_tokens=_max_tokens_for_prompt(prompt_mode, cfg),
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
                raw_full_answer += chunk_text
                clean_chunk = stream_sanitizer.push(chunk_text)
                if clean_chunk:
                    deps.broadcast(
                        {"type": "answer_chunk", "id": qa_id, "chunk": clean_chunk}
                    )
    except Exception as exc:
        deps.error_logger.error("LLM stream error id=%s: %s", qa_id, exc, exc_info=True)
        err = f"\n\n[生成答案出错: {exc}]"
        raw_full_answer += err
        tail = stream_sanitizer.finish()
        if tail:
            deps.broadcast({"type": "answer_chunk", "id": qa_id, "chunk": tail})
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

    tail = stream_sanitizer.finish()
    if tail:
        deps.broadcast({"type": "answer_chunk", "id": qa_id, "chunk": tail})

    full_answer = postprocess_answer_for_mode(raw_full_answer, prompt_mode)

    def _commit():
        if not deps.is_session_current(sess_v):
            return
        session = get_session()
        pre_user_len = len(session.conversation_history)
        pre_qa_len = len(session.qa_pairs)
        try:
            with conversation_lock:
                if images:
                    suffix = f" [图片已省略 x{len(images)}]"
                    session.add_user_message(question_text + suffix)
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
                "answer_len=%d think_len=%d tokens_prompt_delta=%d tokens_completion_delta=%d "
                "tokens_prompt=%d tokens_completion=%d",
                qa_id,
                model_cfg.name,
                first_token_ms,
                gen_elapsed,
                len(full_answer),
                len(full_think),
                token_prompt_delta,
                token_completion_delta,
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
                    "first_token_ms": int(first_token_ms),
                    "total_ms": int(gen_elapsed),
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
            candidate_answer_for_record = ""
            with conversation_lock:
                candidate_answer_for_record = session.get_candidate_answer_for_qa(
                    qa_id,
                    max_chars=2400,
                )
            if not deps.submit_knowledge_record(question_text, full_answer, qa_id, candidate_answer_for_record):
                deps.error_logger.warning(
                    "KNOWLEDGE_ENQUEUE_DROP id=%s question=%r",
                    qa_id,
                    question_text[:80],
                )
            if prompt_mode == PROMPT_MODE_SERVER_SCREEN and images:
                try:
                    from services.vision_verify import schedule_self_verify

                    schedule_self_verify(
                        qa_id=qa_id,
                        answer=full_answer,
                        image_data_url=images[0],
                        broadcast_callable=deps.broadcast,
                    )
                except Exception as exc: # noqa: BLE001
                    deps.error_logger.warning(
                        "VISION_VERIFY_SCHEDULE_FAIL id=%s err=%s",
                        qa_id,
                        exc,
                    )
        except Exception as exc:
            with conversation_lock:
                if len(session.qa_pairs) > pre_qa_len:
                    session.qa_pairs.pop()
                if len(session.conversation_history) > pre_user_len:
                    del session.conversation_history[pre_user_len:]
            deps.error_logger.error(
                "_commit failed for id=%s seq=%d: %s",
                qa_id, seq, exc, exc_info=True,
            )
            deps.broadcast({"type": "answer_error", "id": qa_id, "message": "答案保存失败"})

    deps.flush_commit(seq, _commit)
