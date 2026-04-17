"""KB → WebSocket payload builder。

把 KBHit 列表序列化为前端能直接消费的字典。独立成模块, 便于 pipeline / API
层共用以及单测。
"""
from __future__ import annotations

from typing import Iterable

from .types import KBHit


def build_kb_hits_payload(
    *,
    qa_id: str,
    hits: Iterable[KBHit],
    latency_ms: int,
    degraded: bool,
    excerpt_chars: int,
) -> dict:
    """构造 type=kb_hits 的 ws 消息体。"""
    hit_list = list(hits)
    return {
        "type": "kb_hits",
        "scope": "global",
        "qa_id": qa_id,
        "latency_ms": int(latency_ms),
        "degraded": bool(degraded),
        "hit_count": len(hit_list),
        "hits": [
            {
                "path": h.path,
                "section_path": h.section_path,
                "page": h.page,
                "origin": h.origin,
                "score": float(h.score),
                "excerpt": h.excerpt(int(excerpt_chars)),
            }
            for h in hit_list
        ],
    }
