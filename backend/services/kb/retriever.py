"""KB 检索：FTS5 + 双预算 + 碎句 early-return + 子线程 watchdog。

`retrieve(...)` 是**同步**函数；调用方（pipeline/HTTP）需要 `await run_in_threadpool(retrieve, ...)`。
deadline_ms 作为**硬上限**：超时时用 `sqlite3.Connection.interrupt()` 打断查询，返回空。
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Optional

from core.config import get_config

from ._tokenize import cjk_bigram_query_tokens
from .indexer import _get_store
from .types import KBHit

_log = logging.getLogger(__name__)

_NOISE_WORDS = (
    "嗯", "呃", "那个", "然后", "就是", "啊", "吧", "呢", "的话",
    "em", "uh", "um",
)
_MAX_QUERY_CHARS = 128


def reset() -> None:
    """测试辅助。retriever 目前无自己单例。"""
    return


def _normalize_query(query: str) -> str:
    q = (query or "").strip()
    if not q:
        return ""
    for w in _NOISE_WORDS:
        q = q.replace(w, " ")
    q = re.sub(r"\s+", " ", q).strip()
    if len(q) > _MAX_QUERY_CHARS:
        q = q[:_MAX_QUERY_CHARS]
    return q


def _should_early_return_asr(q: str, min_chars: int) -> bool:
    """ASR 模式：去掉空白和标点后有效字符不足就直接丢。"""
    sig = re.sub(r"[\s\W_]+", "", q, flags=re.UNICODE)
    return len(sig) < max(1, min_chars)


def _build_fts_expr(q: str) -> str:
    """query → FTS5 MATCH: CJK 走 bigram, 非 CJK 按空白切词, 每个 token 做 phrase(AND)。

    用 `"..."` 包住每个 token 避免 `-` / `OR` / `NEAR` 被解释为 FTS 运算符。
    """
    toks = cjk_bigram_query_tokens(q)
    if not toks:
        return ""
    safe: list[str] = []
    for t in toks:
        s = t.replace('"', '""').strip()
        if not s:
            continue
        # FTS5 不允许把纯标点/数字当成 phrase 主体, 但 unicode61 会把非字母数字当分隔符,
        # 这里再过一遍去除只剩标点的 token。
        if not any(ch.isalnum() or ord(ch) > 127 for ch in s):
            continue
        safe.append(f'"{s}"')
    return " ".join(safe)


def retrieve(
    query: str,
    k: int = 4,
    deadline_ms: int = 150,
    *,
    mode: str = "manual_text",
    force: bool = False,
) -> list[KBHit]:
    """同步 FTS5 检索；deadline 到期立刻中断返回空。

    ``force=True`` 时跳过 ``kb_enabled`` / ``kb_trigger_modes`` 这两道开关;
    专给手动测试面板 (`/api/kb/search`) 用 —— 用户既然在 Drawer 里点了搜索,
    就不该被「主流程总开关」拦住。pipeline 默认 ``force=False``,行为不变。
    """
    cfg = get_config()
    if not force:
        if not getattr(cfg, "kb_enabled", False):
            return []
        if mode not in getattr(cfg, "kb_trigger_modes", []):
            return []

    q = _normalize_query(query)
    if not q:
        return []
    if mode == "asr_realtime" and _should_early_return_asr(
        q, int(getattr(cfg, "kb_asr_min_query_chars", 6))
    ):
        return []

    fts_expr = _build_fts_expr(q)
    if not fts_expr:
        return []

    try:
        store = _get_store()
    except Exception as e:  # pragma: no cover
        _log.warning("kb retriever 拿 store 失败: %s", e)
        return []

    try:
        conn = store.open_connection()
    except Exception as e:  # pragma: no cover
        _log.warning("kb retriever 开连接失败: %s", e)
        return []

    hit_rows: list[dict] = []
    error: dict = {}
    done = threading.Event()

    def _runner() -> None:
        try:
            rows = store.fts_search(fts_expr, limit=k, interrupt_connection=conn)
            hit_rows.extend(rows)
        except Exception as e:
            error["e"] = str(e)
        finally:
            done.set()

    t = threading.Thread(target=_runner, name="kb-fts", daemon=True)
    t.start()
    t0 = time.monotonic()
    if not done.wait(max(0.0, deadline_ms / 1000.0)):
        try:
            conn.interrupt()
        except Exception:
            pass
        done.wait(0.05)
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    try:
        conn.close()
    except Exception:
        pass

    if error:
        _log.warning("kb retrieve error q=%r: %s", q, error.get("e"))

    hits: list[KBHit] = []
    timed_out = not hit_rows and elapsed_ms >= deadline_ms

    if hit_rows:
        min_score = float(getattr(cfg, "kb_min_score", 0.0))
        for r in hit_rows:
            raw_score = float(r.get("score") or 0.0)
            # SQLite FTS5 bm25() 返回非正数，越接近 0 越相关；翻成正分给上层。
            pos = -raw_score if raw_score < 0 else raw_score
            if min_score > 0 and pos < min_score:
                continue
            hits.append(
                KBHit(
                    path=r["path"],
                    section_path=r.get("section_path") or "",
                    text=r["text"],
                    score=pos,
                    page=r.get("page"),
                    origin=r.get("origin") or "text",
                )
            )

    if timed_out:
        _log.info(
            "kb retrieve timeout q=%r mode=%s deadline=%dms elapsed=%dms",
            q, mode, deadline_ms, elapsed_ms,
        )
    else:
        _log.info(
            "kb retrieve q=%r mode=%s hits=%d latency=%dms",
            q, mode, len(hits), elapsed_ms,
        )

    try:
        from .recent_hits import global_recent_hits

        global_recent_hits().push(
            {
                "ts": time.time(),
                "query": q,
                "mode": mode,
                "hit_count": len(hits),
                "latency_ms": elapsed_ms,
                "timed_out": timed_out,
                "error": error.get("e"),
                "top_section_paths": [h.section_path for h in hits[:3]],
            }
        )
    except Exception:  # pragma: no cover
        pass

    return hits


__all__ = ["retrieve", "reset"]
