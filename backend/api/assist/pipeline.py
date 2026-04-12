"""Interview assist pipeline: ASR buffering, task dispatch, parallel answer workers."""

import gc
import time
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Tuple

from core.config import get_config
from core.logger import get_interview_logger, get_logger
from core.session import get_session, reset_session, conversation_lock

_ilog = get_interview_logger()
_elog = get_logger("pipeline")
from services.audio import AudioCapture, VADBuffer, audio_capture
from services.stt import (
    build_asr_question_group_text,
    classify_asr_question_candidate,
    classify_followup,
    get_stt_engine,
    is_viable_asr_question_group,
    join_transcription_fragments,
    transcribe_with_fallback,
    transcription_for_publish,
)
from services.llm import (
    PROMPT_MODE_ASR_REALTIME,
    PROMPT_MODE_MANUAL_TEXT,
    PROMPT_MODE_SERVER_SCREEN,
    PROMPT_MODE_WRITTEN_EXAM,
    PromptMode,
    build_system_prompt,
    chat_stream_single_model,
    get_token_stats,
    postprocess_answer_for_mode,
)
from api.common import get_model_health
from api.realtime.ws import broadcast

# ---------------------------------------------------------------------------
# Module state
# ---------------------------------------------------------------------------

_interview_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_pause_event = threading.Event()

_answer_generation = 0
_gen_lock = threading.Lock()

TaskPayload = Tuple[str, Optional[str], bool, str, dict[str, Any]]


@dataclass
class PendingASRGroup:
    source: str
    utterances: list[str] = field(default_factory=list)
    first_mono: float = 0.0
    last_mono: float = 0.0
    has_promote: bool = False


_pending: list[Tuple[TaskPayload, int, int]] = []
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


# ---------------------------------------------------------------------------
# ASR merge / question grouping
# ---------------------------------------------------------------------------

def _reset_asr_merge_buffer():
    global _asr_merge_parts, _asr_merge_mono_first, _asr_merge_mono_last
    _asr_merge_parts = []
    _asr_merge_mono_first = None
    _asr_merge_mono_last = None


def _reset_pending_asr_group():
    global _pending_asr_group
    _pending_asr_group = None


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
    return bool(getattr(cfg, "assist_asr_interrupt_running", True))


def _task_meta(task: TaskPayload) -> dict[str, Any]:
    return task[4]


def _is_asr_task(task: TaskPayload) -> bool:
    return _task_meta(task).get("origin") == "asr"


def _get_latest_asr_turn_id() -> int:
    with _dispatch_lock:
        return _latest_asr_turn_id


def _is_stale_inflight_asr_task(task: TaskPayload) -> bool:
    return _is_asr_task(task) and int(_task_meta(task).get("asr_turn_id", 0)) < _latest_asr_turn_id


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
        reset_session()


# ---------------------------------------------------------------------------
# Model dispatch
# ---------------------------------------------------------------------------

def _key_ok(m) -> bool:
    return bool(m.api_key and m.api_key not in ("", "sk-your-api-key-here"))


def _model_eligible(i: int, m, need_vision: bool) -> bool:
    if not getattr(m, "enabled", True):
        return False
    if get_model_health(i) == "error":
        return False
    if not _key_ok(m):
        return False
    if need_vision and not m.supports_vision:
        return False
    return True


def _prompt_mode_for_task(source: str, manual_input: bool, written_exam: bool = False) -> PromptMode:
    if source.startswith("server_screen_"):
        if written_exam:
            return PROMPT_MODE_WRITTEN_EXAM
        return PROMPT_MODE_SERVER_SCREEN
    if manual_input:
        return PROMPT_MODE_MANUAL_TEXT
    return PROMPT_MODE_ASR_REALTIME


def _priority_model_index(cfg) -> int:
    n = len(cfg.models)
    if n <= 0:
        return 0
    try:
        am = cfg.get_active_model()
    except Exception:
        return max(0, min(int(cfg.active_model), n - 1))
    for i, m in enumerate(cfg.models):
        if m is am:
            return i
    return max(0, min(int(cfg.active_model), n - 1))


def _dispatch_model_order(cfg) -> list[int]:
    n = len(cfg.models)
    if n == 0:
        return []
    p = _priority_model_index(cfg)
    return [p] + [i for i in range(n) if i != p]


