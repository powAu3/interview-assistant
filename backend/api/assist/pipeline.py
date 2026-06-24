"""Interview assist pipeline: ASR buffering, task dispatch, parallel answer workers."""

import gc
import queue
import time
import threading
from difflib import SequenceMatcher
from typing import Any, Callable, Optional

from core.background import BoundedTaskWorker
from core.config import get_config
from core.logger import get_interview_logger, get_logger
from core.session import get_session, reset_session, conversation_lock
from services import review_integration

_ilog = get_interview_logger()
_elog = get_logger("pipeline")
from services.audio import AudioCapture, VADBuffer, audio_capture
from services.stt import (
    get_stt_engine,
    transcribe_with_fallback,
    transcription_for_publish,
    postprocess_interview_transcription,
)
from api.common import get_model_health
from api.realtime.ws import broadcast
from api.assist.answer_worker import (
    AnswerWorkerDeps,
    process_question_parallel,
    prompt_mode_for_task as answer_prompt_mode_for_task,
    prompt_server_screen_code,
)
from api.assist.asr_state import (
    AssistAsrStateMachine,
    PendingASRGroup,
    asr_interrupt_running,
)
from api.assist.scheduler import (
    TaskPayload,
    begin_asr_turn as scheduler_begin_asr_turn,
    claim_next_dispatch,
    dispatch_model_order as scheduler_dispatch_model_order,
    dispatch_snapshot as scheduler_dispatch_snapshot,
    drain_commit_queue,
    is_asr_task,
    is_stale_inflight_asr_task,
    key_ok,
    max_parallel_slots as scheduler_max_parallel_slots,
    model_eligible as scheduler_model_eligible,
    physical_busy_models as scheduler_physical_busy_models,
    pick_model_index as scheduler_pick_model_index,
    priority_model_index as scheduler_priority_model_index,
    task_meta,
)

# ---------------------------------------------------------------------------
# Module state
# ---------------------------------------------------------------------------

_interview_thread: Optional[threading.Thread] = None
_candidate_thread: Optional[threading.Thread] = None
_candidate_audio_capture = AudioCapture()
_stop_event = threading.Event()
_pause_event = threading.Event()
_candidate_flush_event = threading.Event()
_candidate_whisper_preload_lock = threading.Lock()
_candidate_whisper_preload_inflight: set[tuple[str, str]] = set()

# H4: 添加独立 flush 线程，避免阻塞音频采集主循环
_flush_thread: Optional[threading.Thread] = None
_flush_queue: queue.Queue = queue.Queue(maxsize=10)
_flush_stop_event = threading.Event()

_answer_generation = 0
_gen_lock = threading.Lock()

_pending: list[tuple[TaskPayload, int, int]] = []
_dispatch_lock = threading.Lock()
_asr_state_lock = threading.RLock()
_in_flight_tasks: dict[int, tuple[int, TaskPayload]] = {}
_task_session_version = 0
_latest_asr_turn_id = 0

_commit_buffer: dict[int, Callable[[], None]] = {}
_skipped_commit_seqs: set[int] = set()
_next_commit_seq = 0
_next_submit_seq = 0
_commit_lock = threading.Lock()

_asr_merge_parts: list[str] = []
_asr_merge_mono_first: Optional[float] = None
_asr_merge_mono_last: Optional[float] = None
_pending_asr_group: Optional[PendingASRGroup] = None
_recent_asr_turn_monos: list[float] = []
_knowledge_worker: Optional[BoundedTaskWorker] = None
_asr_state = AssistAsrStateMachine(
    broadcast=lambda data: broadcast(data),
    submit_answer_task=lambda task: submit_answer_task(task),
    begin_asr_turn=lambda: _begin_asr_turn(),
    record_asr_turn=lambda now_mono: _record_asr_turn(now_mono),
    is_high_churn_submission=lambda cfg, now_mono: _is_high_churn_asr_submission(cfg, now_mono),
    logger=_ilog,
)


# ---------------------------------------------------------------------------
# ASR merge / question grouping
# ---------------------------------------------------------------------------

def _reset_asr_merge_buffer_locked():
    _asr_state.reset_merge_buffer()
    _sync_asr_state_to_compat_globals()


def _reset_asr_merge_buffer():
    with _asr_state_lock:
        _reset_asr_merge_buffer_locked()


def _reset_pending_asr_group_locked():
    _asr_state.reset_pending_group()
    _sync_asr_state_to_compat_globals()


def _reset_pending_asr_group():
    with _asr_state_lock:
        _reset_pending_asr_group_locked()


def _sync_compat_globals_to_asr_state():
    _asr_state.merge_parts = _asr_merge_parts
    _asr_state.merge_mono_first = _asr_merge_mono_first
    _asr_state.merge_mono_last = _asr_merge_mono_last
    _asr_state.pending_group = _pending_asr_group


def _sync_asr_state_to_compat_globals():
    global _asr_merge_parts, _asr_merge_mono_first, _asr_merge_mono_last, _pending_asr_group
    _asr_merge_parts = _asr_state.merge_parts
    _asr_merge_mono_first = _asr_state.merge_mono_first
    _asr_merge_mono_last = _asr_state.merge_mono_last
    _pending_asr_group = _asr_state.pending_group


def _prune_recent_asr_turns_locked(now_mono: float, window_sec: float = 6.0):
    global _recent_asr_turn_monos
    _recent_asr_turn_monos = [
        ts for ts in _recent_asr_turn_monos
        if now_mono - ts <= window_sec
    ]


def _is_high_churn_asr_submission(cfg, now_mono: float) -> bool:
    if not bool(getattr(cfg, "assist_high_churn_short_answer", False)):
        return False
    with _dispatch_lock:
        _prune_recent_asr_turns_locked(now_mono)
        has_active_asr = any(
            _is_asr_task(task) and not _is_stale_inflight_asr_task(task)
            for _model_idx, task in _in_flight_tasks.values()
        )
        has_recent_turn = bool(_recent_asr_turn_monos)
    return has_active_asr or has_recent_turn


