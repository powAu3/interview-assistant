from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from core.config import get_config
from services.llm import _add_tokens, get_client_for_model

PRACTICE_STATUS_IDLE = "idle"
PRACTICE_STATUS_PREPARING = "preparing"
PRACTICE_STATUS_INTERVIEWER_SPEAKING = "interviewer_speaking"
PRACTICE_STATUS_AWAITING_ANSWER = "awaiting_answer"
PRACTICE_STATUS_THINKING = "thinking_next_turn"
PRACTICE_STATUS_DEBRIEFING = "debriefing"
PRACTICE_STATUS_FINISHED = "finished"

ANSWER_MODE_VOICE = "voice"
ANSWER_MODE_CODE = "code"
ANSWER_MODE_VOICE_CODE = "voice+code"
ANSWER_MODE_OPTIONS = {ANSWER_MODE_VOICE, ANSWER_MODE_CODE, ANSWER_MODE_VOICE_CODE}

DECISION_FOLLOW_UP = "follow_up"
DECISION_ADVANCE = "advance"
DECISION_FINISH = "finish"

INTERVIEWER_STYLE_CALM = "calm_pressing"
INTERVIEWER_STYLE_SUPPORTIVE = "supportive_senior"
INTERVIEWER_STYLE_PRESSURE = "pressure_bigtech"
INTERVIEWER_STYLE_OPTIONS = {
    INTERVIEWER_STYLE_CALM,
    INTERVIEWER_STYLE_SUPPORTIVE,
    INTERVIEWER_STYLE_PRESSURE,
}

INTERVIEWER_PERSONA_MAP = {
    INTERVIEWER_STYLE_CALM: {
        "tone": "calm-pressing",
        "style": "像国内一线技术面试官，礼貌但不放水，会追问证据、取舍和复盘。",
        "project_bias": "项目题优先追 why / how / validation，不让候选人停在结果层。",
        "bar_raising_rule": "回答一旦缺少证据、边界或实现，就优先追问而不是轻易放过。",
    },
    INTERVIEWER_STYLE_SUPPORTIVE: {
        "tone": "supportive-senior",
        "style": "像愿意带人的资深面试官，语气温和，但会用结构化追问逼你把能力讲实。",
        "project_bias": "项目题先帮候选人立主线，再追细节和复盘。",
        "bar_raising_rule": "先让候选人把答案讲完整，再逐步抬高追问强度。",
    },
    INTERVIEWER_STYLE_PRESSURE: {
        "tone": "pressure-bigtech",
        "style": "像大厂技术面，切题更快、追问更锋利，优先盯风险、边界和实现细节。",
        "project_bias": "项目题默认追最难的取舍和线上失误，不接受泛泛而谈。",
        "bar_raising_rule": "只要回答不够硬，就立刻追加更尖锐的问题。",
    },
}

STAGE_GUIDANCE_MAP = {
    "opening": ("开场与岗位匹配", "warm-open"),
    "project": ("项目深挖与证据追问", "probe"),
    "fundamentals": ("基础原理与边界校验", "pressure-check"),
    "design": ("场景设计与方案取舍", "stress-test"),
    "coding": ("代码 / SQL 与实现解释", "implementation-check"),
    "closing": ("总结收束与反问", "wrap-up"),
}

