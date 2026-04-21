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
    volcengine_tts_appkey = "appkey-demo"
    volcengine_tts_token = "token-demo"
    practice_tts_speaker_female = "zh_female_qingxin"
    practice_tts_speaker_male = "zh_male_chunhou"
    melo_tts_cmd = "melo"
    melo_tts_speed = 1.0


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
    assert "瑞迪斯" in normalized


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


def test_synthesize_melo_tts_uses_cli_and_returns_wav(monkeypatch, tmp_path):
    seen: dict[str, object] = {}

    def fake_which(cmd):
        return f"/usr/local/bin/{cmd}" if cmd == "melo" else None

    def fake_run(args, check, capture_output, text, timeout):
        seen["args"] = args
        Path(args[2]).write_bytes(b"RIFFdemo")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(tts_service, "get_config", lambda: _FakeCfg())
    monkeypatch.setattr(tts_service.shutil, "which", fake_which)
    monkeypatch.setattr(tts_service.subprocess, "run", fake_run)

    result = tts_service.synthesize_melo_tts("请讲一下 SQL 和 Redis。")

    assert result["provider"] == "melo_local"
    assert result["speaker"] == "ZH"
    assert result["audio_bytes"] == b"RIFFdemo"
    assert result["content_type"] == "audio/wav"
    assert seen["args"][0].endswith("melo")
    assert "-l" in seen["args"]
    assert "ZH" in seen["args"]
    assert "sequel" in seen["args"][1]
    assert "瑞迪斯" in seen["args"][1]


def test_synthesize_melo_tts_rejects_when_cli_missing(monkeypatch):
    class _MeloCfg(_FakeCfg):
        practice_tts_provider = "melo_local"

    monkeypatch.setattr(tts_service, "get_config", lambda: _MeloCfg())
    monkeypatch.setattr(tts_service.shutil, "which", lambda _cmd: None)

    try:
        tts_service.synthesize_melo_tts("你好")
    except ValueError as exc:
        assert "MeloTTS" in str(exc)
    else:
        raise AssertionError("expected ValueError for missing melo command")


def test_get_melo_tts_status_reports_availability(monkeypatch):
    class _MeloCfg(_FakeCfg):
        practice_tts_provider = "melo_local"

    monkeypatch.setattr(tts_service, "get_config", lambda: _MeloCfg())
    monkeypatch.setattr(tts_service.shutil, "which", lambda cmd: f"/usr/local/bin/{cmd}" if cmd == "melo" else None)

    status = tts_service.get_melo_tts_status()

    assert status["melo_tts_available"] is True
    assert status["melo_tts_resolved_cmd"].endswith("melo")
