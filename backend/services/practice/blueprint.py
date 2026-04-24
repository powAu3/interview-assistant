from __future__ import annotations

import time
import uuid
from typing import Any, Callable, Optional

from .constants import (
    ANSWER_MODE_OPTIONS,
    ANSWER_MODE_VOICE,
    ANSWER_MODE_VOICE_CODE,
    INTERVIEWER_STYLE_CALM,
    INTERVIEWER_STYLE_OPTIONS,
    STAGE_GUIDANCE_MAP,
    TRANSITION_LINE_MAP,
)
from .models import PracticeBlueprint, PracticeContext, PracticePhase, PracticeTurn

BLUEPRINT_PROMPT = """你是一位真实技术面试官，要主持一场更像真实现场的混合全流程模拟面试。
候选人画像：{audience_label}
画像说明：{audience_profile}
出题原则：{audience_focus}

## 候选人简历摘要
{resume_text}

## 目标岗位 JD
{jd_text}

## 岗位信息
- 岗位：{position}
- 语言方向：{language}

## 任务
围绕下面固定流程骨架，生成结构化 interview blueprint。
流程骨架固定，但题目不能写死：
1. opening：开场与岗位匹配
2. project：项目深挖
3. fundamentals：通用基础/八股/场景原理
4. design：系统设计或综合场景
5. coding：代码 / SQL / 伪代码
6. closing：收尾与反问

要求：
- 题目来自 简历 + JD + 通用能力盲区；
- 至少 1 个阶段 answer_mode=voice+code；
- project/design/coding 阶段优先贴合简历和 JD；
- question 必须像面试官口头发问，40-120 字；
- coding 阶段必须补 written_prompt（适合直接给候选人看的题面文字）；
- coding 阶段必须补 artifact_notes（表结构、输入输出、边界条件、约束等，2-5 条）；
- follow_up_budget 0-2 之间；
- focus 用 2-4 个短词。

严格输出 JSON 对象，不要额外解释：
{{
  "opening_script": "...",
  "phases": [
    {{
      "phase_id": "opening",
      "label": "开场与岗位匹配",
      "category": "behavioral",
      "focus": ["..."],
      "follow_up_budget": 0,
      "answer_mode": "voice",
      "question": "...",
      "written_prompt": "...",
      "artifact_notes": ["..."]
    }}
  ]
}}"""


def _normalize_practice_audience(raw: Optional[str]) -> str:
    value = (raw or "").strip().lower()
    return "social" if value == "social" else "campus_intern"


def _normalize_interviewer_style(raw: Optional[str]) -> str:
    value = (raw or "").strip().lower()
    return value if value in INTERVIEWER_STYLE_OPTIONS else INTERVIEWER_STYLE_CALM


def _practice_audience_meta(audience: str) -> tuple[str, str, str]:
    if audience == "social":
        return (
            "社招",
            "候选人通常有 1-5 年工程经验，强调线上稳定性、容量评估、方案取舍与排障闭环。",
            "难度可以中高，但仍需聚焦可执行动作，不要空泛架构概念堆砌。",
        )
    return (
        "校招（实习）",
        "候选人通常为应届或 0-1 年经验，做过课程/实习项目，考察重点是基础扎实度与学习潜力。",
        "难度以中等为主，强调原理清晰、步骤化思路与可落地性。",
    )


def _normalize_answer_mode(raw: Any, fallback: str = ANSWER_MODE_VOICE) -> str:
    value = str(raw or fallback).strip().lower()
    if value in ANSWER_MODE_OPTIONS:
        return value
    return fallback