TRANSITION_LINE_MAP = {
    INTERVIEWER_STYLE_CALM: {
        "opening": "我们先从开场开始，你把主线讲稳一点。",
        "project": "现在我想往项目里压一层，重点听你的判断和验证。",
        "fundamentals": "项目先放一下，我们回到基础原理，看你有没有真正吃透。",
        "design": "下面切到设计题，我更关注你的取舍，而不是大词。",
        "coding": "最后来一道实现题，边写边解释你的边界处理。",
        "closing": "收个尾，你把今天这场面试的自我证明讲完整。",
    },
    INTERVIEWER_STYLE_SUPPORTIVE: {
        "opening": "我们先轻一点，从自我介绍和岗位匹配开始。",
        "project": "下面我想顺着你的经历往下深挖一个项目。",
        "fundamentals": "主线有了，我们回到基础，看看你能不能讲得清楚又不死板。",
        "design": "接下来做一题场景设计，你先抓住主流程就好。",
        "coding": "最后加一题实现，把你的思路写出来，我更看重解释。",
        "closing": "最后一轮，我们把这场面试收束一下。",
    },
    INTERVIEWER_STYLE_PRESSURE: {
        "opening": "先别铺太长，直接用最短时间把你值不值得继续聊讲出来。",
        "project": "现在进项目题，我会直接盯最难的决策和失误复盘。",
        "fundamentals": "项目先停，我们回基础，我要确认你不是只会讲故事。",
        "design": "下面切设计题，不要铺概念，直接讲主链路和风险。",
        "coding": "最后实现题，把代码写出来，不要只口头说思路。",
        "closing": "最后收束一下，用最短的话证明你为什么应该过这一轮。",
    },
}


@dataclass
class PracticeContext:
    position: str
    language: str
    audience: str
    audience_label: str
    resume_text: str
    jd_text: str
    interviewer_style: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "position": self.position,
            "language": self.language,
            "audience": self.audience,
            "audience_label": self.audience_label,
            "resume_text": self.resume_text,
            "jd_text": self.jd_text,
            "interviewer_style": self.interviewer_style,
        }


@dataclass
class PracticePhase:
    phase_id: str
    label: str
    category: str
    focus: list[str] = field(default_factory=list)
    follow_up_budget: int = 0
    answer_mode: str = ANSWER_MODE_VOICE
    question: str = ""
    written_prompt: str = ""
    artifact_notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "phase_id": self.phase_id,
            "label": self.label,
            "category": self.category,
            "focus": list(self.focus),
            "follow_up_budget": self.follow_up_budget,
            "answer_mode": self.answer_mode,
            "question": self.question,
            "written_prompt": self.written_prompt,
            "artifact_notes": list(self.artifact_notes),
        }


@dataclass
class PracticeBlueprint:
    opening_script: str = ""
    phases: list[PracticePhase] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "opening_script": self.opening_script,
            "phases": [phase.to_dict() for phase in self.phases],
        }


@dataclass
class PracticeTurn:
    turn_id: str
    phase_id: str
    phase_label: str
    category: str
    answer_mode: str
    question: str
    prompt_script: str
    stage_prompt: str = ""
    interviewer_signal: str = "warm-open"
    transition_line: str = ""
    written_prompt: str = ""
    artifact_notes: list[str] = field(default_factory=list)
    asked_at: float = field(default_factory=time.time)
    follow_up_of: Optional[str] = None
    transcript: str = ""
    code_text: str = ""
    duration_ms: int = 0
    decision: Optional[str] = None
    decision_reason: str = ""
    evidence: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    scorecard: dict[str, int] = field(default_factory=dict)

    def to_dict(self, reveal_feedback: bool = False) -> dict[str, Any]:
        data = {
            "turn_id": self.turn_id,
            "phase_id": self.phase_id,
            "phase_label": self.phase_label,
            "category": self.category,
            "answer_mode": self.answer_mode,
            "question": self.question,
            "prompt_script": self.prompt_script,
            "stage_prompt": self.stage_prompt,
            "interviewer_signal": self.interviewer_signal,
            "transition_line": self.transition_line,
            "written_prompt": self.written_prompt,
            "artifact_notes": list(self.artifact_notes),
            "asked_at": self.asked_at,
            "follow_up_of": self.follow_up_of,
            "transcript": self.transcript,
            "code_text": self.code_text,
            "duration_ms": self.duration_ms,
        }
        if reveal_feedback:
            data.update(
                {
                    "decision": self.decision,
                    "decision_reason": self.decision_reason,
                    "evidence": list(self.evidence),
                    "strengths": list(self.strengths),
                    "risks": list(self.risks),
                    "scorecard": dict(self.scorecard),
                }
            )
        return data


