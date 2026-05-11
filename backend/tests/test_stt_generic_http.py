from __future__ import annotations

from pathlib import Path
import sys

import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.stt.engines import GenericHTTPSTT


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
