"""Resume × JD Grounded Agent (P2-agent-resume).

把原本「prompt → 一次性出全文」的简历优化拆成三步:

1) JD 关键能力抽取(JSON 输出,小模型 / low temperature)
2) 命中 / 缺失分析(逐条引用简历行号 L<n>,流式 Markdown)
3) 改写建议(必须引用对应 L<n> 的原文,禁止编造经历)

简历正文在送入步骤 2、3 前预先打编号,模型必须用 L<n> 引用。
任何一步失败都会自动降级到旧的单次分析,保证可用性。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Generator, List, Tuple

from core.config import get_config
from services.llm import _add_tokens, get_client

_log = logging.getLogger("resume_optimizer")


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_JD_EXTRACT_PROMPT = """你是资深技术招聘顾问。请从下面 JD 中抽取候选人需要具备的关键能力,
按 must_have(硬性必需)、nice_to_have(加分项)、soft_skills(软实力) 三类分组。
每条尽量是简洁的能力词或场景短语,不要照抄整段 JD。
仅输出 JSON,不要任何其他文字、不要 ```json 围栏。

JD:
{jd}

输出格式:
{{
  "must_have": ["..."],
  "nice_to_have": ["..."],
  "soft_skills": ["..."]
}}
"""

_MATCH_PROMPT = """你是简历审核员。下面给出 JD 关键能力清单和已编号的简历正文。
请逐条判断每条能力是否在简历中有体现:
- 命中:用粗体写出能力名,然后给出对应简历行号(必须是 L<n> 形式,可多个),并附极简引用片段。
- 缺失:用粗体写出能力名,简短建议在简历哪个段落补充。

仅输出 Markdown,不要 JSON,不要重复输出能力清单本身。
不要编造行号,只能用清单里出现过的 L<n>。

JD 关键能力:
{requirements}

简历(每行已加编号):
{resume}

按下面结构输出:
### ✅ 命中能力
- **<能力>** — L12, L18 / "原文极简引用"
- ...

### ⚠️ 缺失能力
- **<能力>** — 建议在 <段落> 增加 ...
- ...
"""

_REWRITE_PROMPT = """你是资深简历教练。基于上一步的命中/缺失分析,
给出 3-6 条针对性的简历改写建议。

硬性要求:
1. 每条建议必须用 L<n> 引用要修改的具体行;若涉及新增内容,标注 "在 L<n> 之后插入"。
2. 引用的"原文"必须直接抄自简历(不可改写),"改写"在原文基础上加强表达。
3. 严禁编造候选人没有的经历或技术栈,只能基于现有内容做加强、重排、量化。
4. 每条说明对应 JD 哪条要求(从命中/缺失分析里挑)。

JD:
{jd}

命中/缺失分析:
{analysis}

简历(每行已加编号):
{resume}

输出 Markdown:
### 📝 改写建议

#### 建议 1 — <一句话标题>
- 引用: **L<n>** / "原文片段"
- 改写: <改写后的版本>
- 对应 JD 要求: <来自上一步的能力名>
- 理由: <为什么这样改>

#### 建议 2 — ...
"""

_FALLBACK_PROMPT = """你是资深技术招聘顾问。简略对比下方 JD 与简历并给出 Markdown 形式的优化建议。

## JD
{jd}

## 简历
{resume}

输出包括:匹配度评分、命中亮点、缺失关键词、面试重点。
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _number_resume(text: str) -> Tuple[str, Dict[int, str]]:
    """给简历每个非空行打 L<n> 前缀,返回 (numbered_text, {n: 原文})."""
    out: List[str] = []
    line_map: Dict[int, str] = {}
    counter = 0
    for raw in text.splitlines():
        stripped = raw.rstrip()
        if not stripped.strip():
            out.append("")
            continue
        counter += 1
        line_map[counter] = stripped
        out.append(f"L{counter}: {stripped}")
    return "\n".join(out), line_map


_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


def _try_parse_json(raw: str) -> Dict[str, Any]:
    if not raw:
        return {}
    cleaned = _JSON_FENCE_RE.sub("", raw.strip())
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    # 退而求其次:尝试匹配第一个 {...} 块
    m = re.search(r"\{[\s\S]*\}", cleaned)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return {}


def _format_requirements(parsed: Dict[str, Any], raw_fallback: str) -> str:
    if not parsed:
        return f"```\n{raw_fallback.strip()}\n```"

    def _bullets(items: Any) -> str:
        if not isinstance(items, list) or not items:
            return "- (无)"
        return "\n".join(f"- {str(x).strip()}" for x in items if str(x).strip())

    parts: List[str] = []
    parts.append("**必需技能 / 经验**")
    parts.append(_bullets(parsed.get("must_have")))
    nice = parsed.get("nice_to_have")
    if isinstance(nice, list) and nice:
        parts.append("")
        parts.append("**加分项**")
        parts.append(_bullets(nice))
    soft = parsed.get("soft_skills")
    if isinstance(soft, list) and soft:
        parts.append("")
        parts.append("**软实力**")
        parts.append(_bullets(soft))
    return "\n".join(parts)


def _requirements_for_prompt(parsed: Dict[str, Any], raw_fallback: str) -> str:
    """给后续步骤模型用,纯文本紧凑版本。"""
    if not parsed:
        return raw_fallback.strip()

    def _list(label: str, items: Any) -> str:
        if not isinstance(items, list) or not items:
            return ""
        joined = "; ".join(str(x).strip() for x in items if str(x).strip())
        return f"{label}: {joined}" if joined else ""

    chunks = [
        _list("must_have", parsed.get("must_have")),
        _list("nice_to_have", parsed.get("nice_to_have")),
        _list("soft_skills", parsed.get("soft_skills")),
    ]
    return "\n".join(c for c in chunks if c) or raw_fallback.strip()


def _stream_chat(
    client,
    model_cfg,
    prompt: str,
    *,
    temperature: float,
    max_tokens: int,
) -> Generator[str, None, None]:
    """流式调用,逐 chunk yield 文本。usage 自动累加。"""
    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        stream_options={"include_usage": True},
    )
    for chunk in response:
        choices = getattr(chunk, "choices", None) or []
        if choices and choices[0].delta and choices[0].delta.content:
            yield choices[0].delta.content
        usage = getattr(chunk, "usage", None)
        if usage:
            _add_tokens(usage.prompt_tokens or 0, usage.completion_tokens or 0)


def _non_stream_chat(
    client,
    model_cfg,
    prompt: str,
    *,
    temperature: float,
    max_tokens: int,
) -> str:
    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=max_tokens,
        stream=False,
    )
    usage = getattr(response, "usage", None)
    if usage:
        _add_tokens(usage.prompt_tokens or 0, usage.completion_tokens or 0)
    if not response.choices:
        return ""
    return response.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def optimize_resume_stream(jd_text: str) -> Generator[str, None, None]:
    """三步式 grounded 流式输出。任一步失败自动降级到单次分析。"""
    cfg = get_config()
    if not cfg.resume_text:
        yield "[错误: 请先上传简历]"
        return

    model_cfg = cfg.get_active_model()
    client = get_client()

    numbered_resume, line_map = _number_resume(cfg.resume_text)
    if not line_map:
        yield "[错误: 简历内容为空,无法进行行号引用]"
        return

    # ----- Step 1: 抽取 JD 关键能力 -----
    yield "## 📊 JD 关键能力抽取\n\n"
    parsed: Dict[str, Any] = {}
    raw_extract = ""
    try:
        raw_extract = _non_stream_chat(
            client,
            model_cfg,
            _JD_EXTRACT_PROMPT.format(jd=jd_text),
            temperature=0.2,
            max_tokens=700,
        )
        parsed = _try_parse_json(raw_extract)
    except Exception as e:  # noqa: BLE001
        _log.warning("resume agent step1 failed: %s", e)
        yield f"\n> 抽取步骤失败({e}),降级到单次综合分析\n\n---\n\n"
        yield from _legacy_pass(client, model_cfg, jd_text, cfg.resume_text)
        return

    yield _format_requirements(parsed, raw_extract) + "\n\n---\n\n"

    requirements_for_match = _requirements_for_prompt(parsed, raw_extract)

    # ----- Step 2: 命中 / 缺失分析 -----
    yield "## 🎯 命中 / 缺失分析\n\n"
    analysis_chunks: List[str] = []
    try:
        for piece in _stream_chat(
            client,
            model_cfg,
            _MATCH_PROMPT.format(
                requirements=requirements_for_match,
                resume=numbered_resume,
            ),
            temperature=0.3,
            max_tokens=1600,
        ):
            analysis_chunks.append(piece)
            yield piece
    except Exception as e:  # noqa: BLE001
        _log.warning("resume agent step2 failed: %s", e)
        yield f"\n\n> 匹配步骤失败:{e}\n\n"
        return

    analysis_text = "".join(analysis_chunks).strip()
    if not analysis_text:
        yield "\n\n> 模型返回空匹配结果,跳过改写步骤。\n"
        return
    yield "\n\n---\n\n"

    # ----- Step 3: 改写建议 -----
    yield "## ✏️ 简历改写建议\n\n"
    try:
        for piece in _stream_chat(
            client,
            model_cfg,
            _REWRITE_PROMPT.format(
                jd=jd_text,
                analysis=analysis_text,
                resume=numbered_resume,
            ),
            temperature=0.45,
            max_tokens=1800,
        ):
            yield piece
    except Exception as e:  # noqa: BLE001
        _log.warning("resume agent step3 failed: %s", e)
        yield f"\n\n> 改写步骤失败:{e}\n"


def _legacy_pass(client, model_cfg, jd_text: str, resume_text: str) -> Generator[str, None, None]:
    """三步链路完全不可用时的兜底:旧的一次性 prompt。"""
    try:
        yield from _stream_chat(
            client,
            model_cfg,
            _FALLBACK_PROMPT.format(jd=jd_text, resume=resume_text),
            temperature=0.6,
            max_tokens=2400,
        )
    except Exception as e:  # noqa: BLE001
        yield f"\n\n[兜底分析也失败: {e}]"
