"""Interview assist pipeline: ASR buffering, task dispatch, parallel answer workers."""

import gc
import time
import threading
from typing import Any, Callable, Optional

from core.background import BoundedTaskWorker
from core.config import get_config
from core.logger import get_interview_logger, get_logger
from core.session import get_session, reset_session, conversation_lock

_ilog = get_interview_logger()
_elog = get_logger("pipeline")
from services.audio import AudioCapture, VADBuffer, audio_capture
from services.stt import (
    get_stt_engine,
    transcribe_with_fallback,
    transcription_for_publish,
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
_stop_event = threading.Event()
_pause_event = threading.Event()

_answer_generation = 0
_gen_lock = threading.Lock()

_pending: list[tuple[TaskPayload, int, int]] = []
_dispatch_lock = threading.Lock()
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

def _reset_asr_merge_buffer():
    _asr_state.reset_merge_buffer()
    _sync_asr_state_to_compat_globals()


def _reset_pending_asr_group():
    _asr_state.reset_pending_group()
    _sync_asr_state_to_compat_globals()


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
    with _dispatch_lock:
        _pending.clear()
        _in_flight_tasks.clear()
        _latest_asr_turn_id = 0
        _recent_asr_turn_monos = []
    with _commit_lock:
        _commit_buffer.clear()
        _skipped_commit_seqs.clear()
        _next_commit_seq = _next_submit_seq
    _task_session_version += 1
    _reset_asr_merge_buffer()
    _reset_pending_asr_group()


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


def _submit_knowledge_record(question: str, answer: str) -> bool:
    worker = _knowledge_worker
    if worker is None:
        _save_knowledge_record(question, answer)
        return True
    return worker.submit(question, answer)


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
    _sync_compat_globals_to_asr_state()
    _asr_state.flush_question_group_now(cfg, session)
    _sync_asr_state_to_compat_globals()


def _try_flush_asr_question_group(cfg, session, now_mono: float, force: bool = False) -> None:
    _sync_compat_globals_to_asr_state()
    _asr_state.try_flush_question_group(cfg, session, now_mono, force)
    _sync_asr_state_to_compat_globals()


def _handle_auto_detect_asr_text(cfg, session, pub: str, source: str, now_mono: float) -> None:
    _sync_compat_globals_to_asr_state()
    _asr_state.handle_auto_detect_asr_text(cfg, session, pub, source, now_mono)
    _sync_asr_state_to_compat_globals()


# ---------------------------------------------------------------------------
# ASR merge buffer
# ---------------------------------------------------------------------------

def _flush_asr_merge_buffer_now(cfg, session) -> None:
    _sync_compat_globals_to_asr_state()
    _asr_state.flush_merge_buffer_now(cfg, session)
    _sync_asr_state_to_compat_globals()


def _try_flush_asr_merge_buffer(cfg, session, now_mono: float, force: bool = False) -> None:
    _sync_compat_globals_to_asr_state()
    _asr_state.try_flush_merge_buffer(cfg, session, now_mono, force)
    _sync_asr_state_to_compat_globals()


def _append_transcription_fragment(cfg, session, pub: str, now_mono: float, force_flush_tail: bool = False) -> None:
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

def start_nonblocking(device_id: Optional[int] = None):
    global _interview_thread
    stop_interview_loop()
    _stop_event.clear()
    _pause_event.clear()

    session = get_session()
    with conversation_lock:
        session.is_recording = True
        session.is_paused = False

    if device_id is not None:
        capture_is_loopback = False
        for d in AudioCapture.list_devices():
            if d["id"] == device_id:
                capture_is_loopback = d["is_loopback"]
                break

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


def stop_interview_loop():
    global _interview_thread
    _stop_event.set()
    _pause_event.clear()
    cancel_answer_work(reset_session_data=False)
    audio_capture.stop(owner="assist")
    session = get_session()
    with conversation_lock:
        session.is_recording = False
        session.is_paused = False
        if len(session.transcription_history) > 30:
            session.transcription_history = session.transcription_history[-30:]
    broadcast({"type": "recording", "value": False})
    broadcast({"type": "paused", "value": False})
    if _interview_thread and _interview_thread.is_alive():
        _interview_thread.join(timeout=3)
    _interview_thread = None
    gc.collect()
    _ilog.info("INTERVIEW_STOP qa_count=%d", len(session.qa_pairs))


def pause_interview():
    _pause_event.set()
    audio_capture.stop(owner="assist")
    session = get_session()
    with conversation_lock:
        session.is_paused = True
    broadcast({"type": "paused", "value": True})


def unpause_interview(device_id: Optional[int] = None):
    session = get_session()
    capture_is_loopback = session.capture_is_loopback
    next_device_id = session.last_device_id
    if device_id is not None:
        next_device_id = int(device_id)
        for d in AudioCapture.list_devices():
            if d["id"] == next_device_id:
                capture_is_loopback = d["is_loopback"]
                break
    audio_capture.start(next_device_id, owner="assist")
    _pause_event.clear()
    with conversation_lock:
        session.last_device_id = next_device_id
        session.capture_is_loopback = capture_is_loopback
        session.is_paused = False
    broadcast({"type": "paused", "value": False})


def is_paused() -> bool:
    return _pause_event.is_set()


def _interview_worker():
    cfg = get_config()
    engine = get_stt_engine()

    if not engine.is_loaded:
        broadcast({"type": "stt_status", "loaded": False, "loading": True})
        try:
            engine.load_model()
        except Exception as e:
            broadcast({"type": "error", "message": f"Whisper \u6a21\u578b\u52a0\u8f7d\u5931\u8d25: {e}"})
            broadcast({"type": "recording", "value": False})
            with conversation_lock:
                get_session().is_recording = False
            return
    broadcast({"type": "stt_status", "loaded": True, "loading": False})

    vad = VADBuffer(
        sample_rate=AudioCapture.SAMPLE_RATE,
        silence_threshold=cfg.silence_threshold,
        silence_duration=cfg.silence_duration,
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

    try:
        while not _stop_event.is_set():
            now = time.monotonic()
            _try_flush_asr_merge_buffer(get_config(), session, now, False)
            _try_flush_asr_question_group(get_config(), session, now, False)

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


def _save_knowledge_record(question: str, answer: str):
    try:
        from services.storage.knowledge import save_record
        save_record("assist", question, answer)
    except Exception:
        pass
