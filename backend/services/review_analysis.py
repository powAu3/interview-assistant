"""
Review 模块 LLM 分析服务（含 ASR 纠错功能）
使用当前激活的 LLM 模型进行逐题分析和整场总结
"""
import json
from difflib import SequenceMatcher
from types import SimpleNamespace
from typing import Optional, Any
from openai import OpenAI

from core.logger import get_logger
from core.config import get_config
from services.llm.streaming import (
    _build_think_params,
    _completion_token_kwargs,
    get_client_for_model,
)

logger = get_logger(__name__)

DEFAULT_ASR_CORRECTION_SAMPLE = (
    "我做过 red 地址缓存，麦 SQL 查询会先看布隆过绿器，"
    "如果空只命中就直接返回，避免打到数据库。"
)


def get_active_llm_client() -> tuple[OpenAI, str]:
    """获取 review 配置的模型客户端和模型名"""
    cfg = get_config()
    review_model = cfg.get_review_model()

    if not review_model.api_key or review_model.api_key in ("", "sk-your-api-key-here"):
        raise ValueError("Review 模型未配置有效的 API Key")

    client = get_client_for_model(review_model)

    return client, review_model.model


def _review_chat_kwargs(max_tokens: int) -> dict[str, Any]:
    """Build model-specific kwargs matching the main answer/model-health path."""
    cfg = get_config()
    review_model = cfg.get_review_model()
    request_cfg = SimpleNamespace(
        think_mode=False,
        think_effort="off",
        max_tokens=max_tokens,
    )
    kwargs = _completion_token_kwargs(review_model, max_tokens)
    think_params = _build_think_params(review_model, request_cfg)
    if think_params:
        kwargs["extra_body"] = think_params
    return kwargs


def _build_asr_correction_prompt(question: str, candidate_answer: str) -> str:
    return f"""你是一位语音识别纠错助手。请根据面试问题的上下文，纠正候选人回答中可能存在的语音识别错误。

面试问题：
{question}

候选人回答（可能包含 ASR 错误）：
{candidate_answer}

常见 ASR 错误类型：
- 同音字错误（如：在这"快"领域 → 在这"块"领域）
- 专业术语识别错误（如：red 地址 → Redis）
- 标点符号缺失或错误
- 口语化表达（如："那个"、"嗯"等语气词过多）

请返回纠正后的文本，要求：
1. 只纠正明显的错误，不改变原意
2. 保留技术术语的正确拼写
3. 适当添加标点符号提高可读性
4. 去除过多的语气词和重复表达
5. 如果没有明显错误，返回原文
6. 不要添加原文中没有的内容

直接返回纠正后的文本，不要添加任何解释或标记。
"""


def _safe_error_detail(exc: Exception) -> str:
    detail = str(exc).strip() or exc.__class__.__name__
    return detail[:500]


def run_asr_correction_check(
    question: str = "",
    candidate_answer: str = "",
) -> dict[str, Any]:
    """Run ASR correction and return a structured result for UI/API diagnostics."""
    cfg = get_config()
    review_model = cfg.get_review_model()
    original = (candidate_answer or "").strip() or DEFAULT_ASR_CORRECTION_SAMPLE
    result: dict[str, Any] = {
        "ok": False,
        "model_name": review_model.name,
        "model": review_model.model,
        "original": original,
        "corrected": original,
        "changed": False,
        "detail": "",
    }

    if len(original.strip()) < 10:
        result.update({"ok": True, "detail": "文本过短，未调用模型"})
        return result

    try:
        client, model_name = get_active_llm_client()
    except ValueError as exc:
        result["detail"] = _safe_error_detail(exc)
        return result

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的语音识别纠错助手，擅长根据上下文纠正 ASR 错误。",
                },
                {"role": "user", "content": _build_asr_correction_prompt(question, original)},
            ],
            temperature=0.1,
            **_review_chat_kwargs(800),
        )

        content = response.choices[0].message.content
        if not content or not content.strip():
            result["detail"] = "模型返回为空"
            return result

        corrected = content.strip()
        if len(corrected) < len(original) * 0.7:
            result.update({"ok": True, "detail": "纠错结果过短，已保留原文"})
            return result

        similarity = SequenceMatcher(None, original, corrected).ratio()
        if similarity < 0.4:
            result.update({"ok": True, "detail": f"纠错结果差异过大，已保留原文（相似度 {similarity:.2f}）"})
            return result

        result.update({
            "ok": True,
            "corrected": corrected,
            "changed": corrected != original,
            "detail": "纠错完成" if corrected != original else "模型认为无需纠错",
        })
        return result
    except Exception as exc:
        logger.warning("ASR correction check failed: %s", exc)
        result["detail"] = _safe_error_detail(exc)
        return result


