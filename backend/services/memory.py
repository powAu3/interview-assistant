"""会话记忆滚动摘要 Agent (P2-agent-memory)。

会话超过阈值时,把最早的若干条 messages 异步压成一段事实笔记替换掉,
保留最近 N 条原文不动。摘要由活动模型本身完成,失败时维持原样,
保证主对话链路绝不被阻塞。

调用入口由 Session 在 add_*_message 时触发,执行体在守护线程里跑;
最终覆盖动作再次拿 conversation_lock,避免并发写。
"""
from __future__ import annotations

import logging
import threading
from typing import Iterable, List, Sequence

_log = logging.getLogger("memory_agent")

_SUMMARY_PROMPT = """你是面试会话的记忆压缩助手。请把下面这段更早的「问答历史」凝练成简洁的事实笔记,
保留:候选人提到过的关键技术栈/项目/数字、面试官追问过的方向、已经回答过的问题及结论。
舍弃:寒暄、重复表达、过程性思考。

输出要求:
- 中文,Markdown 列表,不超过 12 条 bullet。
- 每条不超过 60 字,不复述原文。
- 结尾如果之前已有摘要,请将旧摘要与本次合并去重。

之前已有的滚动摘要:
{prior}

需要压缩的新历史:
{chunk}

请只输出新的滚动摘要本身,不要任何前后缀文字。
"""


def _render_messages(messages: Iterable[dict]) -> str:
    parts: List[str] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            text_parts: List[str] = []
            for piece in content:
                if isinstance(piece, dict) and piece.get("type") == "text":
                    text_parts.append(str(piece.get("text", "")))
                elif isinstance(piece, dict) and piece.get("type") == "image_url":
                    text_parts.append("[图片]")
            content_str = "\n".join(t for t in text_parts if t).strip()
        else:
            content_str = str(content or "").strip()
        if not content_str:
            continue
        # 单条防止过长
        if len(content_str) > 1500:
            content_str = content_str[:1500] + "…"
        parts.append(f"[{role}] {content_str}")
    return "\n\n".join(parts)


def summarize_messages(messages: Sequence[dict], prior_summary: str = "") -> str:
    """同步调用 LLM 做一次压缩。失败抛异常,调用方负责兜底。"""
    if not messages:
        return prior_summary or ""
    rendered = _render_messages(messages)
    if not rendered.strip():
        return prior_summary or ""

    # 延迟导入,避免循环依赖 (services.llm <-> core.session 路径)
    from core.config import get_config
    from services.llm import _add_tokens, get_client

    cfg = get_config()
    model_cfg = cfg.get_active_model()
    client = get_client()

    prompt = _SUMMARY_PROMPT.format(
        prior=prior_summary.strip() or "(无)",
        chunk=rendered,
    )
    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=600,
        stream=False,
    )
    usage = getattr(response, "usage", None)
    if usage:
        _add_tokens(usage.prompt_tokens or 0, usage.completion_tokens or 0)
    if not response.choices:
        return prior_summary or ""
    text = (response.choices[0].message.content or "").strip()
    return text or (prior_summary or "")


def schedule_compaction(target_session) -> None:
    """供 Session 内部调用:在守护线程中执行一次压缩,然后回写。

    target_session 必须暴露:
      - conversation_history (list)
      - SUMMARY_KEEP_RECENT (int)
      - system_summary (str)
      - _compaction_running (bool)
    """
    from core.session import conversation_lock

    keep = getattr(target_session, "SUMMARY_KEEP_RECENT", 4)

    with conversation_lock:
        if target_session._compaction_running:
            return
        history = target_session.conversation_history
        if len(history) <= keep:
            return
        snapshot_len = len(history) - keep
        snapshot = list(history[:snapshot_len])
        prior = target_session.system_summary or ""
        target_session._compaction_running = True

    def _worker() -> None:
        new_summary: str
        try:
            new_summary = summarize_messages(snapshot, prior)
        except Exception as e:  # noqa: BLE001
            _log.warning("memory compaction failed, keep prior summary: %s", e)
            new_summary = prior
        with conversation_lock:
            try:
                # 仅在历史仍包含我们 snapshot 的部分时,才裁掉相应数量
                if len(target_session.conversation_history) >= snapshot_len:
                    target_session.conversation_history = target_session.conversation_history[snapshot_len:]
                target_session.system_summary = new_summary
            finally:
                target_session._compaction_running = False

    threading.Thread(target=_worker, name="memory-compactor", daemon=True).start()
