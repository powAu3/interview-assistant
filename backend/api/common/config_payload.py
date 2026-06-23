from services.storage.resume_history import get_filename_for_id


def build_config_payload(cfg) -> dict:
    active_model = cfg.get_active_model()
    resume_active_history_id = getattr(cfg, "resume_active_history_id", None)
    return {
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
        "whisper_preload": cfg.whisper_preload,
        "doubao_stt_app_id": cfg.doubao_stt_app_id or "",
        "doubao_stt_access_token": cfg.doubao_stt_access_token or "",
        "doubao_stt_api_key": getattr(cfg, "doubao_stt_api_key", "") or "",
        "doubao_stt_resource_id": cfg.doubao_stt_resource_id or "",
        "doubao_stt_boosting_table_id": cfg.doubao_stt_boosting_table_id or "",
        "generic_stt_api_base_url": getattr(cfg, "generic_stt_api_base_url", "") or "",
        "generic_stt_api_key": getattr(cfg, "generic_stt_api_key", "") or "",
        "generic_stt_model": getattr(cfg, "generic_stt_model", "") or "",
        "generic_stt_custom_headers": getattr(cfg, "generic_stt_custom_headers", "") or "",
        "candidate_asr_enabled": bool(getattr(cfg, "candidate_asr_enabled", False)),
        "candidate_stt_provider": getattr(cfg, "candidate_stt_provider", "whisper") or "whisper",
        "candidate_whisper_model": getattr(cfg, "candidate_whisper_model", "") or "",
        "candidate_whisper_language": getattr(cfg, "candidate_whisper_language", "") or "",
        "candidate_remote_stt_enabled": bool(getattr(cfg, "candidate_remote_stt_enabled", False)),
        "candidate_context_enabled": bool(getattr(cfg, "candidate_context_enabled", True)),
        "candidate_context_wait_ms": max(0, min(2000, int(getattr(cfg, "candidate_context_wait_ms", 200) or 0))),
        "candidate_context_max_chars": max(100, min(4000, int(getattr(cfg, "candidate_context_max_chars", 900) or 900))),
        "candidate_context_min_chars": max(1, min(100, int(getattr(cfg, "candidate_context_min_chars", 6) or 6))),
        "candidate_streaming_asr_enabled": bool(getattr(cfg, "candidate_streaming_asr_enabled", True)),
        "candidate_streaming_asr_interval_ms": max(800, min(5000, int(getattr(cfg, "candidate_streaming_asr_interval_ms", 1500) or 1500))),
        "candidate_mic_compatibility_mode": bool(getattr(cfg, "candidate_mic_compatibility_mode", True)),
        "position": cfg.position,
        "language": cfg.language,
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
        "screen_capture_max_long_edge": max(
            0,
            min(4000, int(getattr(cfg, "screen_capture_max_long_edge", 1600) or 0)),
        ),
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
        "review_enabled": bool(getattr(cfg, "review_enabled", False)),
        "review_model_index": int(getattr(cfg, "review_model_index", 0)),
    }
