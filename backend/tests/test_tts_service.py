from __future__ import annotations

import base64
import importlib
import json
import sys
from pathlib import Path
import subprocess

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

tts_service = importlib.import_module("services.tts")


class _FakeCfg:
    practice_tts_provider = "volcengine"
    edge_tts_voice_female = "zh-CN-XiaoxiaoNeural"
    edge_tts_voice_male = "zh-CN-YunxiNeural"
    edge_tts_rate = "+0%"
    edge_tts_pitch = "+0Hz"
    volcengine_tts_appkey = "appkey-demo"
    volcengine_tts_token = "token-demo"
    practice_tts_speaker_female = "zh_female_qingxin"
    practice_tts_speaker_male = "zh_male_chunhou"


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def test_synthesize_volcengine_tts_uses_gender_mapped_speaker(monkeypatch):
    seen: dict[str, object] = {}

    def fake_post(url, json=None, timeout=None):
        seen["url"] = url
        seen["json"] = json
        seen["timeout"] = timeout
        return _FakeResponse(
            {
                "status_code": 20000000,
                "status_text": "OK",
                "namespace": "TTS",
                "data": base64.b64encode(b"demo-audio").decode("utf-8"),
                "payload": '{"duration": 1.28}',
            }
        )

    monkeypatch.setattr(tts_service, "get_config", lambda: _FakeCfg())
    monkeypatch.setattr(tts_service.requests, "post", fake_post)

    result = tts_service.synthesize_volcengine_tts(
        text="请先做一个自我介绍。",
        preferred_gender="female",
    )

    assert result["provider"] == "volcengine"
    assert result["speaker"] == "zh_female_qingxin"
    assert result["audio_bytes"] == b"demo-audio"
    assert result["duration"] == 1.28
    payload = json.loads(seen["json"]["payload"])
    assert payload["speaker"] == "zh_female_qingxin"
    assert payload["text"] == "请先做一个自我介绍。"
    assert "namespace=TTS" in seen["url"]
    assert "appkey=appkey-demo" in seen["url"]
    assert "token=token-demo" in seen["url"]


def test_normalize_tts_text_rewrites_sql_and_related_terms():
    text = "请讲一下 MySQL 和 PostgreSQL 的区别，再补一段 SQL，并说明 Redis 缓存怎么用。"
    normalized = tts_service.normalize_tts_text(text)

    assert "My sequel" in normalized
    assert "Postgres sequel" in normalized
    assert "sequel" in normalized
    assert "Ree dis" in normalized


def test_normalize_tts_text_rewrites_english_backend_terms():
    text = "Explain Redis, Kafka, API gateway, SDK retry, JSON payload, YAML config, and OAuth."
    normalized = tts_service.normalize_tts_text(text, locale_hint="en")

    assert "Redis" in normalized
    assert "Kaf ka" not in normalized
    assert "A P I" in normalized
    assert "S D K" in normalized
    assert "J S O N" in normalized
    assert "Y A M L" in normalized
    assert "Oh Auth" in normalized


def test_synthesize_volcengine_tts_rejects_missing_credentials(monkeypatch):
    class _BrokenCfg(_FakeCfg):
        volcengine_tts_token = ""

    monkeypatch.setattr(tts_service, "get_config", lambda: _BrokenCfg())

    try:
        tts_service.synthesize_volcengine_tts("你好", preferred_gender="male")
    except ValueError as exc:
        assert "火山引擎 TTS" in str(exc)
    else:
        raise AssertionError("expected ValueError for missing credentials")


def test_get_edge_tts_status_reports_availability(monkeypatch):
    monkeypatch.setattr(tts_service.importlib.util, "find_spec", lambda name: object() if name == "edge_tts" else None)

    status = tts_service.get_edge_tts_status()

    assert status["edge_tts_available"] is True
    assert "edge-tts" in status["edge_tts_status_detail"]


def test_synthesize_edge_tts_uses_selected_voice(monkeypatch):
    class _EdgeCfg(_FakeCfg):
        practice_tts_provider = "edge_tts"
        edge_tts_voice_female = "zh-CN-XiaoxiaoNeural"
        edge_tts_voice_male = "zh-CN-YunxiNeural"
        edge_tts_rate = "+0%"
        edge_tts_pitch = "+0Hz"

    seen: dict[str, object] = {}

    class _Communicate:
        def __init__(self, text, voice, rate, pitch):
            seen["text"] = text
            seen["voice"] = voice
            seen["rate"] = rate
            seen["pitch"] = pitch

        async def save(self, output_path):
            Path(output_path).write_bytes(b"ID3demo")

    monkeypatch.setattr(tts_service, "get_config", lambda: _EdgeCfg())
    monkeypatch.setattr(tts_service.importlib.util, "find_spec", lambda name: object() if name == "edge_tts" else None)
    monkeypatch.setitem(sys.modules, "edge_tts", type("EdgeModule", (), {"Communicate": _Communicate}))

    result = tts_service.synthesize_edge_tts("请讲一下 SQL 和 Redis。", preferred_gender="male")

    assert result["provider"] == "edge_tts"
    assert result["speaker"] == "zh-CN-YunxiNeural"
    assert result["audio_bytes"] == b"ID3demo"
    assert seen["voice"] == "zh-CN-YunxiNeural"
    assert "sequel" in seen["text"]
    assert "Ree dis" in seen["text"]
