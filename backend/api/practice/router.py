from __future__ import annotations

import threading
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from api.realtime.ws import broadcast
from core.background import BoundedTaskWorker
from core.config import get_config
from core.logger import get_logger
from services.audio import AudioBusyError, AudioCapture, VADBuffer, audio_capture
from services.llm import get_token_stats
from services.practice import (
    PRACTICE_STATUS_AWAITING_ANSWER,
    PRACTICE_STATUS_DEBRIEFING,
    PRACTICE_STATUS_FINISHED,
    PRACTICE_STATUS_IDLE,
    PRACTICE_STATUS_INTERVIEWER_SPEAKING,
    PRACTICE_STATUS_PREPARING,
    PRACTICE_STATUS_THINKING,
    finish_practice_session,
    get_practice,
    reset_practice,
    start_practice_session,
    submit_practice_answer,
)
from services.stt import get_stt_engine, transcription_for_publish
from services.tts import (
    edge_tts_configured,
    synthesize_edge_tts,
    synthesize_volcengine_tts,
    volcengine_tts_configured,
)

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
            "practice record dropped (queue full): q=%r len_a=%d",
            question[:60],
            len(answer),
        )


def _broadcast_practice_status(status: str) -> None:
    broadcast({"type": "practice_status", "status": status, "scope": "practice"})


def _broadcast_practice_session(session=None, *, reveal_feedback: bool = False) -> None:
    session = session or get_practice()
    broadcast(
        {
            "type": "practice_session",
            "scope": "practice",
            "session": session.to_dict(reveal_feedback=reveal_feedback),
        }
    )


def _broadcast_token_update() -> None:
    stats = get_token_stats()
    broadcast(
        {
            "type": "token_update",
            "prompt": stats["prompt"],
            "completion": stats["completion"],
            "total": stats["total"],
            "by_model": stats.get("by_model", {}),
        }
    )


@router.get("/practice/status")
async def api_practice_status():
    session = get_practice()
    return session.to_dict(reveal_feedback=session.status == PRACTICE_STATUS_FINISHED)


@router.post("/practice/generate")
async def api_practice_generate(body: Optional[dict] = None):
    jd_text = str(((body or {}).get("jd_text") or "")).strip()
    interviewer_style = str(((body or {}).get("interviewer_style") or "")).strip()
    reset_practice()
    get_practice().status = PRACTICE_STATUS_PREPARING
    _broadcast_practice_status(PRACTICE_STATUS_PREPARING)

    def _gen():
        try:
            session = start_practice_session(jd_text=jd_text, interviewer_style=interviewer_style)
            _broadcast_practice_status(PRACTICE_STATUS_INTERVIEWER_SPEAKING)
            _broadcast_practice_session(session, reveal_feedback=False)
            _broadcast_practice_status(PRACTICE_STATUS_AWAITING_ANSWER)
            _broadcast_token_update()
        except Exception as e:
            reset_practice()
            _broadcast_practice_status(PRACTICE_STATUS_IDLE)
            broadcast({"type": "error", "message": f"启动模拟面试失败: {e}"})

    threading.Thread(target=_gen, daemon=True).start()
    return {"ok": True}


class PracticeSubmitBody(BaseModel):
    transcript: str = ""
    code_text: str = ""
    answer_mode: str = "voice"
    duration_ms: int = 0
    answer: str = ""

    def effective_transcript(self) -> str:
        return (self.transcript or self.answer or "").strip()


class PracticeTtsBody(BaseModel):
    text: str
    preferred_gender: str = "auto"
    speaker: Optional[str] = None


@router.post("/practice/submit")
async def api_practice_submit(body: PracticeSubmitBody):
    if not get_practice().current_turn:
        raise HTTPException(400, "没有当前题目")
    if not body.effective_transcript() and not body.code_text.strip():
        raise HTTPException(400, "回答不能为空")

    get_practice().status = PRACTICE_STATUS_THINKING
    _broadcast_practice_status(PRACTICE_STATUS_THINKING)

    transcript = body.effective_transcript()
    code_text = body.code_text.strip()
    duration_ms = max(0, int(body.duration_ms or 0))
    answer_mode = body.answer_mode

    def _eval():
        try:
            previous_question = get_practice().current_turn.question if get_practice().current_turn else ""
            session = submit_practice_answer(
                transcript=transcript,
                code_text=code_text,
                answer_mode=answer_mode,
                duration_ms=duration_ms,
            )
            combined_answer = transcript.strip()
            if code_text:
                combined_answer = f"{combined_answer}\n\n[code]\n{code_text}" if combined_answer else code_text
            if previous_question:
                scores = session.hidden_score_ledger[-1].scorecard if session.hidden_score_ledger else {}
                score_values = list(scores.values())
                score = int(round(sum(score_values) / len(score_values))) if score_values else None
                _submit_practice_record(previous_question, combined_answer, score)

            if session.status == PRACTICE_STATUS_FINISHED:
                _broadcast_practice_status(PRACTICE_STATUS_DEBRIEFING)
                _broadcast_practice_session(session, reveal_feedback=True)
                _broadcast_practice_status(PRACTICE_STATUS_FINISHED)
            else:
                _broadcast_practice_status(PRACTICE_STATUS_INTERVIEWER_SPEAKING)
                _broadcast_practice_session(session, reveal_feedback=False)
                _broadcast_practice_status(PRACTICE_STATUS_AWAITING_ANSWER)
            _broadcast_token_update()
        except Exception as e:
            get_practice().status = PRACTICE_STATUS_AWAITING_ANSWER
            _broadcast_practice_status(PRACTICE_STATUS_AWAITING_ANSWER)
            broadcast({"type": "error", "message": f"处理回答失败: {e}"})

    threading.Thread(target=_eval, daemon=True).start()
    return {"ok": True}


