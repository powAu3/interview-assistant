import time
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import get_config
from core.session import get_session, reset_session, conversation_lock
from services.audio import AudioCapture, VADBuffer, audio_capture
from services.stt import (
    build_asr_question_group_text,
    classify_asr_question_candidate,
    get_stt_engine,
    is_viable_asr_question_group,
    join_transcription_fragments,
    transcription_for_publish,
)
from services.llm import (
    PROMPT_MODE_ASR_REALTIME,
    PROMPT_MODE_MANUAL_TEXT,
    PROMPT_MODE_SERVER_SCREEN,
    PromptMode,
    build_system_prompt,
    chat_stream_single_model,
    get_token_stats,
    postprocess_answer_for_mode,
)
from api.common import get_model_health
from api.realtime.ws import broadcast

router = APIRouter()

_interview_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_pause_event = threading.Event()

# 取消：代数递增，所有在途流式任务中止
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

# 按提问顺序提交到 session
_commit_buffer: dict[int, Callable[[], None]] = {}
_skipped_commit_seqs: set[int] = set()
_next_commit_seq = 0
_next_submit_seq = 0
_commit_lock = threading.Lock()

# 实时辅助：多段 ASR 按时间窗合并后再写入转写 / 触发自动答题（减轻 VAD 碎句）
_asr_merge_parts: list[str] = []
_asr_merge_mono_first: Optional[float] = None
_asr_merge_mono_last: Optional[float] = None
_pending_asr_group: Optional[PendingASRGroup] = None
_recent_asr_turn_monos: list[float] = []


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


