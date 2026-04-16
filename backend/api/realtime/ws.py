import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.session import snapshot_session
from services.stt import get_stt_engine

_log = logging.getLogger("ws")

router = APIRouter()

ws_clients: set[WebSocket] = set()
_loop: Optional[asyncio.AbstractEventLoop] = None
_msg_queue: Optional[asyncio.Queue] = None
_broadcast_drop_count = 0


def init_broadcast(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
    global _loop, _msg_queue, _broadcast_drop_count
    _loop = loop
    _msg_queue = queue
    _broadcast_drop_count = 0


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
    _loop.call_soon_threadsafe(_enqueue_broadcast, data)


def _enqueue_broadcast(data: dict):
    global _broadcast_drop_count
    if _msg_queue is None:
        return
    try:
        _msg_queue.put_nowait(data)
    except asyncio.QueueFull:
        _broadcast_drop_count += 1
        if _broadcast_drop_count == 1 or _broadcast_drop_count % 25 == 0:
            _log.warning(
                "WS broadcast queue full; dropped=%d type=%s",
                _broadcast_drop_count,
                data.get("type"),
            )


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    ws_clients.add(ws)
    _log.info("WS connect clients=%d", len(ws_clients))
    try:
        snapshot = snapshot_session()
        engine = get_stt_engine()
        await ws.send_json({
            "type": "init",
            "is_recording": snapshot["is_recording"],
            "is_paused": snapshot["is_paused"],
            "stt_loaded": engine.is_loaded,
            "transcriptions": snapshot["transcriptions"],
            "qa_pairs": snapshot["qa_pairs"],
        })
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(ws)
        _log.info("WS disconnect clients=%d", len(ws_clients))
