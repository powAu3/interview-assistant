from __future__ import annotations

from pathlib import Path
import sys

import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.stt.engines import GenericHTTPSTT
from services.stt import factory as stt_factory


def _patch_broadcast(monkeypatch, calls: list[dict]):
    import sys as _sys
    ws_mod = _sys.modules.get("api.realtime.ws")
    if ws_mod is None:
        import types as _types
        ws_mod = _types.ModuleType("api.realtime.ws")
        _sys.modules["api.realtime.ws"] = ws_mod
    monkeypatch.setattr(ws_mod, "broadcast", lambda data: calls.append(data), raising=False)


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

    calls = {"broadcast": [], "fallback": 0, "circuit_failure": 0}

    monkeypatch.setattr(stt_factory, "get_stt_engine", lambda model_size=None, language=None: _RemoteEngine())
    monkeypatch.setattr(stt_factory, "_is_circuit_open", lambda: False)
    monkeypatch.setattr(stt_factory, "_circuit_record_failure", lambda is_timeout=False, is_auth=False: calls.__setitem__("circuit_failure", calls["circuit_failure"] + 1))
    monkeypatch.setattr(stt_factory, "_circuit_reset", lambda: None)
    monkeypatch.setattr(stt_factory, "_whisper_transcribe", lambda audio, sample_rate, position, language: calls.__setitem__("fallback", calls["fallback"] + 1) or "fallback text")
    monkeypatch.setattr(stt_factory, "_is_whisper_preloaded", lambda: True)
    monkeypatch.setattr(stt_factory, "_is_whisper_engine_loaded", lambda *_args, **_kwargs: True)

    _patch_broadcast(monkeypatch, calls["broadcast"])

    text = stt_factory.transcribe_with_fallback(np.zeros(16000 * 8, dtype=np.float32), 16000)

    assert text == "fallback text"
    assert calls["fallback"] == 1
    assert calls["circuit_failure"] == 1
    assert any(e.get("type") == "stt_fallback" for e in calls["broadcast"])


def test_candidate_remote_fallback_uses_candidate_event_scope(monkeypatch):
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
    monkeypatch.setattr(stt_factory, "_circuit_record_failure", lambda is_timeout=False, is_auth=False: None)
    monkeypatch.setattr(stt_factory, "_circuit_reset", lambda: None)
    monkeypatch.setattr(stt_factory, "_whisper_transcribe", lambda audio, sample_rate, position, language: calls.__setitem__("fallback", calls["fallback"] + 1) or "fallback text")
    monkeypatch.setattr(stt_factory, "_is_whisper_preloaded", lambda: True)
    monkeypatch.setattr(stt_factory, "_is_whisper_engine_loaded", lambda *_args, **_kwargs: True)

    _patch_broadcast(monkeypatch, calls["broadcast"])

    text = stt_factory.transcribe_with_fallback(
        np.zeros(16000 * 8, dtype=np.float32),
        16000,
        provider="generic",
        status_event_type="candidate_asr_status",
        scope="candidate",
    )

    assert text == "fallback text"
    assert any(e.get("type") == "candidate_stt_fallback" and e.get("scope") == "candidate" for e in calls["broadcast"])
    assert not any(e.get("type") == "stt_fallback" for e in calls["broadcast"])


def test_transcribe_with_fallback_reports_remote_provider_after_success(monkeypatch):
    import core.config as core_config
    monkeypatch.setattr(
        core_config,
        "get_config",
        lambda: type("Cfg", (), {"stt_provider": "generic", "whisper_model": "base", "whisper_language": "auto"})(),
    )

    class _RemoteEngine:
        @property
        def is_loaded(self):
            return True

        def transcribe(self, audio, sample_rate=16000, position="", language=""):
            return "remote text"

    broadcasts: list[dict] = []
    monkeypatch.setattr(stt_factory, "get_stt_engine", lambda model_size=None, language=None: _RemoteEngine())
    monkeypatch.setattr(stt_factory, "_is_circuit_open", lambda: False)
    monkeypatch.setattr(stt_factory, "_circuit_reset", lambda: None)
    _patch_broadcast(monkeypatch, broadcasts)

    text = stt_factory.transcribe_with_fallback(np.zeros(16000 * 8, dtype=np.float32), 16000)

    assert text == "remote text"
    assert any(e.get("type") == "stt_status" and e.get("provider") == "generic" and e.get("loaded") is True for e in broadcasts)


