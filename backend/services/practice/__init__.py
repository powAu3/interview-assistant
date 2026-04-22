from __future__ import annotations

from core.config import get_config as _get_config

from . import blueprint as _blueprint
from . import debrief as _debrief
from . import review as _review
from .constants import *
from .models import *
from .service import (
    _pick_practice_model as _pick_practice_model_impl,
    _request_json_completion as _request_json_completion_impl,
    _request_text_completion as _request_text_completion_impl,
    get_practice,
    reset_practice,
)

get_config = _get_config
_pick_practice_model = _pick_practice_model_impl
_request_json_completion = _request_json_completion_impl
_request_text_completion = _request_text_completion_impl

_normalize_practice_audience = _blueprint._normalize_practice_audience
_normalize_interviewer_style = _blueprint._normalize_interviewer_style
_practice_audience_meta = _blueprint._practice_audience_meta
_normalize_answer_mode = _blueprint._normalize_answer_mode
_default_blueprint = _blueprint._default_blueprint
_normalize_phase = _blueprint._normalize_phase
_normalize_blueprint = _blueprint._normalize_blueprint
_stage_prompt_for_phase = _blueprint._stage_prompt_for_phase
_signal_for_phase = _blueprint._signal_for_phase
_transition_line_for_phase = _blueprint._transition_line_for_phase
_make_turn = _blueprint._make_turn
_build_context = lambda jd_text="", interviewer_style=INTERVIEWER_STYLE_CALM: _blueprint._build_context(
    get_config,
    jd_text,
    interviewer_style,
)

_current_phase = _review._current_phase
_phase_follow_up_count = _review._phase_follow_up_count
_fallback_turn_review = _review._fallback_turn_review
_fallback_debrief_report = _debrief._fallback_debrief_report


def start_practice_session(
    jd_text: str = "",
    interviewer_style: str = INTERVIEWER_STYLE_CALM,
) -> PracticeSession:
    session = reset_practice()
    session.status = PRACTICE_STATUS_PREPARING

    context = _build_context(jd_text, interviewer_style=interviewer_style)
    blueprint = _blueprint._generate_blueprint(
        context,
        pick_practice_model=_pick_practice_model,
        request_json_completion=_request_json_completion,
    )
    session.context = context
    session.blueprint = blueprint
    session.interviewer_persona = dict(INTERVIEWER_PERSONA_MAP[context.interviewer_style])
    session.current_phase_index = 0
    session.current_turn = _make_turn(blueprint.phases[0], interviewer_style=context.interviewer_style)
    session.status = PRACTICE_STATUS_AWAITING_ANSWER
    return session


def _review_current_turn(
    session: PracticeSession,
    phase: PracticePhase,
    turn: PracticeTurn,
) -> dict[str, object]:
    return _review._review_current_turn(
        session,
        phase,
        turn,
        practice_audience_meta=_practice_audience_meta,
        pick_practice_model=_pick_practice_model,
        request_json_completion=_request_json_completion,
    )


def _generate_debrief_report(session: PracticeSession) -> str:
    return _debrief._generate_debrief_report(
        session,
        pick_practice_model=_pick_practice_model,
        request_text_completion=_request_text_completion,
    )


def submit_practice_answer(
    transcript: str,
    code_text: str = "",
    answer_mode: str = ANSWER_MODE_VOICE,
    duration_ms: int = 0,
) -> PracticeSession:
    session = get_practice()
    if not session.current_turn:
        raise ValueError("没有当前面试问题")

    transcript = (transcript or "").strip()
    code_text = (code_text or "").strip()
    if not transcript and not code_text:
        raise ValueError("回答不能为空")

    turn = session.current_turn
    turn.transcript = transcript
    turn.code_text = code_text
    turn.answer_mode = _normalize_answer_mode(answer_mode, turn.answer_mode)
    turn.duration_ms = max(0, int(duration_ms or 0))

    phase = _current_phase(session)
    review = _review_current_turn(session, phase, turn)
    return _review._apply_turn_review(
        session,
        phase,
        turn,
        review,
        make_turn=_make_turn,
        normalize_answer_mode=_normalize_answer_mode,
        generate_debrief_report=_generate_debrief_report,
    )


def finish_practice_session() -> PracticeSession:
    session = get_practice()
    if session.status == PRACTICE_STATUS_FINISHED:
        return session
    if not session.turn_history:
        raise ValueError("还没有完成任何有效回答")
    session.current_turn = None
    session.status = PRACTICE_STATUS_DEBRIEFING
    session.report_markdown = _generate_debrief_report(session)
    session.finished_at = __import__("time").time()
    session.status = PRACTICE_STATUS_FINISHED
    return session
