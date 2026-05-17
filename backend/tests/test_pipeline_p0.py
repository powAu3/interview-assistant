"""
Pipeline-level P0 fixes (CR follow-up):
  - _interview_worker 任意退出路径 (正常 / 异常) 都必须释放音频设备
  - gc.collect() 不再在主 ASR 循环里同步执行 (移到独立 daemon 线程)
"""

from __future__ import annotations

import importlib
import sys
import threading
import time
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

pipeline = importlib.import_module("api.assist.pipeline")


# ---------- 共享 fakes -------------------------------------------------------


class _FakeEngine:
    is_loaded = True

    def load_model(self):
        pass

    def transcribe(self, *args, **kwargs):
        return ""


class _FakeSession:
    def __init__(self):
        self.is_recording = True
        self.is_paused = False
        self.transcription_history = []
        self.qa_pairs = []


class _RecordingAudioCapture:
    """记录 stop 调用次数 + owner; get_audio_chunk 可被外部控制."""

    SAMPLE_RATE = 16000

    def __init__(self):
        self.stop_calls: list[str | None] = []
        self.start_calls: list[tuple] = []
        self._chunk_provider = lambda: None  # 默认无音频, 走 sleep 分支

    def start(self, device_id, owner=None):
        self.start_calls.append((device_id, owner))

    def stop(self, owner=None):
        self.stop_calls.append(owner)

    def get_audio_chunk(self, timeout=0.1):
        return self._chunk_provider()


