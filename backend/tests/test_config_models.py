from __future__ import annotations

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api.common.config_payload import build_config_payload  # noqa: E402
from core.config import AppConfig, ModelConfig  # noqa: E402


def test_active_model_falls_back_to_first_enabled_model():
    cfg = AppConfig(
        models=[
            ModelConfig(name="disabled", enabled=False),
            ModelConfig(name="enabled", enabled=True),
        ],
        active_model=0,
    )

    assert cfg.active_model == 1
    assert cfg.get_active_model().name == "enabled"


def test_active_model_keeps_clamped_index_when_all_models_are_disabled():
    cfg = AppConfig(
        models=[
            ModelConfig(name="disabled-a", enabled=False),
            ModelConfig(name="disabled-b", enabled=False),
        ],
        active_model=5,
    )

    assert cfg.active_model == 1


def test_candidate_remote_stt_requires_explicit_cost_opt_in():
    cfg = AppConfig(
        candidate_stt_provider="doubao",
        candidate_remote_stt_enabled=False,
    )

    assert cfg.candidate_stt_provider == "whisper"


def test_candidate_mic_asr_defaults_to_opt_in():
    cfg = AppConfig()

    assert cfg.candidate_asr_enabled is False


def test_candidate_remote_stt_can_be_enabled_explicitly():
    cfg = AppConfig(
        candidate_stt_provider="generic",
        candidate_remote_stt_enabled=True,
    )

    assert cfg.candidate_stt_provider == "generic"


def test_think_effort_accepts_xhigh():
    cfg = AppConfig(think_mode=True, think_effort="xhigh")

    assert cfg.think_mode is True
    assert cfg.think_effort == "xhigh"


def test_generation_params_are_normalized_for_runtime_safety():
    cfg = AppConfig(temperature=float("nan"), max_tokens=999999)

    assert cfg.temperature == 0.5
    assert cfg.max_tokens == 32768

    cfg = AppConfig(temperature=-3, max_tokens=8)

    assert cfg.temperature == 0.0
    assert cfg.max_tokens == 256


def test_invalid_generation_param_strings_fall_back_to_defaults():
    cfg = AppConfig(temperature="not-a-number", max_tokens="not-a-number")

    assert cfg.temperature == 0.5
    assert cfg.max_tokens == 4096


def test_assist_stop_answer_wait_default_is_preserved():
    cfg = AppConfig()

    assert cfg.assist_stop_answer_wait_sec == 3.0


def test_assist_stop_answer_wait_can_be_disabled_explicitly():
    cfg = AppConfig(assist_stop_answer_wait_sec=0)

    assert cfg.assist_stop_answer_wait_sec == 0.0


def test_config_payload_includes_realtime_voice_runtime_knobs():
    cfg = AppConfig(
        assist_realtime_max_tokens=800,
        assist_realtime_high_churn_max_tokens=360,
        assist_stop_answer_wait_sec=2.5,
        assist_interviewer_asr_drain_timeout_sec=8.0,
    )

    payload = build_config_payload(cfg)

    assert payload["assist_realtime_max_tokens"] == 800
    assert payload["assist_realtime_high_churn_max_tokens"] == 360
    assert payload["assist_stop_answer_wait_sec"] == 2.5
    assert payload["assist_interviewer_asr_drain_timeout_sec"] == 8.0
