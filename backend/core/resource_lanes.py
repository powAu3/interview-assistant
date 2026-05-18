from __future__ import annotations

import asyncio
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable, TypeVar

from core.env import env_int
from core.logger import get_logger

T = TypeVar("T")

_log = get_logger(__name__)


class ResourceLaneBusyError(RuntimeError):
    """Raised when a bounded resource lane cannot accept more work."""


class ResourceLane:
    """Bounded executor for non-critical work that must not starve the main flow."""

    def __init__(
        self,
        name: str,
        *,
        max_workers: int,
        max_pending: int,
    ):
        if max_workers < 1:
            raise ValueError("max_workers must be >= 1")
        if max_pending < 0:
            raise ValueError("max_pending must be >= 0")
        self.name = name
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix=name,
        )
        self._slots = threading.BoundedSemaphore(max_workers + max_pending)
        self._shutdown = False
        self._lock = threading.Lock()
        self.rejected_count = 0

    def submit(self, fn: Callable[..., T], *args: object, **kwargs: object) -> Future[T]:
        with self._lock:
            if self._shutdown:
                raise ResourceLaneBusyError(f"{self.name} lane is shut down")
            if not self._slots.acquire(blocking=False):
                self.rejected_count += 1
                if self.rejected_count == 1 or self.rejected_count % 25 == 0:
                    _log.warning("%s lane full; rejected=%d", self.name, self.rejected_count)
                raise ResourceLaneBusyError(f"{self.name} lane is busy")
            try:
                future = self._executor.submit(fn, *args, **kwargs)
            except Exception:
                self._slots.release()
                raise
        future.add_done_callback(lambda _future: self._slots.release())
        return future

    def shutdown(self, *, wait: bool = True) -> None:
        with self._lock:
            self._shutdown = True
        self._executor.shutdown(wait=wait)


_low_priority_lane = ResourceLane(
    "ia-low-priority",
    max_workers=env_int("IA_LOW_PRIORITY_WORKERS", 1, minimum=1),
    max_pending=env_int("IA_LOW_PRIORITY_MAX_PENDING", 8, minimum=0),
)


def submit_low_priority_background(fn: Callable[..., T], *args: object, **kwargs: object) -> bool:
    try:
        future = _low_priority_lane.submit(fn, *args, **kwargs)
    except ResourceLaneBusyError:
        return False
    future.add_done_callback(_log_background_failure)
    return True


async def run_low_priority(fn: Callable[..., T], *args: object, **kwargs: object) -> T:
    future = _low_priority_lane.submit(fn, *args, **kwargs)
    return await asyncio.wrap_future(future)


def _log_background_failure(future: Future[object]) -> None:
    try:
        future.result()
    except Exception:
        _log.exception("low-priority background task failed")
