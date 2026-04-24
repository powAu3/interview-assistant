from __future__ import annotations

from typing import Any, Callable

from .models import PracticeSession

DEBRIEF_PROMPT = """你是一位技术面试官，请基于整场模拟面试记录输出最终复盘。

## 面试上下文
- 岗位：{position}
- 语言方向：{language}
- 候选人维度：{audience_label}
- 简历摘要：{resume_text}
- JD 摘要：{jd_text}

## 回合记录
{turn_records}

## 输出格式
### 综合 verdict
- 结论：...
- 总评：...

### 阶段表现
- 开场与匹配：...
- 项目深挖：...
- 基础与八股：...
- 设计/综合：...
- 代码 / SQL：...

### 与简历/JD 的贴合度
- ...

### 表达与临场问题
- ...

### 可回填简历表达
- 只基于候选人在本场回答中已经提到的事实，整理 1-3 条可带回简历优化的表达。
- 如果缺少指标或证据，明确写“待补充证据”，不要编造量化结果。

### 知识盲点
- ...

### 下一步建议
1. ...
2. ...
3. ...

### 示范回答方向
- ..."""


def _fallback_debrief_report(session: PracticeSession) -> str:
    strengths = []
    risks = []
    for entry in session.hidden_score_ledger:
        strengths.extend(entry.strengths)
        risks.extend(entry.risks)
    strengths = strengths[:3] or ["回答整体有主线，不会完全失控。"]
    risks = risks[:3] or ["部分问题还可以继续深挖到证据和取舍。"]
    jd_text = session.context.jd_text if session.context else ""
    return "\n".join(
        [
            "### 综合 verdict",
            "- 结论：建议继续练这一轮的项目深挖和设计表达。",
            "- 总评：整场回答具备基本结构，但还可以把证据、取舍和复盘讲得更完整。",
            "",
            "### 阶段表现",
            "- 开场与匹配：能够进入主题，但还可以更像正式面试回答。",
            "- 项目深挖：建议多讲为什么、怎么验证、踩坑与改进。",
            "- 基础与八股：需要把原理和边界讲得更扎实。",
            "- 设计/综合：先讲主流程，再讲取舍和风险。",
            "- 代码 / SQL：把核心实现和边界条件写得更清楚。",
            "",
            "### 与简历/JD 的贴合度",
            f"- JD 重点：{jd_text or '未提供 JD，按岗位常见要求评估。'}",
            "",
            "### 表达与临场问题",
            "- 尽量把回答压缩成“结论 -> 过程 -> 验证 -> 结果”。",
            "",
            "### 可回填简历表达",
            "- 将本轮项目经历整理成“负责事项 -> 技术动作 -> 可验证结果”的一句话；暂无明确指标时标注待补充证据。",
            "",
            "### 知识盲点",
            *[f"- {item}" for item in risks],
            "",
            "### 下一步建议",
            "1. 把项目题用 STAR + why/how/impact 重新梳理一次。",
            "2. 每道基础题都补一句边界与线上经验。",
            "3. 代码/SQL 题练到可以一边写一边解释。",
            "",
            "### 示范回答方向",
            *[f"- {item}" for item in strengths],
        ]
    ).strip()


def _generate_debrief_report(
    session: PracticeSession,
    *,
    pick_practice_model: Callable[[], Any],
    request_text_completion: Callable[..., str],
) -> str:
    if not session.context:
        return _fallback_debrief_report(session)

    turn_records = []
    for turn in session.turn_history:
        turn_records.append(
            "\n".join(
                [
                    f"## {turn.phase_label} / {turn.category}",
                    f"- 问题：{turn.question}",
                    f"- 回答：{turn.transcript or '（未提供）'}",
                    f"- 代码：{turn.code_text or '（无）'}",
                    f"- 决策：{turn.decision or 'advance'}",
                    f"- 证据：{'；'.join(turn.evidence) or '（无）'}",
                    f"- 优点：{'；'.join(turn.strengths) or '（无）'}",
                    f"- 风险：{'；'.join(turn.risks) or '（无）'}",
                ]
            )
        )
    prompt = DEBRIEF_PROMPT.format(
        position=session.context.position,
        language=session.context.language,
        audience_label=session.context.audience_label,
        resume_text=session.context.resume_text or "暂无简历摘要",
        jd_text=session.context.jd_text or "暂无 JD",
        turn_records="\n\n".join(turn_records) or "暂无有效作答记录",
    )
    try:
        text = request_text_completion(pick_practice_model(), prompt, max_tokens=1800)
        return text or _fallback_debrief_report(session)
    except Exception:
        return _fallback_debrief_report(session)
