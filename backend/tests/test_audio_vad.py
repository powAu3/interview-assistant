from __future__ import annotations

from pathlib import Path
import sys

import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.audio import VADBuffer
from services.audio import _audio_device_sort_key


def test_vad_flushes_when_max_speech_duration_reached():
    vad = VADBuffer(
        sample_rate=10,
        silence_threshold=0.01,
        silence_duration=99.0,
        min_speech_duration=0.1,
        max_speech_duration=0.5,
    )

    result = vad.feed(np.ones(5, dtype=np.float32) * 0.1)

    assert result is not None
    assert len(result) == 5


def test_audio_device_sort_keeps_default_loopback_first():
    devices = [
        {"id": 1, "name": "Alpha Mic", "is_loopback": False},
        {"id": 20001, "name": "ZZZ Speakers (system audio)", "is_loopback": True, "is_default_output": True},
        {"id": 20000, "name": "AAA Monitor (system audio)", "is_loopback": True, "is_default_output": False},
    ]

    ordered = sorted(devices, key=_audio_device_sort_key)

    assert [item["id"] for item in ordered] == [20001, 20000, 1]