@dataclass
class PracticeScoreLedgerEntry:
    turn_id: str
    phase_id: str
    decision: str
    scorecard: dict[str, int] = field(default_factory=dict)
    evidence: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    answer_mode: str = ANSWER_MODE_VOICE

    def to_dict(self) -> dict[str, Any]:
        return {
            "turn_id": self.turn_id,
            "phase_id": self.phase_id,
            "decision": self.decision,
            "scorecard": dict(self.scorecard),
            "evidence": list(self.evidence),
            "strengths": list(self.strengths),
            "risks": list(self.risks),
            "answer_mode": self.answer_mode,
        }


@dataclass
class PracticeSession:
    status: str = PRACTICE_STATUS_IDLE
    context: Optional[PracticeContext] = None
    blueprint: Optional[PracticeBlueprint] = None
    current_phase_index: int = 0
    current_turn: Optional[PracticeTurn] = None
    turn_history: list[PracticeTurn] = field(default_factory=list)
    hidden_score_ledger: list[PracticeScoreLedgerEntry] = field(default_factory=list)
    interviewer_persona: dict[str, str] = field(default_factory=dict)
    report_markdown: str = ""
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None

    def to_dict(self, reveal_feedback: bool = False) -> dict[str, Any]:
        return {
            "status": self.status,
            "context": self.context.to_dict() if self.context else None,
            "blueprint": self.blueprint.to_dict() if self.blueprint else None,
            "current_phase_index": self.current_phase_index,
            "current_turn": (
                self.current_turn.to_dict(reveal_feedback=reveal_feedback)
                if self.current_turn
                else None
            ),
            "turn_history": [
                turn.to_dict(reveal_feedback=reveal_feedback) for turn in self.turn_history
            ],
            "interviewer_persona": dict(self.interviewer_persona),
            "report_markdown": self.report_markdown if reveal_feedback else "",
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }


_practice: Optional[PracticeSession] = None
_lock = threading.Lock()


def get_practice() -> PracticeSession:
    global _practice
    with _lock:
        if _practice is None:
            _practice = PracticeSession()
        return _practice


def reset_practice() -> PracticeSession:
    global _practice
    with _lock:
        _practice = PracticeSession()
        return _practice


def _normalize_practice_audience(raw: Optional[str]) -> str:
    v = (raw or "").strip().lower()
    return "social" if v == "social" else "campus_intern"


def _normalize_interviewer_style(raw: Optional[str]) -> str:
    value = (raw or "").strip().lower()
    return value if value in INTERVIEWER_STYLE_OPTIONS else INTERVIEWER_STYLE_CALM


def _practice_model_ready(model_cfg) -> bool:
    return bool(
        getattr(model_cfg, "enabled", True)
        and model_cfg.api_key
        and model_cfg.api_key not in ("", "sk-your-api-key-here")
    )


def _pick_practice_model():
    from api.common import get_model_health

    cfg = get_config()
    if not cfg.models:
        raise ValueError("没有可用的练习模型：请至少配置一个模型")

    active = max(0, min(int(cfg.active_model), len(cfg.models) - 1))
    order = [active] + [i for i in range(len(cfg.models)) if i != active]

    for respect_health in (True, False):
        for i in order:
            model_cfg = cfg.models[i]
            if not _practice_model_ready(model_cfg):
                continue
            if respect_health and get_model_health(i) == "error":
                continue
            return model_cfg

    raise ValueError("没有可用的练习模型：请至少启用一个已配置 API Key 的模型")


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

TURN_REVIEW_PROMPT = """你是一位真实技术面试官，要根据候选人的回答，决定下一步是追问、换题推进，还是结束整场面试。

## 面试上下文
- 岗位：{position}
- 语言方向：{language}
- 候选人维度：{audience_label}
- 当前阶段：{phase_label} / {category}
- 当前阶段目标：{focus}
- 当前阶段 follow_up_budget：{follow_up_budget}
- 当前阶段已追问次数：{follow_up_count}

## 当前问题
{question}

## 候选人回答（语音转写）
{transcript}

## 候选人代码 / SQL
{code_text}

## 输出要求
严格输出 JSON：
{{
  "decision": "follow_up" | "advance" | "finish",
  "reason": "...",
  "next_question": "...",
  "next_answer_mode": "voice" | "code" | "voice+code",
  "scorecard": {{
    "technical_depth": 0-10,
    "communication": 0-10,
    "job_fit": 0-10,
    "confidence": 0-10
  }},
  "evidence": ["..."],
  "strengths": ["..."],
  "risks": ["..."]
}}

判定规则：
- 回答过短、缺少关键证据、没回答 why/how/验证时，优先 follow_up；
- 当前阶段目标已覆盖，输出 advance；
- 如果已经是最后阶段且回答基本完成，可输出 finish；
- coding 阶段如果没有 code_text 且题目明显要求写代码/SQL，优先 follow_up。"""

