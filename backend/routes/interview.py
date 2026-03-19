import time
import threading
from typing import Any, Callable, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import get_config
from core.session import get_session, reset_session, conversation_lock
from services.audio import AudioCapture, VADBuffer, audio_capture
from services.stt import get_stt_engine, transcription_for_publish
from services.llm import build_system_prompt, chat_stream_single_model, get_token_stats
from routes.common import get_model_health
from routes.ws import broadcast

router = APIRouter()

_interview_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_pause_event = threading.Event()

# 取消：代数递增，所有在途流式任务中止
_answer_generation = 0
_gen_lock = threading.Lock()

# 待处理任务 (text, image, manual, source), seq, session_version
_pending: list[Tuple[Tuple[str, Optional[str], bool, str], int, int]] = []
_dispatch_lock = threading.Lock()
_in_flight_models: set[int] = set()
_task_session_version = 0

# 按提问顺序提交到 session
_commit_buffer: dict[int, Callable[[], None]] = {}
_next_commit_seq = 0
_next_submit_seq = 0
_commit_lock = threading.Lock()


def _bump_generation():
    global _answer_generation
    with _gen_lock:
        _answer_generation += 1


def _capture_generation() -> int:
    with _gen_lock:
        return _answer_generation


def _reset_answer_state():
    global _pending, _in_flight_models, _commit_buffer, _next_commit_seq, _next_submit_seq, _task_session_version
    with _dispatch_lock:
        _pending.clear()
        _in_flight_models.clear()
    with _commit_lock:
        _commit_buffer.clear()
        _next_commit_seq = 0
        _next_submit_seq = 0
    _task_session_version += 1


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


def _pick_model_index(task: Tuple[str, Optional[str], bool, str], busy: set[int]) -> Optional[int]:
    text, image, manual, source = task
    need_vision = bool(image)
    cfg = get_config()

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

    for i, m in enumerate(cfg.models):
        if not ok_basic(i, m):
            continue
        if get_model_health(i) == "error":
            continue
        return i
    for i, m in enumerate(cfg.models):
        if ok_basic(i, m):
            return i
    return None


def _max_parallel_slots() -> int:
    cfg = get_config()
    n_ok = sum(1 for i, m in enumerate(cfg.models) if _model_eligible(i, m, False))
    cap = max(1, getattr(cfg, "max_parallel_answers", 2))
    return max(1, min(cap, max(n_ok, 1)))


def _submit_answer_task(task: Tuple[str, Optional[str], bool, str]):
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
        with _dispatch_lock:
            if len(_in_flight_models) >= _max_parallel_slots():
                return
            model_idx = None
            task_seq = None
            for idx, (task, seq, tv) in enumerate(_pending):
                mi = _pick_model_index(task, _in_flight_models)
                if mi is not None:
                    _pending.pop(idx)
                    model_idx = mi
                    task_seq = (task, seq, tv)
                    break
            if model_idx is None or task_seq is None:
                return
            _in_flight_models.add(model_idx)
        task, seq, sess_v = task_seq
        threading.Thread(
            target=_run_answer_worker,
            args=(task, seq, model_idx, sess_v),
            daemon=True,
        ).start()


def _run_answer_worker(
    task: Tuple[str, Optional[str], bool, str],
    seq: int,
    model_idx: int,
    sess_v: int,
):
    try:
        _process_question_parallel(task, seq, model_idx, sess_v)
    finally:
        with _dispatch_lock:
            _in_flight_models.discard(model_idx)
        _try_dispatch()


def _flush_commit(seq: int, apply_fn: Callable[[], None]):
    global _next_commit_seq
    with _commit_lock:
        _commit_buffer[seq] = apply_fn
        while _next_commit_seq in _commit_buffer:
            _commit_buffer.pop(_next_commit_seq)()
            _next_commit_seq += 1


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
    _bump_generation()
    with _dispatch_lock:
        _pending.clear()
    reset_session()
    _reset_answer_state()
    return {"ok": True}


def _reset_pipeline_after_abort():
    """取消后重置序号，避免未完成序号阻塞后续提交。"""
    global _next_submit_seq, _next_commit_seq
    with _commit_lock:
        _commit_buffer.clear()
        _next_commit_seq = 0
    with _dispatch_lock:
        _next_submit_seq = 0