def _record_asr_turn(now_mono: float):
    with _dispatch_lock:
        _prune_recent_asr_turns_locked(now_mono)
        _recent_asr_turn_monos.append(now_mono)


def _asr_confirm_window_sec(cfg) -> float:
    confirm = float(getattr(cfg, "assist_asr_confirm_window_sec", 0.45) or 0.0)
    return max(0.0, min(5.0, confirm))


def _asr_group_max_wait_sec(cfg) -> float:
    max_wait = float(getattr(cfg, "assist_asr_group_max_wait_sec", 1.2) or 0.0)
    return max(0.2, min(8.0, max_wait))


def _asr_interrupt_running(cfg) -> bool:
    return asr_interrupt_running(cfg)


def _task_meta(task: TaskPayload) -> dict[str, Any]:
    return task_meta(task)


def _is_asr_task(task: TaskPayload) -> bool:
    return is_asr_task(task)


def _get_latest_asr_turn_id() -> int:
    with _dispatch_lock:
        return _latest_asr_turn_id


def _is_stale_inflight_asr_task(task: TaskPayload) -> bool:
    return is_stale_inflight_asr_task(task, _latest_asr_turn_id)


# ---------------------------------------------------------------------------
# Generation control
# ---------------------------------------------------------------------------

def _bump_generation():
    global _answer_generation
    with _gen_lock:
        _answer_generation += 1


def _capture_generation() -> int:
    with _gen_lock:
        return _answer_generation


def _reset_answer_state():
    global _pending, _in_flight_tasks, _commit_buffer, _skipped_commit_seqs, _next_commit_seq, _task_session_version, _latest_asr_turn_id, _recent_asr_turn_monos
    with _asr_state_lock:
        with _dispatch_lock:
            _pending.clear()
            _in_flight_tasks.clear()
            _latest_asr_turn_id = 0
            _recent_asr_turn_monos = []
            _task_session_version += 1
            next_commit_seq = _next_submit_seq
        _reset_asr_merge_buffer_locked()
        _reset_pending_asr_group_locked()
    # commit 相关操作单独处理
    with _commit_lock:
        _commit_buffer.clear()
        _skipped_commit_seqs.clear()
        _next_commit_seq = next_commit_seq


def cancel_answer_work(reset_session_data: bool = False):
    _bump_generation()
    _reset_answer_state()
    if reset_session_data:
        with conversation_lock:
            reset_session()


def init_background_workers():
    global _knowledge_worker
    if _knowledge_worker is None:
        _knowledge_worker = BoundedTaskWorker(
            "assist.knowledge_worker",
            _save_knowledge_record,
            maxsize=64,
        )
    _knowledge_worker.start()


def shutdown_background_workers():
    global _knowledge_worker
    if _knowledge_worker is None:
        return
    _knowledge_worker.stop()


def _submit_knowledge_record(
    question: str,
    answer: str,
    qa_id: str = "",
    candidate_answer: str = "",
) -> bool:
    worker = _knowledge_worker
    if worker is None:
        _save_knowledge_record("save", question, answer, qa_id, candidate_answer)
        return True
    return worker.submit("save", question, answer, qa_id, candidate_answer)


def _submit_candidate_knowledge_update(qa_id: str, candidate_answer: str) -> bool:
    if not (qa_id or "").strip() or not (candidate_answer or "").strip():
        return False
    worker = _knowledge_worker
    if worker is None:
        _save_knowledge_record("candidate_update", qa_id, candidate_answer)
        return True
    return worker.submit("candidate_update", qa_id, candidate_answer)


# ---------------------------------------------------------------------------
# Model dispatch
# ---------------------------------------------------------------------------

def _key_ok(m) -> bool:
    return key_ok(m)


def _model_eligible(i: int, m, need_vision: bool) -> bool:
    return scheduler_model_eligible(i, m, need_vision, get_model_health)


def _prompt_mode_for_task(source: str, manual_input: bool, written_exam: bool = False):
    return answer_prompt_mode_for_task(source, manual_input, written_exam=written_exam)


def _priority_model_index(cfg) -> int:
    return scheduler_priority_model_index(cfg)


def _dispatch_model_order(cfg) -> list[int]:
    return scheduler_dispatch_model_order(cfg)


def _dispatch_snapshot_locked() -> tuple[set[int], int]:
    return scheduler_dispatch_snapshot(_in_flight_tasks, _latest_asr_turn_id)


def _physical_busy_models_locked() -> set[int]:
    return scheduler_physical_busy_models(_in_flight_tasks)


def _drain_commit_queue_locked():
    global _next_commit_seq
    _next_commit_seq = drain_commit_queue(
        _commit_buffer,
        _skipped_commit_seqs,
        _next_commit_seq,
    )


def _mark_seq_skipped(seq: int):
    with _commit_lock:
        if seq < _next_commit_seq:
            return
        _skipped_commit_seqs.add(seq)
        _drain_commit_queue_locked()


def _answer_work_idle() -> bool:
    with _dispatch_lock:
        pending = bool(_pending)
        in_flight = bool(_in_flight_tasks)
    with _commit_lock:
        commits = bool(_commit_buffer)
    return not pending and not in_flight and not commits


def _wait_for_answer_work_idle(timeout_sec: float) -> bool:
    deadline = time.monotonic() + max(0.0, timeout_sec)
    while time.monotonic() < deadline:
        if _answer_work_idle():
            return True
        time.sleep(0.05)
    return _answer_work_idle()


def _begin_asr_turn() -> int:
    global _latest_asr_turn_id
    with _dispatch_lock:
        _latest_asr_turn_id, skipped = scheduler_begin_asr_turn(_pending, _latest_asr_turn_id)
        turn_id = _latest_asr_turn_id
    for seq in skipped:
        _mark_seq_skipped(seq)
    return turn_id