DEBRIEF_PROMPT = """你是一位技术面试官，请基于整场模拟面试记录输出最终复盘。

## 面试上下文
- 岗位：{position}
- 语言方向：{language}
- 候选人维度：{audience_label}
- 简历摘要：{resume_text}
- JD 摘要：{jd_text}

## 回合记录
{turn_records}

## 输出格式
### 综合 verdict
- 结论：...
- 总评：...

### 阶段表现
- 开场与匹配：...
- 项目深挖：...
- 基础与八股：...
- 设计/综合：...
- 代码 / SQL：...

### 与简历/JD 的贴合度
- ...

### 表达与临场问题
- ...

### 知识盲点
- ...

### 下一步建议
1. ...
2. ...
3. ...

### 示范回答方向
- ..."""


def _normalize_answer_mode(raw: Any, fallback: str = ANSWER_MODE_VOICE) -> str:
    value = str(raw or fallback).strip().lower()
    if value in ANSWER_MODE_OPTIONS:
        return value
    return fallback


def _json_from_text(text: str) -> Any:
    text = (text or "").strip()
    if not text:
        return {}
    if text[0] not in "[{":
        obj_start = text.find("{")
        arr_start = text.find("[")
        starts = [x for x in [obj_start, arr_start] if x >= 0]
        if starts:
            text = text[min(starts):]
    if text and text[0] == "{":
        end = text.rfind("}")
        if end >= 0:
            text = text[: end + 1]
    elif text and text[0] == "[":
        end = text.rfind("]")
        if end >= 0:
            text = text[: end + 1]
    return json.loads(text)


def _request_json_completion(model_cfg, prompt: str, *, max_tokens: int = 2200) -> dict[str, Any]:
    client = get_client_for_model(model_cfg)
    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=max_tokens,
    )
    if getattr(response, "usage", None):
        _add_tokens(
            response.usage.prompt_tokens or 0,
            response.usage.completion_tokens or 0,
        )
    text = response.choices[0].message.content or "{}"
    raw = _json_from_text(text)
    if isinstance(raw, dict):
        return raw
    return {}


def _request_text_completion(model_cfg, prompt: str, *, max_tokens: int = 1800) -> str:
    client = get_client_for_model(model_cfg)
    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5,
        max_tokens=max_tokens,
    )
    if getattr(response, "usage", None):
        _add_tokens(
            response.usage.prompt_tokens or 0,
            response.usage.completion_tokens or 0,
        )
    return (response.choices[0].message.content or "").strip()


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


def _make_turn(phase: PracticePhase, *, question: Optional[str] = None, follow_up_of: Optional[str] = None,
               answer_mode: Optional[str] = None, interviewer_style: str = INTERVIEWER_STYLE_CALM) -> PracticeTurn:
    q = (question or phase.question).strip()
    return PracticeTurn(
        turn_id=_next_turn_id(),
        phase_id=phase.phase_id,
        phase_label=phase.label,
        category=phase.category,
        answer_mode=_normalize_answer_mode(answer_mode, phase.answer_mode),
        question=q,
        prompt_script=q,
        stage_prompt=_stage_prompt_for_phase(phase),
        interviewer_signal=_signal_for_phase(phase, is_follow_up=bool(follow_up_of)),
        transition_line=_transition_line_for_phase(interviewer_style, phase),
        written_prompt=phase.written_prompt,
        artifact_notes=list(phase.artifact_notes),
        follow_up_of=follow_up_of,
    )