def correct_asr_errors(
    question: str,
    candidate_answer: str,
) -> str:
    """
    使用 LLM 纠正语音识别错误
    返回纠正后的文本
    """
    if not candidate_answer or len(candidate_answer.strip()) < 10:
        return candidate_answer

    result = run_asr_correction_check(question, candidate_answer)
    if result.get("ok") and result.get("changed"):
        logger.info(
            "ASR correction applied: original_len=%d, corrected_len=%d",
            len(candidate_answer),
            len(str(result.get("corrected") or "")),
        )
        return str(result.get("corrected") or candidate_answer)
    if not result.get("ok"):
        logger.warning("ASR correction skipped: %s", result.get("detail") or "unknown error")
    return candidate_answer


def analyze_turn(
    question: str,
    candidate_answer: str,
    reference_answer: str,
    code_text: str = "",
    apply_asr_correction: bool = True,
) -> dict[str, Any]:
    """
    分析单个 turn
    返回：
    {
        "strengths": ["亮点1", "亮点2"],
        "risks": ["风险1", "风险2"],
        "scorecard": {"准确性": 8, "深度": 7, "表达": 8},
        "evidence": {"key": "value"},
        "corrected_answer": "纠正后的回答（如有变化）"
    }
    """
    # 语音识别纠错
    corrected_answer = candidate_answer
    if apply_asr_correction and candidate_answer:
        corrected_answer = correct_asr_errors(question, candidate_answer)
    correction_evidence = {}
    if corrected_answer != candidate_answer:
        correction_evidence = {
            "asr_correction": {
                "original": candidate_answer,
                "corrected": corrected_answer,
            }
        }

    try:
        client, model_name = get_active_llm_client()
    except ValueError as e:
        logger.warning("Failed to get active LLM client: %s", e)
        return {
            "strengths": [],
            "risks": [],
            "scorecard": {},
            "evidence": correction_evidence,
            "corrected_answer": corrected_answer if corrected_answer != candidate_answer else None,
        }

    prompt = f"""你是一位资深的技术面试官，请对候选人的回答进行客观评价。

问题：
{question}

候选人回答：
{corrected_answer if corrected_answer else "(未录制到回答)"}

参考答案：
{reference_answer}
"""

    if code_text:
        prompt += f"""

代码：
{code_text}
"""

    prompt += """

请从以下维度分析：
1. **亮点（strengths）**：列出候选人回答中的优点，例如：准确性、深度、实战经验、代码质量等
2. **风险（risks）**：列出候选人回答中的不足或可改进点
3. **评分（scorecard）**：给出 1-10 分的评分，包含：准确性、深度、表达三个维度
4. **补强建议（evidence.improvement_advice）**：给出 1 条下一次回答可直接采用的改进动作
5. **追问练习（evidence.follow_up_questions）**：给出 1-2 个面试官可能继续追问的问题
6. **知识标签（evidence.tags）**：提取 1-3 个技术主题标签

请以 JSON 格式返回，格式如下：
```json
{
  "strengths": ["亮点1", "亮点2", "亮点3"],
  "risks": ["风险1", "风险2"],
  "scorecard": {
    "准确性": 8,
    "深度": 7,
    "表达": 8
  },
  "evidence": {
    "improvement_advice": "补充一个真实项目中的取舍或踩坑",
    "follow_up_questions": ["如果数据量扩大 10 倍，你会怎么改？"],
    "tags": ["Redis", "缓存穿透"]
  }
}
```

注意：
- 如果候选人未回答或回答为空，strengths 为空，risks 包含"未回答"，scorecard 全部为 0
- 评分要客观，结合参考答案和实际回答质量
- 每条亮点/风险限制在 30 字以内
- 不要编造候选人没有表达过的项目经历；补强建议和追问可以基于问题主题提出
"""

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的技术面试官，擅长客观评价候选人的回答。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            **_review_chat_kwargs(1000),
        )

        content = response.choices[0].message.content
        if not content:
            raise ValueError("Empty response from LLM")

        # 提取 JSON
        if "```json" in content:
            start = content.index("```json") + 7
            end = content.index("```", start)
            json_str = content[start:end].strip()
        elif "```" in content:
            start = content.index("```") + 3
            end = content.index("```", start)
            json_str = content[start:end].strip()
        else:
            json_str = content.strip()

        result = json.loads(json_str)
        llm_evidence = result.get("evidence", {})
        if not isinstance(llm_evidence, dict):
            llm_evidence = {}

        return {
            "strengths": result.get("strengths", []),
            "risks": result.get("risks", []),
            "scorecard": result.get("scorecard", {}),
            "evidence": {**llm_evidence, **correction_evidence},
            "corrected_answer": corrected_answer if corrected_answer != candidate_answer else None,
        }

    except Exception as e:
        logger.error("Failed to analyze turn: %s", e, exc_info=True)
        return {
            "strengths": [],
            "risks": [f"分析失败: {str(e)[:50]}"],
            "scorecard": {},
            "evidence": correction_evidence,
            "corrected_answer": corrected_answer if corrected_answer != candidate_answer else None,
        }


