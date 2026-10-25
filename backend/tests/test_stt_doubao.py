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


def _server_text_frame(text: str, *, with_sequence: bool = False, is_last: bool = False) -> bytes:
    """构造服务端全量响应帧（gzip JSON）。

    with_sequence=True 时按 header(4)+sequence(4)+size(4)+payload 布局；
    否则按 header(4)+size(4)+payload 布局。is_last 对应 flags 0b0010。
    """
    payload = gzip.compress(
        json.dumps({"result": {"text": text}}, ensure_ascii=False).encode("utf-8")
    )
    flags = (0x01 if with_sequence else 0x00) | (0x02 if is_last else 0x00)
    header = bytes([0x00, (engines.MSG_FULL_SERVER_RESPONSE << 4) | flags, engines.COMPRESSION_GZIP, 0x00])
    prefix = b"\x00\x00\x00\x07" if with_sequence else b""
    return header + prefix + struct.pack(">I", len(payload)) + payload


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


# ---------------------------------------------------------------------------
# issue #22：负序号结束包 + 服务端末包立即返回
# ---------------------------------------------------------------------------

def test_last_audio_frame_uses_negative_sequence_with_last_flag():
    frame = engines._build_ws_frame_audio(b"abc", sequence=5, is_last=True)
    assert frame[1] == 0x23  # 音频消息类型 2 << 4 | flags 0b0011
    assert struct.unpack(">i", frame[4:8])[0] == -5
    assert struct.unpack(">I", frame[8:12])[0] == len(frame) - 12

    normal = engines._build_ws_frame_audio(b"abc", sequence=4, is_last=False)
    assert normal[1] == 0x21  # flags 0b0001
    assert struct.unpack(">i", normal[4:8])[0] == 4


def test_full_request_frame_carries_sequence_one():
    frame = engines._build_ws_frame_full_request("app", "")
    assert frame[1] == 0x11  # 全量请求类型 1 << 4 | flags 0b0001
    assert struct.unpack(">i", frame[4:8])[0] == 1


def test_parse_ws_response_supports_frames_with_and_without_sequence():
    for with_seq in (True, False):
        frame = _server_text_frame("你好世界", with_sequence=with_seq, is_last=True)
        msg_type, payload, is_last = engines._parse_ws_response(frame)
        assert msg_type == engines.MSG_FULL_SERVER_RESPONSE
        assert payload["result"]["text"] == "你好世界"
        assert is_last is True

    frame = _server_text_frame("中间结果", with_sequence=True, is_last=False)
    msg_type, payload, is_last = engines._parse_ws_response(frame)
    assert payload["result"]["text"] == "中间结果"
    assert is_last is False


def test_transcribe_returns_immediately_on_server_last_frame(monkeypatch):
    calls = {"recv": 0, "close": 0, "sent": []}

    class FakeWebSocket:
        def send_binary(self, frame):
            calls["sent"].append(frame)

        def settimeout(self, _timeout):
            pass

        def recv(self):
            calls["recv"] += 1
            if calls["recv"] == 1:
                return _server_text_frame("RAG 的召回怎么优化", with_sequence=True, is_last=True)
            raise AssertionError("server last frame should end the recv loop")

        def close(self):
            calls["close"] += 1

    monkeypatch.setattr(
        engines,
        "websocket",
        SimpleNamespace(create_connection=lambda *_a, **_k: FakeWebSocket()),
    )

    engine = DoubaoSTT(api_key="sk-test")
    audio = np.zeros(16000, dtype=np.float32)  # 1s → 5 个 200ms 音频包
    text = engine.transcribe(audio, sample_rate=16000)

    assert "RAG" in text
    # 服务端第一帧就是结束包：只 recv 一次就返回，不再空等到超时
    assert calls["recv"] == 1
    assert calls["close"] == 1
    # 全量请求(seq=1) + 5 个音频包(seq 2..6)，最后一包负序号
    audio_frames = calls["sent"][1:]
    assert len(audio_frames) == 5
    assert audio_frames[-1][1] == 0x23
    assert struct.unpack(">i", audio_frames[-1][4:8])[0] == -6
    for i, frame in enumerate(audio_frames[:-1]):
        assert frame[1] == 0x21
        assert struct.unpack(">i", frame[4:8])[0] == 2 + i
