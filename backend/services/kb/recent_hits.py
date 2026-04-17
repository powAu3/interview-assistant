"""内存环形缓冲: 记录最近若干次 KB 检索命中, 供 UI / debug 查看。

线程安全: push / list / clear 均持同一把 RLock。
"""
from __future__ import annotations

from collections import deque
from threading import RLock
from typing import Any, Optional


class RecentHits:
    def __init__(self, capacity: int = 50) -> None:
        self._dq: deque[dict[str, Any]] = deque(maxlen=max(1, int(capacity)))
        self._lock = RLock()

    def push(self, rec: dict[str, Any]) -> None:
        with self._lock:
            self._dq.append(rec)

    def list(self, limit: Optional[int] = None) -> list[dict[str, Any]]:
        """按时间倒序返回 (最新在前)。limit 为 None 时返回全部。"""
        with self._lock:
            items = list(self._dq)
        items.reverse()
        if limit is not None:
            return items[: max(0, int(limit))]
        return items

    def clear(self) -> None:
        with self._lock:
            self._dq.clear()


_GLOBAL: Optional[RecentHits] = None


def global_recent_hits() -> RecentHits:
    """全局单例; 容量来自 AppConfig.kb_recent_hits_capacity。"""
    global _GLOBAL
    if _GLOBAL is None:
        try:
            from core.config import get_config  # type: ignore

            cap = int(getattr(get_config(), "kb_recent_hits_capacity", 50) or 50)
        except Exception:
            cap = 50
        _GLOBAL = RecentHits(capacity=cap)
    return _GLOBAL


def reset_global_recent_hits() -> None:
    """测试辅助: 清空单例, 强制下次重建 (便于改 capacity 后生效)。"""
    global _GLOBAL
    _GLOBAL = None
