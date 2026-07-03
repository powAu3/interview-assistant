from __future__ import annotations

from pathlib import Path
import importlib
import json
import sys
from types import SimpleNamespace

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

suite_script = importlib.import_module("scripts.run_interviewer_replay_suite")


def test_run_replay_suite_aggregates_scenario_results(monkeypatch, tmp_path):
    scenario_ids = ["a", "b"]
    monkeypatch.setattr(suite_script, "SCENARIOS", {key: {} for key in scenario_ids})

    def fake_generate_fixture_main(argv):
        out_idx = argv.index("--out") + 1
        wav_path = Path(argv[out_idx])
        manifest_path = wav_path.with_suffix(".json")
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(
                {
                    "audio_path": str(wav_path),
                    "expected_phrases": [wav_path.stem],
                    "recommended_settle_sec": 5.0,
                    "min_transcript_count": 1,
                    "min_segment_emitted": 1,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return 0

    calls: list[str] = []

    def fake_run_interviewer_pipeline_replay(device_id, **kwargs):
        calls.append(Path(kwargs["audio_path"]).stem)
        stem = Path(kwargs["audio_path"]).stem
        return {
            "repeats": 2,
            "success_count": 2 if stem == "a" else 1,
            "failure_count": 0 if stem == "a" else 1,
            "summary": {
                "max_qa_count": 2,
                "answer_models": ["lite-ark"] if stem == "a" else ["doubao2.1Pro"],
                "max_raw_queue_drop_count": 0,
                "max_segment_dropped": 0 if stem == "a" else 1,
                "max_loopback_discontinuity_count": 0,
                "max_segment_queue_depth": 1,
                "drain_timeout_count": 0,
            },
        }

    monkeypatch.setattr(suite_script, "generate_fixture_main", fake_generate_fixture_main)
    monkeypatch.setattr(suite_script, "run_interviewer_pipeline_replay", fake_run_interviewer_pipeline_replay)
    monkeypatch.setattr(Path, "resolve", lambda self: self)

    result = suite_script.run_replay_suite(20002, repeats=2, scenario_ids=scenario_ids)

    assert calls == scenario_ids
    assert result["scenario_count"] == 2
    assert result["isolate_answers"] is True
    assert result["success_rounds"] == 3
    assert result["failure_rounds"] == 1
    assert result["total_rounds"] == 4
    assert result["summary"]["max_segment_dropped"] == 1
    assert result["summary"]["max_qa_count"] == 2
    assert result["summary"]["answer_models"] == ["doubao2.1Pro", "lite-ark"]


def test_run_replay_suite_can_temporarily_force_whisper_and_lite_ark(monkeypatch, tmp_path):
    scenario_ids = ["a"]
    monkeypatch.setattr(suite_script, "SCENARIOS", {key: {} for key in scenario_ids})

    models = [
        SimpleNamespace(name="main", model="main-model"),
        SimpleNamespace(name="lite-ark", model="doubao-seed-lite"),
    ]
    state = {
        "stt_provider": "doubao",
        "whisper_preload": True,
        "active_model": 0,
        "max_parallel_answers": 2,
        "assist_stop_answer_wait_sec": 3.0,
        "assist_interviewer_asr_drain_timeout_sec": 6.0,
        "models": models,
    }
    updates_seen: list[dict] = []

    def fake_get_config():
        return SimpleNamespace(**state)

    def fake_update_config(update):
        updates_seen.append(dict(update))
        state.update(update)

    def fake_generate_fixture_main(argv):
        out_idx = argv.index("--out") + 1
        wav_path = Path(argv[out_idx])
        wav_path.parent.mkdir(parents=True, exist_ok=True)
        wav_path.with_suffix(".json").write_text(
            json.dumps(
                {
                    "audio_path": str(wav_path),
                    "expected_phrases": ["a"],
                    "recommended_settle_sec": 1.0,
                    "min_transcript_count": 1,
                    "min_segment_emitted": 1,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return 0

    replay_seen: dict[str, object] = {}

    def fake_run_interviewer_pipeline_replay(_device_id, **kwargs):
        replay_seen.update(kwargs)
        return {
            "repeats": 1,
            "success_count": 1,
            "failure_count": 0,
            "summary": {
                "max_qa_count": 1,
                "answer_models": ["lite-ark"],
                "max_raw_queue_drop_count": 0,
                "max_segment_dropped": 0,
                "max_loopback_discontinuity_count": 0,
                "max_segment_queue_depth": 1,
                "drain_timeout_count": 0,
            },
        }

    monkeypatch.setattr(suite_script, "get_config", fake_get_config)
    monkeypatch.setattr(suite_script, "update_config", fake_update_config)
    monkeypatch.setattr(suite_script, "generate_fixture_main", fake_generate_fixture_main)
    monkeypatch.setattr(suite_script, "run_interviewer_pipeline_replay", fake_run_interviewer_pipeline_replay)
    monkeypatch.setattr(Path, "resolve", lambda self: self)

    result = suite_script.run_replay_suite(
        20002,
        repeats=1,
        scenario_ids=scenario_ids,
        isolate_answers=False,
        stt_provider="whisper",
        answer_model_name="lite-ark",
        max_parallel_answers=3,
        answer_wait_sec=12.0,
    )

    assert result["stt_provider"] == "whisper"
    assert result["answer_model"] == "lite-ark"
    assert result["max_parallel_answers"] == 3
    assert result["isolate_answers"] is False
    assert replay_seen["isolate_answers"] is False
    assert {
        "stt_provider": "whisper",
        "whisper_preload": False,
        "assist_interviewer_asr_drain_timeout_sec": 12.0,
    } in updates_seen
    assert {
        "active_model": 1,
        "max_parallel_answers": 3,
        "assist_stop_answer_wait_sec": 12.0,
    } in updates_seen
    assert state["stt_provider"] == "doubao"
    assert state["active_model"] == 0
