from __future__ import annotations

from pathlib import Path
import asyncio
import importlib
import sys
from types import SimpleNamespace

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

session_mod = importlib.import_module('core.session')
assist_routes = importlib.import_module('api.assist.routes')
ws_mod = importlib.import_module('api.realtime.ws')


def test_reset_session_keeps_singleton_identity():
    session = session_mod.reset_session()
    original_id = id(session)
    session.add_transcription('hello')
    session.add_qa('q', 'a')

    reset = session_mod.reset_session()

    assert id(reset) == original_id
    assert reset.transcription_history == []
    assert reset.qa_pairs == []


def test_session_snapshot_contains_serialized_qa_fields():
    session = session_mod.reset_session()
    session.is_recording = True
    session.is_paused = True
    qa = session.add_qa('q', 'a', source='manual_text', model_name='demo')
    snapshot = session.snapshot()

    assert snapshot['is_recording'] is True
    assert snapshot['is_paused'] is True
    assert snapshot['qa_pairs'][0]['id'] == qa.id
    assert snapshot['qa_pairs'][0]['source'] == 'manual_text'
    assert snapshot['qa_pairs'][0]['model_name'] == 'demo'


def test_api_session_uses_snapshot_shape():
    session = session_mod.reset_session()
    session.add_transcription('one')
    session.add_qa('q', 'a', source='manual_text', model_name='demo')

    payload = asyncio.run(assist_routes.api_session())

    assert payload['transcriptions'] == ['one']
    assert payload['qa_pairs'][0]['source'] == 'manual_text'
    assert payload['qa_pairs'][0]['model_name'] == 'demo'


def test_websocket_init_uses_session_snapshot(monkeypatch: pytest.MonkeyPatch):
    session = session_mod.reset_session()
    session.is_recording = True
    session.add_transcription('one')
    session.add_qa('q', 'a', source='manual_text', model_name='demo')

    sent: list[dict] = []

    class FakeWS:
        # 模拟 starlette WebSocket: 真实环境一定有 client / query_params / headers,
        # 这里给最小 stub 让 _ws_authorized 在 loopback 分支直接放行。
        client = SimpleNamespace(host="127.0.0.1")
        query_params: dict[str, str] = {}
        headers: dict[str, str] = {}

        async def accept(self):
            return None

        async def send_json(self, data):
            sent.append(data)

        async def receive_text(self):
            raise ws_mod.WebSocketDisconnect()

    monkeypatch.setattr(ws_mod, 'get_stt_engine', lambda: SimpleNamespace(is_loaded=True))

    asyncio.run(ws_mod.websocket_endpoint(FakeWS()))

    assert sent[0]['type'] == 'init'
    assert sent[0]['transcriptions'] == ['one']
    assert sent[0]['qa_pairs'][0]['source'] == 'manual_text'
