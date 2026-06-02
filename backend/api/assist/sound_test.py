"""Pre-flight real audio diagnostic: Playback → Capture → STT → LLM → WebSocket."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np

from api.realtime.ws import broadcast
from core.config import get_config
from core.logger import get_logger
from services.audio import AudioCapture, play_audio_file
from services.llm import (
    PROMPT_MODE_MANUAL_TEXT,
    build_system_prompt,
    chat_stream_single_model,
    create_answer_stream_sanitizer,
    postprocess_answer_for_mode,
)
from services.stt import get_stt_engine

PREFLIGHT_SCENARIOS = [
    {
        "id": "self_intro",
        "label": "项目经历",
        "question": "请介绍一下你最近做过的项目",
        "recommended": True,
    }
]

PREFLIGHT_EXPECTED_PHRASE = "请介绍一下你最近做过的项目"
PREFLIGHT_AUDIO_PATH = Path(__file__).resolve().parents[2] / "assets" / "preflight_phrase.wav"

_running = False
_lock = threading.Lock()
_log = get_logger("assist.preflight")
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
_level_lock = threading.Lock()
_level_stop_event = threading.Event()
_level_thread: Optional[threading.Thread] = None
_level_status: dict = {
    "running": False,
    "device_id": None,
    "rms": 0.0,
    "peak": 0.0,
    "level_pct": 0,
    "has_signal": False,
    "error": None,
    "started_at": None,
    "updated_at": None,
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


def test_input_audio(device_id: int, duration_sec: float = 1.2) -> dict:
    cap = AudioCapture()
    started = time.monotonic()
    try:
        cap.start(int(device_id), owner="audio-test", mic_compatibility_mode=True)
        time.sleep(0.1)
        captured = collect_capture_audio(
            cap,
            duration_sec=max(0.5, min(3.0, float(duration_sec or 1.2))),
        )
    finally:
        cap.stop(owner="audio-test")

    elapsed_sec = time.monotonic() - started
    if captured is None or len(captured) == 0:
        return {
            "ok": False,
            "device_id": int(device_id),
            "elapsed_sec": elapsed_sec,
            "rms": 0.0,
            "peak": 0.0,
            "has_signal": False,
            "detail": "未捕获到音频，请检查麦克风权限或设备选择",
        }

    audio = captured.astype(np.float32)
    rms = float(AudioCapture.compute_energy(audio))
    peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
    has_signal = rms > 0.003 or peak > 0.02
    return {
        "ok": True,
        "device_id": int(device_id),
        "elapsed_sec": elapsed_sec,
        "samples": int(len(audio)),
        "rms": rms,
        "peak": peak,
        "has_signal": has_signal,
        "detail": (
            f"已捕获输入信号（RMS {rms:.4f}，峰值 {peak:.3f}）"
            if has_signal
            else f"已打开麦克风，但音量偏低（RMS {rms:.4f}，峰值 {peak:.3f}）"
        ),
    }


def _input_level_pct(rms: float, peak: float) -> int:
    return max(0, min(100, int(round(max(rms * 2500, peak * 250)))))


def _set_level_status(**updates) -> None:
    with _level_lock:
        _level_status.update(updates)
        _level_status["updated_at"] = time.time()


def get_input_level_status() -> dict:
    with _level_lock:
        return dict(_level_status)


def _run_input_level_monitor(device_id: int, stop_event: threading.Event) -> None:
    cap = AudioCapture()
    rms = 0.0
    peak = 0.0
    try:
        cap.start(int(device_id), owner="audio-level-test", mic_compatibility_mode=True)
        _set_level_status(running=True, error=None)
        while not stop_event.is_set():
            chunk = cap.get_audio_chunk(max_chunks=4)
            if chunk is not None and len(chunk) > 0:
                audio = chunk.astype(np.float32)
                next_rms = float(AudioCapture.compute_energy(audio))
                next_peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
                rms = (rms * 0.35) + (next_rms * 0.65)
                peak = max(next_peak, peak * 0.72)
            else:
                rms *= 0.82
                peak *= 0.72
            _set_level_status(
                rms=rms,
                peak=peak,
                level_pct=_input_level_pct(rms, peak),
                has_signal=rms > 0.003 or peak > 0.02,
            )
            stop_event.wait(0.08)
    except Exception as exc:
        _log.warning("input level monitor failed device=%s: %s", device_id, exc, exc_info=True)
        _set_level_status(error=str(exc), running=False)
    finally:
        try:
            cap.stop(owner="audio-level-test")
        finally:
            _set_level_status(running=False)


def start_input_level_monitor(device_id: int) -> dict:
    global _level_thread, _level_stop_event, _level_status
    stop_input_level_monitor()
    with _level_lock:
        _level_stop_event = threading.Event()
        _level_status = {
            "running": True,
            "device_id": int(device_id),
            "rms": 0.0,
            "peak": 0.0,
            "level_pct": 0,
            "has_signal": False,
            "error": None,
            "started_at": time.time(),
            "updated_at": time.time(),
        }
        thread = threading.Thread(
            target=_run_input_level_monitor,
            args=(int(device_id), _level_stop_event),
            daemon=True,
            name="audio-level-test",
        )
        _level_thread = thread
    thread.start()
    return get_input_level_status()


def stop_input_level_monitor() -> dict:
    global _level_thread
    with _level_lock:
        thread = _level_thread
        _level_stop_event.set()
    if thread and thread.is_alive():
        thread.join(timeout=1.5)
    with _level_lock:
        if _level_thread is thread:
            _level_thread = None
        _level_status["running"] = False
        _level_status["updated_at"] = time.time()
    return get_input_level_status()


def resolve_preflight_scenario(scenario_id: str) -> dict:
    for scenario in PREFLIGHT_SCENARIOS:
        if scenario.get("id") == scenario_id:
            return scenario
    for scenario in PREFLIGHT_SCENARIOS:
        if scenario.get("recommended"):
            return scenario
    return PREFLIGHT_SCENARIOS[0]


def generate_preflight_answer(cfg, model_cfg, question: str) -> dict:
    prompt_mode = PROMPT_MODE_MANUAL_TEXT
    system_prompt = build_system_prompt(
        manual_input=True,
        mode=prompt_mode,
        screen_region=getattr(cfg, "screen_capture_region", "left_half"),
    )
    sanitizer = create_answer_stream_sanitizer(prompt_mode)
    raw_answer = ""
    started = time.monotonic()
    first_token_mono: Optional[float] = None
    for chunk_type, chunk_text in chat_stream_single_model(
        model_cfg,
        [{"role": "user", "content": question}],
        system_prompt=system_prompt,
    ):
        if chunk_type != "text":
            continue
        if first_token_mono is None and chunk_text:
            first_token_mono = time.monotonic()
        raw_answer += chunk_text
        sanitizer.push(chunk_text)
    sanitizer.finish()
    total_ms = int((time.monotonic() - started) * 1000)
    first_token_ms = int((first_token_mono - started) * 1000) if first_token_mono is not None else total_ms
    return {
        "answer": postprocess_answer_for_mode(raw_answer, prompt_mode).strip(),
        "first_token_ms": first_token_ms,
        "total_ms": total_ms,
    }


def _run_preflight(device_id: Optional[int], scenario_id: str):
    global _running
    started_mono = time.monotonic()
    scenario = resolve_preflight_scenario(scenario_id)
    resolved_scenario_id = scenario.get("id", scenario_id)
    expected_phrase = scenario.get("expected_phrase") or PREFLIGHT_EXPECTED_PHRASE
    llm_question = scenario.get("question") or expected_phrase
    _set_status(
        running=True,
        scenario_id=resolved_scenario_id,
        device_id=device_id,
        expected_phrase=expected_phrase,
        captured_transcript=None,
        match_ok=None,
        steps={},
        error=None,
        started_at=time.time(),
        finished_at=None,
    )
    try:
        _log.info("PREFLIGHT_START scenario=%s requested=%s device_id=%s", resolved_scenario_id, scenario_id, device_id)
        if device_id is None:
            raise RuntimeError("未选择音频设备，无法进行真实音频链路测试")

        cfg = get_config()
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
        ok, detail = match_phrase(expected_phrase, transcript)
        _set_step("stt", "pass" if transcript.strip() else "fail", transcript.strip() or "识别结果为空", {"transcript": transcript})
        _set_status(match_ok=ok)
        _set_step("match", "pass" if ok else "fail", detail, {"transcript": transcript, "expected_phrase": expected_phrase})
        if not ok:
            raise RuntimeError(detail)

        _set_step("llm", "running", "正在通过真实答题链路检测 LLM…")
        model_cfg = cfg.get_active_model()
        llm_result = generate_preflight_answer(cfg, model_cfg, llm_question)
        answer = llm_result["answer"]
        if not answer:
            raise RuntimeError("模型回答为空")
        _log.info(
            "PREFLIGHT_LLM_OK model=%s question=%r first_token=%dms total=%dms answer_len=%d",
            model_cfg.name,
            llm_question,
            llm_result["first_token_ms"],
            llm_result["total_ms"],
            len(answer),
        )
        _set_step(
            "llm",
            "pass",
            f"首 token {llm_result['first_token_ms']}ms · 完整 {llm_result['total_ms']}ms",
            {
                "answer": answer,
                "question": llm_question,
                "first_token_ms": llm_result["first_token_ms"],
                "total_ms": llm_result["total_ms"],
                "model_name": model_cfg.name,
            },
        )

        _set_step("ws", "pass", "WebSocket 链路正常（您看到这条就说明已通）")
        _set_step("done", "done", "真实音频链路检测完成")
        _log.info("PREFLIGHT_DONE scenario=%s elapsed=%.0fms", resolved_scenario_id, (time.monotonic() - started_mono) * 1000)
    except Exception as e:
        _log.error("PREFLIGHT_ERROR scenario=%s requested=%s device_id=%s: %s", resolved_scenario_id, scenario_id, device_id, e, exc_info=True)
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