def _dispatch_snapshot_locked() -> tuple[set[int], int]:
    busy_models: set[int] = set()
    effective_slots = 0
    for model_idx, task in _in_flight_tasks.values():
        if _is_stale_inflight_asr_task(task):
            continue
        busy_models.add(model_idx)
        effective_slots += 1
    return busy_models, effective_slots


def _physical_busy_models_locked() -> set[int]:
    return {model_idx for model_idx, _task in _in_flight_tasks.values()}


def _drain_commit_queue_locked():
    global _next_commit_seq
    while True:
        while _next_commit_seq in _skipped_commit_seqs:
            _skipped_commit_seqs.discard(_next_commit_seq)
            _next_commit_seq += 1
        apply_fn = _commit_buffer.pop(_next_commit_seq, None)
        if apply_fn is None:
            return
        apply_fn()
        _next_commit_seq += 1


def _mark_seq_skipped(seq: int):
    with _commit_lock:
        if seq < _next_commit_seq:
            return
        _skipped_commit_seqs.add(seq)
        _drain_commit_queue_locked()


def _begin_asr_turn() -> int:
    global _latest_asr_turn_id
    skipped: list[int] = []
    with _dispatch_lock:
        _latest_asr_turn_id += 1
        turn_id = _latest_asr_turn_id
        kept: list[Tuple[TaskPayload, int, int]] = []
        for task, seq, sess_v in _pending:
            if _is_asr_task(task):
                skipped.append(seq)
                continue
            kept.append((task, seq, sess_v))
        _pending[:] = kept
    for seq in skipped:
        _mark_seq_skipped(seq)
    return turn_id


def pick_model_index(
    task: TaskPayload,
    busy: set[int],
    avoid_models: Optional[set[int]] = None,
) -> Optional[int]:
    text, image, manual, source, meta = task
    need_vision = bool(image)
    cfg = get_config()
    avoid = avoid_models or set()

    def ok_basic(i: int, m) -> bool:
        if i in busy:
            return False
        if not getattr(m, "enabled", True):
            return False
        if not _key_ok(m):
            return False
        if need_vision and not m.supports_vision:
            return False
        return True

    order = _dispatch_model_order(cfg)
    if avoid:
        for i in order:
            if i in avoid:
                continue
            m = cfg.models[i]
            if not ok_basic(i, m):
                continue
            if get_model_health(i) == "error":
                continue
            return i
        for i in order:
            if i in avoid:
                continue
            m = cfg.models[i]
            if ok_basic(i, m):
                return i
    for i in order:
        m = cfg.models[i]
        if not ok_basic(i, m):
            continue
        if get_model_health(i) == "error":
            continue
        return i
    for i in order:
        m = cfg.models[i]
        if ok_basic(i, m):
            return i
    return None


def _max_parallel_slots() -> int:
    cfg = get_config()
    n_ok = sum(1 for i, m in enumerate(cfg.models) if _model_eligible(i, m, False))
    cap = max(1, getattr(cfg, "max_parallel_answers", 2))
    return max(1, min(cap, max(n_ok, 1)))


def submit_answer_task(task: TaskPayload):
    global _next_submit_seq
    if pick_model_index(task, set()) is None:
        broadcast(
            {
                "type": "error",
                "message": "\u6ca1\u6709\u53ef\u7528\u7684\u7b54\u9898\u6a21\u578b\uff1a\u8bf7\u81f3\u5c11\u542f\u7528\u4e00\u4e2a\u5df2\u914d\u7f6e API Key \u7684\u6a21\u578b\uff08\u8bc6\u56fe\u9898\u9700\u8bc6\u56fe\u6a21\u578b\uff09\u3002",
            }
        )
        return
    with _dispatch_lock:
        seq = _next_submit_seq
        _next_submit_seq += 1
        tv = _task_session_version
        _pending.append((task, seq, tv))
    _try_dispatch()


# ---------------------------------------------------------------------------
# ASR question group handling
# ---------------------------------------------------------------------------

def _flush_asr_question_group_now(cfg, session) -> None:
    global _pending_asr_group
    group = _pending_asr_group
    if group is None:
        return
    _pending_asr_group = None
    if not is_viable_asr_question_group(
        group.utterances,
        getattr(cfg, "transcription_min_sig_chars", 2),
    ):
        return
    question_text = build_asr_question_group_text(group.utterances)
    if not question_text:
        return
    now_mono = time.monotonic()
    high_churn_short = _is_high_churn_asr_submission(cfg, now_mono)
    turn_id = _begin_asr_turn()
    _record_asr_turn(now_mono)
    _ilog.info(
        "ASR_QUESTION turn=%d utterances=%d churn=%s text=%r",
        turn_id, len(group.utterances), high_churn_short,
        question_text[:150],
    )
    submit_answer_task(
        (
            question_text,
            None,
            False,
            group.source,
            {
                "origin": "asr",
                "asr_turn_id": turn_id,
                "utterances": list(group.utterances),
                "high_churn_short_answer": high_churn_short,
            },
        )
    )


