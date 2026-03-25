import time
import json
import re
import threading
from typing import Optional, Generator
from dataclasses import dataclass, field
from core.config import get_config
from services.llm import get_client, _add_tokens, _token_stats


@dataclass
class PracticeQuestion:
    id: int
    question: str
    category: str


@dataclass
class PracticeEvaluation:
    question_id: int
    question: str
    answer: str
    score: float
    feedback: str


@dataclass
class PracticeSession:
    questions: list[PracticeQuestion] = field(default_factory=list)
    evaluations: list[PracticeEvaluation] = field(default_factory=list)
    current_index: int = 0
    status: str = "idle"
    report: str = ""
    created_at: float = field(default_factory=time.time)

    def current_question(self) -> Optional[PracticeQuestion]:
        if 0 <= self.current_index < len(self.questions):
            return self.questions[self.current_index]
        return None

    def is_last_question(self) -> bool:
        return self.current_index >= len(self.questions) - 1

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "questions": [{"id": q.id, "question": q.question, "category": q.category} for q in self.questions],
            "current_index": self.current_index,
            "evaluations": [
                {"question_id": e.question_id, "question": e.question, "answer": e.answer,
                 "score": e.score, "feedback": e.feedback}
                for e in self.evaluations
            ],
            "report": self.report,
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


QUESTION_GEN_PROMPT = """你是一位国内大厂技术面试官，负责 {position} 岗位面试。
本轮候选人维度：{audience_label}。
候选人画像：{audience_profile}
出题要求：{audience_focus}
不要限制为“一面/二面”模板，按真实面试流程自然出题。

## 候选人简历
{resume}

## 出题任务
生成 {count} 道题，优先使用简历信息，题目语言与技术栈尽量贴合 {language} 方向。

## 题型节奏（按比例近似，不必机械）
1) 项目深挖（约 45%-55%，category=project）：
- 必须引用简历中的项目、职责、技术选型或业务场景；
- 重点问“你为什么这么做”“踩过什么坑”“怎么验证效果”“如果重做如何改进”。

2) 技术基础原理（约 25%-35%，category=basic）：
- 围绕简历出现的技术追问底层机制与边界，例如 Java 并发/JVM、MySQL、Redis、Spring；
- 不要出与简历完全无关的冷门题。

3) 场景综合与轻设计（约 15%-25%，category=comprehensive 或 design）：
- 题目要有真实业务感，难度与候选人维度匹配；
- 避免超出候选人阶段的超大规模治理题。

## 题目质量要求
- 每题只问 1 个核心问题，可加 1 句追问；
- 题干建议 40-130 字，口语化，像真实面试官发问；
- 至少 2 题包含明确排查/优化动作（不是纯定义题）；
- 至少 1 题涉及代码或 SQL 实现（category 可用 basic 或 comprehensive）；
- 不要连续 3 题都在同一知识点。

## 分类标签（仅可使用以下四种）
project / basic / design / comprehensive

严格输出 JSON 数组，不要任何额外说明：
[{{"id": 1, "question": "...", "category": "project"}}, ...]"""

QUESTION_GEN_NO_RESUME = """你是一位国内大厂技术面试官，岗位是 {position}，主语言方向是 {language}。
本轮候选人维度：{audience_label}。
候选人画像：{audience_profile}
出题要求：{audience_focus}
不要限制为“一面/二面”模板，按真实面试流程自然出题。
请生成 {count} 道题，要求由浅入深、可追问、重实战。

## 默认候选人画像（无简历时）
- 参考上面的候选人维度，构造贴近其经验阶段的问题背景；
- 问题需要可回答，不要出现明显“经验越级”。

## 出题结构（按比例近似）
1) 基础原理（约 35%-45%，category=basic）：
- Java 基础高频：集合与并发、JVM、Spring、网络协议等；
- 必须结合场景，不要纯背定义。

2) 场景实战（约 35%-45%，category=comprehensive）：
- MySQL/Redis/消息队列/日志排查/性能优化/故障止血等；
- 至少 2 题明确要求“排查步骤或落地动作”。

3) 轻量系统设计（约 15%-25%，category=design）：
- 与候选人维度匹配的设计题，聚焦核心链路和取舍；
- 避免超大规模、超复杂组织协作题。

## 额外要求
- 至少 1 题是代码或 SQL 实现题（category 可用 basic 或 comprehensive）；
- 每题只问 1 个核心问题，可附 1 句追问；
- 题干 40-130 字，语言自然，像现场面试官提问；
- 不要重复考同一知识点，不要连续堆砌超高并发数字。

## 分类标签（仅可使用以下三种）
basic / design / comprehensive

严格输出 JSON 数组，不要任何额外文本：
[{{"id": 1, "question": "...", "category": "basic"}}, ...]"""

EVAL_PROMPT = """你是一位国内大厂技术面试官，本轮候选人维度：{audience_label}。
要求客观、具体、可执行：指出问题时要给正确说法或改进路径，避免空泛批评。

## 面试题
{question}

## 候选人回答
{answer}

## 评价维度（每项 0-10 分）
1. **准确性**：回答是否正确，有无技术错误
2. **完整性**：是否覆盖关键知识点
3. **表达力**：逻辑是否清晰、有条理
4. **深度**：是否展现深入理解

## 输出格式（严格遵守）

### 评分
- 准确性：X/10
- 完整性：X/10
- 表达力：X/10
- 深度：X/10
- **综合：X/10**

### 点评
[2-3 句整体评价，语气温和但中肯]

### 亮点 ✅
- [回答好的地方，至少找一个鼓励点]

### 不足 ⚠️
- [需要改进的地方，给出具体方向；如有错误要写出正确结论]

### 参考思路
[给出更好的回答框架，80-120字，帮助候选人提升]"""

