from __future__ import annotations

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

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
