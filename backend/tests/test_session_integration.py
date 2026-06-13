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


def test_candidate_asr_pending_preserves_active_qa_after_window_closes():
    session = session_mod.reset_session()
    session.open_candidate_answer_window("qa-prev")
    session.mark_candidate_asr_busy()
    session.close_candidate_answer_window()
    session.mark_candidate_asr_busy()

    assert session.has_candidate_asr_pending_for_qa("qa-prev")
    segment = session.add_candidate_transcription("真实回答片段", qa_id=session.candidate_asr_active_qa_id)
    assert segment is not None
    assert segment.qa_id == "qa-prev"
    assert session.get_candidate_answer_for_qa("qa-prev") == "真实回答片段"


def test_candidate_partial_transcription_is_replaced_by_final_text():
    session = session_mod.reset_session()
    partial = session.add_candidate_transcription(
        "我做了风控",
        qa_id="qa-prev",
        provider="whisper",
        segment_id="seg-1",
        is_final=False,
    )
    final = session.add_candidate_transcription(
        "我做了风控规则引擎，支持灰度发布。",
        qa_id="qa-prev",
        provider="whisper",
        segment_id="seg-1",
        is_final=True,
    )

    assert partial is final
    assert len(session.candidate_answer_segments) == 1
    assert session.candidate_answer_segments[0].is_final is True
    assert session.get_candidate_answer_for_qa("qa-prev") == "我做了风控规则引擎，支持灰度发布。"


def test_api_session_uses_snapshot_shape():
    session = session_mod.reset_session()
    session.add_transcription('one')
    session.add_qa('q', 'a', source='manual_text', model_name='demo')

    payload = asyncio.run(assist_routes.api_session())

    assert payload['transcriptions'] == ['one']
    assert payload['qa_pairs'][0]['source'] == 'manual_text'
    assert payload['qa_pairs'][0]['model_name'] == 'demo'


class _AuthFakeWS:
    client = SimpleNamespace(host="127.0.0.1")

    def __init__(
        self,
        *,
        origin: str | None,
        token: str = "",
        host: str = "127.0.0.1",
        port: int = 18080,
    ):
        self.headers = {"origin": origin} if origin else {}
        self.query_params = {"token": token} if token else {}
        self.url = SimpleNamespace(scheme="ws", hostname=host, port=port)


def test_websocket_allows_local_requests_when_auth_is_not_enabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("IA_AUTH_ENABLE", raising=False)
    monkeypatch.delenv("IA_AUTH_DISABLE", raising=False)
    monkeypatch.delenv("IA_AUTH_TOKEN", raising=False)
    ws = _AuthFakeWS(origin="http://localhost:5173")

    assert ws_mod._ws_authorized(ws) is True


def test_websocket_loopback_rejects_cross_origin_without_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("IA_AUTH_ENABLE", "1")
    monkeypatch.delenv("IA_AUTH_DISABLE", raising=False)
    ws = _AuthFakeWS(origin="http://localhost:5173")

    assert ws_mod._ws_authorized(ws) is False


def test_websocket_loopback_allows_same_origin_without_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("IA_AUTH_ENABLE", "1")
    monkeypatch.delenv("IA_AUTH_DISABLE", raising=False)
    ws = _AuthFakeWS(origin="http://localhost:18080")

    assert ws_mod._ws_authorized(ws) is True


def test_websocket_loopback_cross_origin_allows_valid_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("IA_AUTH_ENABLE", "1")
    monkeypatch.delenv("IA_AUTH_DISABLE", raising=False)
    ws = _AuthFakeWS(origin="http://localhost:5173", token="valid-token")
    monkeypatch.setattr(ws_mod, "verify_token", lambda token: token == "valid-token")

    assert ws_mod._ws_authorized(ws) is True


def test_websocket_init_uses_session_snapshot(monkeypatch: pytest.MonkeyPatch):
    session = session_mod.reset_session()
    session.is_recording = True
    session.add_transcription('one')
    session.add_qa('q', 'a', source='manual_text', model_name='demo')
    session.add_candidate_transcription(
        '候选人真实回答',
        qa_id='qa-prev',
        provider='whisper',
        segment_id='cand-1',
    )

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
    assert sent[0]['candidate_transcriptions'] == ['候选人真实回答']
    assert sent[0]['candidate_answer_segments'][0]['segment_id'] == 'cand-1'
    assert sent[0]['qa_pairs'][0]['source'] == 'manual_text'