def test_transcribe_with_fallback_suppresses_short_empty_remote_audio(monkeypatch):
    import core.config as core_config
    monkeypatch.setattr(
        core_config,
        "get_config",
        lambda: type("Cfg", (), {"stt_provider": "generic", "whisper_model": "base", "whisper_language": "auto"})(),
    )

    class _RemoteEngine:
        def transcribe(self, audio, sample_rate=16000, position="", language=""):
            return ""

    calls = {"fallback": 0, "circuit_failure": 0}
    monkeypatch.setattr(stt_factory, "get_stt_engine", lambda model_size=None, language=None: _RemoteEngine())
    monkeypatch.setattr(stt_factory, "_is_circuit_open", lambda: False)
    monkeypatch.setattr(stt_factory, "_circuit_record_failure", lambda is_timeout=False, is_auth=False: calls.__setitem__("circuit_failure", calls["circuit_failure"] + 1))
    monkeypatch.setattr(stt_factory, "_circuit_reset", lambda: None)
    monkeypatch.setattr(stt_factory, "_whisper_transcribe", lambda audio, sample_rate, position, language: calls.__setitem__("fallback", calls["fallback"] + 1) or "fallback text")
    monkeypatch.setattr(stt_factory, "_is_whisper_preloaded", lambda: True)
    _patch_broadcast(monkeypatch, [])

    text = stt_factory.transcribe_with_fallback(np.zeros(16000 * 2, dtype=np.float32), 16000)

    assert text == ""
    assert calls["fallback"] == 0
    assert calls["circuit_failure"] == 0


def test_transcribe_with_fallback_loads_unready_whisper_before_returning(monkeypatch):
    import core.config as core_config
    monkeypatch.setattr(
        core_config,
        "get_config",
        lambda: type("Cfg", (), {"stt_provider": "generic", "whisper_model": "base", "whisper_language": "auto"})(),
    )

    class _RemoteEngine:
        def transcribe(self, audio, sample_rate=16000, position="", language=""):
            raise RuntimeError("remote failed")

    calls = {"load": 0, "transcribe": 0, "circuit_failure": 0}

    class _FakeWhisper:
        def __init__(self, model_size="base", language="auto"):
            self.model_size = model_size
            self.language = language
            self._loaded = False

        @property
        def is_loaded(self):
            return self._loaded

        @property
        def is_loading(self):
            return False

        def load_model(self):
            calls["load"] += 1
            self._loaded = True

        def transcribe(self, audio, sample_rate=16000, position="", language=""):
            calls["transcribe"] += 1
            return "whisper text"

    broadcasts: list[dict] = []
    monkeypatch.setattr(stt_factory, "get_stt_engine", lambda model_size=None, language=None: _RemoteEngine())
    monkeypatch.setattr(stt_factory, "_is_circuit_open", lambda: False)
    monkeypatch.setattr(stt_factory, "_circuit_record_failure", lambda is_timeout=False, is_auth=False: calls.__setitem__("circuit_failure", calls["circuit_failure"] + 1))
    monkeypatch.setattr(stt_factory, "STTEngine", _FakeWhisper)
    monkeypatch.setattr(stt_factory, "_engine", None)
    monkeypatch.setattr(stt_factory, "_whisper_preload_done", False)
    _patch_broadcast(monkeypatch, broadcasts)

    text = stt_factory.transcribe_with_fallback(np.zeros(16000 * 8, dtype=np.float32), 16000)

    assert text == "whisper text"
    assert calls["load"] == 1
    assert calls["transcribe"] == 1
    assert calls["circuit_failure"] == 1
    assert any(e.get("type") == "stt_status" and e.get("provider") == "whisper" and e.get("loading") is False for e in broadcasts)


def test_whisper_fallback_load_does_not_hold_global_engine_lock(monkeypatch):
    import core.config as core_config

    monkeypatch.setattr(
        core_config,
        "get_config",
        lambda: type("Cfg", (), {"whisper_model": "base", "whisper_language": "auto"})(),
    )

    calls = {"load_saw_lock_free": False}

    class _FakeWhisper:
        def __init__(self, model_size="base", language="auto"):
            self.model_size = model_size
            self.language = language
            self._loaded = False

        @property
        def is_loaded(self):
            return self._loaded

        @property
        def is_loading(self):
            return False

        def load_model(self):
            acquired = stt_factory._engine_lock.acquire(blocking=False)
            if acquired:
                stt_factory._engine_lock.release()
                calls["load_saw_lock_free"] = True
            self._loaded = True

    monkeypatch.setattr(stt_factory, "STTEngine", _FakeWhisper)
    monkeypatch.setattr(stt_factory, "_engine", None)
    monkeypatch.setattr(stt_factory, "_whisper_preload_done", False)

    engine = stt_factory._get_whisper_fallback()

    assert engine.is_loaded is True
    assert calls["load_saw_lock_free"] is True


def test_candidate_partial_whisper_skips_when_inference_lock_busy(monkeypatch):
    import core.config as core_config

    monkeypatch.setattr(
        core_config,
        "get_config",
        lambda: type("Cfg", (), {"stt_provider": "whisper", "whisper_model": "base", "whisper_language": "auto"})(),
    )

    calls = {"transcribe": 0}

    class _FakeWhisper:
        model_size = "base"
        language = "auto"

        @property
        def is_loaded(self):
            return True

        def transcribe(self, audio, sample_rate=16000, position="", language=""):
            calls["transcribe"] += 1
            return "should not run"

    monkeypatch.setattr(stt_factory, "_engine", _FakeWhisper())
    monkeypatch.setattr(stt_factory, "_whisper_engines", {("base", "auto"): stt_factory._engine})
    _patch_broadcast(monkeypatch, [])

    assert stt_factory._whisper_infer_lock.acquire(blocking=False) is True
    try:
        text = stt_factory.transcribe_with_fallback(
            np.zeros(16000, dtype=np.float32),
            16000,
            provider="whisper",
            scope="candidate",
            whisper_lock_timeout_sec=0.0,
            whisper_require_loaded=True,
        )
    finally:
        stt_factory._whisper_infer_lock.release()

    assert text == ""
    assert calls["transcribe"] == 0