def _asr_fast_confirm_sec(cfg) -> float:
    fast = float(getattr(cfg, "assist_asr_fast_confirm_sec", 0.2) or 0.0)
    return max(0.1, min(2.0, fast))


def _try_flush_asr_question_group(cfg, session, now_mono: float, force: bool = False) -> None:
    group = _pending_asr_group
    if group is None:
        return
    confirm = _asr_confirm_window_sec(cfg)
    fast_confirm = _asr_fast_confirm_sec(cfg)
    max_wait = _asr_group_max_wait_sec(cfg)
    since_last = now_mono - group.last_mono
    age = now_mono - group.first_mono
    if force or age >= max_wait:
        _flush_asr_question_group_now(cfg, session)
    elif group.has_promote and len(group.utterances) == 1 and since_last >= fast_confirm:
        _flush_asr_question_group_now(cfg, session)
    elif group.has_promote and since_last >= confirm:
        _flush_asr_question_group_now(cfg, session)
    elif not group.has_promote and since_last >= confirm * 2:
        _flush_asr_question_group_now(cfg, session)


def _handle_auto_detect_asr_text(cfg, session, pub: str, source: str, now_mono: float) -> None:
    global _pending_asr_group
    _try_flush_asr_question_group(cfg, session, now_mono, False)
    kind, cleaned = classify_asr_question_candidate(
        pub,
        getattr(cfg, "transcription_min_sig_chars", 2),
    )
    if not cleaned:
        return
    if kind == "ignore" and _pending_asr_group is None:
        return
    if _pending_asr_group is None:
        _pending_asr_group = PendingASRGroup(
            source=source,
            utterances=[cleaned],
            first_mono=now_mono,
            last_mono=now_mono,
            has_promote=(kind == "promote"),
        )
    else:
        _pending_asr_group.utterances.append(cleaned)
        _pending_asr_group.last_mono = now_mono
        _pending_asr_group.source = source
        _pending_asr_group.has_promote = _pending_asr_group.has_promote or kind == "promote"


# ---------------------------------------------------------------------------
# ASR merge buffer
# ---------------------------------------------------------------------------

def _flush_asr_merge_buffer_now(cfg, session) -> None:
    global _asr_merge_parts, _asr_merge_mono_first, _asr_merge_mono_last
    if not _asr_merge_parts:
        return
    parts = list(_asr_merge_parts)
    _asr_merge_parts.clear()
    _asr_merge_mono_first = None
    _asr_merge_mono_last = None
    merged_raw = join_transcription_fragments(parts)
    min_sig = getattr(cfg, "transcription_min_sig_chars", 2)
    pub = transcription_for_publish(merged_raw, min_sig)
    if not pub:
        return
    session.add_transcription(pub)
    broadcast({"type": "transcription", "text": pub})
    if cfg.auto_detect:
        src = (
            "conversation_loopback"
            if session.capture_is_loopback
            else "conversation_mic"
        )
        _handle_auto_detect_asr_text(cfg, session, pub, src, time.monotonic())


def _try_flush_asr_merge_buffer(cfg, session, now_mono: float, force: bool = False) -> None:
    if not _asr_merge_parts:
        return
    gap = float(getattr(cfg, "assist_transcription_merge_gap_sec", 2.0) or 0.0)
    max_wait = float(getattr(cfg, "assist_transcription_merge_max_sec", 12.0) or 12.0)
    if max_wait < 1.0:
        max_wait = 12.0
    if force:
        _flush_asr_merge_buffer_now(cfg, session)
        return
    if gap <= 0:
        return
    if _asr_merge_mono_last is None:
        return
    since_last = now_mono - _asr_merge_mono_last
    burst_age = (now_mono - _asr_merge_mono_first) if _asr_merge_mono_first is not None else 0.0
    if since_last >= gap or burst_age >= max_wait:
        _flush_asr_merge_buffer_now(cfg, session)