def _default_blueprint(context: PracticeContext) -> PracticeBlueprint:
    return PracticeBlueprint(
        opening_script="我们开始一场更接近真实现场的模拟面试，你正常回答，我会根据你的表现追问和切题。",
        phases=[
            PracticePhase(
                phase_id="opening",
                label="开场与岗位匹配",
                category="behavioral",
                focus=["自我介绍", "岗位动机"],
                follow_up_budget=0,
                answer_mode=ANSWER_MODE_VOICE,
                question=f"先做一个 90 秒左右的自我介绍，并说明你为什么想做 {context.position} 这个岗位。",
            ),
            PracticePhase(
                phase_id="project",
                label="项目深挖",
                category="project",
                focus=["项目取舍", "线上问题", "效果验证"],
                follow_up_budget=1,
                answer_mode=ANSWER_MODE_VOICE,
                question="讲一个你真正主导过、并且最能代表你能力边界的项目，我会重点追问你当时的关键决策。",
            ),
            PracticePhase(
                phase_id="fundamentals",
                label="基础与八股",
                category="fundamentals",
                focus=["原理", "边界", "排障"],
                follow_up_budget=1,
                answer_mode=ANSWER_MODE_VOICE,
                question=f"围绕你岗位最常用的 {context.language} / 数据库 / 缓存，请挑一个最容易被问穿的基础点讲清楚原理和边界。",
            ),
            PracticePhase(
                phase_id="design",
                label="设计与综合场景",
                category="design",
                focus=["取舍", "可扩展性", "稳定性"],
                follow_up_budget=1,
                answer_mode=ANSWER_MODE_VOICE,
                question="如果让你设计一个接近真实业务的核心链路，请先给出主流程，再说明你最担心的稳定性问题。",
            ),
            PracticePhase(
                phase_id="coding",
                label="代码与 SQL",
                category="coding",
                focus=["实现", "边界处理", "可读性"],
                follow_up_budget=1,
                answer_mode=ANSWER_MODE_VOICE_CODE,
                question="最后来一道实现题：请写出关键 SQL 或伪代码，并口头解释你的思路和边界处理。",
                written_prompt="请根据题意写出关键 SQL / 伪代码，并保证你的实现能在真实面试里直接讨论。",
                artifact_notes=[
                    "如果是 SQL，请明确你假设的表结构和关键字段。",
                    "如果是代码题，请明确输入、输出和边界条件。",
                    "优先给可运行主干，再补复杂度、索引或异常处理。",
                ],
            ),
            PracticePhase(
                phase_id="closing",
                label="收尾与反问",
                category="closing",
                focus=["总结", "反问"],
                follow_up_budget=0,
                answer_mode=ANSWER_MODE_VOICE,
                question="这场面试最后一个问题：如果你反过来向面试官证明你适合这个岗位，你会怎么收束你的表达？",
            ),
        ],
    )


def _normalize_phase(raw: dict[str, Any], fallback: PracticePhase) -> PracticePhase:
    focus = raw.get("focus") or fallback.focus
    if not isinstance(focus, list):
        focus = fallback.focus
    artifact_notes = raw.get("artifact_notes") or fallback.artifact_notes
    if not isinstance(artifact_notes, list):
        artifact_notes = fallback.artifact_notes
    return PracticePhase(
        phase_id=str(raw.get("phase_id") or fallback.phase_id),
        label=str(raw.get("label") or fallback.label),
        category=str(raw.get("category") or fallback.category),
        focus=[str(item) for item in focus if str(item).strip()] or list(fallback.focus),
        follow_up_budget=max(0, min(2, int(raw.get("follow_up_budget", fallback.follow_up_budget) or 0))),
        answer_mode=_normalize_answer_mode(raw.get("answer_mode"), fallback.answer_mode),
        question=str(raw.get("question") or fallback.question),
        written_prompt=str(raw.get("written_prompt") or fallback.written_prompt),
        artifact_notes=[str(item) for item in artifact_notes if str(item).strip()] or list(fallback.artifact_notes),
    )


def _normalize_blueprint(raw: dict[str, Any], context: PracticeContext) -> PracticeBlueprint:
    fallback = _default_blueprint(context)
    phases_raw = raw.get("phases")
    if not isinstance(phases_raw, list) or not phases_raw:
        return fallback

    by_phase_id: dict[str, dict[str, Any]] = {}
    for item in phases_raw:
        if not isinstance(item, dict):
            continue
        phase_id = str(item.get("phase_id") or "").strip()
        if phase_id:
            by_phase_id[phase_id] = item

    normalized: list[PracticePhase] = []
    for fallback_phase in fallback.phases:
        item = by_phase_id.get(fallback_phase.phase_id, {})
        normalized.append(_normalize_phase(item, fallback_phase))

    return PracticeBlueprint(
        opening_script=str(raw.get("opening_script") or fallback.opening_script),
        phases=normalized,
    )