def pick_model_index(
    task: TaskPayload,
    busy: set[int],
    avoid_models: Optional[set[int]] = None,
) -> Optional[int]:
    return scheduler_pick_model_index(
        task,
        busy,
        get_config(),
        get_model_health,
        avoid_models=avoid_models,
    )


def _max_parallel_slots() -> int:
    return scheduler_max_parallel_slots(get_config(), get_model_health)


def submit_answer_task(task: TaskPayload) -> bool:
    global _next_submit_seq
    if pick_model_index(task, set()) is None:
        broadcast(
            {
                "type": "error",
                "message": "\u6ca1\u6709\u53ef\u7528\u7684\u7b54\u9898\u6a21\u578b\uff1a\u8bf7\u81f3\u5c11\u542f\u7528\u4e00\u4e2a\u5df2\u914d\u7f6e API Key \u7684\u6a21\u578b\uff08\u8bc6\u56fe\u9898\u9700\u8bc6\u56fe\u6a21\u578b\uff09\u3002",
            }
        )
        return False
    with _dispatch_lock:
        seq = _next_submit_seq
        _next_submit_seq += 1
        tv = _task_session_version
        _pending.append((task, seq, tv))
    _try_dispatch()
    return True


# ---------------------------------------------------------------------------
# ASR question group handling
# ---------------------------------------------------------------------------

def _flush_asr_question_group_now(cfg, session) -> None:
    with _asr_state_lock:
        _sync_compat_globals_to_asr_state()
        _asr_state.flush_question_group_now(cfg, session)
        _sync_asr_state_to_compat_globals()


def _try_flush_asr_question_group(cfg, session, now_mono: float, force: bool = False) -> None:
    with _asr_state_lock:
        _sync_compat_globals_to_asr_state()
        _asr_state.try_flush_question_group(cfg, session, now_mono, force)
        _sync_asr_state_to_compat_globals()


def _handle_auto_detect_asr_text(cfg, session, pub: str, source: str, now_mono: float) -> None:
    with _asr_state_lock:
        _sync_compat_globals_to_asr_state()
        _asr_state.handle_auto_detect_asr_text(cfg, session, pub, source, now_mono)
        _sync_asr_state_to_compat_globals()


# ---------------------------------------------------------------------------
# ASR merge buffer
# ---------------------------------------------------------------------------

def _flush_asr_merge_buffer_now(cfg, session) -> None:
    with _asr_state_lock:
        _sync_compat_globals_to_asr_state()
        _asr_state.flush_merge_buffer_now(cfg, session)
        _sync_asr_state_to_compat_globals()


def _try_flush_asr_merge_buffer(cfg, session, now_mono: float, force: bool = False) -> None:
    with _asr_state_lock:
        _sync_compat_globals_to_asr_state()
        _asr_state.try_flush_merge_buffer(cfg, session, now_mono, force)
        _sync_asr_state_to_compat_globals()


def _append_transcription_fragment(cfg, session, pub: str, now_mono: float, force_flush_tail: bool = False) -> None:
    with _asr_state_lock:
        _sync_compat_globals_to_asr_state()
        _asr_state.append_transcription_fragment(cfg, session, pub, now_mono, force_flush_tail)
        _sync_asr_state_to_compat_globals()


# ---------------------------------------------------------------------------
# Dispatch / worker
# ---------------------------------------------------------------------------

def _try_dispatch():
    while True:
        with _dispatch_lock:
            step = claim_next_dispatch(
                _pending,
                _in_flight_tasks,
                _latest_asr_turn_id,
                _max_parallel_slots(),
                pick_model_index,
            )
        if step.skipped_seq is not None:
            _mark_seq_skipped(step.skipped_seq)
            continue
        if step.claim is None:
            return
        threading.Thread(
            target=_run_answer_worker,
            args=(
                step.claim.task,
                step.claim.seq,
                step.claim.model_idx,
                step.claim.session_version,
            ),
            daemon=True,
        ).start()


def _run_answer_worker(
    task: TaskPayload,
    seq: int,
    model_idx: int,
    sess_v: int,
):
    try:
        _process_question_parallel(task, seq, model_idx, sess_v)
    finally:
        with _dispatch_lock:
            _in_flight_tasks.pop(seq, None)
        _try_dispatch()


def _flush_commit(seq: int, apply_fn: Callable[[], None]):
    with _commit_lock:
        if seq < _next_commit_seq:
            return
        _commit_buffer[seq] = apply_fn
        _drain_commit_queue_locked()


# ---------------------------------------------------------------------------
# Interview loop
# ---------------------------------------------------------------------------

def _device_is_loopback(device_id: Optional[int]) -> bool:
    if device_id is None:
        return False
    for d in AudioCapture.list_devices():
        if d["id"] == device_id:
            return bool(d["is_loopback"])
    return False


