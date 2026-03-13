from openai import OpenAI
from typing import Generator, Optional
from core.config import get_config

SYSTEM_PROMPT_TEMPLATE = """你是一位资深的{position}面试辅助专家。你的任务是帮助候选人实时生成面试回答。

## 面试配置
- 岗位: {position}
- 编程语言: {language}

{resume_section}

## 回答风格（极其重要，必须严格遵守）

你的回答必须模拟一个优秀候选人的**口头面试回答风格**，而不是写技术文档或教程：

1. **先说结论**: 用1-2句话直接回答核心，让面试官立刻知道你懂
2. **结构化展开**: 用"第一...第二...第三..."组织，每个点2-3句话即可
3. **不要默认写代码**: 除非面试官**明确要求**"写一下代码"或"手写实现"，否则只用文字描述思路和原理。八股文/概念题绝对不需要代码
4. **体现深度而非广度**: 在关键点上展开底层原理、设计取舍、实际经验，不要面面俱到
5. **简历关联**: 如果有简历，自然融入："我之前在XX项目中就遇到过..."
6. **控制篇幅**: 重要问题200-400字，简单问题50-150字。面试官没耐心听长篇大论
7. **面试语气**: 自信但不傲慢，像在和面试官对话，不是在写论文

## 绝对不要做的事
- ❌ 不要给完整代码实现（除非被明确要求写代码）
- ❌ 不要像教科书一样罗列所有知识点
- ❌ 不要重复问题
- ❌ 不要说"这是一个好问题"之类的废话
- ❌ 不要用表格（面试官听不到表格）

## 什么时候才写代码
- 面试官说"写一下"、"实现一下"、"代码怎么写"
- 涉及算法题且需要完整实现
- 此时用 {language} 写简洁代码，加必要注释

## 图片题目
- 如果用户发送了截图/图片，仔细分析图片中的题目内容
- 根据题目类型给出面试风格的回答（算法题给代码+思路，概念题给口述回答）"""


def build_system_prompt() -> str:
    cfg = get_config()
    resume_section = ""
    if cfg.resume_text:
        resume_section = f"""## 候选人简历信息
以下是候选人的简历，回答时自然融入相关经历：

{cfg.resume_text}"""

    return SYSTEM_PROMPT_TEMPLATE.format(
        position=cfg.position,
        language=cfg.language,
        resume_section=resume_section,
    )


def get_client() -> OpenAI:
    cfg = get_config()
    m = cfg.get_active_model()
    return OpenAI(api_key=m.api_key, base_url=m.api_base_url)


def _sanitize_messages(messages: list[dict], supports_vision: bool) -> list[dict]:
    """Strip image content from messages if model doesn't support vision."""
    if supports_vision:
        return messages
    sanitized = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            texts = []
            has_image = False
            for part in content:
                if part.get("type") == "text":
                    texts.append(part["text"])
                elif part.get("type") == "image_url":
                    has_image = True
            text = "\n".join(texts)
            if has_image:
                text += "\n[注意: 图片已省略，当前模型不支持图片识别]"
            sanitized.append({"role": msg["role"], "content": text})
        else:
            sanitized.append(msg)
    return sanitized


def chat_stream(
    messages: list[dict],
    system_prompt: Optional[str] = None,
) -> Generator[str, None, None]:
    cfg = get_config()
    m = cfg.get_active_model()
    client = get_client()

    clean_messages = _sanitize_messages(messages, m.supports_vision)

    full_messages = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(clean_messages)

    extra_kwargs: dict = {}
    if cfg.think_mode and m.supports_think:
        extra_kwargs["extra_body"] = {"think_mode": True}

    try:
        response = client.chat.completions.create(
            model=m.model,
            messages=full_messages,
            temperature=cfg.temperature,
            max_tokens=cfg.max_tokens,
            stream=True,
            **extra_kwargs,
        )
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except Exception as e:
        yield f"\n\n[LLM 错误: {str(e)}]"
