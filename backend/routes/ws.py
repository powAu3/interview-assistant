import asyncio
import json
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.session import get_session
from services.stt import get_stt_engine

router = APIRouter()

ws_clients: set[WebSocket] = set()
_loop: Optional[asyncio.AbstractEventLoop] = None
_msg_queue: Optional[asyncio.Queue] = None


def init_broadcast(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
    global _loop, _msg_queue
    _loop = loop
    _msg_queue = queue


async def ws_dispatcher():
    while True:
        data = await _msg_queue.get()
        dead = set()
        for ws in ws_clients.copy():
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        ws_clients.difference_update(dead)


def broadcast(data: dict):
    """Thread-safe broadcast to all connected WebSocket clients."""
    if _loop is None or _msg_queue is None:
        return
    _loop.call_soon_threadsafe(_msg_queue.put_nowait, data)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    ws_clients.add(ws)
    try:
        session = get_session()
        engine = get_stt_engine()
        await ws.send_json({
            "type": "init",
            "is_recording": session.is_recording,
            "is_paused": session.is_paused,
            "stt_loaded": engine.is_loaded,
            "transcriptions": session.transcription_history[-50:],
            "qa_pairs": [
                {"id": qa.id, "question": qa.question, "answer": qa.answer, "timestamp": qa.timestamp}
                for qa in session.qa_pairs
            ],
        })
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(ws)
