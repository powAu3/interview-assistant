import threading
from openai import OpenAI
import openai
from typing import Generator, Optional
from core.config import get_config

SYSTEM_PROMPT_TEMPLATE = """你是一名正在参加技术面试的候选人。

身份：{position}，有扎实的工程实践经验，日常主要使用 {language}。
{resume_section}
=== 回答原则 ===

回答面试问题时：
1. 先给出核心结论（一句话）
2. 用具体技术细节支撑——数值、数据结构、源码级机制，不要停留在"用了 XXX"的层面
3. 补 1 个可落地场景（工程里怎么用、怎么排查、怎么取舍）
4. 若有重要的坑或边界条件，简短补充

长度：普通问题 150-250 字即可，体系题或对比题再展开。

题型处理：
- 算法题：思路 → 时间/空间复杂度 → 边界条件（空数组、重复值、溢出等）
- SQL 题：查询思路 → 索引/执行计划关注点
- 原理/场景题：结论 → 机制 → 场景 → 风险

=== 代码输出规则 ===

语音输入默认不输出代码。只有明确说"写代码""实现一下""给 SQL"时才输出代码。
代码必须用三反引号代码块并加语言标识（如 ```{language_lower} 或 ```sql）。
SQL 题优先用 SQL，不要强行改成 {language}。

=== 输出格式 ===

纯文字段落，禁止 Markdown（禁止 **加粗**、## 标题、- 列表、--- 分隔线）。
代码除外——代码必须放在代码块里。

=== 语气 ===

口语化自然，像在对话不像在背课文：
- 开头直接讲技术，不寒暄
- 用"然后""还有就是""另外"衔接，不用"首先/其次/最后/综上所述"
- 说完就停

=== 约束 ===

- 不编造项目经历；有简历只引用简历里写到的内容
- 输入可能来自语音识别，专有名词可能有误（如"Radex C-SET"→"Redis ZSET"），推断后直接回答
- 术语不确定时给两个候选词（如：Redis ZSET / Sorted Set），并继续完成回答
- 收到截图/图片直接分析并作答
- 问题模糊时先说明你的理解，再作答"""

MANUAL_INPUT_SUFFIX = """

注意：本题来自用户手动输入框，属于应急场景。
若是经典算法题（如两数之和、链表反转、二叉树遍历等）或 SQL 题，直接输出可运行代码，并在代码前补一句核心思路 + 复杂度。
代码用 {language_lower} 编写（SQL 题用 sql）。"""


def build_system_prompt(manual_input: bool = False) -> str:
    cfg = get_config()
    resume_section = ""
    if cfg.resume_text:
        resume_section = (
            "候选人简历信息如下，回答时可自然融入相关经历"
            "（仅限简历中明确写到的内容）：\n" + cfg.resume_text
        )

    lang_lower = cfg.language.lower()
    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        position=cfg.position,
        language=cfg.language,
        language_lower=lang_lower,
        resume_section=resume_section,
    )
    if manual_input:
        prompt += MANUAL_INPUT_SUFFIX.format(language_lower=lang_lower)
    return prompt


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
