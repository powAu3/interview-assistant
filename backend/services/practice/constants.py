from __future__ import annotations

PRACTICE_STATUS_IDLE = "idle"
PRACTICE_STATUS_PREPARING = "preparing"
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
