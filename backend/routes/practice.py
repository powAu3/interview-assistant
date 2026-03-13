import time
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import get_config
from services.audio import AudioCapture, VADBuffer, audio_capture
from services.stt import get_stt_engine
from services.practice import (
    get_practice, reset_practice,
    generate_questions, evaluate_answer_stream, generate_report_stream,
    parse_score_from_feedback, PracticeEvaluation,
)
from routes.ws import broadcast

router = APIRouter()

_practice_thread: Optional[threading.Thread] = None
_practice_stop = threading.Event()
_practice_answer_buf: list[str] = []


@router.get("/practice/status")
async def api_practice_status():
    return get_practice().to_dict()


@router.post("/practice/generate")
async def api_practice_generate(body: dict = {}):
    count = body.get("count", 6)
    practice = reset_practice()
    practice.status = "generating"
    broadcast({"type": "practice_status", "status": "generating"})

    def _gen():
        try:
            qs = generate_questions(count)
            practice.questions = qs
            practice.current_index = 0
            practice.status = "questioning"
            broadcast({
                "type": "practice_questions",
                "questions": [{"id": q.id, "question": q.question, "category": q.category} for q in qs],
            })
            broadcast({"type": "practice_status", "status": "questioning"})
        except Exception as e:
            practice.status = "idle"
            broadcast({"type": "error", "message": f"生成题目失败: {e}"})
            broadcast({"type": "practice_status", "status": "idle"})

    threading.Thread(target=_gen, daemon=True).start()
    return {"ok": True}


class PracticeSubmitBody(BaseModel):
    answer: str


@router.post("/practice/submit")
async def api_practice_submit(body: PracticeSubmitBody):
    practice = get_practice()
    q = practice.current_question()
    if not q:
        raise HTTPException(400, "没有当前题目")
    if not body.answer.strip():
        raise HTTPException(400, "回答不能为空")
    practice.status = "evaluating"
    broadcast({"type": "practice_status", "status": "evaluating"})

    def _eval():
        full = ""
        broadcast({"type": "practice_eval_start", "question_id": q.id})
        for chunk in evaluate_answer_stream(q.question, body.answer.strip()):
            full += chunk
            broadcast({"type": "practice_eval_chunk", "chunk": chunk})
        score = parse_score_from_feedback(full)
        ev = PracticeEvaluation(
            question_id=q.id, question=q.question,
            answer=body.answer.strip(), score=score, feedback=full,
        )
        practice.evaluations.append(ev)
        practice.status = "questioning"
        broadcast({"type": "practice_eval_done", "question_id": q.id, "score": score, "feedback": full})
        broadcast({"type": "practice_status", "status": "questioning"})

    threading.Thread(target=_eval, daemon=True).start()
    return {"ok": True}


@router.post("/practice/next")
async def api_practice_next():
    practice = get_practice()
    if practice.current_index < len(practice.questions) - 1:
        practice.current_index += 1
        broadcast({"type": "practice_next", "index": practice.current_index})
        return {"ok": True, "index": practice.current_index}
    raise HTTPException(400, "已经是最后一题")


@router.post("/practice/finish")
async def api_practice_finish():
    practice = get_practice()
    if not practice.evaluations:
        raise HTTPException(400, "还没有完成任何题目")
    practice.status = "report"
    broadcast({"type": "practice_status", "status": "report"})

    def _report():
        full = ""
        broadcast({"type": "practice_report_start"})
        for chunk in generate_report_stream(practice.evaluations):
            full += chunk
            broadcast({"type": "practice_report_chunk", "chunk": chunk})
        practice.report = full
        practice.status = "finished"
        broadcast({"type": "practice_report_done", "report": full})
        broadcast({"type": "practice_status", "status": "finished"})

    threading.Thread(target=_report, daemon=True).start()
    return {"ok": True}


@router.post("/practice/reset")
async def api_practice_reset():
    _stop_practice_recording()
    reset_practice()
    broadcast({"type": "practice_status", "status": "idle"})
    return {"ok": True}


@router.post("/practice/record")
async def api_practice_record(body: dict):
    action = body.get("action", "start")
    if action == "start":
        device_id = body.get("device_id")
        if device_id is None:
            raise HTTPException(400, "请选择麦克风设备")
        _start_practice_recording(int(device_id))
        return {"ok": True}
    else:
        _stop_practice_recording()
        return {"ok": True, "text": "\n".join(_practice_answer_buf)}


def _start_practice_recording(device_id: int):
    global _practice_thread
    _stop_practice_recording()
    _practice_stop.clear()
    _practice_answer_buf.clear()

    audio_capture.start(device_id)
    broadcast({"type": "practice_recording", "value": True})

    _practice_thread = threading.Thread(target=_practice_record_worker, daemon=True)
    _practice_thread.start()


def _stop_practice_recording():
    global _practice_thread
    _practice_stop.set()
    audio_capture.stop()
    broadcast({"type": "practice_recording", "value": False})
    if _practice_thread and _practice_thread.is_alive():
        _practice_thread.join(timeout=3)
    _practice_thread = None


def _practice_record_worker():
    cfg = get_config()
    engine = get_stt_engine(cfg.whisper_model, cfg.whisper_language)
    if not engine.is_loaded:
        try:
            engine.load_model()
        except Exception as e:
            broadcast({"type": "error", "message": f"STT 加载失败: {e}"})
            return

    vad = VADBuffer(
        sample_rate=AudioCapture.SAMPLE_RATE,
        silence_threshold=cfg.silence_threshold,
        silence_duration=cfg.silence_duration,
    )

    while not _practice_stop.is_set():
        chunk = audio_capture.get_audio_chunk(timeout=0.1)
        if chunk is None:
            time.sleep(0.05)
            continue
        energy = AudioCapture.compute_energy(chunk)
        broadcast({"type": "audio_level", "value": round(energy, 4)})

        speech_audio = vad.feed(chunk)
        if speech_audio is not None and len(speech_audio) > AudioCapture.SAMPLE_RATE * 0.3:
            try:
                text = engine.transcribe(speech_audio, AudioCapture.SAMPLE_RATE)
                if text.strip():
                    _practice_answer_buf.append(text.strip())
                    broadcast({"type": "practice_transcription", "text": text.strip()})
            except Exception:
                pass

    remaining = vad.flush()
    if remaining is not None and len(remaining) > AudioCapture.SAMPLE_RATE * 0.3:
        try:
            text = engine.transcribe(remaining, AudioCapture.SAMPLE_RATE)
            if text.strip():
                _practice_answer_buf.append(text.strip())
                broadcast({"type": "practice_transcription", "text": text.strip()})
        except Exception:
            pass
