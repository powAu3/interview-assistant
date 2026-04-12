"""Interview assist HTTP routes."""

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import get_config
from core.session import get_session
from .pipeline import (
    cancel_answer_work,
    is_paused,
    pause_interview,
    pick_model_index,
    prompt_server_screen_code,
    start_nonblocking,
    stop_interview_loop,
    submit_answer_task,
    unpause_interview,
    _bump_generation,
)

router = APIRouter()


class ManualQuestion(BaseModel):
    text: str
    image: Optional[str] = None


@router.post("/start")
async def api_start(body: dict):
    device_id = body.get("device_id")
    if device_id is None:
        raise HTTPException(400, "\u8bf7\u9009\u62e9\u97f3\u9891\u8bbe\u5907")
    try:
        dev = int(device_id)
    except (TypeError, ValueError):
        raise HTTPException(400, "device_id 必须是整数")
    try:
        start_nonblocking(dev)
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
        raise HTTPException(400, "\u9762\u8bd5\u672a\u5728\u8fdb\u884c\u4e2d")
    if is_paused():
        raise HTTPException(400, "\u5df2\u7ecf\u5904\u4e8e\u6682\u505c\u72b6\u6001")
    pause_interview()
    return {"ok": True}


@router.post("/unpause")
async def api_resume_interview(body: Optional[dict] = None):
    session = get_session()
    if not session.is_recording:
        raise HTTPException(400, "\u9762\u8bd5\u672a\u5728\u8fdb\u884c\u4e2d")
    if not is_paused():
        raise HTTPException(400, "\u9762\u8bd5\u672a\u5904\u4e8e\u6682\u505c\u72b6\u6001")
    device_id = (body or {}).get("device_id")
    if device_id is not None:
        try:
            int(device_id)
        except (TypeError, ValueError):
            raise HTTPException(400, "device_id \u5fc5\u987b\u662f\u6574\u6570")
    unpause_interview(device_id=int(device_id) if device_id is not None else None)
    return {"ok": True}


@router.post("/clear")
async def api_clear():
    from api.realtime.ws import broadcast
    cancel_answer_work(reset_session_data=True)
    broadcast({"type": "session_cleared"})
    return {"ok": True}


@router.post("/ask/cancel")
async def api_ask_cancel():
    _bump_generation()
    cancel_answer_work(reset_session_data=False)
    return {"ok": True}


@router.post("/ask")
async def api_ask(body: ManualQuestion):
    if not body.text.strip() and not body.image:
        raise HTTPException(400, "\u95ee\u9898\u4e0d\u80fd\u4e3a\u7a7a")
    text = body.text.strip() or "\u8bf7\u5206\u6790\u8fd9\u5f20\u56fe\u7247\u4e2d\u7684\u9898\u76ee\uff0c\u5e76\u7ed9\u51fa\u9762\u8bd5\u56de\u7b54"
    src = "manual_image" if body.image else "manual_text"
    submit_answer_task((text, body.image, True, src, {"origin": "manual"}))
    return {"ok": True}


@router.post("/ask-from-server-screen")
async def api_ask_from_server_screen():
    from services.llm import has_vision_model
    from services.capture import ScreenCaptureError, capture_primary_left_half_data_url

    if not has_vision_model():
        raise HTTPException(400, "\u8bf7\u81f3\u5c11\u914d\u7f6e\u4e00\u4e2a\u652f\u6301\u8bc6\u56fe\u4e14\u5df2\u586b\u5199 API Key \u7684\u6a21\u578b")
    try:
        data_url = capture_primary_left_half_data_url()
    except ScreenCaptureError as e:
        raise HTTPException(503, str(e))
    cfg = get_config()
    region = getattr(cfg, "screen_capture_region", "left_half") or "left_half"
    text = prompt_server_screen_code(cfg.language, region)
    if pick_model_index((text, data_url, True, "server_screen_left", {"origin": "server_screen"}), set()) is None:
        raise HTTPException(400, "\u6ca1\u6709\u53ef\u7528\u7684\u8bc6\u56fe\u6a21\u578b\uff0c\u8bf7\u68c0\u67e5\u542f\u7528\u72b6\u6001\u4e0e API Key")
    cancel_answer_work(reset_session_data=False)
    submit_answer_task((text, data_url, True, "server_screen_left", {"origin": "server_screen"}))
    return {"ok": True}


@router.get("/preflight/scenarios")
async def api_preflight_scenarios():
    from .sound_test import get_scenarios
    return {"scenarios": get_scenarios()}


@router.post("/preflight/run")
async def api_preflight_run(body: dict):
    from .sound_test import start_preflight
    scenario_id = body.get("scenario_id", "self_intro")
    device_id = body.get("device_id")
    if device_id is not None:
        try:
            device_id = int(device_id)
        except (TypeError, ValueError):
            raise HTTPException(400, "device_id 必须是整数")
    ok = start_preflight(
        device_id=device_id,
        scenario_id=scenario_id,
    )
    if not ok:
        raise HTTPException(409, "\u94FE\u8DEF\u68C0\u6D4B\u5DF2\u5728\u8FD0\u884C\u4E2D")
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
