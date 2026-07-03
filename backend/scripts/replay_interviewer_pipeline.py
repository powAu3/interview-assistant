"""
Replay audio through the full interviewer pipeline:
raw capture -> VAD -> segment queue -> ASR worker -> published transcription.

Usage:
    python -m scripts.replay_interviewer_pipeline --device-id 20002 --repeats 3
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.assist.pipeline import (  # noqa: E402
    get_interviewer_runtime_snapshot,
    start_nonblocking,
    stop_interview_loop,
)
from api.assist.sound_test import PREFLIGHT_AUDIO_PATH, match_phrase, play_audio_fixture  # noqa: E402
from core.config import get_config, update_config  # noqa: E402
from core.session import get_session, reset_session  # noqa: E402


def _load_replay_manifest(manifest_path: str | Path | None) -> dict[str, Any]:
    if not manifest_path:
        return {}
    path = Path(manifest_path).resolve()
    return json.loads(path.read_text(encoding="utf-8"))


@contextlib.contextmanager
def _temporary_replay_pipeline_config(*, isolate_answers: bool):
    if not isolate_answers:
        yield
        return

    cfg = get_config()
    original = {
        "auto_detect": bool(getattr(cfg, "auto_detect", True)),
        "assist_stop_answer_wait_sec": float(getattr(cfg, "assist_stop_answer_wait_sec", 3.0) or 0.0),
    }
    update_config({
        "auto_detect": False,
        "assist_stop_answer_wait_sec": 0.0,
    })
    try:
        yield
    finally:
        update_config(original)


def run_interviewer_pipeline_replay(
    device_id: int,
    *,
    repeats: int = 3,
    gap_sec: float = 0.25,
    audio_path: str | Path | None = None,
    expected_phrase: str = "",
    settle_sec: float = 3.0,
    isolate_answers: bool = True,
    min_transcript_count: int = 1,
    min_segment_emitted: int = 1,
) -> dict:
    target_audio = Path(audio_path) if audio_path else PREFLIGHT_AUDIO_PATH
    target_phrase = (expected_phrase or "请介绍一下你最近做过的项目").strip()
    rounds: list[dict] = []
    normalized_repeats = max(1, min(20, int(repeats or 1)))
    normalized_gap_sec = max(0.0, min(2.0, float(gap_sec or 0.0)))
    normalized_settle_sec = max(0.5, min(20.0, float(settle_sec or 0.0)))
    normalized_min_transcript_count = max(1, min(20, int(min_transcript_count or 1)))
    normalized_min_segment_emitted = max(1, min(20, int(min_segment_emitted or 1)))

    with _temporary_replay_pipeline_config(isolate_answers=isolate_answers):
        for idx in range(normalized_repeats):
            reset_session()
            round_started = time.monotonic()
            start_nonblocking(int(device_id))
            playback_sec = 0.0
            try:
                time.sleep(0.35)
                playback_sec = play_audio_fixture(target_audio)
                time.sleep(normalized_settle_sec)
            finally:
                stop_interview_loop()

            session = get_session()
            transcript = "\n".join(session.transcription_history).strip()
            transcript_count = len(session.transcription_history)
            qa_summaries = [
                {
                    "id": getattr(qa, "id", ""),
                    "question": getattr(qa, "question", ""),
                    "answer_len": len(getattr(qa, "answer", "") or ""),
                    "model_name": getattr(qa, "model_name", "") or "",
                    "source": getattr(qa, "source", "") or "",
                }
                for qa in getattr(session, "qa_pairs", [])
            ]
            ok, detail = match_phrase(target_phrase, transcript)
            if transcript_count < normalized_min_transcript_count:
                ok = False
                detail = (
                    f"{detail}；转写条数不足（期望至少 {normalized_min_transcript_count}，实际 {transcript_count}）"
                )
            runtime_snapshot = get_interviewer_runtime_snapshot() or {}
            segment_emitted = int(runtime_snapshot.get("segment_emitted", 0) or 0)
            rounds.append(
                {
                    "round": idx + 1,
                    "ok": ok,
                    "detail": detail,
                    "playback_sec": playback_sec,
                    "total_ms": int((time.monotonic() - round_started) * 1000),
                    "transcript_count": transcript_count,
                    "transcript": transcript,
                    "qa_count": len(qa_summaries),
                    "answer_models": sorted(
                        {
                            item["model_name"]
                            for item in qa_summaries
                            if item.get("model_name")
                        }
                    ),
                    "qa_pairs": qa_summaries,
                    "runtime": runtime_snapshot,
                }
            )
            if segment_emitted < normalized_min_segment_emitted:
                rounds[-1]["ok"] = False
                rounds[-1]["detail"] = (
                    f'{rounds[-1]["detail"]}；segment 数不足（期望至少 {normalized_min_segment_emitted}，实际 {segment_emitted}）'
                )
            if idx + 1 < normalized_repeats and normalized_gap_sec > 0:
                time.sleep(normalized_gap_sec)

    success_count = sum(1 for item in rounds if item["ok"])
    total_values = [int(item.get("total_ms", 0)) for item in rounds if int(item.get("total_ms", 0)) > 0]
    runtime_raw_drop_values = [
        int((item.get("runtime") or {}).get("raw_queue_drop_count", 0))
        for item in rounds
    ]
    runtime_segment_drop_values = [
        int((item.get("runtime") or {}).get("segment_dropped", 0))
        for item in rounds
    ]
    runtime_max_depth_values = [
        int((item.get("runtime") or {}).get("max_observed_segment_queue_depth", 0))
        for item in rounds
    ]
    runtime_discontinuity_values = [
        int((item.get("runtime") or {}).get("loopback_discontinuity_count", 0))
        for item in rounds
    ]
    runtime_max_raw_chunk_values = [
        int((item.get("runtime") or {}).get("max_raw_chunk_samples", 0))
        for item in rounds
    ]
    drain_timeout_count = sum(
        1
        for item in rounds
        if bool((item.get("runtime") or {}).get("drain_timed_out", False))
    )
    qa_count_values = [int(item.get("qa_count", 0) or 0) for item in rounds]
    answer_model_values = sorted(
        {
            str(model)
            for item in rounds
            for model in (item.get("answer_models") or [])
            if str(model).strip()
        }
    )
    return {
        "device_id": int(device_id),
        "repeats": normalized_repeats,
        "success_count": success_count,
        "failure_count": len(rounds) - success_count,
        "audio_path": str(target_audio),
        "expected_phrase": target_phrase,
        "isolate_answers": bool(isolate_answers),
        "min_transcript_count": normalized_min_transcript_count,
        "min_segment_emitted": normalized_min_segment_emitted,
        "summary": {
            "avg_total_ms": int(sum(total_values) / len(total_values)) if total_values else 0,
            "max_total_ms": max(total_values) if total_values else 0,
            "max_qa_count": max(qa_count_values) if qa_count_values else 0,
            "answer_models": answer_model_values,
            "max_raw_queue_drop_count": max(runtime_raw_drop_values) if runtime_raw_drop_values else 0,
            "max_segment_dropped": max(runtime_segment_drop_values) if runtime_segment_drop_values else 0,
            "max_segment_queue_depth": max(runtime_max_depth_values) if runtime_max_depth_values else 0,
            "max_loopback_discontinuity_count": max(runtime_discontinuity_values) if runtime_discontinuity_values else 0,
            "max_raw_chunk_samples": max(runtime_max_raw_chunk_values) if runtime_max_raw_chunk_values else 0,
            "drain_timeout_count": drain_timeout_count,
        },
        "rounds": rounds,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replay audio through the full interviewer pipeline.")
    parser.add_argument("--device-id", type=int, required=True, help="Loopback capture device id.")
    parser.add_argument("--repeats", type=int, default=3, help="How many rounds to run.")
    parser.add_argument("--gap-sec", type=float, default=0.25, help="Gap between rounds.")
    parser.add_argument("--audio-path", type=str, default="", help="Optional WAV file to play.")
    parser.add_argument("--manifest-path", type=str, default="", help="Optional JSON manifest generated alongside a replay WAV fixture.")
    parser.add_argument("--expected-phrase", type=str, default="", help="Expected transcript for matching.")
    parser.add_argument("--settle-sec", type=float, default=3.0, help="Wait after playback before stopping.")
    parser.add_argument("--min-transcript-count", type=int, default=1, help="Minimum expected published transcript count per round.")
    parser.add_argument("--min-segment-emitted", type=int, default=1, help="Minimum expected emitted interviewer segment count per round.")
    parser.add_argument(
        "--no-isolate-answers",
        action="store_true",
        help="Keep auto-detect/answer workers enabled during replay.",
    )
    args = parser.parse_args(argv)
    manifest = _load_replay_manifest(args.manifest_path or None)
    manifest_audio_path = manifest.get("audio_path") if isinstance(manifest, dict) else None
    manifest_expected = ""
    if isinstance(manifest, dict):
        expected_phrases = manifest.get("expected_phrases") or []
        if expected_phrases:
            manifest_expected = "\n".join(str(item) for item in expected_phrases if str(item).strip())
    manifest_settle_sec = float(manifest.get("recommended_settle_sec", 0.0) or 0.0) if isinstance(manifest, dict) else 0.0
    manifest_min_transcript_count = int(manifest.get("min_transcript_count", 1) or 1) if isinstance(manifest, dict) else 1
    manifest_min_segment_emitted = int(manifest.get("min_segment_emitted", 1) or 1) if isinstance(manifest, dict) else 1

    result = run_interviewer_pipeline_replay(
        args.device_id,
        repeats=args.repeats,
        gap_sec=args.gap_sec,
        audio_path=args.audio_path or manifest_audio_path or None,
        expected_phrase=args.expected_phrase or manifest_expected or "",
        settle_sec=args.settle_sec if args.settle_sec != 3.0 or not manifest_settle_sec else manifest_settle_sec,
        isolate_answers=not bool(args.no_isolate_answers),
        min_transcript_count=(
            args.min_transcript_count
            if args.min_transcript_count != 1 or not manifest_min_transcript_count
            else manifest_min_transcript_count
        ),
        min_segment_emitted=(
            args.min_segment_emitted
            if args.min_segment_emitted != 1 or not manifest_min_segment_emitted
            else manifest_min_segment_emitted
        ),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("failure_count", 0) == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
