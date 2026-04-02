"""Pre-flight pipeline diagnostic: Audio → STT → LLM → WebSocket."""

import threading
import time
from typing import Optional

import numpy as np
from core.config import get_config
from services.stt import get_stt_engine
from services.llm.streaming import get_client
from api.realtime.ws import broadcast

PREFLIGHT_SCENARIOS = [
    {
        "id": "self_intro",
        "label": "\u81EA\u6211\u4ECB\u7ECD",
        "question": "\u8BF7\u505A\u4E00\u4E0B\u81EA\u6211\u4ECB\u7ECD",
        "recommended": True,
    },
    {
        "id": "algo",
        "label": "\u7B97\u6CD5\u9898",
        "question": "\u8BF4\u4E00\u4E0B\u5FEB\u901F\u6392\u5E8F\u7684\u65F6\u95F4\u590D\u6742\u5EA6",
        "recommended": False,
    },
    {
        "id": "system_design",
        "label": "\u7CFB\u7EDF\u8BBE\u8BA1",
        "question": "\u5982\u4F55\u8BBE\u8BA1\u4E00\u4E2A\u9AD8\u5E76\u53D1\u7684\u77ED\u94FE\u670D\u52A1",
        "recommended": False,
    },
]

_running = False
_lock = threading.Lock()


def _broadcast_step(step: str, status: str, detail: str = "", extra: Optional[dict] = None):
    msg = {"type": "preflight_step", "step": step, "status": status, "detail": detail}
    if extra:
        msg.update(extra)
    broadcast(msg)


def _run_diagnostic(device_id: Optional[int], scenario_id: str):
    global _running
    try:
        cfg = get_config()
        scenario = next((s for s in PREFLIGHT_SCENARIOS if s["id"] == scenario_id), PREFLIGHT_SCENARIOS[0])

        _broadcast_step("audio", "running", "\u6B63\u5728\u68C0\u6D4B\u97F3\u9891\u8BBE\u5907\u2026")
        try:
            if device_id is not None:
                from services.audio import AudioCapture
                cap = AudioCapture()
                cap.start(device_id)
                time.sleep(0.5)
                frames = cap.get_audio_chunk()
                cap.stop()
                if frames is not None and len(frames) > 0:
                    peak = float(np.max(np.abs(frames)))
                    _broadcast_step("audio", "pass", f"\u97F3\u9891\u8BBE\u5907\u6B63\u5E38\uFF0C\u5CF0\u503C {peak:.4f}")
                else:
                    _broadcast_step("audio", "pass", "\u97F3\u9891\u8BBE\u5907\u53EF\u8BBF\u95EE\uFF08\u65E0\u4FE1\u53F7\uFF09")
            else:
                _broadcast_step("audio", "skip", "\u672A\u9009\u62E9\u97F3\u9891\u8BBE\u5907\uFF0C\u8DF3\u8FC7")
        except Exception as e:
            _broadcast_step("audio", "fail", str(e)[:120])

        _broadcast_step("stt", "running", "\u6B63\u5728\u68C0\u6D4B\u8BED\u97F3\u8BC6\u522B\u5F15\u64CE\u2026")
        try:
            engine = get_stt_engine()
            sr = 16000
            silence = np.zeros(int(sr * 1.0), dtype=np.float32)
            result = engine.transcribe(silence, sample_rate=sr)
            if result is not None:
                _broadcast_step("stt", "pass", f"STT \u5F15\u64CE ({cfg.stt_provider}) \u5DE5\u4F5C\u6B63\u5E38")
            else:
                _broadcast_step("stt", "warn", "STT \u8FD4\u56DE\u7A7A\u7ED3\u679C\uFF0C\u53EF\u80FD\u914D\u7F6E\u6709\u8BEF")
        except Exception as e:
            _broadcast_step("stt", "fail", str(e)[:120])

        _broadcast_step("llm", "running", "\u6B63\u5728\u68C0\u6D4B LLM \u6A21\u578B\u8FDE\u63A5\u2026")
        try:
            client = get_client()
            model_cfg = cfg.get_active_model()
            resp = client.chat.completions.create(
                model=model_cfg.model,
                messages=[
                    {"role": "system", "content": "\u4F60\u662F\u4E00\u4F4D\u6280\u672F\u9762\u8BD5\u5B98\u3002\u7528\u4E00\u53E5\u8BDD\u56DE\u7B54\u3002"},
                    {"role": "user", "content": scenario["question"]},
                ],
                max_tokens=120,
                stream=False,
            )
            answer = resp.choices[0].message.content or ""
            _broadcast_step(
                "llm", "pass",
                f"\u6A21\u578B ({model_cfg.name}) \u54CD\u5E94\u6B63\u5E38",
                extra={"answer": answer.strip(), "question": scenario["question"]},
            )
        except Exception as e:
            _broadcast_step("llm", "fail", str(e)[:150])

        _broadcast_step("ws", "pass", "WebSocket \u94FE\u8DEF\u6B63\u5E38\uFF08\u60A8\u770B\u5230\u8FD9\u6761\u5C31\u8BF4\u660E\u5DF2\u901A\uFF09")
        _broadcast_step("done", "done", "\u94FE\u8DEF\u68C0\u6D4B\u5B8C\u6210")

    except Exception as e:
        _broadcast_step("error", "fail", f"\u68C0\u6D4B\u5F02\u5E38: {e}")
    finally:
        with _lock:
            _running = False


def start_preflight(device_id: Optional[int] = None, scenario_id: str = "self_intro"):
    global _running
    with _lock:
        if _running:
            return False
        _running = True
    t = threading.Thread(target=_run_diagnostic, args=(device_id, scenario_id), daemon=True)
    t.start()
    return True


def get_scenarios():
    return PREFLIGHT_SCENARIOS
