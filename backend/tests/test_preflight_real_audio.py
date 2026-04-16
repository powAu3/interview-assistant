from __future__ import annotations

from pathlib import Path
import importlib
import sys
from types import SimpleNamespace

import numpy as np
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

sound_test = importlib.import_module('api.assist.sound_test')


def test_normalize_phrase_strips_punctuation_and_spaces():
    assert sound_test.normalize_phrase(' 请 介绍一下，你最近做过的项目！ ') == '请介绍一下你最近做过的项目'


def test_phrase_match_accepts_expected_substring():
    ok, detail = sound_test.match_phrase('请介绍一下你最近做过的项目', '请介绍一下你最近做过的项目。')
    assert ok is True
    assert '识别匹配' in detail


def test_phrase_match_rejects_mismatch():
    ok, detail = sound_test.match_phrase('请介绍一下你最近做过的项目', '今天天气很好')
    assert ok is False
    assert '未匹配' in detail


def test_collect_capture_audio_merges_chunks(monkeypatch: pytest.MonkeyPatch):
    chunks = [np.ones(3, dtype=np.float32), np.ones(2, dtype=np.float32), None]
    now = {'v': 0.0}

    def fake_monotonic():
        now['v'] += 0.06
        return now['v']

    monkeypatch.setattr(sound_test.time, 'sleep', lambda _: None)
    monkeypatch.setattr(sound_test.time, 'monotonic', fake_monotonic)

    class FakeCapture:
        def get_audio_chunk(self):
            return chunks.pop(0) if chunks else None

    merged = sound_test.collect_capture_audio(FakeCapture(), duration_sec=0.2, poll_interval=0.05)
    assert merged is not None
    assert len(merged) == 5


def test_run_preflight_updates_status_and_completes(monkeypatch: pytest.MonkeyPatch):
    events: list[dict] = []
    monkeypatch.setattr(sound_test, 'broadcast', lambda data: events.append(data))
    monkeypatch.setattr(sound_test, 'play_preflight_audio', lambda: 1.0)
    monkeypatch.setattr(sound_test, 'collect_capture_audio', lambda cap, duration_sec, poll_interval=0.05: np.ones(1600, dtype=np.float32) * 0.1)
    monkeypatch.setattr(sound_test, 'match_phrase', lambda expected, actual: (True, '识别匹配'))

    class FakeCapture:
        SAMPLE_RATE = 16000

        def start(self, device_id):
            self.device_id = device_id
        def stop(self):
            return None
        @staticmethod
        def compute_energy(audio):
            return 0.1

    class FakeEngine:
        def transcribe(self, audio, sample_rate=16000):
            return sound_test.PREFLIGHT_EXPECTED_PHRASE

    class FakeClient:
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='ok'))])

    cfg = SimpleNamespace(stt_provider='whisper', get_active_model=lambda: SimpleNamespace(name='demo', model='demo-model'))
    monkeypatch.setattr(sound_test, 'get_config', lambda: cfg)
    monkeypatch.setattr(sound_test, 'AudioCapture', FakeCapture)
    monkeypatch.setattr(sound_test, 'get_stt_engine', lambda: FakeEngine())
    monkeypatch.setattr(sound_test, 'get_client', lambda: FakeClient())

    sound_test._run_preflight(1, 'self_intro')

    status = sound_test.get_preflight_status()
    assert status['running'] is False
    assert status['captured_transcript'] == sound_test.PREFLIGHT_EXPECTED_PHRASE
    assert status['match_ok'] is True
    assert any(e.get('step') == 'playback' for e in events)
    assert any(e.get('step') == 'done' for e in events)
    assert any(e.get('type') == 'preflight_step' for e in events)
