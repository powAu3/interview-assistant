"""
Review 模块 LLM 分析服务
使用 Lite Ark 模型进行逐题分析和整场总结
"""
import json
from typing import Optional, Any
from openai import OpenAI

from core.logger import get_logger

logger = get_logger(__name__)

# Lite Ark 配置（可通过环境变量或配置文件覆盖）
LITE_ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3"
LITE_ARK_MODEL = "ep-20250110190909-w7sxd"  # Lite 模型端点


def get_lite_ark_client(api_key: str) -> OpenAI:
    """创建 Lite Ark 客户端"""
    return OpenAI(
        api_key=api_key,
        base_url=LITE_ARK_API_BASE,
    )


def analyze_turn(
    question: str,
    candidate_answer: str,
    reference_answer: str,
    code_text: str = "",
    api_key: str = "",
) -> dict[str, Any]:
    """
    分析单个 turn
    返回：
    {
        "strengths": ["亮点1", "亮点2"],
        "risks": ["风险1", "风险2"],
        "scorecard": {"准确性": 8, "深度": 7, "表达": 8},
        "evidence": {"key": "value"}
    }
    """
    if not api_key:
        logger.warning("No API key provided for LLM analysis")
        return {
            "strengths": [],
            "risks": [],
            "scorecard": {},
            "evidence": {},
        }

    prompt = f"""你是一位资深的技术面试官，请对候选人的回答进行客观评价。

问题：
{question}

候选人回答：
{candidate_answer if candidate_answer else "(未录制到回答)"}

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

请以 JSON 格式返回，格式如下：
```json
{
  "strengths": ["亮点1", "亮点2", "亮点3"],
  "risks": ["风险1", "风险2"],
  "scorecard": {
    "准确性": 8,
    "深度": 7,
    "表达": 8
  }
}
```

注意：
- 如果候选人未回答或回答为空，strengths 为空，risks 包含"未回答"，scorecard 全部为 0
- 评分要客观，结合参考答案和实际回答质量
- 每条亮点/风险限制在 30 字以内
"""

    try:
        client = get_lite_ark_client(api_key)
        response = client.chat.completions.create(
            model=LITE_ARK_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的技术面试官，擅长客观评价候选人的回答。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1000,
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
            "strengths": result.get("strengths", []),
            "risks": result.get("risks", []),
            "scorecard": result.get("scorecard", {}),
            "evidence": {},
        }

    except Exception as e:
        logger.error("Failed to analyze turn: %s", e, exc_info=True)
        return {
            "strengths": [],
            "risks": [f"分析失败: {str(e)[:50]}"],
            "scorecard": {},
            "evidence": {},
        }


def generate_summary(
    turns: list[dict[str, Any]],
    api_key: str = "",
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
    if not api_key:
        logger.warning("No API key provided for summary generation")
        return {
            "summary_markdown": "未配置 API Key，无法生成总结",
            "strong_points": [],
            "weak_points": [],
        }

    if not turns:
        return {
            "summary_markdown": "本场面试未录制到有效问答",
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
        client = get_lite_ark_client(api_key)
        response = client.chat.completions.create(
            model=LITE_ARK_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "你是一位专业的技术面试官，擅长总结候选人的整体表现。",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1500,
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
