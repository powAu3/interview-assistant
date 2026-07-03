from __future__ import annotations

from pathlib import Path
import importlib
import json
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

fixture_script = importlib.import_module("scripts.generate_interviewer_mix_fixture")


def test_build_scenario_ssml_includes_breaks_and_voice():
    ssml = fixture_script.build_scenario_ssml("separated_cn", voice_name="Microsoft Huihui Desktop")

    assert "Microsoft Huihui Desktop" in ssml
    assert "<break time='2400ms'/>" in ssml
    assert "请先做一个简单的自我介绍。" in ssml


def test_build_scenario_manifest_carries_expected_metadata():
    manifest = fixture_script.build_scenario_manifest(
        "mixed_followups_cn",
        audio_path="tmp/mixed.wav",
        voice_name="Microsoft Huihui Desktop",
    )

    assert manifest["scenario_id"] == "mixed_followups_cn"
    assert manifest["audio_path"] == "tmp/mixed.wav"
    assert manifest["min_transcript_count"] == 2
    assert manifest["min_segment_emitted"] == 3
    assert len(manifest["expected_phrases"]) == 3


def test_boundary_scenarios_cover_short_terms_noise_and_tail_flush():
    scenario_ids = set(fixture_script.SCENARIOS)

    assert "rapid_short_followups_cn" in scenario_ids
    assert "terms_mixed_cn_en" in scenario_ids
    assert "filler_noise_then_question_cn" in scenario_ids
    assert "tail_stop_flush_cn" in scenario_ids
    assert fixture_script.SCENARIOS["terms_mixed_cn_en"]["min_segment_emitted"] == 3
    assert fixture_script.SCENARIOS["tail_stop_flush_cn"]["recommended_settle_sec"] <= 2.0


def test_generate_interviewer_mix_fixture_main_writes_manifest(monkeypatch, tmp_path):
    out_path = tmp_path / "fixture.wav"
    monkeypatch.setattr(
        fixture_script,
        "synthesize_ssml_to_wav",
        lambda ssml, output_path, preferred_voice_name="": {
            "output_path": str(output_path),
            "selected_voice": "Microsoft Huihui Desktop",
        },
    )

    assert fixture_script.main(["--scenario", "separated_cn", "--out", str(out_path)]) == 0

    manifest_path = out_path.with_suffix(".json")
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["scenario_id"] == "separated_cn"
    assert manifest["audio_path"] == str(out_path.resolve())
