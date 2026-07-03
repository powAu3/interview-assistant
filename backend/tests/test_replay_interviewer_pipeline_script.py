from __future__ import annotations

from pathlib import Path
import importlib
import json
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

replay_script = importlib.import_module("scripts.replay_interviewer_pipeline")


def test_replay_interviewer_pipeline_script_returns_zero_on_success(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        replay_script,
        "run_interviewer_pipeline_replay",
        lambda device_id, repeats=3, gap_sec=0.25, audio_path=None, expected_phrase="", settle_sec=3.0, isolate_answers=True, min_transcript_count=1, min_segment_emitted=1: (
            seen.update(
                {
                    "device_id": device_id,
                    "repeats": repeats,
                    "gap_sec": gap_sec,
                    "audio_path": audio_path,
                    "expected_phrase": expected_phrase,
                    "settle_sec": settle_sec,
                    "isolate_answers": isolate_answers,
                    "min_transcript_count": min_transcript_count,
                }
            )
            or {"failure_count": 0}
        ),
    )

    assert replay_script.main([
        "--device-id", "20002",
        "--repeats", "4",
        "--gap-sec", "0.1",
        "--audio-path", "tmp/sample.wav",
        "--expected-phrase", "你好",
        "--settle-sec", "2.5",
    ]) == 0
    assert seen == {
        "device_id": 20002,
        "repeats": 4,
        "gap_sec": 0.1,
        "audio_path": "tmp/sample.wav",
        "expected_phrase": "你好",
        "settle_sec": 2.5,
        "isolate_answers": True,
        "min_transcript_count": 1,
    }


def test_replay_interviewer_pipeline_script_returns_two_on_failure(monkeypatch):
    monkeypatch.setattr(
        replay_script,
        "run_interviewer_pipeline_replay",
        lambda device_id, repeats=3, gap_sec=0.25, audio_path=None, expected_phrase="", settle_sec=3.0, isolate_answers=True, min_transcript_count=1, min_segment_emitted=1: {
            "failure_count": 1
        },
    )

    assert replay_script.main(["--device-id", "20002"]) == 2


def test_replay_interviewer_pipeline_script_can_disable_answer_isolation(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        replay_script,
        "run_interviewer_pipeline_replay",
        lambda device_id, repeats=3, gap_sec=0.25, audio_path=None, expected_phrase="", settle_sec=3.0, isolate_answers=True, min_transcript_count=1, min_segment_emitted=1: (
            seen.update({"isolate_answers": isolate_answers}) or {"failure_count": 0}
        ),
    )

    assert replay_script.main(["--device-id", "20002", "--no-isolate-answers"]) == 0
    assert seen["isolate_answers"] is False


