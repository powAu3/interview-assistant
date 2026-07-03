"""
Run the full audio validation stack:
1. high-frequency capture+remote STT preflight
2. complex interviewer full-pipeline replay suite

Usage:
    python -m scripts.run_audio_validation_suite --device-id 20002
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.assist.sound_test import PREFLIGHT_EXPECTED_PHRASE, replay_preflight_capture_stt  # noqa: E402
from scripts.run_interviewer_replay_suite import run_replay_suite  # noqa: E402


def run_audio_validation_suite(
    device_id: int,
    *,
    preflight_repeats: int = 8,
    preflight_gap_sec: float = 0.08,
    replay_repeats: int = 3,
    replay_gap_sec: float = 0.1,
    isolate_answers: bool = True,
) -> dict:
    preflight = replay_preflight_capture_stt(
        int(device_id),
        repeats=preflight_repeats,
        gap_sec=preflight_gap_sec,
        expected_phrase=PREFLIGHT_EXPECTED_PHRASE,
    )
    replay_suite = run_replay_suite(
        int(device_id),
        repeats=replay_repeats,
        gap_sec=replay_gap_sec,
        isolate_answers=isolate_answers,
    )
    preflight_failures = int(preflight.get("failure_count", 0))
    replay_failures = int(replay_suite.get("failure_rounds", 0))
    return {
        "device_id": int(device_id),
        "preflight": preflight,
        "replay_suite": replay_suite,
        "summary": {
            "preflight_failure_count": preflight_failures,
            "replay_failure_rounds": replay_failures,
            "total_failure_count": preflight_failures + replay_failures,
            "preflight_success_count": int(preflight.get("success_count", 0)),
            "replay_success_rounds": int(replay_suite.get("success_rounds", 0)),
            "max_raw_queue_drop_count": int(replay_suite.get("summary", {}).get("max_raw_queue_drop_count", 0)),
            "max_segment_dropped": int(replay_suite.get("summary", {}).get("max_segment_dropped", 0)),
            "max_loopback_discontinuity_count": int(
                replay_suite.get("summary", {}).get("max_loopback_discontinuity_count", 0)
            ),
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the full audio validation suite.")
    parser.add_argument("--device-id", type=int, required=True, help="Loopback capture device id.")
    parser.add_argument("--preflight-repeats", type=int, default=8, help="Replay rounds for capture+STT preflight.")
    parser.add_argument("--preflight-gap-sec", type=float, default=0.08, help="Gap between preflight rounds.")
    parser.add_argument("--replay-repeats", type=int, default=3, help="Replay rounds per interviewer scenario.")
    parser.add_argument("--replay-gap-sec", type=float, default=0.1, help="Gap between interviewer replay rounds.")
    parser.add_argument(
        "--no-isolate-answers",
        action="store_true",
        help="Keep auto-detect/answer workers enabled during interviewer replay.",
    )
    args = parser.parse_args(argv)

    result = run_audio_validation_suite(
        args.device_id,
        preflight_repeats=args.preflight_repeats,
        preflight_gap_sec=args.preflight_gap_sec,
        replay_repeats=args.replay_repeats,
        replay_gap_sec=args.replay_gap_sec,
        isolate_answers=not bool(args.no_isolate_answers),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if int(result.get("summary", {}).get("total_failure_count", 0)) == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
