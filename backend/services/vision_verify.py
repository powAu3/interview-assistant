"""服务端截图审题 self-verify Agent (P2-agent-vision)。

主流程跑完后,异步用同一张截图 + 已生成答案再问一次视觉模型:
"该解法是否能通过题面给出的样例输入 / 约束?"
模型返回 JSON 判定 + 简短理由,我们把结果广播给前端,
让用户在 UI 上看到「自检通过 / 自检失败」的可信度提示,
而不是悄悄替换原答案,避免误判时 silently 改坏。

只在 ``PROMPT_MODE_SERVER_SCREEN`` 调用,且仅当存在 vision 模型时触发。
"""
from __future__ import annotations

import json
import logging
import re
import threading
from typing import Optional

_log = logging.getLogger("vision_verify")


_VERIFY_PROMPT = """你是严谨的代码评审员。下面是一道编程题(以截图形式给出)以及一位候选人提交的解答。

请判断:
1. 解答的算法思路是否能正确处理图中题面的所有样例输入与边界约束?
2. 关键步骤是否可重现题面给出的样例输出?

只输出严格 JSON,不要任何 markdown 围栏或多余文字。结构:
{{
  "verdict": "PASS" | "FAIL" | "UNKNOWN",
  "reason": "不超过 80 字的中文判定理由,如有违反的样例请明确指出"
}}

候选人解答(可能含代码块):
---
{answer}
---
"""


_JSON_FENCE = re.compile(r"^```(?:json)?|```$", re.IGNORECASE | re.MULTILINE)
_JSON_OBJECT = re.compile(r"\{[\s\S]*?\}")


def _parse_verdict(raw: str) -> dict:
    if not raw:
        return {"verdict": "UNKNOWN", "reason": "模型无返回"}
    cleaned = _JSON_FENCE.sub("", raw.strip())
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        match = _JSON_OBJECT.search(cleaned)
        if not match:
            return {"verdict": "UNKNOWN", "reason": cleaned[:120]}
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {"verdict": "UNKNOWN", "reason": cleaned[:120]}
    verdict = str(data.get("verdict", "UNKNOWN")).upper()
    if verdict not in ("PASS", "FAIL", "UNKNOWN"):
        verdict = "UNKNOWN"
    reason = str(data.get("reason", "")).strip() or "(无理由)"
    return {"verdict": verdict, "reason": reason[:240]}


def _pick_vision_model_cfg():
    from core.config import get_config
    cfg = get_config()
    for m in cfg.models:
        if (
            m.supports_vision
            and bool(getattr(m, "enabled", True))
            and m.api_key
            and m.api_key not in ("", "sk-your-api-key-here")
        ):
            return m
    return None


def _verify_blocking(answer: str, image_data_url: str) -> dict:
    """同步执行一次 self-verify。失败时返回 verdict=UNKNOWN。"""
    model_cfg = _pick_vision_model_cfg()
    if model_cfg is None:
        return {"verdict": "UNKNOWN", "reason": "未配置可用的视觉模型"}

    from services.llm import _add_tokens, get_client_for_model

    client = get_client_for_model(model_cfg)
    user_content = [
        {"type": "text", "text": _VERIFY_PROMPT.format(answer=answer)},
        {"type": "image_url", "image_url": {"url": image_data_url}},
    ]
    try:
        response = client.chat.completions.create(
            model=model_cfg.model,
            messages=[{"role": "user", "content": user_content}],
            temperature=0.1,
            max_tokens=300,
            stream=False,
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("vision self-verify call failed: %s", e)
        return {"verdict": "UNKNOWN", "reason": f"自检调用失败: {e}"}

    usage = getattr(response, "usage", None)
    if usage:
        _add_tokens(usage.prompt_tokens or 0, usage.completion_tokens or 0)
    if not response.choices:
        return {"verdict": "UNKNOWN", "reason": "模型返回空"}
    raw = (response.choices[0].message.content or "").strip()
    return _parse_verdict(raw)


def schedule_self_verify(
    *,
    qa_id: str,
    answer: str,
    image_data_url: Optional[str],
    broadcast_callable,
) -> None:
    """异步触发一次 self-verify,完成后通过 broadcast_callable 推送结果。

    无 image / 无答案 / 无 vision 模型时直接跳过(不报错)。
    所有失败均吞掉,只通过 verdict=UNKNOWN 透出。
    """
    if not qa_id or not answer or not image_data_url:
        return
    if _pick_vision_model_cfg() is None:
        return

    def _worker() -> None:
        try:
            result = _verify_blocking(answer, image_data_url)
        except Exception as e:  # noqa: BLE001
            _log.warning("vision self-verify worker crashed: %s", e)
            result = {"verdict": "UNKNOWN", "reason": f"自检异常: {e}"}
        try:
            broadcast_callable({
                "type": "vision_verify",
                "id": qa_id,
                "verdict": result["verdict"],
                "reason": result["reason"],
            })
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(
        target=_worker,
        name=f"vision-verify-{qa_id[-6:]}",
        daemon=True,
    ).start()