@router.post("/practice/tts")
async def api_practice_tts(body: PracticeTtsBody):
    cfg = get_config()
    provider = (getattr(cfg, "practice_tts_provider", "local") or "local").strip()
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "播报文本不能为空")
    try:
        if provider == "volcengine":
            if not volcengine_tts_configured():
                raise HTTPException(400, "火山引擎 TTS 未配置完成，请先在设置里填写 appkey / token")
            result = await run_in_threadpool(
                synthesize_volcengine_tts,
                text,
                preferred_gender=(body.preferred_gender or "auto"),
                speaker=body.speaker,
            )
        elif provider == "edge_tts":
            if not edge_tts_configured():
                raise HTTPException(400, "EdgeTTS 未安装，请先执行 pip install edge-tts")
            result = await run_in_threadpool(
                synthesize_edge_tts,
                text,
                preferred_gender=(body.preferred_gender or "auto"),
                voice=body.speaker,
            )
        else:
            raise HTTPException(400, "当前播报方案不走后端 TTS 服务")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "ok": True,
        "provider": result["provider"],
        "speaker": result["speaker"],
        "audio_base64": result["audio_base64"],
        "content_type": result["content_type"],
        "duration": result["duration"],
    }


@router.post("/practice/next")
async def api_practice_next():
    raise HTTPException(410, "新版模拟面试由系统自动推进，不再支持手动下一题")


@router.post("/practice/finish")
async def api_practice_finish():
    if not get_practice().turn_history:
        raise HTTPException(400, "还没有完成任何题目")
    get_practice().status = PRACTICE_STATUS_DEBRIEFING
    _broadcast_practice_status(PRACTICE_STATUS_DEBRIEFING)

    def _finish():
        try:
            session = finish_practice_session()
            _broadcast_practice_session(session, reveal_feedback=True)
            _broadcast_practice_status(PRACTICE_STATUS_FINISHED)
            _broadcast_token_update()
        except Exception as e:
            get_practice().status = PRACTICE_STATUS_AWAITING_ANSWER
            _broadcast_practice_status(PRACTICE_STATUS_AWAITING_ANSWER)
            broadcast({"type": "error", "message": f"结束模拟面试失败: {e}"})

    threading.Thread(target=_finish, daemon=True).start()
    return {"ok": True}


@router.post("/practice/reset")
async def api_practice_reset():
    await run_in_threadpool(_stop_practice_recording)
    reset_practice()
    _broadcast_practice_session(reveal_feedback=False)
    _broadcast_practice_status(PRACTICE_STATUS_IDLE)
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
                    text = engine.transcribe(
                        speech_audio,
                        AudioCapture.SAMPLE_RATE,
                        position=cfg.position,
                        language=cfg.language,
                    )
                    min_sig = getattr(get_config(), "transcription_min_sig_chars", 2)
                    pub = transcription_for_publish(text, min_sig)
                    if pub:
                        _practice_answer_buf.append(pub)
                        broadcast({"type": "practice_transcription", "text": pub, "scope": "practice"})
                except Exception:
                    pass

        remaining = vad.flush()
        if remaining is not None and len(remaining) > AudioCapture.SAMPLE_RATE * 0.3:
            try:
                text = engine.transcribe(
                    remaining,
                    AudioCapture.SAMPLE_RATE,
                    position=cfg.position,
                    language=cfg.language,
                )
                min_sig = getattr(get_config(), "transcription_min_sig_chars", 2)
                pub = transcription_for_publish(text, min_sig)
                if pub:
                    _practice_answer_buf.append(pub)
                    broadcast({"type": "practice_transcription", "text": pub, "scope": "practice"})
            except Exception:
                pass
    except Exception as e:
        broadcast({"type": "error", "message": f"练习录音异常: {e}"})
        broadcast({"type": "practice_recording", "value": False, "scope": "practice"})
