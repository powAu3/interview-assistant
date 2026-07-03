from __future__ import annotations

from pathlib import Path
import importlib
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

replay_script = importlib.import_module("scripts.replay_preflight_stt")


def test_replay_preflight_script_returns_zero_on_all_success(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        replay_script,
        "replay_preflight_capture_stt",
        lambda device_id, repeats=5, gap_sec=0.25, audio_path=None, expected_phrase=None: (
            seen.update(
                {
                    "device_id": device_id,
                    "repeats": repeats,
                    "gap_sec": gap_sec,
                    "audio_path": audio_path,
                    "expected_phrase": expected_phrase,
                }
            )
            or {
                "device_id": device_id,
                "repeats": repeats,
                "gap_sec": gap_sec,
                "failure_count": 0,
            }
        ),
    )
    assert replay_script.main([
        "--device-id", "9",
        "--repeats", "4",
        "--gap-sec", "0.1",
        "--audio-path", "tmp/sample.wav",
        "--expected-phrase", "你好",
    ]) == 0
    assert seen == {
        "device_id": 9,
        "repeats": 4,
        "gap_sec": 0.1,
        "audio_path": "tmp/sample.wav",
        "expected_phrase": "你好",
    }


def test_replay_preflight_script_returns_two_when_failures_present(monkeypatch):
    monkeypatch.setattr(
        replay_script,
        "replay_preflight_capture_stt",
        lambda device_id, repeats=5, gap_sec=0.25, audio_path=None, expected_phrase=None: {
            "device_id": device_id,
            "repeats": repeats,
            "gap_sec": gap_sec,
            "failure_count": 1,
        },
    )
    assert replay_script.main(["--device-id", "9"]) == 2