def start_nonblocking(device_id: Optional[int] = None, candidate_mic_device_id: Optional[int] = None):
    global _interview_thread, _candidate_thread
    stop_interview_loop()
    _stop_event.clear()
    _pause_event.clear()
    _candidate_flush_event.clear()

    session = get_session()
    with conversation_lock:
        session.is_recording = True
        session.is_paused = False

    if device_id is not None:
        capture_is_loopback = _device_is_loopback(device_id)

        audio_capture.start(device_id, owner="assist")

        with conversation_lock:
            session.last_device_id = device_id
            session.capture_is_loopback = capture_is_loopback
        _ilog.info("INTERVIEW_START device=%s loopback=%s", device_id, capture_is_loopback)
    else:
        _ilog.info("INTERVIEW_START no_device (written_exam_mode)")

    broadcast({"type": "recording", "value": True})
    broadcast({"type": "paused", "value": False})

    if device_id is not None:
        _interview_thread = threading.Thread(target=_interview_worker, daemon=True)
        _interview_thread.start()

    cfg = get_config()
    if (
        device_id is not None
        and candidate_mic_device_id is not None
        and bool(getattr(cfg, "candidate_asr_enabled", False))
        and int(candidate_mic_device_id) != int(device_id)
    ):
        try:
            _candidate_audio_capture.start(
                int(candidate_mic_device_id),
                owner="assist-candidate",
                mic_compatibility_mode=bool(getattr(cfg, "candidate_mic_compatibility_mode", True)),
            )
            with conversation_lock:
                session.last_candidate_mic_device_id = int(candidate_mic_device_id)
            _candidate_thread = threading.Thread(target=_candidate_worker, daemon=True)
            _candidate_thread.start()
            _ilog.info("CANDIDATE_ASR_START device=%s", candidate_mic_device_id)
        except Exception as exc:
            with conversation_lock:
                session.last_candidate_mic_device_id = 0
            _elog.warning("CANDIDATE_ASR_START_FAIL device=%s err=%s", candidate_mic_device_id, exc)
            broadcast({
                "type": "candidate_asr_status",
                "loaded": False,
                "loading": False,
                "provider": "off",
                "error": str(exc)[:160],
                "reason": "mic_unavailable",
                "safe_degraded": True,
            })
    elif device_id is not None:
        with conversation_lock:
            session.last_candidate_mic_device_id = 0
        reason = "disabled" if not bool(getattr(cfg, "candidate_asr_enabled", False)) else "missing_or_same_device"
        broadcast({"type": "candidate_asr_status", "loaded": False, "loading": False, "provider": "off", "reason": reason})

    # 创建 review session（如果满足条件）
    review_integration.on_assist_start(
        interviewer_device_id=device_id,
        candidate_device_id=candidate_mic_device_id,
        candidate_asr_enabled=bool(getattr(cfg, "candidate_asr_enabled", False)),
    )


def stop_interview_loop():
    global _interview_thread, _candidate_thread, _flush_thread
    _stop_event.set()
    _flush_stop_event.set()
    _pause_event.clear()
    _candidate_flush_event.set()
    audio_capture.stop(owner="assist")
    _candidate_audio_capture.stop(owner="assist-candidate")
    session = get_session()

    current_thread = threading.current_thread()
    if _interview_thread and _interview_thread.is_alive() and _interview_thread is not current_thread:
        _interview_thread.join(timeout=5)
    _interview_thread = None
    if _flush_thread and _flush_thread.is_alive() and _flush_thread is not current_thread:
        _flush_thread.join(timeout=1)
    _flush_thread = None
    if _candidate_thread and _candidate_thread.is_alive() and _candidate_thread is not current_thread:
        _candidate_thread.join(timeout=5)
    _candidate_thread = None

    try:
        _try_flush_asr_merge_buffer(
            get_config(), session, time.monotonic(), True
        )
        _try_flush_asr_question_group(
            get_config(), session, time.monotonic(), True
        )
    except Exception:
        _elog.debug("final ASR flush during stop skipped", exc_info=True)

    wait_sec = float(getattr(get_config(), "assist_stop_answer_wait_sec", 3.0) or 0.0)
    if wait_sec > 0 and not _wait_for_answer_work_idle(min(wait_sec, 20.0)):
        _elog.warning("ANSWER_STOP_WAIT_TIMEOUT pending/inflight work will be cancelled")
    cancel_answer_work(reset_session_data=False)

    # 结束 review session（如果存在）。必须在音频 worker 最后 flush、候选人 ASR final、
    # 以及可等待的答案 commit 之后执行，否则关闭应用时复盘会漏掉末尾问题。
    review_integration.on_assist_stop(session)

    with conversation_lock:
        session.is_recording = False
        session.is_paused = False
        if hasattr(session, "close_candidate_answer_window"):
            session.close_candidate_answer_window()
        if len(session.transcription_history) > 30:
            session.transcription_history = session.transcription_history[-30:]
        if hasattr(session, "candidate_transcription_history") and len(session.candidate_transcription_history) > 30:
            session.candidate_transcription_history = session.candidate_transcription_history[-30:]
    broadcast({"type": "recording", "value": False})
    broadcast({"type": "paused", "value": False})
    _candidate_flush_event.clear()
    gc.collect()
    _ilog.info("INTERVIEW_STOP qa_count=%d", len(session.qa_pairs))


def pause_interview():
    _pause_event.set()
    _candidate_flush_event.set()
    audio_capture.stop(owner="assist")
    _candidate_audio_capture.stop(owner="assist-candidate")
    session = get_session()
    with conversation_lock:
        session.is_paused = True
    broadcast({"type": "paused", "value": True})


def unpause_interview(device_id: Optional[int] = None, candidate_mic_device_id: Optional[int] = None):
    global _candidate_thread
    session = get_session()
    capture_is_loopback = session.capture_is_loopback
    next_device_id = session.last_device_id
    if device_id is not None:
        next_device_id = int(device_id)
        capture_is_loopback = _device_is_loopback(next_device_id)
    audio_capture.start(next_device_id, owner="assist")
    next_candidate_id = session.last_candidate_mic_device_id
    if candidate_mic_device_id is not None:
        next_candidate_id = int(candidate_mic_device_id)
    cfg = get_config()
    if (
        next_candidate_id
        and bool(getattr(cfg, "candidate_asr_enabled", False))
        and int(next_candidate_id) != int(next_device_id)
    ):
        try:
            _candidate_audio_capture.start(
                next_candidate_id,
                owner="assist-candidate",
                mic_compatibility_mode=bool(getattr(cfg, "candidate_mic_compatibility_mode", True)),
            )
            if not _candidate_thread or not _candidate_thread.is_alive():
                _candidate_thread = threading.Thread(target=_candidate_worker, daemon=True)
                _candidate_thread.start()
        except Exception as exc:
            next_candidate_id = 0
            _elog.warning("CANDIDATE_ASR_RESUME_FAIL err=%s", exc)
            broadcast({
                "type": "candidate_asr_status",
                "loaded": False,
                "loading": False,
                "provider": "off",
                "error": str(exc)[:160],
                "reason": "mic_unavailable",
                "safe_degraded": True,
            })
    _candidate_flush_event.clear()
    _pause_event.clear()
    with conversation_lock:
        session.last_device_id = next_device_id
        session.last_candidate_mic_device_id = int(next_candidate_id or 0)
        session.capture_is_loopback = capture_is_loopback
        session.is_paused = False
    broadcast({"type": "paused", "value": False})


