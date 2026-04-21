import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from core.auth import is_auth_disabled, is_loopback_host, verify_token
from core.session import snapshot_session
from services.practice import get_practice
from services.stt import get_stt_engine

_log = logging.getLogger("ws")

router = APIRouter()

ws_clients: set[WebSocket] = set()
_loop: Optional[asyncio.AbstractEventLoop] = None
_msg_queue: Optional[asyncio.Queue] = None
_broadcast_drop_count = 0

# 心跳/超时配置（秒）。25s 间隔可穿透多数代理 60s 空闲断连阈值。
HEARTBEAT_INTERVAL = 25
HEARTBEAT_TIMEOUT = 60
# 单条 send 的硬超时，避免某个客户端把整个并行 gather 拖慢过久。
SEND_TIMEOUT = 5.0


def init_broadcast(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
    global _loop, _msg_queue, _broadcast_drop_count
    _loop = loop
    _msg_queue = queue
    _broadcast_drop_count = 0


async def _safe_send(ws: WebSocket, data: dict) -> bool:
    try:
        await asyncio.wait_for(ws.send_json(data), timeout=SEND_TIMEOUT)
        return True
    except asyncio.TimeoutError:
        _log.warning("WS send timeout, dropping client")
        return False
    except Exception:
        return False


async def ws_dispatcher():
    if _msg_queue is None:
        return
    while True:
        data = await _msg_queue.get()
        clients = list(ws_clients)
        if not clients:
            continue
        results = await asyncio.gather(
            *[_safe_send(ws, data) for ws in clients],
            return_exceptions=False,
        )
        dead = [ws for ws, ok in zip(clients, results) if not ok]
        if dead:
            for ws in dead:
                ws_clients.discard(ws)
                try:
                    await ws.close(code=status.WS_1011_INTERNAL_ERROR)
                except Exception:
                    pass


async def ws_heartbeat():
    """服务端主动心跳：定期 ping 客户端，长时间无 pong 视为僵尸连接并关闭。"""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        now = time.monotonic()
        clients = list(ws_clients)
        if not clients:
            continue
        ping_msg = {"type": "ping", "ts": now}
        results = await asyncio.gather(
            *[_safe_send(ws, ping_msg) for ws in clients],
            return_exceptions=False,
        )
        for ws, ok in zip(clients, results):
            if not ok:
                ws_clients.discard(ws)
                try:
                    await ws.close(code=status.WS_1011_INTERNAL_ERROR)
                except Exception:
                    pass
                continue
            last = getattr(ws, "_ia_last_pong", None) or getattr(ws, "_ia_connected_at", now)
            if now - last > HEARTBEAT_TIMEOUT:
                _log.info("WS heartbeat timeout, closing stale client")
                ws_clients.discard(ws)
                try:
                    await ws.close(code=status.WS_1001_GOING_AWAY)
                except Exception:
                    pass


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


def _ws_authorized(ws: WebSocket) -> bool:
    if is_auth_disabled():
        return True
    _client = getattr(ws, "client", None)
    client_host = _client.host if _client else None
    if is_loopback_host(client_host):
        return True
    token = ws.query_params.get("token")
    if not token:
        auth = ws.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth.split(None, 1)[1].strip()
    return verify_token(token)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    if not _ws_authorized(ws):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await ws.accept()
    now = time.monotonic()
    ws._ia_connected_at = now  # type: ignore[attr-defined]
    ws._ia_last_pong = now  # type: ignore[attr-defined]
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
            "practice_session": get_practice().to_dict(
                reveal_feedback=get_practice().status == "finished"
            ),
        })
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(msg, dict):
                mtype = msg.get("type")
                if mtype == "ping":
                    ws._ia_last_pong = time.monotonic()  # type: ignore[attr-defined]
                    await ws.send_json({"type": "pong"})
                elif mtype == "pong":
                    ws._ia_last_pong = time.monotonic()  # type: ignore[attr-defined]
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(ws)
        _log.info("WS disconnect clients=%d", len(ws_clients))
