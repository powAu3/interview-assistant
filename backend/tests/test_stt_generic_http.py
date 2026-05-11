from __future__ import annotations

from pathlib import Path
import sys

import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.stt.engines import GenericHTTPSTT
from services.stt import factory as stt_factory


def test_generic_http_stt_posts_openai_compatible_multipart(monkeypatch):
    captured = {}

    class _Resp:
        status_code = 200
        headers = {"content-type": "application/json"}

        def json(self):
            return {"text": "请介绍一下 Redis。"}

    def fake_post(url, headers=None, files=None, data=None, timeout=None):
        captured.update({
            "url": url,
            "headers": headers,
            "files": files,
            "data": data,
            "timeout": timeout,
        })
        return _Resp()

    monkeypatch.setattr("services.stt.engines.requests.post", fake_post)

    engine = GenericHTTPSTT(
        api_base_url="https://asr.example.com/v1/",
        api_key="sk-test",
        model="asr-model",
    )
    audio = np.zeros(1600, dtype=np.float32)

    assert engine.transcribe(audio, sample_rate=16000) == "请介绍一下 Redis。"
    assert captured["url"] == "https://asr.example.com/v1/audio/transcriptions"
    assert captured["headers"] == {"Authorization": "Bearer sk-test"}
    assert captured["data"] == {"model": "asr-model", "response_format": "json"}
    assert captured["files"]["file"][0] == "audio.wav"
    assert captured["files"]["file"][2] == "audio/wav"
    assert captured["files"]["file"][1].startswith(b"RIFF")


def test_generic_http_stt_extracts_nested_result_text(monkeypatch):
    class _Resp:
        status_code = 200
        headers = {"content-type": "application/json"}

        def json(self):
            return {"result": {"text": "你好。"}}

    monkeypatch.setattr("services.stt.engines.requests.post", lambda **_kwargs: _Resp())
    monkeypatch.setattr(
        "services.stt.engines.requests.post",
        lambda *args, **kwargs: _Resp(),
    )

    engine = GenericHTTPSTT("https://asr.example.com/v1", "sk", "m")
    assert engine.transcribe(np.zeros(100, dtype=np.float32), sample_rate=16000) == "你好。"


def test_transcribe_with_fallback_treats_empty_remote_text_as_failure(monkeypatch):
    import core.config as core_config
    monkeypatch.setattr(
        core_config,
        "get_config",
        lambda: type("Cfg", (), {"stt_provider": "generic", "whisper_model": "base", "whisper_language": "auto"})(),
    )

    class _RemoteEngine:
        def transcribe(self, audio, sample_rate=16000, position="", language=""):
            return ""

    calls = {"broadcast": [], "fallback": 0}

    monkeypatch.setattr(stt_factory, "get_stt_engine", lambda model_size=None, language=None: _RemoteEngine())
    monkeypatch.setattr(stt_factory, "_is_circuit_open", lambda: False)
    monkeypatch.setattr(stt_factory, "_circuit_record_failure", lambda is_timeout=False: None)
    monkeypatch.setattr(stt_factory, "_circuit_reset", lambda: None)
    monkeypatch.setattr(stt_factory, "_whisper_transcribe", lambda audio, sample_rate, position, language: calls.__setitem__("fallback", calls["fallback"] + 1) or "fallback text")

    import sys as _sys
    ws_mod = _sys.modules.get("api.realtime.ws")
    if ws_mod is None:
        import types as _types
        ws_mod = _types.ModuleType("api.realtime.ws")
        _sys.modules["api.realtime.ws"] = ws_mod
    monkeypatch.setattr(ws_mod, "broadcast", lambda data: calls["broadcast"].append(data), raising=False)

    text = stt_factory.transcribe_with_fallback(np.zeros(100, dtype=np.float32), 16000)

    assert text == "fallback text"
    assert calls["fallback"] == 1
    assert calls["broadcast"]