def generate_summary(
    turns: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    生成整场面试的总结
    返回：
    {
        "summary_markdown": "## 整体表现\n...",
        "strong_points": ["基础扎实", "表达清晰"],
        "weak_points": ["深度不够", "缺少实战案例"]
    }
    """
    if not turns:
        return {
            "summary_markdown": "本场面试未录制到有效问答",
            "strong_points": [],
            "weak_points": [],
        }

    try:
        client, model_name = get_active_llm_client()
    except ValueError as e:
        logger.warning("Failed to get active LLM client: %s", e)
        return {
            "summary_markdown": "未配置有效的模型 API Key，无法生成总结",
            "strong_points": [],
            "weak_points": [],
        }

    # 构建输入
    turns_text = ""
    for idx, turn in enumerate(turns, start=1):
        turns_text += f"""
### 第 {idx} 题
问题：{turn.get('question_text', '')}
回答：{turn.get('candidate_answer_text', '(未录制)')}
"""
        strengths = turn.get("strengths", [])
        risks = turn.get("risks", [])
        if strengths:
            turns_text += f"亮点：{', '.join(strengths)}\n"
        if risks:
            turns_text += f"风险：{', '.join(risks)}\n"

    prompt = f"""你是一位资深技术面试官，请对候选人的整场面试表现进行总结。

本场面试共 {len(turns)} 轮问答：
{turns_text}

请生成一份 Markdown 格式的整体评价，包含：
1. 整体表现概述（2-3 句话）
2. 主要亮点（3-5 条，用列表形式）
3. 改进方向（2-4 条，用列表形式）

同时，请提取：
- strong_points：高频亮点关键词（数组，3-5 个词）
- weak_points：高频短板关键词（数组，2-4 个词）

返回 JSON 格式：
```json
{{
  "summary_markdown": "## 整体表现\n\n...\n\n**亮点：**\n- ...\n\n**改进方向：**\n- ...",
  "strong_points": ["基础扎实", "表达清晰", "有实战经验"],
  "weak_points": ["深度不够", "缺少踩坑案例"]
}}
```
"""

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的技术面试官，擅长总结候选人的整体表现。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            **_review_chat_kwargs(1500),
        )

        content = response.choices[0].message.content
        if not content:
            raise ValueError("Empty response from LLM")

        # 提取 JSON
        if "```json" in content:
            start = content.index("```json") + 7
            end = content.index("```", start)
            json_str = content[start:end].strip()
        elif "```" in content:
            start = content.index("```") + 3
            end = content.index("```", start)
            json_str = content[start:end].strip()
        else:
            json_str = content.strip()

        result = json.loads(json_str)

        return {
            "summary_markdown": result.get("summary_markdown", ""),
            "strong_points": result.get("strong_points", []),
            "weak_points": result.get("weak_points", []),
        }

    except Exception as e:
        logger.error("Failed to generate summary: %s", e, exc_info=True)
        return {
            "summary_markdown": f"## 总结生成失败\n\n{str(e)}",
            "strong_points": [],
            "weak_points": [],
        }
