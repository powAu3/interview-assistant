import time
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import get_config
from core.session import get_session, reset_session
from services.audio import AudioCapture, VADBuffer, audio_capture
from services.stt import get_stt_engine
from services.llm import build_system_prompt, chat_stream, _token_stats
from routes.ws import broadcast

router = APIRouter()

_interview_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_pause_event = threading.Event()  # set = paused, clear = running


class ManualQuestion(BaseModel):
    text: str
    image: Optional[str] = None


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
    # 允许切换设备：传入 device_id 则使用新设备，否则沿用上次的
    device_id = (body or {}).get("device_id")
    if device_id is not None:
        try:
            session.last_device_id = int(device_id)
        except (TypeError, ValueError):
            raise HTTPException(400, "device_id 必须是整数")
    audio_capture.start(session.last_device_id)
    _pause_event.clear()
    session.is_paused = False
    broadcast({"type": "paused", "value": False})
    return {"ok": True}


@router.post("/clear")
async def api_clear():
    reset_session()
    return {"ok": True}


@router.post("/ask")
async def api_ask(body: ManualQuestion):
    if not body.text.strip() and not body.image:
        raise HTTPException(400, "问题不能为空")
    text = body.text.strip() or "请分析这张图片中的题目，并给出面试回答"
    # 手动输入框提问通常是应急场景：允许算法/SQL题更快进入“思路+代码”模式
    threading.Thread(target=_process_question, args=(text, body.image, True), daemon=True).start()
    return {"ok": True}


@router.get("/session")
async def api_session():
    session = get_session()
    return {
        "is_recording": session.is_recording,
        "is_paused": session.is_paused,
        "transcriptions": session.transcription_history[-50:],
        "qa_pairs": [
            {"id": qa.id, "question": qa.question, "answer": qa.answer, "timestamp": qa.timestamp}
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

    audio_capture.start(device_id)
    broadcast({"type": "recording", "value": True})
    broadcast({"type": "paused", "value": False})

    _interview_thread = threading.Thread(target=_interview_worker, daemon=True)
    _interview_thread.start()


def stop_interview_loop():
    global _interview_thread
    _stop_event.set()
    _pause_event.clear()
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
    engine = get_stt_engine(cfg.whisper_model, cfg.whisper_language)

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

    while not _stop_event.is_set():
        # 暂停时等待恢复
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
                text = engine.transcribe(speech_audio, AudioCapture.SAMPLE_RATE,
                                        position=cfg.position, language=cfg.language)
                if text.strip():
                    session.add_transcription(text)
                    broadcast({"type": "transcription", "text": text})
                    if cfg.auto_detect:
                        _process_question(text)
            except Exception as e:
                broadcast({"type": "error", "message": f"转写错误: {e}"})
            finally:
                broadcast({"type": "transcribing", "value": False})

    remaining = vad.flush()
    if remaining is not None and len(remaining) > AudioCapture.SAMPLE_RATE * 0.3:
        try:
            text = engine.transcribe(remaining, AudioCapture.SAMPLE_RATE,
                                     position=cfg.position, language=cfg.language)
            if text.strip():
                session.add_transcription(text)
                broadcast({"type": "transcription", "text": text})
        except Exception:
            pass


def _process_question(
    question_text: str,
    image: Optional[str] = None,
    manual_input: bool = False,
):
    session = get_session()
    system_prompt = build_system_prompt(manual_input=manual_input)

    if image:
        content: list = [{"type": "text", "text": question_text}]
        content.append({"type": "image_url", "image_url": {"url": image}})
        session.add_user_message(content)
    else:
        session.add_user_message(question_text)
    messages = session.get_conversation_messages()

    display_question = question_text + (" [📷 附图]" if image else "")
    qa_id = f"qa-{len(session.qa_pairs)}-{int(time.time())}"
    broadcast({"type": "answer_start", "id": qa_id, "question": display_question})

    full_answer = ""
    full_think = ""
    try:
        for chunk_type, chunk_text in chat_stream(messages, system_prompt=system_prompt):
            if chunk_type == "think":
                full_think += chunk_text
                broadcast({"type": "answer_think_chunk", "id": qa_id, "chunk": chunk_text})
            else:
                full_answer += chunk_text
                broadcast({"type": "answer_chunk", "id": qa_id, "chunk": chunk_text})
    except Exception as e:
        error_msg = f"\n\n[生成答案出错: {e}]"
        full_answer += error_msg
        broadcast({"type": "answer_chunk", "id": qa_id, "chunk": error_msg})

    session.add_assistant_message(full_answer)
    session.add_qa(display_question, full_answer)
    broadcast({"type": "answer_done", "id": qa_id, "question": display_question, "answer": full_answer, "think": full_think})
    broadcast({
        "type": "token_update",
        "prompt": _token_stats["prompt"],
        "completion": _token_stats["completion"],
        "total": _token_stats["total"],
    })

    threading.Thread(
        target=_save_knowledge_record,
        args=(question_text, full_answer),
        daemon=True,
    ).start()


def _save_knowledge_record(question: str, answer: str):
    try:
        from services.knowledge import save_record
        save_record("assist", question, answer)
    except Exception:
        pass