def is_paused() -> bool:
    return _pause_event.is_set()


# H4: 独立 flush worker 线程，避免阻塞音频采集主循环
def _flush_worker():
    """独立线程处理 ASR buffer flush，避免阻塞音频采集"""
    while not _flush_stop_event.is_set():
        try:
            flush_signal = _flush_queue.get(timeout=0.1)
            if flush_signal:
                cfg, session, now = flush_signal
                _try_flush_asr_merge_buffer(cfg, session, now, False)
                _try_flush_asr_question_group(cfg, session, now, False)
        except queue.Empty:
            continue
        except Exception as e:
            _elog.error("flush_worker error: %s", e, exc_info=True)


def _interview_worker():
    cfg = get_config()
    engine = get_stt_engine()

    if not engine.is_loaded:
        broadcast({"type": "stt_status", "loaded": False, "loading": True, "provider": getattr(cfg, "stt_provider", "whisper")})
        try:
            engine.load_model()
        except Exception as e:
            broadcast({"type": "error", "message": f"Whisper \u6a21\u578b\u52a0\u8f7d\u5931\u8d25: {e}"})
            broadcast({"type": "recording", "value": False})
            with conversation_lock:
                get_session().is_recording = False
            return
    broadcast({"type": "stt_status", "loaded": bool(engine.is_loaded), "loading": False, "provider": getattr(cfg, "stt_provider", "whisper")})

    vad = VADBuffer(
        sample_rate=AudioCapture.SAMPLE_RATE,
        silence_threshold=getattr(cfg, "silence_threshold", 0.01),
        silence_duration=getattr(cfg, "silence_duration", 1.2),
        max_speech_duration=getattr(cfg, "assist_vad_max_speech_sec", 18.0),
    )
    session = get_session()
    _reset_asr_merge_buffer()

    # gc.collect() 之前直接放在主 ASR 循环里 (每 60s 同步执行),
    # 大堆下单次 50~500ms, 期间无法读音频可能丢块。改成独立 daemon 线程,
    # 主循环零阻塞; 线程靠 _stop_event 退出, 与 worker 生命周期对齐。
    _gc_stop = threading.Event()

    def _gc_periodic_worker() -> None:
        while not _gc_stop.wait(60.0):
            try:
                gc.collect()
            except Exception:
                pass

    _gc_thread = threading.Thread(
        target=_gc_periodic_worker, daemon=True, name="assist-gc"
    )
    _gc_thread.start()

    # H4: 启动独立 flush 线程
    global _flush_thread
    _flush_thread = threading.Thread(
        target=_flush_worker, daemon=True, name="assist-flush"
    )
    _flush_stop_event.clear()
    _flush_thread.start()

    try:
        while not _stop_event.is_set():
            now = time.monotonic()
            # H4: 将 flush 逻辑移到独立线程，避免阻塞音频采集
            try:
                _flush_queue.put_nowait((get_config(), session, now))
            except queue.Full:
                pass  # 如果队列满，跳过本次 flush

            if _pause_event.is_set():
                time.sleep(0.1)
                continue

            chunk = audio_capture.get_audio_chunk(timeout=0.1)
            if chunk is None:
                time.sleep(0.05)
                continue

            energy = AudioCapture.compute_energy(chunk)
            broadcast({"type": "audio_level", "value": round(energy, 4)})

            speech_audio = vad.feed(chunk)
            if speech_audio is not None and len(speech_audio) > AudioCapture.SAMPLE_RATE * 0.3:
                broadcast({"type": "transcribing", "value": True})
                try:
                    t0 = time.monotonic()
                    text = transcribe_with_fallback(
                        speech_audio,
                        AudioCapture.SAMPLE_RATE,
                        position=cfg.position,
                        language=cfg.language,
                    )
                    text = postprocess_interview_transcription(text)
                    stt_ms = (time.monotonic() - t0) * 1000
                    audio_sec = len(speech_audio) / AudioCapture.SAMPLE_RATE
                    _ilog.info(
                        "ASR raw=%.1fs stt=%.0fms text=%r",
                        audio_sec, stt_ms, text[:120] if text else "",
                    )
                    min_sig = getattr(
                        get_config(), "transcription_min_sig_chars", 2
                    )
                    pub = transcription_for_publish(text, min_sig)
                    if pub:
                        _ilog.info("ASR publish=%r", pub[:120])
                        _append_transcription_fragment(
                            get_config(), session, pub, time.monotonic(), False
                        )
                except Exception as e:
                    _elog.error("ASR transcribe error: %s", e, exc_info=True)
                finally:
                    broadcast({"type": "transcribing", "value": False})

        remaining = vad.flush()
        if remaining is not None and len(remaining) > AudioCapture.SAMPLE_RATE * 0.3:
            try:
                text = transcribe_with_fallback(
                    remaining, AudioCapture.SAMPLE_RATE, position=cfg.position, language=cfg.language
                )
                text = postprocess_interview_transcription(text)
                min_sig = getattr(
                    get_config(), "transcription_min_sig_chars", 2
                )
                pub = transcription_for_publish(text, min_sig)
                if pub:
                    _append_transcription_fragment(
                        get_config(), session, pub, time.monotonic(), True
                    )
            except Exception:
                pass
    except Exception as e:
        _elog.error("Interview worker crashed: %s", e, exc_info=True)
        broadcast({"type": "error", "message": f"\u9762\u8bd5\u5faa\u73af\u5f02\u5e38: {e}"})
        with conversation_lock:
            get_session().is_recording = False
        broadcast({"type": "recording", "value": False})
    finally:
        # 保证 worker 任何退出路径 (正常 / 异常 / 早退) 都释放音频设备。
        # AudioCapture.stop 是幂等的: 即使外部 stop_interview_loop 已经先调过,
        # 重复调用也是 no-op (内部用 _lock + _running 标志位防御)。
        # 这能修复 worker 异常崩溃后麦克风/系统音频设备一直被占用的泄漏。
        try:
            audio_capture.stop(owner="assist")
        except Exception:
            _elog.error("audio_capture.stop in worker finally failed", exc_info=True)
        # 通知 GC daemon 退出并 join, 让 worker 生命周期完全确定 (避免测试需要
        # sleep 等收敛, 也不让旧 daemon 与下一轮 worker 的 daemon 短暂并存)。
        # threading.Event.set() 不会抛, 不需要 try; join(timeout) 只兜个上限。
        _gc_stop.set()
        try:
            _gc_thread.join(timeout=0.5)
        except Exception:
            pass
        _flush_stop_event.set()
        try:
            if _flush_thread and _flush_thread.is_alive():
                _flush_thread.join(timeout=0.5)
        except Exception:
            pass
        try:
            _try_flush_asr_merge_buffer(
                get_config(), get_session(), time.monotonic(), True
            )
        except Exception:
            pass
        try:
            _try_flush_asr_question_group(
                get_config(), get_session(), time.monotonic(), True
            )
        except Exception:
            pass