def _cancel_answer_work(reset_session_data: bool = False):
    _bump_generation()
    _reset_answer_state()
    if reset_session_data:
        reset_session()


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
    _submit_answer_task(
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


def _try_flush_asr_question_group(cfg, session, now_mono: float, force: bool = False) -> None:
    group = _pending_asr_group
    if group is None:
        return
    confirm = _asr_confirm_window_sec(cfg)
    max_wait = _asr_group_max_wait_sec(cfg)
    since_last = now_mono - group.last_mono
    age = now_mono - group.first_mono
    if force or age >= max_wait or (group.has_promote and since_last >= confirm):
        _flush_asr_question_group_now(cfg, session)


def _handle_auto_detect_asr_text(cfg, session, pub: str, source: str, now_mono: float) -> None:
    global _pending_asr_group
    _try_flush_asr_question_group(cfg, session, now_mono, False)
    kind, cleaned = classify_asr_question_candidate(
        pub,
        getattr(cfg, "transcription_min_sig_chars", 2),
    )
    if kind == "ignore" or not cleaned:
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


class ManualQuestion(BaseModel):
    text: str
    image: Optional[str] = None


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


def _prompt_mode_for_task(source: str, manual_input: bool) -> PromptMode:
    if source.startswith("server_screen_"):
        return PROMPT_MODE_SERVER_SCREEN
    if manual_input:
        return PROMPT_MODE_MANUAL_TEXT
    return PROMPT_MODE_ASR_REALTIME


def _priority_model_index(cfg) -> int:
    """与 get_active_model() 指向同一条模型配置，避免仅依赖 active_model 整数与列表不同步。"""
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
    """
    实时辅助选路顺序：先顶栏「优先模型」(active_model)，再按配置里当前列表顺序尝试其余模型。
    与多模型并行配合：优先模型空闲时尽量先用它；多路时其余路按列表顺序占槽。
    """
    n = len(cfg.models)
    if n == 0:
        return []
    p = _priority_model_index(cfg)
    return [p] + [i for i in range(n) if i != p]


def _pick_model_index(
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


def _submit_answer_task(task: TaskPayload):
    global _next_submit_seq
    if _pick_model_index(task, set()) is None:
        broadcast(
            {
                "type": "error",
                "message": "没有可用的答题模型：请至少启用一个已配置 API Key 的模型（识图题需识图模型）。",
            }
        )
        return
    with _dispatch_lock:
        seq = _next_submit_seq
        _next_submit_seq += 1
        tv = _task_session_version
        _pending.append((task, seq, tv))
    _try_dispatch()


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
                mi = _pick_model_index(task, busy_models, avoid_models=avoid_models)
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


@router.post("/start")
async def api_start(body: dict):
    device_id = body.get("device_id")
    if device_id is None:
        raise HTTPException(400, "请选择音频设备")
    try:
        _start_nonblocking(int(device_id))
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/stop")
async def api_stop():
    stop_interview_loop()
    return {"ok": True}


@router.post("/pause")
async def api_pause():
    session = get_session()
    if not session.is_recording:
        raise HTTPException(400, "面试未在进行中")
    if _pause_event.is_set():
        raise HTTPException(400, "已经处于暂停状态")
    _pause_event.set()
    audio_capture.stop()
    session.is_paused = True
    broadcast({"type": "paused", "value": True})
    return {"ok": True}


@router.post("/unpause")
async def api_resume_interview(body: Optional[dict] = None):
    session = get_session()
    if not session.is_recording:
        raise HTTPException(400, "面试未在进行中")
    if not _pause_event.is_set():
        raise HTTPException(400, "面试未处于暂停状态")
    device_id = (body or {}).get("device_id")
    if device_id is not None:
        try:
            session.last_device_id = int(device_id)
        except (TypeError, ValueError):
            raise HTTPException(400, "device_id 必须是整数")
        for d in AudioCapture.list_devices():
            if d["id"] == session.last_device_id:
                session.capture_is_loopback = d["is_loopback"]
                break
    audio_capture.start(session.last_device_id)
    _pause_event.clear()
    session.is_paused = False
    broadcast({"type": "paused", "value": False})
    return {"ok": True}


@router.post("/clear")
async def api_clear():
    _cancel_answer_work(reset_session_data=True)
    broadcast({"type": "session_cleared"})
    return {"ok": True}


def _reset_pipeline_after_abort():
    """取消后重置序号，避免未完成序号阻塞后续提交。"""
    _cancel_answer_work(reset_session_data=False)


@router.post("/ask/cancel")
async def api_ask_cancel():
    _bump_generation()
    _reset_pipeline_after_abort()
    return {"ok": True}


@router.post("/ask")
async def api_ask(body: ManualQuestion):
    if not body.text.strip() and not body.image:
        raise HTTPException(400, "问题不能为空")
    text = body.text.strip() or "请分析这张图片中的题目，并给出面试回答"
    src = "manual_image" if body.image else "manual_text"
    _submit_answer_task((text, body.image, True, src, {"origin": "manual"}))
    return {"ok": True}


def _screen_region_label(region: str) -> str:
    labels = {
        "full": "主显示器全屏",
        "left_half": "主显示器左半屏",
        "right_half": "主显示器右半屏",
        "top_half": "主显示器上半屏",
        "bottom_half": "主显示器下半屏",
    }
    return labels.get(region, "主显示器左半屏")


def _prompt_server_screen_code(language: str, region: str) -> str:
    where = _screen_region_label(region)
    return (
        f"下图来自运行本后端的电脑「{where}」的实时画面，可能包含题目描述、输入输出约束或代码片段。\n\n"
        f"请基于图中可见信息作答。若是编程题，代码请优先使用 {language}（SQL 题使用 sql）。\n\n"
        "请尽量按以下顺序组织：题目理解、主方案代码、备选方案代码（1-2 个）、方案对比、思路与复杂度、测试用例设计。\n"
        "如果关键信息看不清，请明确说明缺失项，不要编造；可在合理假设下给出最小可执行方案。"
    )


@router.post("/ask-from-server-screen")
async def api_ask_from_server_screen():
    """手机端等远程客户端触发：截取服务端本机主屏指定区域，送 VL 作答（手机仅 HTTP，不调用系统截图）。"""
    from services.llm import has_vision_model
    from services.capture import ScreenCaptureError, capture_primary_left_half_data_url

    if not has_vision_model():
        raise HTTPException(400, "请至少配置一个支持识图且已填写 API Key 的模型")
    try:
        data_url = capture_primary_left_half_data_url()
    except ScreenCaptureError as e:
        raise HTTPException(503, str(e))
    cfg = get_config()
    region = getattr(cfg, "screen_capture_region", "left_half") or "left_half"
    text = _prompt_server_screen_code(cfg.language, region)
    if _pick_model_index((text, data_url, True, "server_screen_left", {"origin": "server_screen"}), set()) is None:
        raise HTTPException(400, "没有可用的识图模型，请检查启用状态与 API Key")
    _cancel_answer_work(reset_session_data=False)
    _submit_answer_task((text, data_url, True, "server_screen_left", {"origin": "server_screen"}))
    return {"ok": True}


@router.get("/session")
async def api_session():
    session = get_session()
    return {
        "is_recording": session.is_recording,
        "is_paused": session.is_paused,
        "transcriptions": session.transcription_history[-50:],
        "qa_pairs": [
            {
                "id": qa.id,
                "question": qa.question,
                "answer": qa.answer,
                "timestamp": qa.timestamp,
                "source": getattr(qa, "source", "") or "",
                "model_name": getattr(qa, "model_name", "") or "",
            }
            for qa in session.qa_pairs
        ],
    }


def _start_nonblocking(device_id: int):
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
    broadcast({"type": "recording", "value": True})
    broadcast({"type": "paused", "value": False})

    _interview_thread = threading.Thread(target=_interview_worker, daemon=True)
    _interview_thread.start()


def stop_interview_loop():
    global _interview_thread
    _stop_event.set()
    _pause_event.clear()
    _cancel_answer_work(reset_session_data=False)
    audio_capture.stop()
    session = get_session()
    session.is_recording = False
    session.is_paused = False
    broadcast({"type": "recording", "value": False})
    broadcast({"type": "paused", "value": False})
    if _interview_thread and _interview_thread.is_alive():
        _interview_thread.join(timeout=3)
    _interview_thread = None


def _interview_worker():
    cfg = get_config()
    engine = get_stt_engine()

    if not engine.is_loaded:
        broadcast({"type": "stt_status", "loaded": False, "loading": True})
        try:
            engine.load_model()
        except Exception as e:
            broadcast({"type": "error", "message": f"Whisper 模型加载失败: {e}"})
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
                    text = engine.transcribe(
                        speech_audio,
                        AudioCapture.SAMPLE_RATE,
                        position=cfg.position,
                        language=cfg.language,
                    )
                    min_sig = getattr(
                        get_config(), "transcription_min_sig_chars", 2
                    )
                    pub = transcription_for_publish(text, min_sig)
                    if pub:
                        _append_transcription_fragment(
                            get_config(), session, pub, time.monotonic(), False
                        )
                except Exception as e:
                    broadcast({"type": "error", "message": f"转写错误: {e}"})
                finally:
                    broadcast({"type": "transcribing", "value": False})

        remaining = vad.flush()
        if remaining is not None and len(remaining) > AudioCapture.SAMPLE_RATE * 0.3:
            try:
                text = engine.transcribe(
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
        broadcast({"type": "error", "message": f"面试循环异常: {e}"})
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

    prompt_mode: PromptMode = _prompt_mode_for_task(source, manual_input)
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
        base_messages = list(get_session().get_conversation_messages_for_llm())
    messages_for_llm = base_messages + [{"role": "user", "content": user_for_llm}]

    display_question = question_text + (" [📷 附图]" if image else "")
    qa_id = f"qa-{seq}-{int(time.time() * 1000)}"
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
    try:
        for chunk_type, chunk_text in chat_stream_single_model(
            model_cfg,
            messages_for_llm,
            system_prompt=system_prompt,
            abort_check=aborted,
        ):
            if aborted():
                break
            if chunk_type == "think":
                full_think += chunk_text
                broadcast({"type": "answer_think_chunk", "id": qa_id, "chunk": chunk_text})
            else:
                full_answer += chunk_text
                broadcast({"type": "answer_chunk", "id": qa_id, "chunk": chunk_text})
    except Exception as e:
        err = f"\n\n[生成答案出错: {e}]"
        full_answer += err
        broadcast({"type": "answer_chunk", "id": qa_id, "chunk": err})

    if aborted():
        broadcast({"type": "answer_cancelled", "id": qa_id})
        _mark_seq_skipped(seq)
        return

    # Post-generation quality gate: remove leaked thinking artifacts / unstable markdown.
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