def _next_turn_id() -> str:
    return f"turn-{uuid.uuid4().hex[:10]}"


def _stage_prompt_for_phase(phase: PracticePhase) -> str:
    stage_title, _ = STAGE_GUIDANCE_MAP.get(phase.phase_id, (phase.label, "warm-open"))
    focus = " / ".join(phase.focus[:3]) if phase.focus else phase.label
    return f"{stage_title}：本轮重点盯 {focus}。"


def _signal_for_phase(phase: PracticePhase, *, is_follow_up: bool = False) -> str:
    _, default_signal = STAGE_GUIDANCE_MAP.get(phase.phase_id, (phase.label, "warm-open"))
    if not is_follow_up:
        return default_signal
    if phase.phase_id in {"project", "design", "coding"}:
        return "stress-test"
    return "probe"


def _transition_line_for_phase(style: str, phase: PracticePhase) -> str:
    style_map = TRANSITION_LINE_MAP.get(style, TRANSITION_LINE_MAP[INTERVIEWER_STYLE_CALM])
    return style_map.get(phase.phase_id, f"下面切到 {phase.label}。")


def _make_turn(
    phase: PracticePhase,
    *,
    question: Optional[str] = None,
    follow_up_of: Optional[str] = None,
    answer_mode: Optional[str] = None,
    interviewer_style: str = INTERVIEWER_STYLE_CALM,
) -> PracticeTurn:
    prompt = (question or phase.question).strip()
    return PracticeTurn(
        turn_id=_next_turn_id(),
        phase_id=phase.phase_id,
        phase_label=phase.label,
        category=phase.category,
        answer_mode=_normalize_answer_mode(answer_mode, phase.answer_mode),
        question=prompt,
        prompt_script=prompt,
        stage_prompt=_stage_prompt_for_phase(phase),
        interviewer_signal=_signal_for_phase(phase, is_follow_up=bool(follow_up_of)),
        transition_line=_transition_line_for_phase(interviewer_style, phase),
        written_prompt=phase.written_prompt,
        artifact_notes=list(phase.artifact_notes),
        follow_up_of=follow_up_of,
        asked_at=time.time(),
    )


def _build_context(
    get_config_fn: Callable[[], Any],
    jd_text: str = "",
    interviewer_style: str = INTERVIEWER_STYLE_CALM,
) -> PracticeContext:
    cfg = get_config_fn()
    audience = _normalize_practice_audience(getattr(cfg, "practice_audience", "campus_intern"))
    audience_label, _, _ = _practice_audience_meta(audience)
    return PracticeContext(
        position=cfg.position,
        language=cfg.language,
        audience=audience,
        audience_label=audience_label,
        resume_text=(getattr(cfg, "resume_text", "") or "").strip(),
        jd_text=(jd_text or "").strip(),
        interviewer_style=_normalize_interviewer_style(interviewer_style),
    )


def _generate_blueprint(
    context: PracticeContext,
    *,
    pick_practice_model: Callable[[], Any],
    request_json_completion: Callable[..., dict[str, Any]],
) -> PracticeBlueprint:
    audience_label, audience_profile, audience_focus = _practice_audience_meta(context.audience)
    prompt = BLUEPRINT_PROMPT.format(
        audience_label=audience_label,
        audience_profile=audience_profile,
        audience_focus=audience_focus,
        resume_text=context.resume_text or "暂无简历摘要，请根据岗位与 JD 自行构造合理候选人背景。",
        jd_text=context.jd_text or "暂无 JD，请围绕岗位常见能力要求生成。",
        position=context.position,
        language=context.language,
    )
    try:
        raw = request_json_completion(pick_practice_model(), prompt, max_tokens=2600)
    except Exception:
        raw = {}
    return _normalize_blueprint(raw, context)