REPORT_PROMPT = """你是一位国内大厂技术面试官，本轮候选人维度：{audience_label}。
请根据以下模拟面试记录，生成综合评价报告。
报告要简洁、可执行，聚焦该候选人维度下的下一步提升，不要写冗长大段背景描述。

## 面试记录
{records}

## 报告格式

### 📊 综合评分：X/100

### 📋 各维度总结
| 维度 | 评分 | 说明 |
|------|------|------|
| 技术能力 | X/10 | ... |
| 项目经验 | X/10 | ... |
| 表达沟通 | X/10 | ... |
| 学习潜力 | X/10 | ... |

### 💪 核心优势
1. ...
2. ...

### 📈 改进建议
1. ...
2. ...
3. ...

### 🎯 面试建议
[通过 / 待定 / 建议加强，并给出 1-2 句总结评语]

### 📚 推荐学习资源
- [针对薄弱点推荐 2-3 个学习方向]

补充要求：
- 综合报告尽量控制在 600-1100 字；
- 各维度说明优先“问题 -> 建议”，避免空话。"""


def generate_questions(count: int = 6) -> list[PracticeQuestion]:
    cfg = get_config()
    m = cfg.get_active_model()
    client = get_client()
    audience = _normalize_practice_audience(getattr(cfg, "practice_audience", "campus_intern"))
    audience_label, audience_profile, audience_focus = _practice_audience_meta(audience)

    if cfg.resume_text:
        prompt = QUESTION_GEN_PROMPT.format(
            position=cfg.position, language=cfg.language,
            audience_label=audience_label,
            audience_profile=audience_profile,
            audience_focus=audience_focus,
            resume=cfg.resume_text, count=count,
        )
    else:
        prompt = QUESTION_GEN_NO_RESUME.format(
            position=cfg.position, language=cfg.language,
            audience_label=audience_label,
            audience_profile=audience_profile,
            audience_focus=audience_focus,
            count=count,
        )

    response = client.chat.completions.create(
        model=m.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.6,
        max_tokens=2048,
    )
    text = response.choices[0].message.content or "[]"
    start = text.find("[")
    end = text.rfind("]") + 1
    if start >= 0 and end > start:
        text = text[start:end]

    raw = json.loads(text)
    return [PracticeQuestion(id=q["id"], question=q["question"], category=q.get("category", "basic")) for q in raw]


def evaluate_answer_stream(question: str, answer: str) -> Generator[str, None, None]:
    cfg = get_config()
    m = cfg.get_active_model()
    client = get_client()
    audience = _normalize_practice_audience(getattr(cfg, "practice_audience", "campus_intern"))
    audience_label, _, _ = _practice_audience_meta(audience)

    prompt = EVAL_PROMPT.format(
        audience_label=audience_label, question=question, answer=answer,
    )

    try:
        response = client.chat.completions.create(
            model=m.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=1500,
            stream=True,
            stream_options={"include_usage": True},
        )
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
            if hasattr(chunk, "usage") and chunk.usage:
                _add_tokens(
                    chunk.usage.prompt_tokens or 0,
                    chunk.usage.completion_tokens or 0,
                )
    except Exception as e:
        yield f"\n\n[评价生成错误: {e}]"


def generate_report_stream(evaluations: list[PracticeEvaluation]) -> Generator[str, None, None]:
    cfg = get_config()
    m = cfg.get_active_model()
    client = get_client()
    audience = _normalize_practice_audience(getattr(cfg, "practice_audience", "campus_intern"))
    audience_label, _, _ = _practice_audience_meta(audience)

    records = ""
    for ev in evaluations:
        records += f"\n### 第 {ev.question_id} 题 [{ev.question}]\n"
        records += f"**候选人回答：** {ev.answer}\n"
        records += f"**评分：** {ev.score}/10\n"
        records += f"**评价：** {ev.feedback[:200]}\n"

    prompt = REPORT_PROMPT.format(audience_label=audience_label, records=records)

    try:
        response = client.chat.completions.create(
            model=m.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=2000,
            stream=True,
            stream_options={"include_usage": True},
        )
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
            if hasattr(chunk, "usage") and chunk.usage:
                _add_tokens(
                    chunk.usage.prompt_tokens or 0,
                    chunk.usage.completion_tokens or 0,
                )
    except Exception as e:
        yield f"\n\n[报告生成错误: {e}]"


def parse_score_from_feedback(feedback: str) -> float:
    """Extract composite score from evaluation feedback text."""
    m = re.search(r'综合[：:]\s*(\d+(?:\.\d+)?)\s*/\s*10', feedback)
    if m:
        return float(m.group(1))
    scores = re.findall(r'(\d+(?:\.\d+)?)\s*/\s*10', feedback)
    if scores:
        nums = [float(s) for s in scores]
        return round(sum(nums) / len(nums), 1)
    return 5.0