def _build_context(jd_text: str = "", interviewer_style: str = INTERVIEWER_STYLE_CALM) -> PracticeContext:
    cfg = get_config()
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


def start_practice_session(jd_text: str = "", interviewer_style: str = INTERVIEWER_STYLE_CALM) -> PracticeSession:
    session = reset_practice()
    session.status = PRACTICE_STATUS_PREPARING

    context = _build_context(jd_text, interviewer_style=interviewer_style)
    model_cfg = _pick_practice_model()
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
        raw = _request_json_completion(model_cfg, prompt, max_tokens=2600)
    except Exception:
        raw = {}

    blueprint = _normalize_blueprint(raw, context)
    session.context = context
    session.blueprint = blueprint
    session.interviewer_persona = dict(INTERVIEWER_PERSONA_MAP[context.interviewer_style])
    session.current_phase_index = 0
    session.current_turn = _make_turn(blueprint.phases[0], interviewer_style=context.interviewer_style)
    session.status = PRACTICE_STATUS_AWAITING_ANSWER
    return session


def _current_phase(session: PracticeSession) -> PracticePhase:
    if not session.blueprint or not session.blueprint.phases:
        raise ValueError("当前没有可用的面试蓝图")
    index = max(0, min(session.current_phase_index, len(session.blueprint.phases) - 1))
    return session.blueprint.phases[index]


def _phase_follow_up_count(session: PracticeSession, phase_id: str) -> int:
    return sum(1 for turn in session.turn_history if turn.phase_id == phase_id and turn.follow_up_of)


def _fallback_turn_review(session: PracticeSession, phase: PracticePhase, turn: PracticeTurn) -> dict[str, Any]:
    transcript = turn.transcript.strip()
    code_text = turn.code_text.strip()
    short_answer = len(transcript) < 55 and len(code_text) < 12
    missing_code = phase.answer_mode == ANSWER_MODE_VOICE_CODE and not code_text
    follow_up_count = _phase_follow_up_count(session, phase.phase_id)
    lacks_evidence = not any(token in transcript for token in ["因为", "所以", "验证", "监控", "压测", "复盘", "指标", "取舍"])
    project_needs_probe = phase.phase_id == "project" and lacks_evidence
    design_needs_probe = phase.phase_id == "design" and not any(
        token in transcript for token in ["流程", "链路", "容量", "限流", "降级", "风险", "扩展"]
    )

    if (short_answer or missing_code or project_needs_probe or design_needs_probe) and follow_up_count < phase.follow_up_budget:
        if missing_code:
            next_question = "你刚才主要在口头解释，请把关键 SQL / 伪代码补出来，并说明边界处理。"
            next_mode = ANSWER_MODE_VOICE_CODE
        elif project_needs_probe:
            next_question = "我先追问细一点：你当时为什么这么做，怎么验证结果，复盘后会改哪一处？"
            next_mode = phase.answer_mode
        elif design_needs_probe:
            next_question = "先别铺太大，回到主链路本身：核心流程怎么走，最先要压的风险点是什么？"
            next_mode = phase.answer_mode
        else:
            next_question = "你刚才先给了结论，但我想继续追问一下：具体怎么做、怎么验证、结果如何？"
            next_mode = phase.answer_mode
        return {
            "decision": DECISION_FOLLOW_UP,
            "reason": "回答还不够完整，需要继续追问关键证据。",
            "next_question": next_question,
            "next_answer_mode": next_mode,
            "scorecard": {
                "technical_depth": 5,
                "communication": 6,
                "job_fit": 6,
                "confidence": 6,
            },
            "evidence": ["回答偏概括，需要更多细节、证据或实现。"],
            "strengths": ["能先给出方向"],
            "risks": ["细节、证据或取舍说明不足"],
        }

    last_phase = bool(session.blueprint and session.current_phase_index >= len(session.blueprint.phases) - 1)
    return {
        "decision": DECISION_FINISH if last_phase else DECISION_ADVANCE,
        "reason": "当前阶段已经覆盖核心目标，可以推进到下一段。",
        "next_question": "",
        "next_answer_mode": phase.answer_mode,
        "scorecard": {
            "technical_depth": 7,
            "communication": 7,
            "job_fit": 7,
            "confidence": 7,
        },
        "evidence": ["回答覆盖了当前阶段的大部分目标。"],
        "strengths": ["结构基本清晰"],
        "risks": ["可以继续提升回答密度"],
    }


