"""Written-exam diagnostic: fixed screenshot code question -> LLM -> WebSocket."""

from __future__ import annotations

import base64
import io
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from api.common.model_health import get_model_health
from api.realtime.ws import broadcast
from core.config import get_config
from core.logger import get_logger
from .answer_worker import prompt_server_screen_code


EXAM_PREFLIGHT_QUESTION = "代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。"
EXAM_PREFLIGHT_EVENT_TYPE = "exam_preflight_step"

_running = False
_lock = threading.Lock()
_log = get_logger("assist.exam_preflight")
_status: dict = {
    "running": False,
    "question": EXAM_PREFLIGHT_QUESTION,
    "model_name": None,
    "preflight_id": None,
    "qa_id": None,
    "steps": {},
    "error": None,
    "started_at": None,
    "finished_at": None,
}


def _set_status(**updates) -> None:
    with _lock:
        _status.update(updates)


def _set_step(step: str, status: str, detail: str = "", extra: Optional[dict] = None) -> None:
    entry = {"status": status, "detail": detail}
    if extra:
        entry.update(extra)
    with _lock:
        steps = dict(_status.get("steps") or {})
        steps[step] = entry
        _status["steps"] = steps
    msg = {"type": EXAM_PREFLIGHT_EVENT_TYPE, "step": step, "status": status, "detail": detail}
    if extra:
        msg.update(extra)
    broadcast(msg)


def _set_step_unless_status(
    step: str,
    status: str,
    detail: str = "",
    extra: Optional[dict] = None,
    *,
    blocked_statuses: tuple[str, ...] = ("pass", "fail", "done"),
) -> bool:
    entry = {"status": status, "detail": detail}
    if extra:
        entry.update(extra)
    with _lock:
        steps = dict(_status.get("steps") or {})
        current = steps.get(step) or {}
        if current.get("status") in blocked_statuses:
            return False
        steps[step] = entry
        _status["steps"] = steps
    msg = {"type": EXAM_PREFLIGHT_EVENT_TYPE, "step": step, "status": status, "detail": detail}
    if extra:
        msg.update(extra)
    broadcast(msg)
    return True


def get_exam_preflight_status() -> dict:
    with _lock:
        return {
            "running": _status.get("running", False),
            "question": _status.get("question") or EXAM_PREFLIGHT_QUESTION,
            "model_name": _status.get("model_name"),
            "preflight_id": _status.get("preflight_id"),
            "qa_id": _status.get("qa_id"),
            "steps": dict(_status.get("steps") or {}),
            "error": _status.get("error"),
            "started_at": _status.get("started_at"),
            "finished_at": _status.get("finished_at"),
        }


def _font_candidates() -> list[str]:
    return [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]


def _load_font(size: int):
    from PIL import ImageFont

    for path in _font_candidates():
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                continue
    try:
        return ImageFont.truetype("arial.ttf", size=size)
    except Exception:
        return ImageFont.load_default()


def build_fixed_code_question_image_data_url() -> str:
    """Create a deterministic screenshot-like PNG for the exam preflight."""
    from PIL import Image, ImageDraw

    width, height = 1080, 620
    image = Image.new("RGB", (width, height), "#f8fafc")
    draw = ImageDraw.Draw(image)
    title_font = _load_font(34)
    body_font = _load_font(26)
    mono_font = _load_font(24)

    draw.rounded_rectangle((36, 36, width - 36, height - 36), radius=20, fill="#ffffff", outline="#cbd5e1", width=2)
    draw.rounded_rectangle((64, 68, 232, 116), radius=14, fill="#dbeafe", outline="#93c5fd", width=1)
    draw.text((84, 78), "代码题", fill="#1d4ed8", font=body_font)
    draw.text((64, 148), "两数之和", fill="#0f172a", font=title_font)

    lines = [
        "给定整数数组 nums 和目标值 target，",
        "请返回数组中两个数之和等于 target 的下标。",
        "假设每组输入只存在一个答案，且同一个元素不能重复使用。",
        "示例：nums = [2, 7, 11, 15], target = 9，输出 [0, 1]",
    ]
    y = 212
    for line in lines:
        draw.text((64, y), line, fill="#334155", font=body_font)
        y += 48

    draw.rounded_rectangle((64, 430, width - 64, 540), radius=14, fill="#0f172a", outline="#1e293b", width=1)
    draw.text((92, 456), "def two_sum(nums, target):", fill="#bfdbfe", font=mono_font)
    draw.text((92, 492), "    # return [i, j]", fill="#86efac", font=mono_font)

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _model_key_ok(model_cfg) -> bool:
    api_key = getattr(model_cfg, "api_key", "")
    return bool(api_key and api_key not in ("", "sk-your-api-key-here"))


