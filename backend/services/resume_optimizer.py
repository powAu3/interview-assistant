from typing import Generator
from core.config import get_config
from services.llm import get_client, _add_tokens, _token_stats

OPTIMIZE_PROMPT = """你是一位资深的技术招聘顾问，擅长优化简历和面试策略。请对比分析候选人简历和目标岗位 JD，给出详细的优化建议。

## 目标岗位 JD
{jd}

## 候选人简历
{resume}

## 请按以下结构输出分析（使用 Markdown 格式）

### 📊 匹配度评分

给出 0-100 的匹配度分数，并用一句话概括匹配情况。

### ✅ 匹配亮点

列出简历中与 JD 高度匹配的技能、经验、项目，解释为什么匹配。

### ⚠️ 缺失关键词

列出 JD 中要求但简历未体现的关键技能/经验，按重要性排序。

### 📝 简历修改建议

针对每段项目经历，给出具体的修改建议：
- 哪些描述可以更好地匹配 JD
- 建议添加的关键技术词汇
- STAR 法则优化建议

### 🎯 面试重点准备

基于 JD 和简历的差距，列出面试中最可能被问到的问题及准备方向。"""


def optimize_resume_stream(jd_text: str) -> Generator[str, None, None]:
    cfg = get_config()
    if not cfg.resume_text:
        yield "[错误: 请先上传简历]"
        return

    m = cfg.get_active_model()
    client = get_client()

    prompt = OPTIMIZE_PROMPT.format(jd=jd_text, resume=cfg.resume_text)

    try:
        response = client.chat.completions.create(
            model=m.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=3000,
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
        yield f"\n\n[分析出错: {e}]"
