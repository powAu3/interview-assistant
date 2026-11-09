from __future__ import annotations

import asyncio
import importlib
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
main = importlib.import_module('main')


@pytest.mark.parametrize(('provider', 'preload', 'expected'), [
    ('funasr', False, True),
    ('whisper', False, False),
    ('whisper', True, True),
])
def test_packaged_start_restores_selected_funasr(monkeypatch, provider, preload, expected):
    from core.config import AppConfig
    import services.storage.resume_history as resume
    import services.stt.factory as factory

    cfg = AppConfig(stt_provider=provider, whisper_preload=preload)
    engine = SimpleNamespace(is_loaded=False)
    loads = []
    def load():
        loads.append(provider)
        engine.is_loaded = True
    engine.load_model = load
    monkeypatch.setenv('IA_STT_LAZY_START', '1')
    monkeypatch.setattr(main, 'get_config', lambda: cfg)
    monkeypatch.setattr(main, 'get_stt_engine', lambda: engine)
    monkeypatch.setattr(main, 'init_auth', lambda: '')
    monkeypatch.setattr(main, 'is_auth_disabled', lambda: True)
    monkeypatch.setattr(main.ws, 'broadcast', lambda *a, **k: None)
    monkeypatch.setattr(main.ws, 'init_broadcast', lambda *a: None)
    monkeypatch.setattr(factory, 'preload_whisper_fallback', lambda: None)
    monkeypatch.setattr(resume, 'restore_active_resume', lambda: False)
    for name in ['init_background_workers', 'preload_candidate_asr_if_enabled', 'stop_interview_loop', 'shutdown_background_workers']:
        monkeypatch.setattr(main.assist, name, lambda: None)
    class ImmediateThread:
        def __init__(self, target, **kwargs):
            self.target = target
        def start(self):
            self.target()
    monkeypatch.setattr(main.threading, 'Thread', ImmediateThread)
    async def run():
        async with main.lifespan(main.app):
            assert engine.is_loaded is expected
    asyncio.run(run())
    assert len(loads) == int(expected)
