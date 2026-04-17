import time
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from core.background import BoundedTaskWorker
from core.config import get_config
from core.logger import get_logger
from services.audio import AudioCapture, AudioBusyError, VADBuffer, audio_capture
from services.stt import get_stt_engine, transcription_for_publish
from services.practice import (
    get_practice, reset_practice,
    generate_questions, evaluate_answer_stream, generate_report_stream,
    parse_score_from_feedback, PracticeEvaluation,
)
from services.llm import get_token_stats
from api.realtime.ws import broadcast

router = APIRouter()
_log = get_logger("practice")

_practice_thread: Optional[threading.Thread] = None
_practice_stop = threading.Event()
_practice_answer_buf: list[str] = []


def _save_practice_record(question: str, answer: str, score: Optional[int]):
    try:
        from services.storage.knowledge import save_record
        save_record("practice", question, answer, score)
    except Exception:
        _log.exception("save practice record failed")


_practice_record_worker = BoundedTaskWorker(
    "practice.record_worker",
    _save_practice_record,
    maxsize=64,
)


def _submit_practice_record(question: str, answer: str, score: Optional[int]) -> None:
    if not _practice_record_worker.submit(question, answer, score):
        _log.warning(
            "practice record dropped (queue full): q=%r len_a=%d", question[:60], len(answer)
        )


@router.get("/practice/status")
async def api_practice_status():
    return get_practice().to_dict()


@router.post("/practice/generate")
async def api_practice_generate(body: Optional[dict] = None):
    count = (body or {}).get("count", 6)
    practice = reset_practice()
    practice.status = "generating"
    broadcast({"type": "practice_status", "status": "generating", "scope": "practice"})

    def _gen():
        try:
            qs = generate_questions(count)
            practice.questions = qs
            practice.current_index = 0
            practice.status = "questioning"
            broadcast({
                "type": "practice_questions",
                "scope": "practice",
                "questions": [{"id": q.id, "question": q.question, "category": q.category} for q in qs],
            })
            broadcast({"type": "practice_status", "status": "questioning", "scope": "practice"})
        except Exception as e:
            practice.status = "idle"
            broadcast({"type": "error", "message": f"生成题目失败: {e}"})
            broadcast({"type": "practice_status", "status": "idle", "scope": "practice"})

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
    broadcast({"type": "practice_status", "status": "evaluating", "scope": "practice"})
    answer_text = body.answer.strip()

    def _eval():
        try:
            full = ""
            broadcast({"type": "practice_eval_start", "question_id": q.id, "scope": "practice"})
            for chunk in evaluate_answer_stream(q.question, answer_text):
                full += chunk
                broadcast({"type": "practice_eval_chunk", "chunk": chunk, "scope": "practice"})
            score = parse_score_from_feedback(full)
            ev = PracticeEvaluation(
                question_id=q.id, question=q.question,
                answer=answer_text, score=score, feedback=full,
            )
            practice.evaluations.append(ev)
            practice.status = "questioning"
            broadcast({
                "type": "practice_eval_done",
                "question_id": q.id,
                "question": q.question,
                "answer": answer_text,
                "score": score,
                "feedback": full,
                "scope": "practice",
            })
            broadcast({"type": "practice_status", "status": "questioning", "scope": "practice"})
            stats = get_token_stats()
            broadcast({
                "type": "token_update",
                "prompt": stats["prompt"],
                "completion": stats["completion"],
                "total": stats["total"],
                "by_model": stats.get("by_model", {}),
            })
            _submit_practice_record(q.question, answer_text, score)
        except Exception as e:
            practice.status = "questioning"
            broadcast({"type": "error", "message": f"评价失败: {e}"})
            broadcast({"type": "practice_status", "status": "questioning", "scope": "practice"})

    threading.Thread(target=_eval, daemon=True).start()
    return {"ok": True}


@router.post("/practice/next")
async def api_practice_next():
    practice = get_practice()
    if practice.current_index < len(practice.questions) - 1:
        practice.current_index += 1
        broadcast({"type": "practice_next", "index": practice.current_index, "scope": "practice"})
        return {"ok": True, "index": practice.current_index}
    raise HTTPException(400, "已经是最后一题")