def test_candidate_remote_fallback_skips_whisper_when_inference_lock_busy(monkeypatch):
    import core.config as core_config

    monkeypatch.setattr(
        core_config,
        "get_config",
        lambda: type("Cfg", (), {"stt_provider": "generic", "whisper_model": "base", "whisper_language": "auto"})(),
    )

    calls = {"whisper": 0}

    class _RemoteEngine:
        def transcribe(self, audio, sample_rate=16000, position="", language=""):
            return ""

    class _FakeWhisper:
        model_size = "base"
        language = "auto"

        @property
        def is_loaded(self):
            return True

        def transcribe(self, audio, sample_rate=16000, position="", language=""):
            calls["whisper"] += 1
            return "should not run"

    def fake_get_stt_engine(provider=None, model_size=None, language=None):
        if provider == "whisper":
            return _FakeWhisper()
        return _RemoteEngine()

    monkeypatch.setattr(stt_factory, "get_stt_engine", fake_get_stt_engine)
    monkeypatch.setattr(stt_factory, "_is_circuit_open", lambda: False)
    monkeypatch.setattr(stt_factory, "_circuit_record_failure", lambda is_timeout=False, is_auth=False: None)
    monkeypatch.setattr(stt_factory, "_circuit_reset", lambda: None)
    monkeypatch.setattr(stt_factory, "_is_whisper_engine_loaded", lambda *_args, **_kwargs: True)
    _patch_broadcast(monkeypatch, [])

    assert stt_factory._whisper_infer_lock.acquire(blocking=False) is True
    try:
        text = stt_factory.transcribe_with_fallback(
            np.zeros(16000 * 8, dtype=np.float32),
            16000,
            provider="generic",
            scope="candidate",
            whisper_lock_timeout_sec=0.0,
        )
    finally:
        stt_factory._whisper_infer_lock.release()

    assert text == ""
    assert calls["whisper"] == 0


def test_whisper_language_cache_does_not_keep_stale_alias(monkeypatch):
    import core.config as core_config

    cfg = type(
        "Cfg",
        (),
        {"stt_provider": "whisper", "whisper_model": "base", "whisper_language": "auto"},
    )()
    monkeypatch.setattr(core_config, "get_config", lambda: cfg)

    class _FakeWhisper:
        def __init__(self, model_size="base", language="auto"):
            self.model_size = model_size
            self.language = language

        @property
        def is_loaded(self):
            return False

    monkeypatch.setattr(stt_factory, "STTEngine", _FakeWhisper)
    monkeypatch.setattr(stt_factory, "_engine", None)
    monkeypatch.setattr(stt_factory, "_whisper_engines", {})

    old_auto = stt_factory.get_stt_engine(provider="whisper", model_size="base", language="auto")
    cfg.whisper_language = "zh"
    stt_factory.set_whisper_language("zh")

    explicit_auto = stt_factory.get_stt_engine(provider="whisper", model_size="base", language="auto")
    explicit_zh = stt_factory.get_stt_engine(provider="whisper", model_size="base", language="zh")

    assert explicit_zh is old_auto
    assert explicit_zh.language == "zh"
    assert explicit_auto is not old_auto
    assert explicit_auto.language == "auto"


def test_whisper_engine_cache_reuses_same_asr_and_splits_different_asr(monkeypatch):
    import core.config as core_config

    cfg = type(
        "Cfg",
        (),
        {"stt_provider": "whisper", "whisper_model": "base", "whisper_language": "auto"},
    )()
    monkeypatch.setattr(core_config, "get_config", lambda: cfg)

    class _FakeWhisper:
        def __init__(self, model_size="base", language="auto"):
            self.model_size = model_size
            self.language = language

        @property
        def is_loaded(self):
            return False

    monkeypatch.setattr(stt_factory, "STTEngine", _FakeWhisper)
    monkeypatch.setattr(stt_factory, "_engine", None)
    monkeypatch.setattr(stt_factory, "_whisper_engines", {})

    interviewer = stt_factory.get_stt_engine(provider="whisper", model_size="base", language="auto")
    candidate_same = stt_factory.get_stt_engine(provider="whisper", model_size="base", language="auto")
    candidate_different = stt_factory.get_stt_engine(provider="whisper", model_size="tiny", language="en")

    assert candidate_same is interviewer
    assert candidate_different is not interviewer
    assert candidate_different.model_size == "tiny"
    assert candidate_different.language == "en"