def _append_transcription_fragment(cfg, session, pub: str, now_mono: float, force_flush_tail: bool = False) -> None:
    global _asr_merge_parts, _asr_merge_mono_first, _asr_merge_mono_last
    gap = float(getattr(cfg, "assist_transcription_merge_gap_sec", 2.0) or 0.0)
    if gap <= 0:
        session.add_transcription(pub)
        broadcast({"type": "transcription", "text": pub})
        if cfg.auto_detect:
            src = (
                "conversation_loopback"
                if session.capture_is_loopback
                else "conversation_mic"
            )
            _handle_auto_detect_asr_text(cfg, session, pub, src, now_mono)
        return
    if not _asr_merge_parts:
        _asr_merge_mono_first = now_mono
    _asr_merge_parts.append(pub)
    _asr_merge_mono_last = now_mono
    if force_flush_tail:
        _flush_asr_merge_buffer_now(cfg, session)
    else:
        _try_flush_asr_merge_buffer(cfg, session, now_mono, False)


# ---------------------------------------------------------------------------
# Dispatch / worker
# ---------------------------------------------------------------------------

def _try_dispatch():
    while True:
        skipped_seq: Optional[int] = None
        with _dispatch_lock:
            busy_models, effective_slots = _dispatch_snapshot_locked()
            physical_busy_models = _physical_busy_models_locked()
            if effective_slots >= _max_parallel_slots():
                return
            model_idx = None
            task_seq = None
            idx = 0
            while idx < len(_pending):
                task, seq, tv = _pending[idx]
                meta = _task_meta(task)
                if _is_asr_task(task) and int(meta.get("asr_turn_id", 0)) < _latest_asr_turn_id:
                    _pending.pop(idx)
                    skipped_seq = seq
                    break
                avoid_models = None
                if _is_asr_task(task):
                    avoid_models = physical_busy_models
                mi = pick_model_index(task, busy_models, avoid_models=avoid_models)
                if mi is not None:
                    _pending.pop(idx)
                    model_idx = mi
                    task_seq = (task, seq, tv)
                    break
                idx += 1
            if model_idx is None or task_seq is None:
                if skipped_seq is None:
                    return
            else:
                _in_flight_tasks[task_seq[1]] = (model_idx, task_seq[0])
        if skipped_seq is not None:
            _mark_seq_skipped(skipped_seq)
            continue
        task, seq, sess_v = task_seq
        threading.Thread(
            target=_run_answer_worker,
            args=(task, seq, model_idx, sess_v),
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

def start_nonblocking(device_id: int):
    global _interview_thread
    stop_interview_loop()
    _stop_event.clear()
    _pause_event.clear()

    capture_is_loopback = False
    for d in AudioCapture.list_devices():
        if d["id"] == device_id:
            capture_is_loopback = d["is_loopback"]
            break

    audio_capture.start(device_id)

    session = get_session()
    session.is_recording = True
    session.is_paused = False
    session.last_device_id = device_id
    session.capture_is_loopback = capture_is_loopback
    _ilog.info("INTERVIEW_START device=%s loopback=%s", device_id, capture_is_loopback)
    broadcast({"type": "recording", "value": True})
    broadcast({"type": "paused", "value": False})

    _interview_thread = threading.Thread(target=_interview_worker, daemon=True)
    _interview_thread.start()


def stop_interview_loop():
    global _interview_thread
    _stop_event.set()
    _pause_event.clear()
    cancel_answer_work(reset_session_data=False)
    audio_capture.stop()
    session = get_session()
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
    audio_capture.stop()
    session = get_session()
    session.is_paused = True
    broadcast({"type": "paused", "value": True})


def unpause_interview(device_id: Optional[int] = None):
    session = get_session()
    if device_id is not None:
        session.last_device_id = int(device_id)
        for d in AudioCapture.list_devices():
            if d["id"] == session.last_device_id:
                session.capture_is_loopback = d["is_loopback"]
                break
    audio_capture.start(session.last_device_id)
    _pause_event.clear()
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
    _last_gc_mono = time.monotonic()

    try:
        while not _stop_event.is_set():
            now = time.monotonic()
            if now - _last_gc_mono > 60.0:
                gc.collect()
                _last_gc_mono = now
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
        get_session().is_recording = False
        broadcast({"type": "recording", "value": False})
    finally:
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

def _screen_region_label(region: str) -> str:
    labels = {
        "full": "\u4e3b\u663e\u793a\u5668\u5168\u5c4f",
        "left_half": "\u4e3b\u663e\u793a\u5668\u5de6\u534a\u5c4f",
        "right_half": "\u4e3b\u663e\u793a\u5668\u53f3\u534a\u5c4f",
        "top_half": "\u4e3b\u663e\u793a\u5668\u4e0a\u534a\u5c4f",
        "bottom_half": "\u4e3b\u663e\u793a\u5668\u4e0b\u534a\u5c4f",
    }
    return labels.get(region, "\u4e3b\u663e\u793a\u5668\u5de6\u534a\u5c4f")


def prompt_server_screen_code(language: str, region: str) -> str:
    where = _screen_region_label(region)
    return (
        f"\u4e0b\u56fe\u6765\u81ea\u8fd0\u884c\u672c\u540e\u7aef\u7684\u7535\u8111\u300c{where}\u300d\u7684\u5b9e\u65f6\u753b\u9762\uff0c\u53ef\u80fd\u5305\u542b\u9898\u76ee\u63cf\u8ff0\u3001\u8f93\u5165\u8f93\u51fa\u7ea6\u675f\u6216\u4ee3\u7801\u7247\u6bb5\u3002\n\n"
        f"\u8bf7\u57fa\u4e8e\u56fe\u4e2d\u53ef\u89c1\u4fe1\u606f\u4f5c\u7b54\u3002\u82e5\u662f\u7f16\u7a0b\u9898\uff0c\u4ee3\u7801\u8bf7\u4f18\u5148\u4f7f\u7528 {language}\uff08SQL \u9898\u4f7f\u7528 sql\uff09\u3002\n\n"
        "\u8bf7\u5c3d\u91cf\u6309\u4ee5\u4e0b\u987a\u5e8f\u7ec4\u7ec7\uff1a\u9898\u76ee\u7406\u89e3\u3001\u4e3b\u65b9\u6848\u4ee3\u7801\u3001\u5907\u9009\u65b9\u6848\u4ee3\u7801\uff081-2 \u4e2a\uff09\u3001\u65b9\u6848\u5bf9\u6bd4\u3001\u601d\u8def\u4e0e\u590d\u6742\u5ea6\u3001\u6d4b\u8bd5\u7528\u4f8b\u8bbe\u8ba1\u3002\n"
        "\u5982\u679c\u5173\u952e\u4fe1\u606f\u770b\u4e0d\u6e05\uff0c\u8bf7\u660e\u786e\u8bf4\u660e\u7f3a\u5931\u9879\uff0c\u4e0d\u8981\u7f16\u9020\uff1b\u53ef\u5728\u5408\u7406\u5047\u8bbe\u4e0b\u7ed9\u51fa\u6700\u5c0f\u53ef\u6267\u884c\u65b9\u6848\u3002"
    )


def _process_question_parallel(
    task: TaskPayload,
    seq: int,
    model_idx: int,
    sess_v: int,
):
    question_text, image, manual_input, source, meta = task
    cfg = get_config()
    model_cfg = cfg.models[model_idx]
    my_gen = _capture_generation()
    my_asr_turn = int(meta.get("asr_turn_id", 0)) if _is_asr_task(task) else 0

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

    written_exam = bool(getattr(cfg, "written_exam_mode", False))
    written_exam_think = bool(getattr(cfg, "written_exam_think", False))
    prompt_mode: PromptMode = _prompt_mode_for_task(source, manual_input, written_exam=written_exam)
    system_prompt = build_system_prompt(
        manual_input=manual_input,
        mode=prompt_mode,
        screen_region=getattr(cfg, "screen_capture_region", "left_half"),
        high_churn_short_answer=bool(meta.get("high_churn_short_answer", False)),
    )

    if image:
        user_for_llm: Any = [
            {"type": "text", "text": question_text},
            {"type": "image_url", "image_url": {"url": image}},
        ]
    else:
        user_for_llm = question_text

    with conversation_lock:
        session_ref = get_session()
        base_messages = list(session_ref.get_conversation_messages_for_llm())
        last_qa = session_ref.get_last_qa()

    is_followup = False
    if (
        not image
        and last_qa
        and source in ("asr", "manual_text")
        and classify_followup(question_text, last_qa.question, last_qa.answer)
    ):
        is_followup = True
        prev_answer_summary = last_qa.answer[:500]
        user_for_llm = (
            f"[\u8ffd\u95ee\u4e0a\u4e0b\u6587] \u4e0a\u4e00\u4e2a\u95ee\u9898\uff1a{last_qa.question}\n"
            f"\u4f60\u4e0a\u6b21\u56de\u7b54\u7684\u8981\u70b9\uff1a{prev_answer_summary}\n\n"
            f"\u73b0\u5728\u9762\u8bd5\u5b98\u8ffd\u95ee\uff1a{question_text}"
        )

    messages_for_llm = base_messages + [{"role": "user", "content": user_for_llm}]

    display_question = question_text + (" [\U0001f4f7 \u9644\u56fe]" if image else "")
    qa_id = f"qa-{seq}-{int(time.time() * 1000)}"
    _ilog.info(
        "ANSWER_START id=%s model=%s source=%s followup=%s q=%r",
        qa_id, model_cfg.name, source, is_followup, question_text[:120],
    )
    broadcast(
        {
            "type": "answer_start",
            "id": qa_id,
            "question": display_question,
            "source": source,
            "model_name": model_cfg.name,
            "model_index": model_idx,
        }
    )

    full_answer = ""
    full_think = ""
    _exam_think_notified = False
    gen_start = time.monotonic()
    first_token_mono: Optional[float] = None
    try:
        think_override = written_exam_think if prompt_mode == PROMPT_MODE_WRITTEN_EXAM else None
        for chunk_type, chunk_text in chat_stream_single_model(
            model_cfg,
            messages_for_llm,
            system_prompt=system_prompt,
            abort_check=aborted,
            override_think_mode=think_override,
        ):
            if aborted():
                break
            if first_token_mono is None:
                first_token_mono = time.monotonic()
            if chunk_type == "think":
                full_think += chunk_text
                if prompt_mode == PROMPT_MODE_WRITTEN_EXAM:
                    if not _exam_think_notified:
                        _exam_think_notified = True
                        broadcast({"type": "answer_think_chunk", "id": qa_id, "chunk": "思考中..."})
                else:
                    broadcast({"type": "answer_think_chunk", "id": qa_id, "chunk": chunk_text})
            else:
                full_answer += chunk_text
                broadcast({"type": "answer_chunk", "id": qa_id, "chunk": chunk_text})
    except Exception as e:
        _elog.error("LLM stream error id=%s: %s", qa_id, e, exc_info=True)
        err = f"\n\n[\u751f\u6210\u7b54\u6848\u51fa\u9519: {e}]"
        full_answer += err
        broadcast({"type": "answer_chunk", "id": qa_id, "chunk": err})

    gen_elapsed = (time.monotonic() - gen_start) * 1000
    first_token_ms = (first_token_mono - gen_start) * 1000 if first_token_mono else gen_elapsed

    if aborted():
        _ilog.info("ANSWER_CANCEL id=%s after=%.0fms", qa_id, gen_elapsed)
        broadcast({"type": "answer_cancelled", "id": qa_id})
        _mark_seq_skipped(seq)
        return

    full_answer = postprocess_answer_for_mode(full_answer, prompt_mode)

    def _commit():
        global _task_session_version
        if sess_v != _task_session_version:
            return
        session = get_session()
        try:
            if image:
                content: list = [{"type": "text", "text": question_text}]
                content.append({"type": "image_url", "image_url": {"url": image}})
                session.add_user_message(content)
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
            _ilog.info(
                "ANSWER_DONE id=%s model=%s first_token=%.0fms total=%.0fms "
                "answer_len=%d think_len=%d tokens_prompt=%d tokens_completion=%d",
                qa_id, model_cfg.name, first_token_ms, gen_elapsed,
                len(full_answer), len(full_think),
                stats["prompt"], stats["completion"],
            )
            broadcast(
                {
                    "type": "answer_done",
                    "id": qa_id,
                    "question": display_question,
                    "answer": full_answer,
                    "think": full_think,
                    "model_name": model_cfg.name,
                }
            )
            broadcast(
                {
                    "type": "token_update",
                    "prompt": stats["prompt"],
                    "completion": stats["completion"],
                    "total": stats["total"],
                    "by_model": stats.get("by_model", {}),
                }
            )
            threading.Thread(
                target=_save_knowledge_record,
                args=(question_text, full_answer),
                daemon=True,
            ).start()
        except Exception:
            broadcast({"type": "answer_cancelled", "id": qa_id})

    _flush_commit(seq, _commit)


def _save_knowledge_record(question: str, answer: str):
    try:
        from services.storage.knowledge import save_record
        save_record("assist", question, answer)
    except Exception:
        pass
