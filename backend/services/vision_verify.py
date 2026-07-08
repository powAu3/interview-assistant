"""服务端截图审题 self-verify Agent (P2-agent-vision)。

主流程跑完后,异步用同一批截图 + 已生成答案再问一次视觉模型:
"该解法是否能通过题面给出的样例输入 / 约束?"
模型返回 JSON 判定 + 简短理由,我们把结果广播给前端,
让用户在 UI 上看到「自检通过 / 自检失败」的可信度提示,
而不是悄悄替换原答案,避免误判时 silently 改坏。

只在截图答题链路调用,包括普通服务端截图和笔试截图; 仅当存在 vision 模型时触发。
"""
from __future__ import annotations

import json
import re
import threading
import base64
from collections.abc import Sequence
from typing import Optional

from core.logger import get_logger

_log = get_logger("vision_verify")

_VERIFY_SEMAPHORE = threading.BoundedSemaphore(4)


_VERIFY_PROMPT = """你是严谨的代码评审员。下面是一道编程题(以截图形式给出)以及一位候选人提交的解答。

{image_note}

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


def _normalize_image_data_url(image_data_url: str) -> str:
    raw = (image_data_url or "").strip()
    if not raw:
        return raw
    if raw.startswith("data:image"):
        return raw
    try:
        base64.b64decode(raw, validate=True)
    except Exception:
        return raw
    return f"data:image/png;base64,{raw}"


def _normalize_image_data_urls(image_data_url: Optional[str | Sequence[str]]) -> list[str]:
    if not image_data_url:
        return []
    if isinstance(image_data_url, str):
        candidates = [image_data_url]
    else:
        candidates = [str(item) for item in image_data_url if item]
    return [_normalize_image_data_url(item) for item in candidates if str(item or "").strip()]


def _build_verify_prompt(answer: str, image_count: int) -> str:
    if image_count > 1:
        image_note = (
            f"本次共有 {image_count} 张连续截图，请按提交顺序合并理解题面。"
            "后续截图可能包含补充约束、失败用例、运行报错、隐藏条件或样例输出，"
            "这些信息必须参与判定；如果后续截图推翻前一版理解，以后续截图为准。"
        )
    else:
        image_note = "本次共有 1 张截图，请以截图中可见的题面、样例和约束为准。"
    return _VERIFY_PROMPT.format(answer=answer, image_note=image_note)


def _verify_blocking(answer: str, image_data_url: str | Sequence[str]) -> dict:
    """同步执行一次 self-verify。失败时返回 verdict=UNKNOWN。"""
    model_cfg = _pick_vision_model_cfg()
    if model_cfg is None:
        return {"verdict": "UNKNOWN", "reason": "未配置可用的视觉模型"}

    from services.llm import _add_tokens, get_client_for_model

    client = get_client_for_model(model_cfg)
    images = _normalize_image_data_urls(image_data_url)
    user_content = [
        {"type": "text", "text": _build_verify_prompt(answer, len(images))},
    ]
    for image_url in images:
        user_content.append({"type": "image_url", "image_url": {"url": image_url}})
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
    image_data_url: Optional[str | Sequence[str]],
    broadcast_callable,
) -> None:
    """异步触发一次 self-verify,完成后通过 broadcast_callable 推送结果。

    无 image / 无答案 / 无 vision 模型时直接跳过(不报错)。
    所有失败均吞掉,只通过 verdict=UNKNOWN 透出。
    """
    images = _normalize_image_data_urls(image_data_url)
    if not qa_id or not answer or not images:
        return
    if _pick_vision_model_cfg() is None:
        return
    if not _VERIFY_SEMAPHORE.acquire(blocking=False):
        _log.debug("vision_verify skipped (semaphore full) id=%s", qa_id)
        return

    def _worker() -> None:
        try:
            result = _verify_blocking(answer, images)
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
        finally:
            _VERIFY_SEMAPHORE.release()

    threading.Thread(
        target=_worker,
        name=f"vision-verify-{qa_id[-6:]}",
        daemon=True,
    ).start()