@router.post("/ask/cancel")
async def api_ask_cancel():
    _bump_generation()
    with _dispatch_lock:
        _pending.clear()
    _reset_pipeline_after_abort()
    return {"ok": True}


@router.post("/ask")
async def api_ask(body: ManualQuestion):
    if not body.text.strip() and not body.image:
        raise HTTPException(400, "问题不能为空")
    text = body.text.strip() or "请分析这张图片中的题目，并给出面试回答"
    src = "manual_image" if body.image else "manual_text"
    _submit_answer_task((text, body.image, True, src))
    return {"ok": True}


def _prompt_server_left_screen_code(language: str) -> str:
    return (
        f"下图来自运行本后端的电脑「主显示器左半屏」的实时画面，可能包含编程题、OJ 题干、或编辑器里的题目/代码片段。\n\n"
        f"请根据图中可读信息作答。**代码实现请严格使用语言：{language}**。\n\n"
        "请按下面三部分组织回答（代码必须放在 Markdown 代码块中并标明语言）：\n\n"
        "【1 代码】\n"
        "给出完整、可直接运行或通过常见单测框架执行的解答。\n\n"
        "【2 思路】\n"
        "简述核心算法或步骤、关键数据结构；若有，给出时间与空间复杂度。\n\n"
        "【3 测试用例设计】\n"
        "说明如何设计用例覆盖正常路径、边界与异常；可列举若干输入与期望输出或行为。\n\n"
        "若图中无法辨认编程类题目，请简要说明，并给出在当前画面下你能提供的最大帮助。"
    )


@router.post("/ask-from-server-screen")
async def api_ask_from_server_screen():
    """手机端等远程客户端触发：截取服务端本机主屏左半幅，送 VL 按配置语言写代码（手机仅 HTTP，不调用系统截图）。"""
    from services.llm import has_vision_model
    from services.screen_capture import ScreenCaptureError, capture_primary_left_half_data_url

    if not has_vision_model():
        raise HTTPException(400, "请至少配置一个支持识图且已填写 API Key 的模型")
    try:
        data_url = capture_primary_left_half_data_url()
    except ScreenCaptureError as e:
        raise HTTPException(503, str(e))
    cfg = get_config()
    text = _prompt_server_left_screen_code(cfg.language)
    if _pick_model_index((text, data_url, True, "server_screen_left"), set()) is None:
        raise HTTPException(400, "没有可用的识图模型，请检查启用状态与 API Key")
    _submit_answer_task((text, data_url, True, "server_screen_left"))
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

    session = get_session()
    session.is_recording = True
    session.is_paused = False
    session.last_device_id = device_id
    session.capture_is_loopback = False
    for d in AudioCapture.list_devices():
        if d["id"] == device_id:
            session.capture_is_loopback = d["is_loopback"]
            break

    audio_capture.start(device_id)
    broadcast({"type": "recording", "value": True})
    broadcast({"type": "paused", "value": False})

    _interview_thread = threading.Thread(target=_interview_worker, daemon=True)
    _interview_thread.start()


def stop_interview_loop():
    global _interview_thread
    _stop_event.set()
    _pause_event.clear()
    _bump_generation()
    with _dispatch_lock:
        _pending.clear()
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

    try:
        while not _stop_event.is_set():
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
                        session.add_transcription(pub)
                        broadcast({"type": "transcription", "text": pub})
                        if cfg.auto_detect:
                            src = (
                                "conversation_loopback"
                                if session.capture_is_loopback
                                else "conversation_mic"
                            )
                            _submit_answer_task((pub, None, False, src))
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
                    session.add_transcription(pub)
                    broadcast({"type": "transcription", "text": pub})
            except Exception:
                pass
    except Exception as e:
        broadcast({"type": "error", "message": f"面试循环异常: {e}"})
        get_session().is_recording = False
        broadcast({"type": "recording", "value": False})


def _process_question_parallel(
    task: Tuple[str, Optional[str], bool, str],
    seq: int,
    model_idx: int,
    sess_v: int,
):
    question_text, image, manual_input, source = task
    cfg = get_config()
    model_cfg = cfg.models[model_idx]
    my_gen = _capture_generation()

    def aborted() -> bool:
        return my_gen != _answer_generation

    system_prompt = build_system_prompt(manual_input=manual_input)

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
        return

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
        from services.knowledge import save_record

        save_record("assist", question, answer)
    except Exception:
        pass