def select_exam_preflight_model(cfg):
    """Pick the same kind of model a real screenshot code question requires."""
    models = list(getattr(cfg, "models", []) or [])
    if not models:
        raise RuntimeError("没有可用的答题模型，请先配置模型")

    try:
        active_idx = max(0, min(int(getattr(cfg, "active_model", 0) or 0), len(models) - 1))
    except Exception:
        active_idx = 0
    order = [active_idx] + [i for i in range(len(models)) if i != active_idx]

    def eligible(i: int, model_cfg, *, ignore_health: bool = False) -> bool:
        if not getattr(model_cfg, "enabled", True):
            return False
        if not _model_key_ok(model_cfg):
            return False
        if not getattr(model_cfg, "supports_vision", False):
            return False
        if not ignore_health and get_model_health(i) == "error":
            return False
        return True

    for idx in order:
        model_cfg = models[idx]
        if eligible(idx, model_cfg):
            return idx, model_cfg
    for idx in order:
        model_cfg = models[idx]
        if eligible(idx, model_cfg, ignore_health=True):
            return idx, model_cfg
    raise RuntimeError("没有可用的识图模型，请在设置中启用一个支持视觉且已填写 API Key 的模型")


def _exam_preflight_task(cfg, image_data_url: str, preflight_id: str):
    region = getattr(cfg, "screen_capture_region", "left_half")
    text = (
        f"{prompt_server_screen_code(getattr(cfg, 'language', 'Python'), region)}\n\n"
        "这是固定链路检测用截图代码题，请按笔试模式直接给出可提交代码。"
    )
    return (
        text,
        image_data_url,
        True,
        "server_screen_exam_preflight",
        {
            "origin": "server_screen",
            "image_count": 1,
            "exam_preflight": True,
            "exam_preflight_id": preflight_id,
        },
    )


def _finish_preflight() -> None:
    global _running
    with _lock:
        _status["running"] = False
        _status["finished_at"] = time.time()
        _running = False