@router.post("/practice/finish")
async def api_practice_finish():
    practice = get_practice()
    if not practice.evaluations:
        raise HTTPException(400, "还没有完成任何题目")
    practice.status = "report"
    broadcast({"type": "practice_status", "status": "report", "scope": "practice"})

    def _report():
        try:
            full = ""
            broadcast({"type": "practice_report_start", "scope": "practice"})
            for chunk in generate_report_stream(practice.evaluations):
                full += chunk
                broadcast({"type": "practice_report_chunk", "chunk": chunk, "scope": "practice"})
            practice.report = full
            practice.status = "finished"
            broadcast({"type": "practice_report_done", "report": full, "scope": "practice"})
            broadcast({"type": "practice_status", "status": "finished", "scope": "practice"})
            stats = get_token_stats()
            broadcast({
                "type": "token_update",
                "prompt": stats["prompt"],
                "completion": stats["completion"],
                "total": stats["total"],
                "by_model": stats.get("by_model", {}),
            })
        except Exception as e:
            practice.status = "finished"
            broadcast({"type": "error", "message": f"报告生成失败: {e}"})
            broadcast({"type": "practice_status", "status": "finished", "scope": "practice"})

    threading.Thread(target=_report, daemon=True).start()
    return {"ok": True}


@router.post("/practice/reset")
async def api_practice_reset():
    await run_in_threadpool(_stop_practice_recording)
    reset_practice()
    broadcast({"type": "practice_status", "status": "idle", "scope": "practice"})
    return {"ok": True}


@router.post("/practice/record")
async def api_practice_record(body: dict):
    action = body.get("action", "start")
    if action == "start":
        device_id = body.get("device_id")
        if device_id is None:
            raise HTTPException(400, "请选择麦克风设备")
        try:
            await run_in_threadpool(_start_practice_recording, int(device_id))
        except AudioBusyError as e:
            raise HTTPException(409, str(e))
        return {"ok": True}
    else:
        await run_in_threadpool(_stop_practice_recording)
        return {"ok": True, "text": "\n".join(_practice_answer_buf)}


def _start_practice_recording(device_id: int):
    global _practice_thread
    _stop_practice_recording()
    _practice_stop.clear()
    _practice_answer_buf.clear()

    audio_capture.start(device_id, owner="practice")
    broadcast({"type": "practice_recording", "value": True, "scope": "practice"})

    _practice_thread = threading.Thread(target=_practice_record_worker, daemon=True)
    _practice_thread.start()


def _stop_practice_recording():
    global _practice_thread
    _practice_stop.set()
    audio_capture.stop(owner="practice")
    broadcast({"type": "practice_recording", "value": False, "scope": "practice"})
    if _practice_thread and _practice_thread.is_alive():
        _practice_thread.join(timeout=3)
    _practice_thread = None


def _practice_record_worker():
    try:
        cfg = get_config()
        engine = get_stt_engine()
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
            broadcast({"type": "audio_level", "value": round(energy, 4), "scope": "practice"})

            speech_audio = vad.feed(chunk)
            if speech_audio is not None and len(speech_audio) > AudioCapture.SAMPLE_RATE * 0.3:
                try:
                    text = engine.transcribe(speech_audio, AudioCapture.SAMPLE_RATE,
                                            position=cfg.position, language=cfg.language)
                    min_sig = getattr(
                        get_config(), "transcription_min_sig_chars", 2
                    )
                    pub = transcription_for_publish(text, min_sig)
                    if pub:
                        _practice_answer_buf.append(pub)
                        broadcast({"type": "practice_transcription", "text": pub, "scope": "practice"})
                except Exception:
                    pass

        remaining = vad.flush()
        if remaining is not None and len(remaining) > AudioCapture.SAMPLE_RATE * 0.3:
            try:
                text = engine.transcribe(remaining, AudioCapture.SAMPLE_RATE,
                                         position=cfg.position, language=cfg.language)
                min_sig = getattr(
                    get_config(), "transcription_min_sig_chars", 2
                )
                pub = transcription_for_publish(text, min_sig)
                if pub:
                    _practice_answer_buf.append(pub)
                    broadcast({"type": "practice_transcription", "text": pub, "scope": "practice"})
            except Exception:
                pass
    except Exception as e:
        broadcast({"type": "error", "message": f"练习录音异常: {e}"})
        broadcast({"type": "practice_recording", "value": False, "scope": "practice"})
