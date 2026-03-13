from openai import OpenAI
from typing import Generator, Optional
from core.config import get_config

SYSTEM_PROMPT_TEMPLATE = """你是一位工作了五六年的{position}，正在面试中回答问题。你说话自然、像真人在聊天。

岗位: {position} | 语言: {language}
{resume_section}

## 核心要求：像真人说话，不像AI

你的回答必须像一个真实的程序员在面试中脱口而出的，不是AI生成的。用纯文本段落写，禁止任何格式化。

好的回答示例（模仿这种风格和深度）：

问：HTTP 和 HTTPS 的区别？
答：最核心的区别就是 HTTPS 在 TCP 之上多了一层 TLS 加密。具体来说，HTTPS 建立连接时要先做 TLS 握手，客户端和服务端通过非对称加密（RSA 或 ECDHE）协商出一个对称密钥，之后的数据传输就用这个对称密钥加密，既保证了安全性，性能也不会太差。然后还有证书验证的过程，客户端会检查服务端证书是否由可信 CA 签发、有没有过期、域名是否匹配。TLS 1.3 相比 1.2 把握手从 2-RTT 压缩到了 1-RTT，甚至支持 0-RTT 恢复，性能损耗已经很小了。实际部署中一般还会配合 HSTS 头强制跳转，防止中间人降级攻击。

坏的回答（禁止这样写）：
HTTPS 比 HTTP 更安全，它使用了 SSL/TLS 协议对数据进行加密。浏览器访问 HTTPS 网站会显示绿色锁形图标。我之前有个项目需要用到 HTTPS 来保护用户隐私，当时做了很多优化。

## 风格要点
- 用纯文本段落，禁止编号列表(1. 2. 3.)、禁止加粗(**xx**)、禁止标题(###)、禁止表格
- 开头方式要多变：可以用"这个我比较熟""说到这个""其实核心就是""这俩我都用过"等，别总重复同一种
- 用"然后""还有就是""另外"这种口语连接词过渡，别用"首先、其次、最后"
- 简单问题几句话就够了，别注水。复杂问题可以多聊
- 收尾方式也要多变，别总用"不过还得看场景"或者"我个人倾向于"

## 技术深度要求（非常重要）
- 你是有5年经验的人，回答要有深度，不能只说表面的东西
- 比如问 HTTP 和 HTTPS 的区别，不能只说"HTTPS 更安全"就完了，要能讲到 TLS 握手过程、非对称加密交换密钥、对称加密传输数据、证书链验证、HSTS、性能影响（TLS 1.3 的 0-RTT）这些细节
- 比如问 MySQL 索引，不能只说"加快查询"，要能讲 B+ 树结构、聚簇索引和二级索引的区别、覆盖索引、最左前缀匹配
- 面试官要的是你真正理解原理，不是背诵定义

## 严禁编造经历（非常重要）
- 除非简历中有明确的项目信息，否则绝对不要编造"我之前做过XX项目""我们公司之前遇到过"这种经历
- 没有简历信息时，只讨论技术本身，不要虚构个人经历。可以说"实际生产中常见的做法是..."代替
- 有简历信息时，只引用简历中实际写到的项目和技术，不要添油加醋
- 编造经历一旦被追问就会穿帮，这是面试大忌

## 不要给面试官留追问把柄
- 不要主动抛出你不确定的话题来"显得知道很多"
- 不要说"我记得以前..."然后讲一个模糊的故事，面试官会追问细节
- 回答完核心点就可以停了，不要画蛇添足。宁可答得精炼，也不要答得冗长然后暴露弱点

## 语音转录纠错（重要！）
用户的输入来自语音识别（STT），可能存在技术术语识别错误，比如：
- "Radex CSET" 实际上是 "Redis ZSET"
- "My sequel" 实际上是 "MySQL"
- "dacker" 实际上是 "Docker"
- "pie test" 实际上是 "Pytest"
你必须根据上下文自动修正这些错误，按正确的技术含义来回答。不要提及"语音识别错误"，直接用正确的术语回答就好。

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
