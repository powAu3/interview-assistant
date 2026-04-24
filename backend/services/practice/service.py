from __future__ import annotations

import json
import threading
from typing import Any, Optional

from core.config import get_config
from services.llm import _add_tokens, get_client_for_model

from .models import PracticeSession

_practice: Optional[PracticeSession] = None
_lock = threading.Lock()


def get_practice() -> PracticeSession:
    global _practice
    with _lock:
        if _practice is None:
            _practice = PracticeSession()
        return _practice


def reset_practice() -> PracticeSession:
    global _practice
    with _lock:
        _practice = PracticeSession()
        return _practice


def _practice_model_ready(model_cfg) -> bool:
    return bool(
        getattr(model_cfg, "enabled", True)
        and model_cfg.api_key
        and model_cfg.api_key not in ("", "sk-your-api-key-here")
    )


def _pick_practice_model():
    from api.common import get_model_health

    cfg = get_config()
    if not cfg.models:
        raise ValueError("没有可用的练习模型：请至少配置一个模型")

    active = max(0, min(int(cfg.active_model), len(cfg.models) - 1))
    order = [active] + [i for i in range(len(cfg.models)) if i != active]

    for respect_health in (True, False):
        for index in order:
            model_cfg = cfg.models[index]
            if not _practice_model_ready(model_cfg):
                continue
            if respect_health and get_model_health(index) == "error":
                continue
            return model_cfg

    raise ValueError("没有可用的练习模型：请至少启用一个已配置 API Key 的模型")


def _json_from_text(text: str) -> Any:
    text = (text or "").strip()
    if not text:
        return {}
    if text[0] not in "[{":
        obj_start = text.find("{")
        arr_start = text.find("[")
        starts = [value for value in [obj_start, arr_start] if value >= 0]
        if starts:
            text = text[min(starts):]
    if text and text[0] == "{":
        end = text.rfind("}")
        if end >= 0:
            text = text[: end + 1]
    elif text and text[0] == "[":
        end = text.rfind("]")
        if end >= 0:
            text = text[: end + 1]
    return json.loads(text)


def _request_json_completion(model_cfg, prompt: str, *, max_tokens: int = 2200) -> dict[str, Any]:
    client = get_client_for_model(model_cfg)
    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=max_tokens,
    )
    if getattr(response, "usage", None):
        _add_tokens(
            response.usage.prompt_tokens or 0,
            response.usage.completion_tokens or 0,
        )
    text = response.choices[0].message.content or "{}"
    raw = _json_from_text(text)
    if isinstance(raw, dict):
        return raw
    return {}


def _request_text_completion(model_cfg, prompt: str, *, max_tokens: int = 1800) -> str:
    client = get_client_for_model(model_cfg)
    response = client.chat.completions.create(
        model=model_cfg.model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5,
        max_tokens=max_tokens,
    )
    if getattr(response, "usage", None):
        _add_tokens(
            response.usage.prompt_tokens or 0,
            response.usage.completion_tokens or 0,
        )
    return (response.choices[0].message.content or "").strip()
