import time
import json
import re
import threading
from typing import Optional, Generator
from dataclasses import dataclass, field
from core.config import get_config
from services.llm import get_client


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


QUESTION_GEN_PROMPT = """你是一位资深的{position}技术面试官，正在为候选人进行模拟面试。
你必须仔细阅读简历，针对简历中提到的具体项目、技术栈和工作经历来出题。

## 候选人简历
{resume}

## 出题规则（共 {count} 题，严格遵守比例）

项目深挖题（约占 50%）：
- 必须直接引用简历中的具体项目名称、技术选型或业务场景
- 问"为什么选X而不是Y"、"遇到过什么问题"、"怎么优化的"、"如果重新设计会怎么改"
- 示例："你简历里提到用 Redis 做缓存，遇到过缓存穿透或雪崩吗？当时怎么处理的？"

技术原理题（约占 30%）：
- 基于简历中出现的技术栈深入追问原理
- 简历提到 MySQL 就问索引/事务/锁，提到并发就问线程安全/锁机制
- 不要问跟简历技术栈无关的内容

系统设计/综合题（约占 20%）：
- 结合简历中的业务场景出设计题
- 示例："你做过XX系统，如果日活从1万增长到100万，架构怎么演进？"

## 分类标签
每题标记为 project / basic / design / comprehensive

严格输出 JSON 数组，不要其他内容：
[{{"id": 1, "question": "...", "category": "project"}}, ...]"""

QUESTION_GEN_NO_RESUME = """你是一位资深的{position}技术面试官。
生成 {count} 道 {language} 方向的面试题（由浅入深），覆盖实际工作场景。

## 出题规则
- 不要只问概念定义（"什么是XX"），要问应用场景和实战问题
- 好的问题示例："线上服务 MySQL 慢查询怎么排查？""Python 多线程和多进程分别适合什么场景？"
- 坏的问题示例："请解释什么是面向对象编程"（太教科书了）

比例分配：
- 基础概念+原理（40%）：核心原理和最佳实践，带场景
- 实战问题（40%）：生产环境常见问题、性能调优、故障排查
- 系统设计（20%）：综合开放性设计题

每题分类为 basic / design / comprehensive

严格输出 JSON 数组，不要其他内容：
[{{"id": 1, "question": "...", "category": "basic"}}, ...]"""

EVAL_PROMPT = """你是一位资深的{position}技术面试官。请评价候选人对以下问题的回答。

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
- [需要改进的地方，给出具体方向]

### 参考思路
[给出更好的回答框架，80-120字，帮助候选人提升]"""

REPORT_PROMPT = """你是一位资深的{position}技术面试官。请根据以下模拟面试记录，生成综合评价报告。

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
- [针对薄弱点推荐 2-3 个学习方向]"""


def generate_questions(count: int = 6) -> list[PracticeQuestion]:
    cfg = get_config()
    m = cfg.get_active_model()
    client = get_client()

    if cfg.resume_text:
        prompt = QUESTION_GEN_PROMPT.format(
            position=cfg.position, language=cfg.language,
            resume=cfg.resume_text, count=count,
        )
    else:
        prompt = QUESTION_GEN_NO_RESUME.format(
            position=cfg.position, language=cfg.language, count=count,
        )

    response = client.chat.completions.create(
        model=m.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.8,
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

    prompt = EVAL_PROMPT.format(
        position=cfg.position, question=question, answer=answer,
    )

    try:
        response = client.chat.completions.create(
            model=m.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=1500,
            stream=True,
        )
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except Exception as e:
        yield f"\n\n[评价生成错误: {e}]"


def generate_report_stream(evaluations: list[PracticeEvaluation]) -> Generator[str, None, None]:
    cfg = get_config()
    m = cfg.get_active_model()
    client = get_client()

    records = ""
    for ev in evaluations:
        records += f"\n### 第 {ev.question_id} 题 [{ev.question}]\n"
        records += f"**候选人回答：** {ev.answer}\n"
        records += f"**评分：** {ev.score}/10\n"
        records += f"**评价：** {ev.feedback[:200]}\n"

    prompt = REPORT_PROMPT.format(position=cfg.position, records=records)

    try:
        response = client.chat.completions.create(
            model=m.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=2000,
            stream=True,
        )
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
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
