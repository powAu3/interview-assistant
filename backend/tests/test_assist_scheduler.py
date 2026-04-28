from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api.assist import scheduler  # noqa: E402


def _asr_task(text: str, turn_id: int) -> scheduler.TaskPayload:
    return (text, None, False, "conversation_mic", {"origin": "asr", "asr_turn_id": turn_id})


def _manual_task(text: str) -> scheduler.TaskPayload:
    return (text, None, True, "manual_text", {"origin": "manual"})


def test_begin_asr_turn_drops_pending_asr_only():
    pending: list[scheduler.PendingTask] = [
        (_asr_task("旧 ASR", 1), 0, 3),
        (_manual_task("手动问题"), 1, 3),
    ]

    latest_turn, skipped = scheduler.begin_asr_turn(pending, 1)

    assert latest_turn == 2
    assert skipped == [0]
    assert pending == [(_manual_task("手动问题"), 1, 3)]


def test_claim_next_dispatch_avoids_physical_busy_model_for_asr():
    pending: list[scheduler.PendingTask] = [(_asr_task("最新问题", 2), 2, 7)]
    in_flight = {1: (2, _asr_task("旧问题", 1))}
    calls: list[tuple[set[int], set[int] | None]] = []

    def pick_model(_task, busy, avoid_models=None):
        calls.append((set(busy), set(avoid_models or set())))
        return 0

    step = scheduler.claim_next_dispatch(
        pending,
        in_flight,
        latest_asr_turn_id=2,
        max_parallel_slots=1,
        pick_model_index=pick_model,
    )

    assert step.claim is not None
    assert step.claim.model_idx == 0
    assert step.claim.seq == 2
    assert pending == []
    assert in_flight[2] == (0, _asr_task("最新问题", 2))
    assert calls == [(set(), {2})]


def test_drain_commit_queue_skips_then_drains_in_order():
    committed: list[str] = []
    commit_buffer = {
        1: lambda: committed.append("seq1"),
        2: lambda: committed.append("seq2"),
    }
    skipped_commit_seqs = {0}

    next_seq = scheduler.drain_commit_queue(
        commit_buffer,
        skipped_commit_seqs,
        next_commit_seq=0,
    )

    assert committed == ["seq1", "seq2"]
    assert next_seq == 3
    assert commit_buffer == {}
    assert skipped_commit_seqs == set()


def test_pick_model_index_respects_priority_and_vision():
    cfg = SimpleNamespace(
        models=[
            SimpleNamespace(enabled=True, api_key="k0", supports_vision=False),
            SimpleNamespace(enabled=True, api_key="k1", supports_vision=True),
        ],
        active_model=0,
        get_active_model=lambda: None,
    )
    cfg.get_active_model = lambda: cfg.models[cfg.active_model]
    task: scheduler.TaskPayload = (
        "看图题",
        "data:image/png;base64,xxx",
        False,
        "server_screen_code",
        {},
    )

    picked = scheduler.pick_model_index(
        task,
        busy=set(),
        cfg=cfg,
        get_model_health=lambda _idx: None,
    )

    assert picked == 1
