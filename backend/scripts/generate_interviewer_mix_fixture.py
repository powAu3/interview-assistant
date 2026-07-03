"""
Generate a deterministic interviewer replay WAV fixture on Windows.

The fixture uses built-in Windows speech synthesis so it does not require
network access or API keys. A JSON manifest is written alongside the WAV and
can be consumed by replay_interviewer_pipeline.py.

Usage:
    python -m scripts.generate_interviewer_mix_fixture --scenario separated_cn
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


DEFAULT_VOICE_NAME = "Microsoft Huihui Desktop"

SCENARIOS: dict[str, dict[str, Any]] = {
    "separated_cn": {
        "description": "Three separated interviewer questions with pauses long enough to force multiple segments.",
        "phrases": [
            "请先做一个简单的自我介绍。",
            "你最近做过的项目里，最有挑战的一次是什么？",
            "如果让你重新设计这个项目，你会优先改什么？",
        ],
        "breaks_ms": [2400, 2600],
        "min_transcript_count": 3,
        "min_segment_emitted": 3,
        "recommended_settle_sec": 6.0,
    },
    "mixed_followups_cn": {
        "description": "A longer interviewer question followed by quick follow-ups and then a separated final prompt.",
        "phrases": [
            "请介绍一下你最近做过的项目。",
            "你在里面主要负责哪一块？",
            "如果线上性能突然下降，你会先看什么指标？",
        ],
        "breaks_ms": [900, 2600],
        "min_transcript_count": 2,
        "min_segment_emitted": 3,
        "recommended_settle_sec": 6.0,
    },
    "rapid_short_followups_cn": {
        "description": "Very short follow-ups with tight pauses, stressing VAD merge and pending question grouping.",
        "phrases": [
            "那怎么验证？",
            "失败怎么回滚？",
            "指标看哪些？",
        ],
        "breaks_ms": [620, 760],
        "min_transcript_count": 1,
        "min_segment_emitted": 1,
        "recommended_settle_sec": 5.0,
    },
    "terms_mixed_cn_en": {
        "description": "Chinese interview questions mixed with English technical terms that ASR often distorts.",
        "phrases": [
            "rules 和 skills 的区别是什么？不要结合项目。",
            "pipeline 里怎么做 retry 和 timeout？",
            "SQL 索引失效你会怎么排查？",
        ],
        "breaks_ms": [1800, 2200],
        "min_transcript_count": 3,
        "min_segment_emitted": 3,
        "recommended_settle_sec": 6.0,
    },
    "filler_noise_then_question_cn": {
        "description": "Filler words before real questions, checking that noise does not starve later transcription.",
        "phrases": [
            "嗯嗯，稍等，我看一下。",
            "好，那你讲一下 Redis 持久化怎么选？",
            "再说一下 AOF 重写有什么风险？",
        ],
        "breaks_ms": [900, 2300],
        "min_transcript_count": 2,
        "min_segment_emitted": 2,
        "recommended_settle_sec": 6.0,
    },
    "tail_stop_flush_cn": {
        "description": "A final short question with little trailing silence, validating stop-time tail flush.",
        "phrases": [
            "最后一个问题。",
            "如果线上接口突然变慢，你第一步看什么？",
        ],
        "breaks_ms": [500],
        "min_transcript_count": 1,
        "min_segment_emitted": 1,
        "recommended_settle_sec": 2.0,
    },
}


def _escape_ssml_text(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def build_scenario_manifest(
    scenario_id: str,
    *,
    audio_path: str,
    voice_name: str,
) -> dict[str, Any]:
    scenario = SCENARIOS[scenario_id]
    return {
        "scenario_id": scenario_id,
        "description": scenario["description"],
        "audio_path": str(audio_path),
        "voice_name": voice_name,
        "expected_phrases": list(scenario["phrases"]),
        "min_transcript_count": int(scenario["min_transcript_count"]),
        "min_segment_emitted": int(scenario["min_segment_emitted"]),
        "recommended_settle_sec": float(scenario["recommended_settle_sec"]),
    }


def build_scenario_ssml(
    scenario_id: str,
    *,
    voice_name: str | None = None,
) -> str:
    scenario = SCENARIOS[scenario_id]
    phrases = list(scenario["phrases"])
    breaks_ms = list(scenario["breaks_ms"])
    body_parts: list[str] = []
    for idx, phrase in enumerate(phrases):
        body_parts.append(_escape_ssml_text(phrase))
        if idx < len(breaks_ms):
            body_parts.append(f"<break time='{int(breaks_ms[idx])}ms'/>")
    voice_attr = f" name='{voice_name}'" if (voice_name or "").strip() else ""
    return (
        "<?xml version='1.0'?>"
        "<speak version='1.0' xml:lang='zh-CN' xmlns='http://www.w3.org/2001/10/synthesis'>"
        f"<voice{voice_attr}>"
        + "".join(body_parts)
        + "</voice></speak>"
    )


def _default_output_path(scenario_id: str) -> Path:
    backend_dir = Path(__file__).resolve().parent.parent
    out_dir = backend_dir / "tmp"
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / f"{scenario_id}.wav"


def synthesize_ssml_to_wav(
    ssml: str,
    output_path: Path,
    *,
    preferred_voice_name: str = DEFAULT_VOICE_NAME,
) -> dict[str, Any]:
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ssml_b64 = base64.b64encode(ssml.encode("utf-8")).decode("ascii")
    command = f"""