def _candidate_provider_config(cfg) -> tuple[str, str, str, bool]:
    provider = (getattr(cfg, "candidate_stt_provider", "whisper") or "whisper").strip()
    allow_remote = bool(getattr(cfg, "candidate_remote_stt_enabled", False))
    if provider in ("doubao", "generic") and not allow_remote:
        provider = "whisper"
    model = (getattr(cfg, "candidate_whisper_model", "") or getattr(cfg, "whisper_model", "base") or "base").strip()
    candidate_lang_raw = (getattr(cfg, "candidate_whisper_language", "") or "").strip()
    language = candidate_lang_raw or (getattr(cfg, "whisper_language", "auto") or "auto").strip() or "auto"
    return provider, model, language, allow_remote


def _candidate_streaming_config(cfg, provider: str) -> tuple[bool, int]:
    enabled = bool(getattr(cfg, "candidate_streaming_asr_enabled", True)) and provider == "whisper"
    interval_ms = max(800, min(5000, int(getattr(cfg, "candidate_streaming_asr_interval_ms", 1500) or 1500)))
    return enabled, interval_ms


def _preload_candidate_whisper_async(provider: str, model: str, language: str) -> None:
    if provider != "whisper":
        return
    preload_key = (model or "base", language or "auto")
    with _candidate_whisper_preload_lock:
        if preload_key in _candidate_whisper_preload_inflight:
            return
        _candidate_whisper_preload_inflight.add(preload_key)

    def _load() -> None:
        try:
            try:
                engine = get_stt_engine(
                    provider="whisper",
                    model_size=model,
                    language=language,
                )
            except TypeError:
                engine = get_stt_engine(model_size=model, language=language)
            if not engine.is_loaded:
                engine.load_model()
            broadcast(
                {
                    "type": "candidate_asr_status",
                    "loaded": bool(engine.is_loaded),
                    "loading": False,
                    "provider": "whisper",
                }
            )
        except Exception as exc:
            _elog.warning(
                "CANDIDATE_ASR_PRELOAD_FAIL model=%s language=%s err=%s",
                model,
                language,
                exc,
            )
            broadcast(
                {
                    "type": "candidate_asr_status",
                    "loaded": False,
                    "loading": False,
                    "provider": "whisper",
                    "error": str(exc)[:160],
                }
            )
        finally:
            with _candidate_whisper_preload_lock:
                _candidate_whisper_preload_inflight.discard(preload_key)

    threading.Thread(target=_load, daemon=True, name="candidate-whisper-preload").start()


def preload_candidate_asr_if_enabled() -> None:
    cfg = get_config()
    if not bool(getattr(cfg, "candidate_asr_enabled", False)):
        return
    provider, model, language, _allow_remote = _candidate_provider_config(cfg)
    if provider != "whisper":
        return
    broadcast({"type": "candidate_asr_status", "loaded": False, "loading": True, "provider": "whisper"})
    _preload_candidate_whisper_async(provider, model, language)


def _publish_candidate_transcription(
    session,
    text: str,
    provider: str,
    qa_id: str = "",
    *,
    segment_id: str = "",
    is_final: bool = True,
) -> None:
    cleaned = (text or "").strip()
    if not cleaned:
        return
    recent_interviewer = session.transcription_history[-3:]
    for item in recent_interviewer:
        interviewer_text = (item or "").strip()
        if len(cleaned) < 12 or len(interviewer_text) < 12:
            continue
        threshold = 0.95 if len(cleaned) < 30 else 0.88
        similarity = SequenceMatcher(None, cleaned, interviewer_text).ratio()
        if similarity >= threshold:
            _ilog.info("CANDIDATE_ASR_SKIP_ECHO ratio=%.2f text=%r", similarity, cleaned[:80])
            return
    with conversation_lock:
        segment = session.add_candidate_transcription(
            cleaned,
            qa_id=qa_id or None,
            provider=provider,
            segment_id=segment_id,
            is_final=is_final,
        )
    if segment is None:
        return
    if segment.is_final and segment.qa_id:
        with conversation_lock:
            candidate_answer = session.get_candidate_answer_for_qa(segment.qa_id, max_chars=2400)
        if candidate_answer:
            _submit_candidate_knowledge_update(segment.qa_id, candidate_answer)
    _ilog.info(
        "CANDIDATE_ASR_PUBLISH segment=%s qa_id=%s final=%s provider=%s chars=%d",
        segment.segment_id,
        segment.qa_id,
        segment.is_final,
        provider,
        len(cleaned),
    )
    broadcast(
        {
            "type": "candidate_transcription",
            "scope": "assist",
            "text": cleaned,
            "qa_id": segment.qa_id,
            "provider": provider,
            "segment_id": segment.segment_id,
            "is_final": segment.is_final,
        }
    )


