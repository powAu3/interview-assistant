"""LLM package: prompt builders + streaming generation."""

from .prompts import (
    PROMPT_MODE_ASR_REALTIME,
    PROMPT_MODE_MANUAL_TEXT,
    PROMPT_MODE_SERVER_SCREEN,
    PromptMode,
    build_system_prompt,
    postprocess_answer_for_mode,
)

from .streaming import (
    get_client,
    get_client_for_model,
    has_vision_model,
    vision_extract_text,
    RESUME_VISION_PROMPT,
    get_token_stats,
    _add_tokens,
    _token_stats,
    _broadcast_tokens,
    chat_stream,
    chat_stream_single_model,
)

__all__ = [
    "PROMPT_MODE_ASR_REALTIME",
    "PROMPT_MODE_MANUAL_TEXT",
    "PROMPT_MODE_SERVER_SCREEN",
    "PromptMode",
    "build_system_prompt",
    "postprocess_answer_for_mode",
    "get_client",
    "get_client_for_model",
    "has_vision_model",
    "vision_extract_text",
    "RESUME_VISION_PROMPT",
    "get_token_stats",
    "_add_tokens",
    "_token_stats",
    "_broadcast_tokens",
    "chat_stream",
    "chat_stream_single_model",
]