Add-Type -AssemblyName System.Speech
$ssml = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('{ssml_b64}'))
$outPath = '{str(output_path).replace("'", "''")}'
$preferred = '{preferred_voice_name.replace("'", "''")}'
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $s.GetInstalledVoices() | ForEach-Object {{ $_.VoiceInfo.Name }}
$selected = $null
if ($preferred -and ($voices -contains $preferred)) {{
  $selected = $preferred
}} elseif ($voices -contains '{DEFAULT_VOICE_NAME}') {{
  $selected = '{DEFAULT_VOICE_NAME}'
}} elseif ($voices.Count -gt 0) {{
  $selected = $voices[0]
}}
if (-not $selected) {{
  throw 'No installed Windows speech voice is available.'
}}
$s.SelectVoice($selected)
$s.SetOutputToWaveFile($outPath)
$s.SpeakSsml($ssml)
$s.Dispose()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
@{{
  output_path = $outPath
  selected_voice = $selected
}} | ConvertTo-Json -Compress
"""
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if proc.returncode != 0:
        stderr = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(stderr or "Windows speech synthesis failed")
    payload = json.loads((proc.stdout or "").strip())
    return {
        "output_path": str(output_path),
        "selected_voice": str(payload.get("selected_voice") or preferred_voice_name),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a deterministic interviewer replay WAV fixture.")
    parser.add_argument(
        "--scenario",
        choices=sorted(SCENARIOS.keys()),
        default="separated_cn",
        help="Built-in interviewer replay scenario.",
    )
    parser.add_argument("--out", type=str, default="", help="Output WAV path. Defaults to backend/tmp/<scenario>.wav.")
    parser.add_argument("--voice", type=str, default=DEFAULT_VOICE_NAME, help="Preferred Windows speech voice.")
    args = parser.parse_args(argv)

    output_path = Path(args.out).resolve() if args.out else _default_output_path(args.scenario)
    ssml = build_scenario_ssml(args.scenario, voice_name=args.voice or None)
    synthesis = synthesize_ssml_to_wav(ssml, output_path, preferred_voice_name=args.voice or DEFAULT_VOICE_NAME)
    manifest = build_scenario_manifest(
        args.scenario,
        audio_path=synthesis["output_path"],
        voice_name=synthesis["selected_voice"],
    )
    manifest_path = output_path.with_suffix(".json")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "audio_path": str(output_path),
                "manifest_path": str(manifest_path),
                "scenario_id": args.scenario,
                "voice_name": synthesis["selected_voice"],
                "expected_phrases": manifest["expected_phrases"],
                "min_transcript_count": manifest["min_transcript_count"],
                "min_segment_emitted": manifest["min_segment_emitted"],
                "recommended_settle_sec": manifest["recommended_settle_sec"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
