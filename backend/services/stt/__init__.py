"""Speech-to-text package: text utilities, engine implementations, and factory."""

from .text_utils import (
    TECH_VOCAB,
    TERM_CORRECTIONS,
    _postprocess,
    transcription_significant_len,
    transcription_for_publish,
    join_transcription_fragments,
    normalize_transcription_for_analysis,
    split_question_like_text,
    is_backchannel_text,
    classify_asr_question_candidate,
    is_viable_asr_question_group,
    build_asr_question_group_text,
    AsrQuestionCandidate,
)

from .engines import (
    STTEngine,
    DoubaoSTT,
    IflyitekSTT,
)

from .factory import (
    get_stt_engine,
    set_whisper_language,
)

__all__ = [
    "TECH_VOCAB",
    "TERM_CORRECTIONS",
    "_postprocess",
    "transcription_significant_len",
    "transcription_for_publish",
    "join_transcription_fragments",
    "normalize_transcription_for_analysis",
    "split_question_like_text",
    "is_backchannel_text",
    "classify_asr_question_candidate",
    "is_viable_asr_question_group",
    "build_asr_question_group_text",
    "AsrQuestionCandidate",
    "STTEngine",
    "DoubaoSTT",
    "IflyitekSTT",
    "get_stt_engine",
    "set_whisper_language",
]
