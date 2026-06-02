from __future__ import annotations

from pathlib import Path
import importlib
import sys
import time
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


def test_input_audio_returns_level_metrics(monkeypatch: pytest.MonkeyPatch):
    starts: list[tuple[int, str | None, dict]] = []
    stops: list[str | None] = []

    class FakeCapture:
        def start(self, device_id, owner=None, **kwargs):
            starts.append((device_id, owner, kwargs))

        def stop(self, owner=None):
            stops.append(owner)

        @staticmethod
        def compute_energy(audio):
            return float(np.sqrt(np.mean(audio ** 2)))

    monkeypatch.setattr(sound_test, 'AudioCapture', FakeCapture)
    monkeypatch.setattr(sound_test.time, 'sleep', lambda _: None)
    monkeypatch.setattr(
        sound_test,
        'collect_capture_audio',
        lambda cap, duration_sec, poll_interval=0.05: np.array([0.0, 0.02, -0.04], dtype=np.float32),
    )

    result = sound_test.test_input_audio(7, duration_sec=0.8)

    assert result['ok'] is True
    assert result['device_id'] == 7
    assert result['has_signal'] is True
    assert result['rms'] > 0
    assert result['peak'] == pytest.approx(0.04)
    assert starts == [(7, 'audio-test', {'mic_compatibility_mode': True})]
    assert stops == ['audio-test']


def test_input_level_monitor_updates_until_stopped(monkeypatch: pytest.MonkeyPatch):
    starts: list[tuple[int, str | None, dict]] = []
    stops: list[str | None] = []

    class FakeCapture:
        def start(self, device_id, owner=None, **kwargs):
            starts.append((device_id, owner, kwargs))

        def stop(self, owner=None):
            stops.append(owner)

        def get_audio_chunk(self, max_chunks=None):
            return np.array([0.0, 0.03, -0.05], dtype=np.float32)

        @staticmethod
        def compute_energy(audio):
            return float(np.sqrt(np.mean(audio ** 2)))

    monkeypatch.setattr(sound_test, 'AudioCapture', FakeCapture)

    sound_test.start_input_level_monitor(9)
    deadline = time.monotonic() + 1.0
    status = sound_test.get_input_level_status()
    while time.monotonic() < deadline and status['level_pct'] <= 0:
        time.sleep(0.02)
        status = sound_test.get_input_level_status()
    stopped = sound_test.stop_input_level_monitor()

    assert starts == [(9, 'audio-level-test', {'mic_compatibility_mode': True})]
    assert stops == ['audio-level-test']
    assert status['level_pct'] > 0
    assert status['has_signal'] is True
    assert stopped['running'] is False


def test_resolve_preflight_scenario_falls_back_to_recommended(monkeypatch: pytest.MonkeyPatch):
    scenarios = [
        {"id": "a", "label": "A", "question": "A", "recommended": False},
        {"id": "b", "label": "B", "question": "B", "recommended": True},
    ]
    monkeypatch.setattr(sound_test, 'PREFLIGHT_SCENARIOS', scenarios)

    assert sound_test.resolve_preflight_scenario('a') is scenarios[0]
    assert sound_test.resolve_preflight_scenario('missing') is scenarios[1]


def test_run_preflight_updates_status_and_completes(monkeypatch: pytest.MonkeyPatch):
    events: list[dict] = []
    llm_questions: list[str] = []
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

    cfg = SimpleNamespace(stt_provider='whisper', get_active_model=lambda: SimpleNamespace(name='demo', model='demo-model'))
    monkeypatch.setattr(sound_test, 'get_config', lambda: cfg)
    monkeypatch.setattr(sound_test, 'AudioCapture', FakeCapture)
    monkeypatch.setattr(sound_test, 'get_stt_engine', lambda: FakeEngine())
    monkeypatch.setattr(
        sound_test,
        'generate_preflight_answer',
        lambda cfg, model_cfg, question: (
            llm_questions.append(question)
            or {'answer': '真实答题链路回答', 'first_token_ms': 120, 'total_ms': 880}
        ),
    )

    sound_test._run_preflight(1, 'self_intro')

    status = sound_test.get_preflight_status()
    assert status['running'] is False
    assert status['captured_transcript'] == sound_test.PREFLIGHT_EXPECTED_PHRASE
    assert status['match_ok'] is True
    assert llm_questions == [sound_test.PREFLIGHT_EXPECTED_PHRASE]
    assert any(e.get('step') == 'playback' for e in events)
    assert any(e.get('step') == 'done' for e in events)
    assert any(e.get('type') == 'preflight_step' for e in events)


def test_generate_preflight_answer_uses_real_answer_pipeline(monkeypatch: pytest.MonkeyPatch):
    calls: dict = {}
    cfg = SimpleNamespace(screen_capture_region='left_half')
    model_cfg = SimpleNamespace(name='demo', model='demo-model', supports_vision=False)

    def fake_build_system_prompt(**kwargs):
        calls['prompt_kwargs'] = kwargs
        return 'system-prompt'

    def fake_stream(model, messages, system_prompt=None, **kwargs):
        calls['model'] = model
        calls['messages'] = messages
        calls['system_prompt'] = system_prompt
        yield ('think', 'internal reasoning')
        yield ('text', '真实')
        yield ('text', '回答')

    def fake_postprocess(text, mode):
        calls['postprocess'] = (text, mode)
        return text

    monkeypatch.setattr(sound_test, 'build_system_prompt', fake_build_system_prompt)
    monkeypatch.setattr(sound_test, 'chat_stream_single_model', fake_stream)
    monkeypatch.setattr(sound_test, 'postprocess_answer_for_mode', fake_postprocess)
    ticks = iter([10.0, 10.4, 10.9])
    monkeypatch.setattr(sound_test.time, 'monotonic', lambda: next(ticks))

    result = sound_test.generate_preflight_answer(cfg, model_cfg, '请做一下自我介绍')

    assert result == {'answer': '真实回答', 'first_token_ms': 400, 'total_ms': 900}
    assert calls['prompt_kwargs']['manual_input'] is True
    assert calls['prompt_kwargs']['mode'] == sound_test.PROMPT_MODE_MANUAL_TEXT
    assert calls['model'] is model_cfg
    assert calls['messages'] == [{'role': 'user', 'content': '请做一下自我介绍'}]
    assert calls['system_prompt'] == 'system-prompt'
    assert calls['postprocess'] == ('真实回答', sound_test.PROMPT_MODE_MANUAL_TEXT)