def _review_current_turn(session: PracticeSession, phase: PracticePhase, turn: PracticeTurn) -> dict[str, Any]:
    audience_label, _, _ = _practice_audience_meta(session.context.audience if session.context else "campus_intern")
    prompt = TURN_REVIEW_PROMPT.format(
        position=session.context.position if session.context else "岗位",
        language=session.context.language if session.context else "语言",
        audience_label=audience_label,
        phase_label=phase.label,
        category=phase.category,
        focus=" / ".join(phase.focus),
        follow_up_budget=phase.follow_up_budget,
        follow_up_count=_phase_follow_up_count(session, phase.phase_id),
        question=turn.question,
        transcript=turn.transcript or "（无）",
        code_text=turn.code_text or "（无）",
    )
    model_cfg = _pick_practice_model()
    try:
        raw = _request_json_completion(model_cfg, prompt, max_tokens=1600)
        if not raw:
            raise ValueError("empty turn review")
        return raw
    except Exception:
        return _fallback_turn_review(session, phase, turn)


def _apply_turn_review(session: PracticeSession, phase: PracticePhase, turn: PracticeTurn,
                       review: dict[str, Any]) -> PracticeSession:
    decision = str(review.get("decision") or DECISION_ADVANCE).strip().lower()
    if decision not in {DECISION_FOLLOW_UP, DECISION_ADVANCE, DECISION_FINISH}:
        decision = DECISION_ADVANCE

    turn.decision = decision
    turn.decision_reason = str(review.get("reason") or "").strip()
    turn.evidence = [str(item) for item in (review.get("evidence") or []) if str(item).strip()]
    turn.strengths = [str(item) for item in (review.get("strengths") or []) if str(item).strip()]
    turn.risks = [str(item) for item in (review.get("risks") or []) if str(item).strip()]
    scorecard = review.get("scorecard") or {}
    if not isinstance(scorecard, dict):
        scorecard = {}
    turn.scorecard = {
        str(key): max(0, min(10, int(value)))
        for key, value in scorecard.items()
        if str(key).strip()
    }
    session.turn_history.append(turn)
    session.hidden_score_ledger.append(
        PracticeScoreLedgerEntry(
            turn_id=turn.turn_id,
            phase_id=turn.phase_id,
            decision=decision,
            scorecard=dict(turn.scorecard),
            evidence=list(turn.evidence),
            strengths=list(turn.strengths),
            risks=list(turn.risks),
            answer_mode=turn.answer_mode,
        )
    )

    follow_up_count = _phase_follow_up_count(session, phase.phase_id)
    if decision == DECISION_FOLLOW_UP and follow_up_count <= phase.follow_up_budget:
        session.current_turn = _make_turn(
            phase,
            question=str(review.get("next_question") or phase.question),
            follow_up_of=turn.turn_id,
            answer_mode=_normalize_answer_mode(review.get("next_answer_mode"), phase.answer_mode),
            interviewer_style=session.context.interviewer_style if session.context else INTERVIEWER_STYLE_CALM,
        )
        session.status = PRACTICE_STATUS_AWAITING_ANSWER
        return session

    is_last_phase = bool(session.blueprint and session.current_phase_index >= len(session.blueprint.phases) - 1)
    if decision == DECISION_FINISH or is_last_phase:
        session.current_turn = None
        session.status = PRACTICE_STATUS_DEBRIEFING
        session.report_markdown = _generate_debrief_report(session)
        session.finished_at = time.time()
        session.status = PRACTICE_STATUS_FINISHED
        return session

    session.current_phase_index += 1
    next_phase = _current_phase(session)
    next_question = str(review.get("next_question") or next_phase.question).strip()
    next_mode = _normalize_answer_mode(review.get("next_answer_mode"), next_phase.answer_mode)
    session.current_turn = _make_turn(
        next_phase,
        question=next_question,
        answer_mode=next_mode,
        interviewer_style=session.context.interviewer_style if session.context else INTERVIEWER_STYLE_CALM,
    )
    session.status = PRACTICE_STATUS_AWAITING_ANSWER
    return session


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
    session = _apply_turn_review(session, phase, turn, review)
    return session