def _candidate_worker():
    cfg = get_config()
    provider, model, language, allow_remote = _candidate_provider_config(cfg)
    streaming_enabled, streaming_interval_ms = _candidate_streaming_config(cfg, provider)
    _ilog.info(
        "CANDIDATE_ASR_WORKER_START provider=%s model=%s language=%s remote=%s streaming=%s interval_ms=%d",
        provider,
        model,
        language,
        allow_remote,
        streaming_enabled,
        streaming_interval_ms,
    )
    broadcast({"type": "candidate_asr_status", "loaded": False, "loading": provider == "whisper", "provider": provider})
    _preload_candidate_whisper_async(provider, model, language)

    vad = VADBuffer(
        sample_rate=AudioCapture.SAMPLE_RATE,
        silence_threshold=getattr(cfg, "silence_threshold", 0.01),
        silence_duration=getattr(cfg, "silence_duration", 1.2),
    )
    session = get_session()
    current_segment_id = ""
    last_partial_at = 0.0
    last_partial_text = ""

    def _finalize_candidate_audio(final_audio, log_kind: str) -> None:
        nonlocal current_segment_id, last_partial_text, last_partial_at
        if final_audio is None or len(final_audio) <= AudioCapture.SAMPLE_RATE * 0.3:
            current_segment_id = ""
            last_partial_text = ""
            last_partial_at = 0.0
            with conversation_lock:
                if hasattr(session, "mark_candidate_asr_idle"):
                    session.mark_candidate_asr_idle()
            return
        local_cfg = get_config()
        final_provider, final_model, final_language, final_allow_remote = _candidate_provider_config(local_cfg)
        try:
            with conversation_lock:
                target_qa_id = (
                    getattr(session, "candidate_asr_active_qa_id", "")
                    or getattr(session, "current_candidate_qa_id", "")
                )
                if hasattr(session, "mark_candidate_asr_busy"):
                    session.mark_candidate_asr_busy(target_qa_id)
            t0 = time.monotonic()
            text = transcribe_with_fallback(
                final_audio,
                AudioCapture.SAMPLE_RATE,
                position=local_cfg.position,
                language=final_language,
                provider=final_provider,
                whisper_model=final_model,
                whisper_language=final_language,
                allow_remote=final_allow_remote,
                status_event_type="candidate_asr_status",
                scope="candidate",
                whisper_lock_timeout_sec=0.0,
            )
            pub = transcription_for_publish(
                postprocess_interview_transcription(text),
                max(3, int(getattr(local_cfg, "transcription_min_sig_chars", 2) or 2)),
            )
            if pub:
                replaced_partial = bool(current_segment_id and last_partial_text)
                _ilog.info(
                    "CANDIDATE_ASR_%s segment=%s qa_id=%s provider=%s raw=%.1fs stt=%.0fms chars=%d replaced_partial=%s text=%r",
                    log_kind,
                    current_segment_id,
                    target_qa_id,
                    final_provider,
                    len(final_audio) / AudioCapture.SAMPLE_RATE,
                    (time.monotonic() - t0) * 1000,
                    len(pub),
                    replaced_partial,
                    pub[:120],
                )
                _publish_candidate_transcription(
                    session,
                    pub,
                    final_provider,
                    qa_id=target_qa_id,
                    segment_id=current_segment_id,
                    is_final=True,
                )
                broadcast({"type": "candidate_asr_status", "loaded": True, "loading": False, "provider": final_provider})
        except Exception as e:
            _elog.error("Candidate ASR transcribe error: %s", e, exc_info=True)
            broadcast({"type": "candidate_asr_status", "loaded": False, "loading": False, "provider": final_provider, "error": str(e)[:160]})
        finally:
            with conversation_lock:
                if hasattr(session, "mark_candidate_asr_idle"):
                    session.mark_candidate_asr_idle()
            current_segment_id = ""
            last_partial_text = ""
            last_partial_at = 0.0

    try:
        while not _stop_event.is_set():
            if _pause_event.is_set():
                if _candidate_flush_event.is_set():
                    _candidate_flush_event.clear()
                    _finalize_candidate_audio(vad.flush(), "PAUSE_FINAL")
                time.sleep(0.1)
                continue
            chunk = _candidate_audio_capture.get_audio_chunk(timeout=0.1)
            if chunk is None:
                time.sleep(0.05)
                continue

            cfg = get_config()
            if not bool(getattr(cfg, "candidate_asr_enabled", False)):
                with conversation_lock:
                    if hasattr(session, "mark_candidate_asr_idle"):
                        session.mark_candidate_asr_idle()
                continue

            speech_audio = vad.feed(chunk)
            if getattr(vad, "has_pending_audio", False):
                with conversation_lock:
                    if hasattr(session, "mark_candidate_asr_busy"):
                        session.mark_candidate_asr_busy()
                    target_qa_id = (
                        getattr(session, "candidate_asr_active_qa_id", "")
                        or getattr(session, "current_candidate_qa_id", "")
                    )
                if not current_segment_id:
                    current_segment_id = f"cand-{int(time.time() * 1000)}"
                    last_partial_text = ""
                    last_partial_at = 0.0
                    _ilog.info("CANDIDATE_ASR_SEGMENT_START segment=%s qa_id=%s", current_segment_id, target_qa_id)
                provider, model, language, allow_remote = _candidate_provider_config(cfg)
                streaming_enabled, streaming_interval_ms = _candidate_streaming_config(cfg, provider)
                now_mono = time.monotonic()
                pending_audio = vad.pending_audio() if hasattr(vad, "pending_audio") else None
                if (
                    streaming_enabled
                    and pending_audio is not None
                    and len(pending_audio) >= AudioCapture.SAMPLE_RATE * 1.0
                    and now_mono - last_partial_at >= streaming_interval_ms / 1000.0
                ):
                    last_partial_at = now_mono
                    try:
                        partial_t0 = time.monotonic()
                        partial_text = transcribe_with_fallback(
                            pending_audio,
                            AudioCapture.SAMPLE_RATE,
                            position=cfg.position,
                            language=language,
                            provider=provider,
                            whisper_model=model,
                            whisper_language=language,
                            allow_remote=False,
                            status_event_type="candidate_asr_status",
                            scope="candidate",
                            whisper_lock_timeout_sec=0.0,
                            whisper_require_loaded=True,
                        )
                        partial_pub = transcription_for_publish(
                            postprocess_interview_transcription(partial_text),
                            max(3, int(getattr(cfg, "transcription_min_sig_chars", 2) or 2)),
                        )
                        if partial_pub and partial_pub != last_partial_text:
                            last_partial_text = partial_pub
                            _ilog.info(
                                "CANDIDATE_ASR_PARTIAL segment=%s qa_id=%s provider=%s raw=%.1fs stt=%.0fms chars=%d text=%r",
                                current_segment_id,
                                target_qa_id,
                                provider,
                                len(pending_audio) / AudioCapture.SAMPLE_RATE,
                                (time.monotonic() - partial_t0) * 1000,
                                len(partial_pub),
                                partial_pub[:120],
                            )
                            _publish_candidate_transcription(
                                session,
                                partial_pub,
                                provider,
                                qa_id=target_qa_id,
                                segment_id=current_segment_id,
                                is_final=False,
                            )
                        elif partial_pub:
                            _ilog.debug(
                                "CANDIDATE_ASR_PARTIAL_DUP segment=%s qa_id=%s chars=%d",
                                current_segment_id,
                                target_qa_id,
                                len(partial_pub),
                            )
                        else:
                            _ilog.debug(
                                "CANDIDATE_ASR_PARTIAL_EMPTY segment=%s qa_id=%s raw=%.1fs",
                                current_segment_id,
                                target_qa_id,
                                len(pending_audio) / AudioCapture.SAMPLE_RATE,
                            )
                    except Exception as exc:
                        _elog.debug("Candidate streaming ASR partial failed: %s", exc)
            if speech_audio is None:
                continue
            if len(speech_audio) <= AudioCapture.SAMPLE_RATE * 0.3:
                current_segment_id = ""
                last_partial_text = ""
                last_partial_at = 0.0
                with conversation_lock:
                    if hasattr(session, "mark_candidate_asr_idle"):
                        session.mark_candidate_asr_idle()
                continue

            _finalize_candidate_audio(speech_audio, "FINAL")

        remaining = vad.flush()
        if remaining is not None:
            _finalize_candidate_audio(remaining, "FLUSH_FINAL")
    except Exception as e:
        _elog.error("Candidate ASR worker crashed: %s", e, exc_info=True)
        broadcast({"type": "candidate_asr_status", "loaded": False, "loading": False, "provider": provider, "error": str(e)[:160]})
    finally:
        try:
            _candidate_audio_capture.stop(owner="assist-candidate")
        except Exception:
            _elog.error("candidate audio_capture.stop failed", exc_info=True)