def record_exam_preflight_answer_event(event: dict) -> None:
    preflight_id = str(event.get("exam_preflight_id") or "")
    with _lock:
        if not preflight_id or preflight_id != _status.get("preflight_id"):
            return
    event_type = event.get("type")
    if event_type == "answer_start":
        _set_status(qa_id=event.get("id"), model_name=event.get("model_name"))
        _set_step(
            "submit",
            "pass",
            "已进入真实截图答题 worker",
            {
                "question": EXAM_PREFLIGHT_QUESTION,
                "model_name": event.get("model_name", ""),
                "qa_id": event.get("id", ""),
                "preflight_id": preflight_id,
            },
        )
        _set_step("llm", "running", "正在通过真实答题流生成代码答案…")
        return
    if event_type == "answer_done":
        answer = str(event.get("answer") or "").strip()
        if answer:
            _set_step(
                "llm",
                "pass",
                f"首 token {event.get('first_token_ms', 0)}ms · 完整 {event.get('total_ms', 0)}ms",
                {
                    "answer": answer,
                    "question": EXAM_PREFLIGHT_QUESTION,
                    "first_token_ms": event.get("first_token_ms"),
                    "total_ms": event.get("total_ms"),
                    "model_name": event.get("model_name", ""),
                    "qa_id": event.get("id", ""),
                    "preflight_id": preflight_id,
                },
            )
        else:
            _set_status(error="模型回答为空")
            _set_step("error", "fail", "检测异常: 模型回答为空", {"preflight_id": preflight_id})
            _finish_preflight()
            return
        _set_step(
            "ws",
            "pass",
            "真实答题 WebSocket 完整推送正常",
            {"preflight_id": preflight_id},
        )
        _set_step(
            "ui",
            "pass",
            "检测结果已写入状态，可恢复展示",
            {"preflight_id": preflight_id},
        )
        _set_step("done", "done", "笔试链路检测完成", {"preflight_id": preflight_id})
        _finish_preflight()
        return
    if event_type in ("answer_error", "answer_cancelled"):
        message = str(event.get("message") or "笔试链路检测被取消或失败")
        _set_status(error=message)
        _set_step("error", "fail", f"检测异常: {message}", {"preflight_id": preflight_id})
        _finish_preflight()


def _run_exam_preflight() -> None:
    preflight_id = f"exam-preflight-{uuid.uuid4().hex}"
    _set_status(
        running=True,
        question=EXAM_PREFLIGHT_QUESTION,
        model_name=None,
        preflight_id=preflight_id,
        qa_id=None,
        steps={},
        error=None,
        started_at=time.time(),
        finished_at=None,
    )
    try:
        _log.info("EXAM_PREFLIGHT_START question=%r", EXAM_PREFLIGHT_QUESTION)
        _set_step("screenshot", "running", "正在生成固定截图代码题…", {"question": EXAM_PREFLIGHT_QUESTION})
        image_data_url = build_fixed_code_question_image_data_url()
        _set_step("screenshot", "pass", "已生成固定截图代码题", {"question": EXAM_PREFLIGHT_QUESTION})

        cfg = get_config()
        _set_step("submit", "running", "正在按截图审题链路提交…", {"question": EXAM_PREFLIGHT_QUESTION})
        _model_idx, model_cfg = select_exam_preflight_model(cfg)
        _set_status(model_name=getattr(model_cfg, "name", None))
        task = _exam_preflight_task(cfg, image_data_url, preflight_id)
        from .pipeline import pick_model_index, submit_answer_task

        if pick_model_index(task, set()) is None:
            raise RuntimeError("没有可用的识图模型，请检查启用状态与 API Key")
        queued = submit_answer_task(task)
        if not queued:
            raise RuntimeError("没有可用的识图模型，请检查启用状态与 API Key")
        _set_step_unless_status(
            "submit",
            "running",
            "已提交到真实截图答题 worker，等待开始流式回答…",
            {
                "question": EXAM_PREFLIGHT_QUESTION,
                "model_name": getattr(model_cfg, "name", ""),
                "preflight_id": preflight_id,
            },
        )
        _set_step_unless_status(
            "llm",
            "running",
            "等待真实答题流返回首个结果…",
            {"preflight_id": preflight_id},
            blocked_statuses=("running", "pass", "fail", "done"),
        )
        _log.info("EXAM_PREFLIGHT_QUEUED id=%s model=%s", preflight_id, getattr(model_cfg, "name", ""))
    except Exception as exc:
        _log.error("EXAM_PREFLIGHT_ERROR: %s", exc, exc_info=True)
        _set_status(error=str(exc))
        _set_step("error", "fail", f"检测异常: {exc}", {"preflight_id": preflight_id})
        _finish_preflight()


def start_exam_preflight() -> bool:
    global _running
    with _lock:
        if _running:
            return False
        _running = True
    thread = threading.Thread(target=_run_exam_preflight, daemon=True, name="exam-preflight")
    thread.start()
    return True