def test_replay_interviewer_pipeline_script_reads_manifest_defaults(monkeypatch, tmp_path):
    seen = {}
    manifest_path = tmp_path / "fixture.json"
    manifest_path.write_text(
        json.dumps(
            {
                "audio_path": "tmp/generated.wav",
                "expected_phrases": ["第一问", "第二问"],
                "recommended_settle_sec": 6.0,
                "min_transcript_count": 3,
                "min_segment_emitted": 4,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        replay_script,
        "run_interviewer_pipeline_replay",
        lambda device_id, repeats=3, gap_sec=0.25, audio_path=None, expected_phrase="", settle_sec=3.0, isolate_answers=True, min_transcript_count=1, min_segment_emitted=1: (
            seen.update(
                {
                    "audio_path": audio_path,
                    "expected_phrase": expected_phrase,
                    "settle_sec": settle_sec,
                    "min_transcript_count": min_transcript_count,
                    "min_segment_emitted": min_segment_emitted,
                }
            )
            or {"failure_count": 0}
        ),
    )

    assert replay_script.main(["--device-id", "20002", "--manifest-path", str(manifest_path)]) == 0
    assert seen == {
        "audio_path": "tmp/generated.wav",
        "expected_phrase": "第一问\n第二问",
        "settle_sec": 6.0,
        "min_transcript_count": 3,
        "min_segment_emitted": 4,
    }


def test_run_interviewer_pipeline_replay_includes_runtime_summary(monkeypatch):
    session = type("Session", (), {"transcription_history": ["请介绍一下你最近做过的项目。"]})()
    snapshots = iter(
        [
            {
                "live": False,
                "raw_queue_drop_count": 0,
                "loopback_discontinuity_count": 0,
                "segment_emitted": 2,
                "segment_dropped": 0,
                "max_observed_segment_queue_depth": 2,
                "max_raw_chunk_samples": 1400,
                "drain_timed_out": False,
            },
            {
                "live": False,
                "raw_queue_drop_count": 1,
                "loopback_discontinuity_count": 3,
                "segment_emitted": 5,
                "segment_dropped": 2,
                "max_observed_segment_queue_depth": 5,
                "max_raw_chunk_samples": 2800,
                "drain_timed_out": True,
            },
        ]
    )
    monkeypatch.setattr(replay_script, "reset_session", lambda: None)
    monkeypatch.setattr(replay_script, "start_nonblocking", lambda device_id: None)
    monkeypatch.setattr(replay_script, "stop_interview_loop", lambda: None)
    monkeypatch.setattr(replay_script, "play_audio_fixture", lambda _path: 0.8)
    monkeypatch.setattr(replay_script, "get_session", lambda: session)
    monkeypatch.setattr(replay_script, "get_interviewer_runtime_snapshot", lambda: next(snapshots))
    monkeypatch.setattr(replay_script, "_temporary_replay_pipeline_config", lambda isolate_answers: replay_script.contextlib.nullcontext())

    result = replay_script.run_interviewer_pipeline_replay(20002, repeats=2, gap_sec=0.0, settle_sec=0.5)

    assert result["success_count"] == 2
    assert result["isolate_answers"] is True
    assert result["summary"]["max_raw_queue_drop_count"] == 1
    assert result["summary"]["max_segment_dropped"] == 2
    assert result["summary"]["max_segment_queue_depth"] == 5
    assert result["summary"]["max_loopback_discontinuity_count"] == 3
    assert result["summary"]["max_raw_chunk_samples"] == 2800
    assert result["summary"]["drain_timeout_count"] == 1
    assert result["rounds"][1]["runtime"]["drain_timed_out"] is True


def test_run_interviewer_pipeline_replay_requires_min_transcript_count(monkeypatch):
    session = type("Session", (), {"transcription_history": ["第一问\n第二问"]})()
    monkeypatch.setattr(replay_script, "reset_session", lambda: None)
    monkeypatch.setattr(replay_script, "start_nonblocking", lambda device_id: None)
    monkeypatch.setattr(replay_script, "stop_interview_loop", lambda: None)
    monkeypatch.setattr(replay_script, "play_audio_fixture", lambda _path: 0.8)
    monkeypatch.setattr(replay_script, "get_session", lambda: session)
    monkeypatch.setattr(
        replay_script,
        "get_interviewer_runtime_snapshot",
        lambda: {"raw_queue_drop_count": 0, "segment_dropped": 0, "max_observed_segment_queue_depth": 1, "segment_emitted": 2},
    )
    monkeypatch.setattr(replay_script, "_temporary_replay_pipeline_config", lambda isolate_answers: replay_script.contextlib.nullcontext())

    result = replay_script.run_interviewer_pipeline_replay(
        20002,
        repeats=1,
        gap_sec=0.0,
        settle_sec=0.5,
        expected_phrase="第一问\n第二问",
        min_transcript_count=2,
    )

    assert result["failure_count"] == 1
    assert "转写条数不足" in result["rounds"][0]["detail"]


def test_run_interviewer_pipeline_replay_requires_min_segment_emitted(monkeypatch):
    session = type("Session", (), {"transcription_history": ["第一问", "第二问"]})()
    monkeypatch.setattr(replay_script, "reset_session", lambda: None)
    monkeypatch.setattr(replay_script, "start_nonblocking", lambda device_id: None)
    monkeypatch.setattr(replay_script, "stop_interview_loop", lambda: None)
    monkeypatch.setattr(replay_script, "play_audio_fixture", lambda _path: 0.8)
    monkeypatch.setattr(replay_script, "get_session", lambda: session)
    monkeypatch.setattr(
        replay_script,
        "get_interviewer_runtime_snapshot",
        lambda: {"raw_queue_drop_count": 0, "segment_dropped": 0, "max_observed_segment_queue_depth": 1, "segment_emitted": 2},
    )
    monkeypatch.setattr(replay_script, "_temporary_replay_pipeline_config", lambda isolate_answers: replay_script.contextlib.nullcontext())

    result = replay_script.run_interviewer_pipeline_replay(
        20002,
        repeats=1,
        gap_sec=0.0,
        settle_sec=0.5,
        expected_phrase="第一问\n第二问",
        min_transcript_count=1,
        min_segment_emitted=3,
    )

    assert result["failure_count"] == 1
    assert "segment 数不足" in result["rounds"][0]["detail"]


def test_temporary_replay_pipeline_config_restores_original_values(monkeypatch):
    cfg = type("Cfg", (), {"auto_detect": True, "assist_stop_answer_wait_sec": 3.0})()
    updates: list[dict] = []

    monkeypatch.setattr(replay_script, "get_config", lambda: cfg)

    def fake_update_config(values):
        updates.append(dict(values))
        for key, value in values.items():
            setattr(cfg, key, value)
        return cfg

    monkeypatch.setattr(replay_script, "update_config", fake_update_config)

    with replay_script._temporary_replay_pipeline_config(isolate_answers=True):
        assert cfg.auto_detect is False
        assert cfg.assist_stop_answer_wait_sec == 0.0

    assert cfg.auto_detect is True
    assert cfg.assist_stop_answer_wait_sec == 3.0
    assert updates == [
        {"auto_detect": False, "assist_stop_answer_wait_sec": 0.0},
        {"auto_detect": True, "assist_stop_answer_wait_sec": 3.0},
    ]