# ---------------------------------------------------------------------------
# Answer generation worker
# ---------------------------------------------------------------------------

def _process_question_parallel(
    task: TaskPayload,
    seq: int,
    model_idx: int,
    sess_v: int,
):
    cfg = get_config()
    my_gen = _capture_generation()
    my_asr_turn = int(_task_meta(task).get("asr_turn_id", 0)) if _is_asr_task(task) else 0

    def aborted() -> bool:
        if my_gen != _answer_generation:
            return True
        if (
            _is_asr_task(task)
            and _asr_interrupt_running(cfg)
            and my_asr_turn
            and my_asr_turn < _get_latest_asr_turn_id()
        ):
            return True
        return False

    return process_question_parallel(
        task,
        seq,
        model_idx,
        sess_v,
        AnswerWorkerDeps(
            abort_check=aborted,
            is_session_current=lambda version: version == _task_session_version,
            flush_commit=_flush_commit,
            mark_seq_skipped=_mark_seq_skipped,
            submit_knowledge_record=_submit_knowledge_record,
            broadcast=broadcast,
            logger=_ilog,
            error_logger=_elog,
        ),
    )


def _save_knowledge_record(action: str, *args: object):
    try:
        from services.storage.knowledge import save_record, update_candidate_answer_for_qa

        if action == "candidate_update":
            qa_id = str(args[0] if len(args) > 0 else "")
            candidate_answer = str(args[1] if len(args) > 1 else "")
            update_candidate_answer_for_qa(qa_id, candidate_answer)
            return

        question = str(args[0] if len(args) > 0 else "")
        answer = str(args[1] if len(args) > 1 else "")
        qa_id = str(args[2] if len(args) > 2 else "")
        candidate_answer = str(args[3] if len(args) > 3 else "")
        save_record("assist", question, answer, qa_id=qa_id, candidate_answer=candidate_answer)
    except Exception as exc:
        _elog.warning("_save_knowledge_record failed: %s", exc)
