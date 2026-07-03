"""
Generate and run a batch of interviewer replay scenarios, then summarize health.

Usage:
    python -m scripts.run_interviewer_replay_suite --device-id 20002 --repeats 3
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.generate_interviewer_mix_fixture import DEFAULT_VOICE_NAME, SCENARIOS, main as generate_fixture_main  # noqa: E402
from scripts.replay_interviewer_pipeline import run_interviewer_pipeline_replay  # noqa: E402
from core.config import get_config, update_config  # noqa: E402


@contextlib.contextmanager
def _temporary_stt_provider(provider: str):
    selected = (provider or "").strip()
    if not selected:
        yield
        return
    cfg = get_config()
    original = {
        "stt_provider": getattr(cfg, "stt_provider", "whisper"),
        "whisper_preload": bool(getattr(cfg, "whisper_preload", False)),
        "assist_interviewer_asr_drain_timeout_sec": float(
            getattr(cfg, "assist_interviewer_asr_drain_timeout_sec", 6.0) or 6.0
        ),
    }
    updates = {"stt_provider": selected}
    if selected == "whisper":
        updates["whisper_preload"] = False
        updates["assist_interviewer_asr_drain_timeout_sec"] = max(
            12.0,
            float(getattr(cfg, "assist_interviewer_asr_drain_timeout_sec", 6.0) or 6.0),
        )
    update_config(updates)
    try:
        yield
    finally:
        update_config(original)


def _find_model_index_by_name(model_name: str) -> int | None:
    target = (model_name or "").strip().lower()
    if not target:
        return None
    cfg = get_config()
    for idx, model in enumerate(cfg.models):
        name = (getattr(model, "name", "") or "").strip().lower()
        model_id = (getattr(model, "model", "") or "").strip().lower()
        if target == name or target == model_id:
            return idx
    for idx, model in enumerate(cfg.models):
        label = f"{getattr(model, 'name', '')} {getattr(model, 'model', '')}".lower()
        if target in label:
            return idx
    return None


@contextlib.contextmanager
def _temporary_answer_runtime(
    *,
    answer_model_name: str = "",
    max_parallel_answers: int | None = None,
    answer_wait_sec: float | None = None,
):
    updates: dict[str, object] = {}
    cfg = get_config()
    original = {
        "active_model": int(getattr(cfg, "active_model", 0) or 0),
        "max_parallel_answers": int(getattr(cfg, "max_parallel_answers", 2) or 2),
        "assist_stop_answer_wait_sec": float(getattr(cfg, "assist_stop_answer_wait_sec", 3.0)),
    }
    model_idx = _find_model_index_by_name(answer_model_name)
    if answer_model_name and model_idx is None:
        raise RuntimeError(f"找不到 answer model: {answer_model_name}")
    if model_idx is not None:
        updates["active_model"] = model_idx
    if max_parallel_answers is not None:
        updates["max_parallel_answers"] = max(1, min(8, int(max_parallel_answers)))
    if answer_wait_sec is not None:
        updates["assist_stop_answer_wait_sec"] = max(0.0, min(20.0, float(answer_wait_sec)))
    if not updates:
        yield
        return
    update_config(updates)
    try:
        yield
    finally:
        update_config(original)


def run_replay_suite(
    device_id: int,
    *,
    repeats: int = 3,
    gap_sec: float = 0.12,
    isolate_answers: bool = True,
    scenario_ids: list[str] | None = None,
    stt_provider: str = "",
    answer_model_name: str = "",
    max_parallel_answers: int | None = None,
    answer_wait_sec: float | None = None,
) -> dict:
    backend_dir = Path(__file__).resolve().parent.parent
    tmp_dir = backend_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    selected_ids = scenario_ids or list(SCENARIOS.keys())
    suite_results: list[dict] = []
    effective_provider = (stt_provider or getattr(get_config(), "stt_provider", "") or "").strip()
    effective_answer_model = ""
    effective_max_parallel = int(getattr(get_config(), "max_parallel_answers", 2) or 2)

    with _temporary_stt_provider(stt_provider), _temporary_answer_runtime(
        answer_model_name=answer_model_name,
        max_parallel_answers=max_parallel_answers,
        answer_wait_sec=answer_wait_sec,
    ):
        cfg = get_config()
        effective_provider = (stt_provider or getattr(get_config(), "stt_provider", "") or "").strip()
        effective_answer_model = getattr(cfg.models[int(getattr(cfg, "active_model", 0) or 0)], "name", "")
        effective_max_parallel = int(getattr(cfg, "max_parallel_answers", 2) or 2)
        for scenario_id in selected_ids:
            wav_path = tmp_dir / f"{scenario_id}.wav"
            generate_fixture_main([
                "--scenario",
                scenario_id,
                "--out",
                str(wav_path),
                "--voice",
                DEFAULT_VOICE_NAME,
            ])
            manifest_path = wav_path.with_suffix(".json")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            expected_phrase = "\n".join(manifest.get("expected_phrases") or [])
            result = run_interviewer_pipeline_replay(
                int(device_id),
                repeats=repeats,
                gap_sec=gap_sec,
                audio_path=manifest.get("audio_path") or str(wav_path),
                expected_phrase=expected_phrase,
                settle_sec=float(manifest.get("recommended_settle_sec", 6.0) or 6.0),
                isolate_answers=isolate_answers,
                min_transcript_count=int(manifest.get("min_transcript_count", 1) or 1),
                min_segment_emitted=int(manifest.get("min_segment_emitted", 1) or 1),
            )
            suite_results.append(
                {
                    "scenario_id": scenario_id,
                    "manifest_path": str(manifest_path),
                    "stt_provider": effective_provider,
                    "answer_model": effective_answer_model,
                    "result": result,
                }
            )

    failure_count = sum(int(item["result"].get("failure_count", 0)) for item in suite_results)
    success_rounds = sum(int(item["result"].get("success_count", 0)) for item in suite_results)
    total_rounds = sum(int(item["result"].get("repeats", 0)) for item in suite_results)
    answer_models = sorted(
        {
            str(model)
            for item in suite_results
            for model in (item["result"].get("summary", {}).get("answer_models", []) or [])
            if str(model).strip()
        }
    )
    return {
        "device_id": int(device_id),
        "stt_provider": effective_provider,
        "answer_model": effective_answer_model,
        "max_parallel_answers": effective_max_parallel,
        "isolate_answers": bool(isolate_answers),
        "scenario_count": len(suite_results),
        "success_rounds": success_rounds,
        "failure_rounds": failure_count,
        "total_rounds": total_rounds,
        "summary": {
            "max_raw_queue_drop_count": max(
                int(item["result"].get("summary", {}).get("max_raw_queue_drop_count", 0))
                for item in suite_results
            ) if suite_results else 0,
            "max_segment_dropped": max(
                int(item["result"].get("summary", {}).get("max_segment_dropped", 0))
                for item in suite_results
            ) if suite_results else 0,
            "max_loopback_discontinuity_count": max(
                int(item["result"].get("summary", {}).get("max_loopback_discontinuity_count", 0))
                for item in suite_results
            ) if suite_results else 0,
            "max_segment_queue_depth": max(
                int(item["result"].get("summary", {}).get("max_segment_queue_depth", 0))
                for item in suite_results
            ) if suite_results else 0,
            "max_qa_count": max(
                int(item["result"].get("summary", {}).get("max_qa_count", 0))
                for item in suite_results
            ) if suite_results else 0,
            "answer_models": answer_models,
            "drain_timeout_count": sum(
                int(item["result"].get("summary", {}).get("drain_timeout_count", 0))
                for item in suite_results
            ),
        },
        "scenarios": suite_results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a batch of interviewer replay scenarios.")
    parser.add_argument("--device-id", type=int, required=True, help="Loopback capture device id.")
    parser.add_argument("--repeats", type=int, default=3, help="Replay rounds per scenario.")
    parser.add_argument("--gap-sec", type=float, default=0.12, help="Gap between rounds.")
    parser.add_argument("--scenario", action="append", default=[], help="Optional scenario id filter. Repeat for multiple values.")
    parser.add_argument(
        "--stt-provider",
        choices=["", "whisper", "doubao", "generic"],
        default="",
        help="Temporarily force STT provider during the suite. Use whisper for free local validation.",
    )
    parser.add_argument(
        "--answer-model-name",
        default="",
        help="Temporarily set active answer model by name/model id, e.g. lite-ark.",
    )
    parser.add_argument(
        "--max-parallel-answers",
        type=int,
        default=0,
        help="Temporarily set max_parallel_answers. 0 keeps current config.",
    )
    parser.add_argument(
        "--answer-wait-sec",
        type=float,
        default=-1.0,
        help="Temporarily set stop-time answer wait. Use 8-20 when answer generation is enabled.",
    )
    parser.add_argument(
        "--no-isolate-answers",
        action="store_true",
        help="Keep auto-detect/answer workers enabled during replay.",
    )
    args = parser.parse_args(argv)

    result = run_replay_suite(
        args.device_id,
        repeats=args.repeats,
        gap_sec=args.gap_sec,
        isolate_answers=not bool(args.no_isolate_answers),
        scenario_ids=args.scenario or None,
        stt_provider=args.stt_provider,
        answer_model_name=args.answer_model_name,
        max_parallel_answers=args.max_parallel_answers if args.max_parallel_answers > 0 else None,
        answer_wait_sec=args.answer_wait_sec if args.answer_wait_sec >= 0 else None,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if int(result.get("failure_rounds", 0)) == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