def _fallback_debrief_report(session: PracticeSession) -> str:
    strengths = []
    risks = []
    for entry in session.hidden_score_ledger:
        strengths.extend(entry.strengths)
        risks.extend(entry.risks)
    strengths = strengths[:3] or ["回答整体有主线，不会完全失控。"]
    risks = risks[:3] or ["部分问题还可以继续深挖到证据和取舍。"]
    return "\n".join(
        [
            "### 综合 verdict",
            "- 结论：建议继续练这一轮的项目深挖和设计表达。",
            "- 总评：整场回答具备基本结构，但还可以把证据、取舍和复盘讲得更完整。",
            "",
            "### 阶段表现",
            "- 开场与匹配：能够进入主题，但还可以更像正式面试回答。",
            "- 项目深挖：建议多讲为什么、怎么验证、踩坑与改进。",
            "- 基础与八股：需要把原理和边界讲得更扎实。",
            "- 设计/综合：先讲主流程，再讲取舍和风险。",
            "- 代码 / SQL：把核心实现和边界条件写得更清楚。",
            "",
            "### 与简历/JD 的贴合度",
            f"- JD 重点：{session.context.jd_text or '未提供 JD，按岗位常见要求评估。'}",
            "",
            "### 表达与临场问题",
            "- 尽量把回答压缩成“结论 -> 过程 -> 验证 -> 结果”。",
            "",
            "### 知识盲点",
            *[f"- {item}" for item in risks],
            "",
            "### 下一步建议",
            "1. 把项目题用 STAR + why/how/impact 重新梳理一次。",
            "2. 每道基础题都补一句边界与线上经验。",
            "3. 代码/SQL 题练到可以一边写一边解释。",
            "",
            "### 示范回答方向",
            *[f"- {item}" for item in strengths],
        ]
    ).strip()


def _generate_debrief_report(session: PracticeSession) -> str:
    if not session.context:
        return _fallback_debrief_report(session)

    turn_records = []
    for turn in session.turn_history:
        turn_records.append(
            "\n".join(
                [
                    f"## {turn.phase_label} / {turn.category}",
                    f"- 问题：{turn.question}",
                    f"- 回答：{turn.transcript or '（未提供）'}",
                    f"- 代码：{turn.code_text or '（无）'}",
                    f"- 决策：{turn.decision or 'advance'}",
                    f"- 证据：{'；'.join(turn.evidence) or '（无）'}",
                    f"- 优点：{'；'.join(turn.strengths) or '（无）'}",
                    f"- 风险：{'；'.join(turn.risks) or '（无）'}",
                ]
            )
        )
    prompt = DEBRIEF_PROMPT.format(
        position=session.context.position,
        language=session.context.language,
        audience_label=session.context.audience_label,
        resume_text=session.context.resume_text or "暂无简历摘要",
        jd_text=session.context.jd_text or "暂无 JD",
        turn_records="\n\n".join(turn_records) or "暂无有效作答记录",
    )
    try:
        model_cfg = _pick_practice_model()
        text = _request_text_completion(model_cfg, prompt, max_tokens=1800)
        return text or _fallback_debrief_report(session)
    except Exception:
        return _fallback_debrief_report(session)


def finish_practice_session() -> PracticeSession:
    session = get_practice()
    if session.status == PRACTICE_STATUS_FINISHED:
        return session
    if not session.turn_history:
        raise ValueError("还没有完成任何有效回答")
    session.current_turn = None
    session.status = PRACTICE_STATUS_DEBRIEFING
    session.report_markdown = _generate_debrief_report(session)
    session.finished_at = time.time()
    session.status = PRACTICE_STATUS_FINISHED
    return session
