"""
Replay the built-in preflight audio multiple times through a real capture device.

Usage:
    python -m scripts.replay_preflight_stt --device-id 20000 --repeats 8 --gap-sec 0.2
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.assist.sound_test import replay_preflight_capture_stt  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replay preflight audio and validate STT repeatedly.")
    parser.add_argument("--device-id", type=int, required=True, help="Capture device id used for loopback/mic test.")
    parser.add_argument("--repeats", type=int, default=5, help="How many replay rounds to run.")
    parser.add_argument("--gap-sec", type=float, default=0.25, help="Gap between replay rounds.")
    parser.add_argument("--audio-path", type=str, default="", help="Optional WAV file to play instead of the built-in preflight phrase.")
    parser.add_argument("--expected-phrase", type=str, default="", help="Expected transcript used for matching.")
    args = parser.parse_args(argv)

    result = replay_preflight_capture_stt(
        args.device_id,
        repeats=args.repeats,
        gap_sec=args.gap_sec,
        audio_path=args.audio_path or None,
        expected_phrase=args.expected_phrase or None,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("failure_count", 0) == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
