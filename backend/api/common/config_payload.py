from services.storage.resume_history import get_filename_for_id
from services.tts import get_edge_tts_status


def _mask_secret(key: str) -> str:
    if not key or key in ("", "sk-your-api-key-here"):
        return ""
    if len(key) <= 8:
        return key[:2] + "****" + key[-1:]
    return key[:3] + "****" + key[-3:]


def build_config_payload(cfg) -> dict:
    active_model = cfg.get_active_model()
    resume_active_history_id = getattr(cfg, "resume_active_history_id", None)
    return {
        **get_edge_tts_status(),
        "models": [
            {
                "name": model.name,
                "supports_think": model.supports_think,
                "supports_vision": model.supports_vision,
                "enabled": getattr(model, "enabled", True),
            }
            for model in cfg.models
        ],
        "max_parallel_answers": getattr(cfg, "max_parallel_answers", 2),
        "active_model": cfg.active_model,
        "model_name": active_model.name,
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
        "think_mode": cfg.think_mode,
        "think_effort": cfg.think_effort,
        "stt_provider": cfg.stt_provider,
        "whisper_model": cfg.whisper_model,
        "whisper_language": cfg.whisper_language,
        "doubao_stt_app_id": cfg.doubao_stt_app_id or "",
        "doubao_stt_access_token": _mask_secret(cfg.doubao_stt_access_token or ""),
        "doubao_stt_resource_id": cfg.doubao_stt_resource_id or "",
        "doubao_stt_boosting_table_id": cfg.doubao_stt_boosting_table_id or "",
        "generic_stt_api_base_url": getattr(cfg, "generic_stt_api_base_url", "") or "",
        "generic_stt_api_key": _mask_secret(getattr(cfg, "generic_stt_api_key", "") or ""),
        "generic_stt_model": getattr(cfg, "generic_stt_model", "") or "",
        "practice_tts_provider": getattr(cfg, "practice_tts_provider", "edge_tts") or "edge_tts",
        "edge_tts_voice_female": getattr(cfg, "edge_tts_voice_female", "zh-CN-XiaoxiaoNeural") or "zh-CN-XiaoxiaoNeural",
        "edge_tts_voice_male": getattr(cfg, "edge_tts_voice_male", "zh-CN-YunxiNeural") or "zh-CN-YunxiNeural",
        "edge_tts_rate": getattr(cfg, "edge_tts_rate", "+0%") or "+0%",
        "edge_tts_pitch": getattr(cfg, "edge_tts_pitch", "+0Hz") or "+0Hz",
        "volcengine_tts_appkey": getattr(cfg, "volcengine_tts_appkey", "") or "",
        "volcengine_tts_token": _mask_secret(getattr(cfg, "volcengine_tts_token", "") or ""),
        "practice_tts_speaker_female": getattr(cfg, "practice_tts_speaker_female", "zh_female_qingxin") or "zh_female_qingxin",
        "practice_tts_speaker_male": getattr(cfg, "practice_tts_speaker_male", "zh_male_chunhou") or "zh_male_chunhou",
        "position": cfg.position,
        "language": cfg.language,
        "practice_audience": getattr(cfg, "practice_audience", "campus_intern"),
        "auto_detect": cfg.auto_detect,
        "silence_threshold": cfg.silence_threshold,
        "silence_duration": cfg.silence_duration,
        "answer_autoscroll_bottom_px": max(4, min(400, getattr(cfg, "answer_autoscroll_bottom_px", 40))),
        "transcription_min_sig_chars": max(1, min(50, getattr(cfg, "transcription_min_sig_chars", 2))),
        "assist_transcription_merge_gap_sec": max(
            0.0, min(15.0, float(getattr(cfg, "assist_transcription_merge_gap_sec", 2.0) or 0.0))
        ),
        "assist_transcription_merge_max_sec": max(
            1.0, min(120.0, float(getattr(cfg, "assist_transcription_merge_max_sec", 12.0) or 12.0))
        ),
        "assist_asr_confirm_window_sec": max(
            0.0, min(5.0, float(getattr(cfg, "assist_asr_confirm_window_sec", 0.45) or 0.0))
        ),
        "assist_asr_group_max_wait_sec": max(
            0.2, min(8.0, float(getattr(cfg, "assist_asr_group_max_wait_sec", 1.2) or 1.2))
        ),
        "assist_asr_interrupt_running": bool(getattr(cfg, "assist_asr_interrupt_running", True)),
        "assist_high_churn_short_answer": bool(getattr(cfg, "assist_high_churn_short_answer", False)),
        "screen_capture_region": getattr(cfg, "screen_capture_region", "left_half") or "left_half",
        "multi_screen_capture_idle_sec": max(
            1.0, min(60.0, float(getattr(cfg, "multi_screen_capture_idle_sec", 10.0) or 10.0))
        ),
        "written_exam_mode": bool(getattr(cfg, "written_exam_mode", False)),
        "written_exam_think": bool(getattr(cfg, "written_exam_think", False)),
        "kb_enabled": bool(getattr(cfg, "kb_enabled", False)),
        "kb_top_k": int(getattr(cfg, "kb_top_k", 4) or 4),
        "kb_deadline_ms": int(getattr(cfg, "kb_deadline_ms", 150) or 150),
        "kb_asr_deadline_ms": int(getattr(cfg, "kb_asr_deadline_ms", 80) or 80),
        "has_resume": bool(cfg.resume_text),
        "resume_active_history_id": resume_active_history_id,
        "resume_active_filename": (
            get_filename_for_id(resume_active_history_id)
            if resume_active_history_id is not None
            else None
        ),
        "api_key_set": bool(active_model.api_key and active_model.api_key not in ("", "sk-your-api-key-here")),
    }
