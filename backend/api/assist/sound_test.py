"""Pre-flight real audio diagnostic: Playback → Capture → STT → LLM → WebSocket."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np

from api.realtime.ws import broadcast
from core.config import get_config
from services.audio import AudioCapture, play_audio_file
from services.llm.streaming import get_client
from services.stt import get_stt_engine

PREFLIGHT_SCENARIOS = [
    {
        "id": "self_intro",
        "label": "自我介绍",
        "question": "请做一下自我介绍",
        "recommended": True,
    },
    {
        "id": "algo",
        "label": "算法题",
        "question": "说一下快速排序的时间复杂度",
        "recommended": False,
    },
    {
        "id": "system_design",
        "label": "系统设计",
        "question": "如何设计一个高并发的短链服务",
        "recommended": False,
    },
]

PREFLIGHT_EXPECTED_PHRASE = "请介绍一下你最近做过的项目"
PREFLIGHT_AUDIO_PATH = Path(__file__).resolve().parents[2] / "assets" / "preflight_phrase.wav"

_running = False
_lock = threading.Lock()
_status: dict = {
    "running": False,
    "scenario_id": None,
    "device_id": None,
    "expected_phrase": PREFLIGHT_EXPECTED_PHRASE,
    "captured_transcript": None,
    "match_ok": None,
    "steps": {},
    "error": None,
    "started_at": None,
    "finished_at": None,
}


def normalize_phrase(text: str) -> str:
    text = (text or "").strip().lower()
    if not text:
        return ""
    punctuation = "，。！？；：、,.!?;:'\"()[]{}<>-—_~`"
    return "".join(ch for ch in text if ch not in punctuation and not ch.isspace())


def match_phrase(expected: str, actual: str) -> tuple[bool, str]:
    expected_norm = normalize_phrase(expected)
    actual_norm = normalize_phrase(actual)
    if not actual_norm:
        return False, "未识别到有效文本"
    if expected_norm in actual_norm or actual_norm in expected_norm:
        return True, "识别匹配"
    overlap = sum(1 for ch in expected_norm if ch in actual_norm)
    if expected_norm and overlap / max(len(expected_norm), 1) >= 0.7:
        return True, "识别近似匹配"
    return False, f"识别未匹配（识别结果：{actual.strip() or '空'}）"


def _set_status(**updates):
    with _lock:
        _status.update(updates)


def _set_step(step: str, status: str, detail: str = "", extra: Optional[dict] = None):
    entry = {"status": status, "detail": detail}
    if extra:
        entry.update(extra)
    with _lock:
        steps = dict(_status.get("steps") or {})
        steps[step] = entry
        _status["steps"] = steps
    msg = {"type": "preflight_step", "step": step, "status": status, "detail": detail}
    if extra:
        msg.update(extra)
    broadcast(msg)


def get_preflight_status() -> dict:
    with _lock:
        return {
            "running": _status.get("running", False),
            "scenario_id": _status.get("scenario_id"),
            "device_id": _status.get("device_id"),
            "expected_phrase": _status.get("expected_phrase", PREFLIGHT_EXPECTED_PHRASE),
            "captured_transcript": _status.get("captured_transcript"),
            "match_ok": _status.get("match_ok"),
            "steps": dict(_status.get("steps") or {}),
            "error": _status.get("error"),
            "started_at": _status.get("started_at"),
            "finished_at": _status.get("finished_at"),
        }


def collect_capture_audio(cap: AudioCapture, duration_sec: float, poll_interval: float = 0.05) -> Optional[np.ndarray]:
    deadline = time.monotonic() + duration_sec
    chunks: list[np.ndarray] = []
    while time.monotonic() < deadline:
        chunk = cap.get_audio_chunk()
        if chunk is not None and len(chunk) > 0:
            chunks.append(chunk)
        time.sleep(poll_interval)
    if not chunks:
        return None
    return np.concatenate(chunks)


def play_preflight_audio() -> float:
    if not PREFLIGHT_AUDIO_PATH.exists():
        raise RuntimeError(f"测试音频不存在: {PREFLIGHT_AUDIO_PATH}")
    started = time.monotonic()
    play_audio_file(PREFLIGHT_AUDIO_PATH)
    return time.monotonic() - started


def _run_preflight(device_id: Optional[int], scenario_id: str):
    global _running
    _set_status(
        running=True,
        scenario_id=scenario_id,
        device_id=device_id,
        expected_phrase=PREFLIGHT_EXPECTED_PHRASE,
        captured_transcript=None,
        match_ok=None,
        steps={},
        error=None,
        started_at=time.time(),
        finished_at=None,
    )
    try:
        if device_id is None:
            raise RuntimeError("未选择音频设备，无法进行真实音频链路测试")

        cfg = get_config()
        scenario = next((s for s in PREFLIGHT_SCENARIOS if s["id"] == scenario_id), PREFLIGHT_SCENARIOS[0])

        cap = AudioCapture()
        _set_step("playback", "running", "准备播放测试音频…")
        _set_step("capture", "running", "准备捕获真实音频…")
        try:
            cap.start(device_id)
            time.sleep(0.15)
            playback_elapsed = play_preflight_audio()
            _set_step("playback", "pass", f"测试音频已播放（{playback_elapsed:.2f}s）")
            captured = collect_capture_audio(cap, duration_sec=max(0.8, playback_elapsed + 0.45))
        finally:
            cap.stop()

        if captured is None or len(captured) == 0:
            _set_step("capture", "fail", "未捕获到有效音频")
            raise RuntimeError("未捕获到有效音频")

        energy = float(AudioCapture.compute_energy(captured))
        if energy <= 0.003:
            _set_step("capture", "fail", f"捕获音量过低（RMS {energy:.4f}）")
            raise RuntimeError("捕获音量过低，请检查输出音量或设备选择")
        _set_step("capture", "pass", f"已捕获真实音频（RMS {energy:.4f}）")

        _set_step("stt", "running", "正在识别测试音频…")
        engine = get_stt_engine()
        transcript = engine.transcribe(captured.astype(np.float32), sample_rate=AudioCapture.SAMPLE_RATE) or ""
        _set_status(captured_transcript=transcript)
        ok, detail = match_phrase(PREFLIGHT_EXPECTED_PHRASE, transcript)
        _set_step("stt", "pass" if transcript.strip() else "fail", transcript.strip() or "识别结果为空", {"transcript": transcript})
        _set_status(match_ok=ok)
        _set_step("match", "pass" if ok else "fail", detail, {"transcript": transcript, "expected_phrase": PREFLIGHT_EXPECTED_PHRASE})
        if not ok:
            raise RuntimeError(detail)

        _set_step("llm", "running", "正在检测 LLM 模型连接…")
        client = get_client()
        model_cfg = cfg.get_active_model()
        resp = client.chat.completions.create(
            model=model_cfg.model,
            messages=[
                {"role": "system", "content": "你是一位技术面试官。用一句话回答。"},
                {"role": "user", "content": scenario["question"]},
            ],
            max_tokens=120,
            stream=False,
        )
        answer = resp.choices[0].message.content or ""
        _set_step("llm", "pass", f"模型 ({model_cfg.name}) 响应正常", {"answer": answer.strip(), "question": scenario["question"]})

        _set_step("ws", "pass", "WebSocket 链路正常（您看到这条就说明已通）")
        _set_step("done", "done", "真实音频链路检测完成")
    except Exception as e:
        _set_status(error=str(e))
        _set_step("error", "fail", f"检测异常: {e}")
    finally:
        with _lock:
            _status["running"] = False
            _status["finished_at"] = time.time()
            _running = False


def start_preflight(device_id: Optional[int] = None, scenario_id: str = "self_intro"):
    global _running
    with _lock:
        if _running:
            return False
        _running = True
    t = threading.Thread(target=_run_preflight, args=(device_id, scenario_id), daemon=True)
    t.start()
    return True


def get_scenarios():
    return PREFLIGHT_SCENARIOS
