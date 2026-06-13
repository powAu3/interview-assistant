from __future__ import annotations

import gzip
import json
import struct
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.stt import engines  # noqa: E402
from services.stt.engines import DoubaoSTT  # noqa: E402


def _server_text_frame(text: str) -> bytes:
    payload = gzip.compress(
        json.dumps({"result": {"text": text}}, ensure_ascii=False).encode("utf-8")
    )
    return (
        bytes([0x00, engines.MSG_FULL_SERVER_RESPONSE << 4, engines.COMPRESSION_GZIP, 0x00])
        + b"\x00\x00\x00\x00"
        + struct.pack(">I", len(payload))
        + payload
    )


def test_doubao_stt_does_not_retry_timeout_before_factory_fallback(monkeypatch):
    calls = {"connect": 0, "sleep": []}

    def fake_create_connection(*_args, **_kwargs):
        calls["connect"] += 1
        raise TimeoutError("timed out")

    monkeypatch.setattr(
        engines,
        "websocket",
        SimpleNamespace(create_connection=fake_create_connection),
    )
    monkeypatch.setattr(engines.time, "sleep", lambda seconds: calls["sleep"].append(seconds))

    engine = DoubaoSTT(api_key="sk-test")

    with pytest.raises(TimeoutError):
        engine.transcribe(np.zeros(1600, dtype=np.float32), sample_rate=16000)

    assert calls["connect"] == 1
    assert calls["sleep"] == []


def test_doubao_stt_leaves_transient_retry_to_factory_fallback(monkeypatch):
    calls = {"connect": 0, "sleep": []}

    class FakeWebSocket:
        def __init__(self):
            self.recv_count = 0

        def send_binary(self, _frame):
            pass

        def settimeout(self, _timeout):
            pass

        def recv(self):
            self.recv_count += 1
            if self.recv_count == 1:
                return _server_text_frame("你好")
            raise TimeoutError("done")

        def close(self):
            pass

    def fake_create_connection(*_args, **_kwargs):
        calls["connect"] += 1
        if calls["connect"] == 1:
            raise ConnectionError("connection reset")
        return FakeWebSocket()

    monkeypatch.setattr(
        engines,
        "websocket",
        SimpleNamespace(create_connection=fake_create_connection),
    )
    monkeypatch.setattr(engines.time, "sleep", lambda seconds: calls["sleep"].append(seconds))

    engine = DoubaoSTT(api_key="sk-test")

    with pytest.raises(ConnectionError):
        engine.transcribe(np.zeros(1600, dtype=np.float32), sample_rate=16000)

    assert calls["connect"] == 1
    assert calls["sleep"] == []
