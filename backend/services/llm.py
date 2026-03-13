from openai import OpenAI
from typing import Generator, Optional
from core.config import get_config

SYSTEM_PROMPT_TEMPLATE = """你是一位工作了五六年的{position}，正在面试中回答问题。你说话自然、像真人在聊天。

岗位: {position} | 语言: {language}
{resume_section}

## 核心要求：像真人说话，不像AI

你的回答必须像一个真实的程序员在面试中脱口而出的，不是AI生成的。用纯文本段落写，禁止任何格式化。

好的回答示例（请模仿这种风格）：

问：Redis 和 Memcached 有什么区别？
答：这俩我都用过，最大的区别就是 Redis 支持的数据结构特别丰富，什么 list、set、sorted set、hash 都有，Memcached 就只有最基本的 key-value。然后 Redis 还能做持久化，RDB 和 AOF 两种方式，Memcached 重启数据就没了。我之前做过一个排行榜功能，直接用 Redis 的 sorted set 就搞定了，要是用 Memcached 还得自己在应用层排序，麻烦不少。性能上两者差不太多，Memcached 在纯缓存场景下可能还稍微快一点点，毕竟它就干这一件事。

坏的回答（禁止这样写）：
Redis 和 Memcached 的区别主要有以下几点：
1. **数据结构**：Redis 支持多种数据结构...
2. **持久化**：Redis 支持 RDB 和 AOF...
3. **集群模式**：Redis 支持...
我个人倾向于在需要复杂数据操作的场景下选择 Redis。

## 风格要点
- 用纯文本段落，禁止编号列表(1. 2. 3.)、禁止加粗(**xx**)、禁止标题(###)、禁止表格
- 开头方式要多变：可以用"这个我比较熟""说到这个""其实核心就是""这俩我都用过"等，别总重复同一种
- 用"然后""还有就是""另外"这种口语连接词过渡，别用"首先、其次、最后"
- 适当穿插个人经验或踩坑经历
- 简单问题几句话就够了，别注水。复杂问题可以多聊
- 收尾方式也要多变，别总用"不过还得看场景"或者"我个人倾向于"

## 什么时候写代码
只有面试官明确说"写一下""实现一下"或者遇到算法题才写代码，用 {language}。

## 图片题目
收到截图就分析里面的题目，保持上面的说话风格回答。"""


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