def _wire_common_fakes(monkeypatch, audio_capture, session, *, gc_counter=None):
    """统一打桩 _interview_worker 的全部外部依赖."""

    monkeypatch.setattr(pipeline, "audio_capture", audio_capture)
    monkeypatch.setattr(pipeline, "get_stt_engine", lambda: _FakeEngine())
    monkeypatch.setattr(pipeline, "get_session", lambda: session)
    monkeypatch.setattr(pipeline, "broadcast", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_merge_buffer", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_question_group", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_reset_asr_merge_buffer", lambda: None)
    # _stop_event 是模块级单例, 确保新一轮测试干净
    pipeline._stop_event.clear()
    pipeline._pause_event.clear()

    if gc_counter is not None:
        original_gc_collect = pipeline.gc.collect

        def _counted_gc(*a, **kw):
            gc_counter.append(time.monotonic())
            return original_gc_collect(*a, **kw)

        monkeypatch.setattr(pipeline.gc, "collect", _counted_gc)


# ---------- Fix 1: audio leak --------------------------------------------------


def test_worker_normal_exit_calls_audio_stop(monkeypatch):
    """正常退出 (_stop_event 触发) 必须经过 finally 释放音频设备."""

    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    # 让循环跑一两轮就退出
    iter_count = {"n": 0}

    def _stopping_chunk_provider():
        iter_count["n"] += 1
        if iter_count["n"] > 2:
            pipeline._stop_event.set()
        return None

    audio._chunk_provider = _stopping_chunk_provider

    pipeline._interview_worker()

    # 精确断言: stop 只在 finally 调一次, 不应在 hot loop 误调。
    # 若未来 regress 加成「每轮都 stop」, 这条会立即 fail。
    assert audio.stop_calls == ["assist"], (
        f"audio.stop 应只在 finally 调一次; 实际 stop_calls={audio.stop_calls}"
    )


def test_worker_crash_in_main_loop_still_calls_audio_stop(monkeypatch):
    """主循环抛异常时, finally 仍然必须释放音频设备 (这是原 P0 bug)."""

    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    def _exploding_chunk_provider():
        raise RuntimeError("simulated audio device disappeared")

    audio._chunk_provider = _exploding_chunk_provider

    # 不应再向上抛: 顶层 except 已经 swallow 了
    pipeline._interview_worker()

    # 即使 hot loop 抛异常, 仍然只在 finally 调一次 stop, 不重复
    assert audio.stop_calls == ["assist"], (
        f"worker 崩溃后 stop 应在 finally 恰好调一次; 实际 stop_calls={audio.stop_calls}"
    )


def test_worker_idempotent_stop_safe_when_outer_already_stopped(monkeypatch):
    """worker finally 的 stop 与 stop_interview_loop 的 stop 重复也必须无害."""

    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    audio.stop_calls.append("assist")  # 模拟外部已先停一次

    iter_count = {"n": 0}

    def _stopping():
        iter_count["n"] += 1
        if iter_count["n"] > 1:
            pipeline._stop_event.set()
        return None

    audio._chunk_provider = _stopping

    pipeline._interview_worker()

    # 至少 2 次 (1 次外部 + 1 次 finally), 第二次必须不抛
    assert audio.stop_calls.count("assist") >= 2


# ---------- Fix 2: gc 不再阻塞主循环 ----------------------------------------


def test_gc_collect_not_called_in_main_loop(monkeypatch):
    """主循环里不应再同步调 gc.collect (移到了 daemon 线程, 60s 才触发一次).

    在 50ms 的快测试窗口内, daemon 线程不会 fire, 所以 gc.collect 调用次数应为 0.
    若实现 regress 回到 inline gc, 就算第一轮也会调一次, 测试就会 fail.
    """

    audio = _RecordingAudioCapture()
    session = _FakeSession()
    gc_calls: list[float] = []
    _wire_common_fakes(monkeypatch, audio, session, gc_counter=gc_calls)

    iter_count = {"n": 0}

    def _stopping_chunk_provider():
        iter_count["n"] += 1
        # 多跑几轮验证主循环本体不触发 gc
        if iter_count["n"] > 50:
            pipeline._stop_event.set()
        return None

    audio._chunk_provider = _stopping_chunk_provider

    pipeline._interview_worker()

    assert gc_calls == [], (
        f"主循环内不应同步触发 gc.collect (会卡音频读取); 实际触发 {len(gc_calls)} 次"
    )


def test_gc_daemon_thread_terminates_when_worker_exits(monkeypatch):
    """worker 退出后 gc 后台线程必须能被 _gc_stop 通知退出, 不留孤儿."""

    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    iter_count = {"n": 0}

    def _stopping():
        iter_count["n"] += 1
        if iter_count["n"] > 1:
            pipeline._stop_event.set()
        return None

    audio._chunk_provider = _stopping

    threads_before = {t.name for t in threading.enumerate()}
    pipeline._interview_worker()
    # finally 已显式 join(timeout=0.5), 不需要再 sleep 等收敛
    threads_after = {t.name for t in threading.enumerate() if t.is_alive()}

    # 不残留与 gc daemon 同名的孤儿线程
    new_threads = threads_after - threads_before
    leaked = [n for n in new_threads if "assist-gc" in n.lower()]
    assert leaked == [], f"gc daemon 线程应该已退出; 残留: {leaked}"


# ---------- 兜底: 仅供 sanity ------------------------------------------------


def test_worker_stop_on_load_failure_does_not_call_audio_stop(monkeypatch):
    """模型加载失败的早退路径不会进入 try 块, audio_capture 也没 start 过,
    因此不应误调 stop (避免与外部 stop 顺序竞争)."""

    audio = _RecordingAudioCapture()
    session = _FakeSession()

    class _BrokenEngine:
        is_loaded = False

        def load_model(self):
            raise RuntimeError("model load failed")

    monkeypatch.setattr(pipeline, "audio_capture", audio)
    monkeypatch.setattr(pipeline, "get_stt_engine", lambda: _BrokenEngine())
    monkeypatch.setattr(pipeline, "get_session", lambda: session)
    monkeypatch.setattr(pipeline, "broadcast", lambda *a, **kw: None)

    pipeline._interview_worker()

    # 早退路径没有 try/finally 保护, audio.stop 不会从 worker 内部触发
    # (外部 stop_interview_loop 自己会调). 这条用例锁定行为, 防止以后
    # "保险起见" 在错误路径乱加 stop 反而干扰外部 owner 一致性。
    assert audio.stop_calls == [], (
        f"模型加载失败的早退路径不应调用 audio.stop; 实际 stop_calls={audio.stop_calls}"
    )


# ---------- Written exam mode: start without audio ---------------------------


def test_start_nonblocking_skips_audio_in_exam_mode(monkeypatch):
    """笔试模式 start_nonblocking(device_id=None) 不调 audio_capture.start() 且不启动 ASR worker."""

    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    monkeypatch.setattr(
        pipeline, "get_config",
        lambda: type("Cfg", (), {"written_exam_mode": True})(),
    )

    pipeline.start_nonblocking(device_id=None)

    assert audio.start_calls == [], (
        f"笔试模式不应调用 audio_capture.start; 实际 start_calls={audio.start_calls}"
    )
    assert session.is_recording is True
    assert session.is_paused is False

    pipeline.stop_interview_loop()

    assert "assist" in audio.stop_calls


def test_start_nonblocking_with_device_in_exam_mode(monkeypatch):
    """笔试模式仍允许传 device_id 走正常音频路径（用户想同时录音）."""

    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    monkeypatch.setattr(
        pipeline, "get_config",
        lambda: type("Cfg", (), {"written_exam_mode": True})(),
    )

    pipeline.start_nonblocking(device_id=1)

    assert audio.start_calls == [(1, "assist")], (
        f"传了 device_id 时应走音频路径; 实际 start_calls={audio.start_calls}"
    )

    pipeline.stop_interview_loop()


def test_stop_interview_loop_safe_when_no_audio_started(monkeypatch):
    """笔试模式启动后（无音频）stop_interview_loop 安全完成."""

    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    monkeypatch.setattr(
        pipeline, "get_config",
        lambda: type("Cfg", (), {"written_exam_mode": True})(),
    )

    pipeline.start_nonblocking(device_id=None)
    assert session.is_recording is True

    pipeline.stop_interview_loop()

    assert session.is_recording is False
    assert session.is_paused is False
