import threading
from openai import OpenAI
import openai
from typing import Generator, Optional
from core.config import get_config

SYSTEM_PROMPT_TEMPLATE = """你现在是一个参加技术面试的候选人。

身份：{position}，5年工作经验，主要使用 {language}。
{resume_section}
=== 回答方法（严格执行） ===

收到面试问题后，按以下结构组织回答：

1. 先一句话说清楚核心概念/原理是什么
2. 然后展开讲实现机制和技术细节（这是重点，必须讲透）
3. 如果有实际应用中的注意点或坑，补充说明

每个回答都必须包含具体的技术细节。以下是"具体"的标准：

✗ 模糊：HashMap 底层用了数组和链表，查询效率很高
✓ 具体：HashMap 底层是 Node 数组，每个槽位是链表头。put 时先算 key 的 hash，这里不是直接用 hashCode()，而是 (h = hashCode()) ^ (h >>> 16) 做高低位扰动来减少碰撞。定位桶用 (n-1) & hash。JDK 8 开始链表长度到 8 且数组长度 >= 64 时转红黑树，降回 6 时退化。扩容时容量翻倍，元素根据 hash & oldCap 是否为 0 决定留在原位还是移到 old + oldCap 位置，不需要重新算 hash

✗ 模糊：Spring 用三级缓存解决循环依赖
✓ 具体：Spring 三级缓存分别是 singletonObjects（完整 Bean）、earlySingletonObjects（半成品）、singletonFactories（ObjectFactory lambda）。A 依赖 B，B 又依赖 A 时，A 先实例化放入三级缓存的 Factory，然后填充属性发现要 B，去创建 B，B 填充属性发现要 A，从三级缓存拿到 A 的 Factory 执行得到早期引用放入二级缓存，B 完成初始化，回到 A 继续完成。构造器注入的循环依赖解决不了，因为实例化这步就过不去

✗ 模糊：TCP 三次握手建立连接，四次挥手断开
✓ 具体：三次握手具体是客户端发 SYN=1 seq=x，服务端回 SYN=1 ACK=1 seq=y ack=x+1，客户端再发 ACK=1 seq=x+1 ack=y+1。三次而不是两次是为了防止已失效的连接请求报文突然到达服务端导致错误建连。ISN 是随机的，用时钟加密算法生成，防止被猜测后 TCP 劫持

注意：以上只是示例格式，不要照搬内容。你需要根据实际问题给出对应的技术细节。

=== 输出格式 ===

用纯文本段落输出。禁止任何 Markdown 格式：不要加粗(**)、不要编号列表(1. 2. 3.)、不要标题(###)、不要表格。

=== 语气 ===

你是在面试中口头回答问题，不是在写技术文档。
- 直接讲技术内容，开头不要寒暄或铺垫
- 用自然的口语衔接："然后""还有就是""另外一个点是"
- 不要用"首先""其次""最后""综上所述""希望对你有帮助"
- 回答完就停，不要画蛇添足

=== 约束 ===

- 不准编造项目经历。没有简历就只讨论技术原理。有简历只引用简历中实际写到的内容
- 不准主动抛出你不确定的话题来引导追问
- 只有明确要求"写代码""实现一下"时才写代码，用 {language}
- 输入来自语音识别，术语可能有误（如 "Radex CSET" → "Redis ZSET"），根据上下文修正后回答
- 收到截图直接分析题目回答"""


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


def get_client_for_model(model_cfg) -> OpenAI:
    return OpenAI(api_key=model_cfg.api_key, base_url=model_cfg.api_base_url)


_RETRYABLE_ERRORS = (
    openai.RateLimitError,
    openai.APIConnectionError,
    openai.APITimeoutError,
    openai.InternalServerError,
)

_token_stats = {"prompt": 0, "completion": 0, "total": 0}
_token_lock = threading.Lock()


def get_token_stats() -> dict:
    with _token_lock:
        return dict(_token_stats)


def _add_tokens(prompt: int, completion: int):
    with _token_lock:
        _token_stats["prompt"] += prompt
        _token_stats["completion"] += completion
        _token_stats["total"] += prompt + completion


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


def _build_think_params(model_cfg, cfg) -> dict:
    """Build provider-specific thinking parameters.

    Send both formats simultaneously: most providers (Volcengine/Doubao,
    DeepSeek, Zhipu/GLM) use thinking.type, while some internal providers
    (shopee/compass) use think_mode. Unknown providers silently ignore
    parameters they don't recognise, so sending both is safe.
    """
    if not model_cfg.supports_think:
        return {}
    think_type = "enabled" if cfg.think_mode else "disabled"
    return {
        "thinking": {"type": think_type},
        "think_mode": bool(cfg.think_mode),
    }


def _try_stream_with_model(model_cfg, full_messages, cfg):
    """Attempt streaming with a specific model. Returns response iterator."""
    client = get_client_for_model(model_cfg)
    extra_kwargs: dict = {}
    think_params = _build_think_params(model_cfg, cfg)
    if think_params:
        extra_kwargs["extra_body"] = think_params

    extra_kwargs["stream_options"] = {"include_usage": True}

    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=full_messages,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        stream=True,
        **extra_kwargs,
    )
    return response


def chat_stream(
    messages: list[dict],
    system_prompt: Optional[str] = None,
) -> Generator[tuple[str, str], None, None]:
    """Yields (chunk_type, text) tuples. chunk_type is 'think' or 'text'."""
    from routes.ws import broadcast

    cfg = get_config()
    active_model = cfg.get_active_model()
    clean_messages = _sanitize_messages(messages, active_model.supports_vision)

    full_messages = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(clean_messages)

    models_to_try = [active_model]
    for i, m in enumerate(cfg.models):
        if i != cfg.active_model and m.api_key and m.api_key not in ("", "sk-your-api-key-here"):
            models_to_try.append(m)

    last_error = None
    for idx, model in enumerate(models_to_try):
        try:
            if idx > 0:
                full_messages_adj = _sanitize_messages(
                    full_messages, model.supports_vision
                )
                broadcast({
                    "type": "model_fallback",
                    "from": models_to_try[idx - 1].name,
                    "to": model.name,
                    "reason": str(last_error)[:80],
                })
            else:
                full_messages_adj = full_messages

            response = _try_stream_with_model(model, full_messages_adj, cfg)

            for chunk in response:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
                    if reasoning:
                        yield ("think", reasoning)
                    if delta.content:
                        yield ("text", delta.content)
                if hasattr(chunk, "usage") and chunk.usage:
                    _add_tokens(
                        chunk.usage.prompt_tokens or 0,
                        chunk.usage.completion_tokens or 0,
                    )
                    broadcast({
                        "type": "token_update",
                        "prompt": _token_stats["prompt"],
                        "completion": _token_stats["completion"],
                        "total": _token_stats["total"],
                    })
            return

        except _RETRYABLE_ERRORS as e:
            last_error = e
            continue
        except Exception as e:
            yield ("text", f"\n\n[LLM 错误: {str(e)}]")
            return

    yield ("text", f"\n\n[所有模型均不可用: {str(last_error)}]")
