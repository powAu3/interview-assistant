from __future__ import annotations

from pathlib import Path
import importlib
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

suite_script = importlib.import_module("scripts.run_audio_validation_suite")


def test_run_audio_validation_suite_combines_preflight_and_replay(monkeypatch):
    monkeypatch.setattr(
        suite_script,
        "replay_preflight_capture_stt",
        lambda device_id, repeats=8, gap_sec=0.08, expected_phrase=None: {
            "success_count": 8,
            "failure_count": 0,
        },
    )
    monkeypatch.setattr(
        suite_script,
        "run_replay_suite",
        lambda device_id, repeats=3, gap_sec=0.1, isolate_answers=True: {
            "success_rounds": 6,
            "failure_rounds": 0,
            "summary": {
                "max_raw_queue_drop_count": 0,
                "max_segment_dropped": 0,
                "max_loopback_discontinuity_count": 0,
            },
        },
    )

    result = suite_script.run_audio_validation_suite(20002)

    assert result["summary"]["total_failure_count"] == 0
    assert result["summary"]["preflight_success_count"] == 8
    assert result["summary"]["replay_success_rounds"] == 6
