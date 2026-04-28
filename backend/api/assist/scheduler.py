"""Answer task scheduling primitives for the assist pipeline.

This module owns the queueing rules and stale-ASR arbitration.  The pipeline
module keeps the public functions and worker side effects, while this file
keeps the mutable scheduling decisions testable and isolated.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional, Tuple

TaskPayload = Tuple[str, Optional[str], bool, str, dict[str, Any]]
PendingTask = Tuple[TaskPayload, int, int]


@dataclass(frozen=True)
class DispatchClaim:
    task: TaskPayload
    seq: int
    model_idx: int
    session_version: int


@dataclass(frozen=True)
class DispatchStep:
    claim: DispatchClaim | None = None
    skipped_seq: int | None = None


def task_meta(task: TaskPayload) -> dict[str, Any]:
    return task[4]


def is_asr_task(task: TaskPayload) -> bool:
    return task_meta(task).get("origin") == "asr"


def is_stale_inflight_asr_task(task: TaskPayload, latest_asr_turn_id: int) -> bool:
    return is_asr_task(task) and int(task_meta(task).get("asr_turn_id", 0)) < latest_asr_turn_id


def key_ok(model) -> bool:
    return bool(model.api_key and model.api_key not in ("", "sk-your-api-key-here"))


def model_eligible(i: int, model, need_vision: bool, get_model_health: Callable[[int], Optional[str]]) -> bool:
    if not getattr(model, "enabled", True):
        return False
    if get_model_health(i) == "error":
        return False
    if not key_ok(model):
        return False
    if need_vision and not model.supports_vision:
        return False
    return True


def priority_model_index(cfg) -> int:
    n = len(cfg.models)
    if n <= 0:
        return 0
    try:
        active_model = cfg.get_active_model()
    except Exception:
        return max(0, min(int(cfg.active_model), n - 1))
    for i, model in enumerate(cfg.models):
        if model is active_model:
            return i
    return max(0, min(int(cfg.active_model), n - 1))


def dispatch_model_order(cfg) -> list[int]:
    n = len(cfg.models)
    if n == 0:
        return []
    priority = priority_model_index(cfg)
    return [priority] + [i for i in range(n) if i != priority]


def pick_model_index(
    task: TaskPayload,
    busy: set[int],
    cfg,
    get_model_health: Callable[[int], Optional[str]],
    avoid_models: Optional[set[int]] = None,
) -> Optional[int]:
    _text, image, _manual, _source, _meta = task
    need_vision = bool(image)
    avoid = avoid_models or set()

    def ok_basic(i: int, model) -> bool:
        if i in busy:
            return False
        if not getattr(model, "enabled", True):
            return False
        if not key_ok(model):
            return False
        if need_vision and not model.supports_vision:
            return False
        return True

    order = dispatch_model_order(cfg)
    if avoid:
        for i in order:
            if i in avoid:
                continue
            model = cfg.models[i]
            if not ok_basic(i, model):
                continue
            if get_model_health(i) == "error":
                continue
            return i
        for i in order:
            if i in avoid:
                continue
            model = cfg.models[i]
            if ok_basic(i, model):
                return i
    for i in order:
        model = cfg.models[i]
        if not ok_basic(i, model):
            continue
        if get_model_health(i) == "error":
            continue
        return i
    for i in order:
        model = cfg.models[i]
        if ok_basic(i, model):
            return i
    return None


def max_parallel_slots(cfg, get_model_health: Callable[[int], Optional[str]]) -> int:
    n_ok = sum(1 for i, model in enumerate(cfg.models) if model_eligible(i, model, False, get_model_health))
    cap = max(1, getattr(cfg, "max_parallel_answers", 2))
    return max(1, min(cap, max(n_ok, 1)))


def dispatch_snapshot(
    in_flight_tasks: dict[int, tuple[int, TaskPayload]],
    latest_asr_turn_id: int,
) -> tuple[set[int], int]:
    busy_models: set[int] = set()
    effective_slots = 0
    for model_idx, task in in_flight_tasks.values():
        if is_stale_inflight_asr_task(task, latest_asr_turn_id):
            continue
        busy_models.add(model_idx)
        effective_slots += 1
    return busy_models, effective_slots


def physical_busy_models(in_flight_tasks: dict[int, tuple[int, TaskPayload]]) -> set[int]:
    return {model_idx for model_idx, _task in in_flight_tasks.values()}


def begin_asr_turn(pending: list[PendingTask], latest_asr_turn_id: int) -> tuple[int, list[int]]:
    latest_asr_turn_id += 1
    skipped: list[int] = []
    kept: list[PendingTask] = []
    for task, seq, session_version in pending:
        if is_asr_task(task):
            skipped.append(seq)
            continue
        kept.append((task, seq, session_version))
    pending[:] = kept
    return latest_asr_turn_id, skipped


def claim_next_dispatch(
    pending: list[PendingTask],
    in_flight_tasks: dict[int, tuple[int, TaskPayload]],
    latest_asr_turn_id: int,
    max_parallel_slots: int,
    pick_model_index: Callable[[TaskPayload, set[int], Optional[set[int]]], Optional[int]],
) -> DispatchStep:
    busy_models, effective_slots = dispatch_snapshot(in_flight_tasks, latest_asr_turn_id)
    physical_busy = physical_busy_models(in_flight_tasks)
    if effective_slots >= max_parallel_slots:
        return DispatchStep()

    idx = 0
    while idx < len(pending):
        task, seq, session_version = pending[idx]
        meta = task_meta(task)
        if is_asr_task(task) and int(meta.get("asr_turn_id", 0)) < latest_asr_turn_id:
            pending.pop(idx)
            return DispatchStep(skipped_seq=seq)
        avoid_models = physical_busy if is_asr_task(task) else None
        model_idx = pick_model_index(task, busy_models, avoid_models)
        if model_idx is not None:
            pending.pop(idx)
            in_flight_tasks[seq] = (model_idx, task)
            return DispatchStep(
                claim=DispatchClaim(
                    task=task,
                    seq=seq,
                    model_idx=model_idx,
                    session_version=session_version,
                )
            )
        idx += 1
    return DispatchStep()


def drain_commit_queue(
    commit_buffer: dict[int, Callable[[], None]],
    skipped_commit_seqs: set[int],
    next_commit_seq: int,
) -> int:
    while True:
        while next_commit_seq in skipped_commit_seqs:
            skipped_commit_seqs.discard(next_commit_seq)
            next_commit_seq += 1
        apply_fn = commit_buffer.pop(next_commit_seq, None)
        if apply_fn is None:
            return next_commit_seq
        apply_fn()
        next_commit_seq += 1
