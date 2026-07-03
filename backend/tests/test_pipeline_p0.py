"""
Pipeline-level P0 fixes (CR follow-up):
  - _interview_worker 任意退出路径 (正常 / 异常) 都必须释放音频设备
  - gc.collect() 不再在主 ASR 循环里同步执行 (移到独立 daemon 线程)
"""

from __future__ import annotations

import importlib
import queue
import sys
import threading
import time
from pathlib import Path

import pytest
import numpy as np

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
        self.capture_is_loopback = True


class _RecordingAudioCapture:
    """记录 stop 调用次数 + owner; get_audio_chunk 可被外部控制."""

    SAMPLE_RATE = 16000

    def __init__(self):
        self.stop_calls: list[str | None] = []
        self.stop_kwargs: list[dict] = []
        self.start_calls: list[tuple] = []
        self._chunk_provider = lambda: None  # 默认无音频, 走 sleep 分支
        self.dropped_chunks_count = 0
        self._is_running = True

    def start(self, device_id, owner=None, **kwargs):
        self.start_calls.append((device_id, owner, kwargs))
        self._is_running = True

    def stop(self, owner=None, **kwargs):
        self.stop_calls.append(owner)
        self.stop_kwargs.append(kwargs)
        self._is_running = False

    def get_audio_chunk(self, timeout=0.1):
        return self._chunk_provider()

    def drain_audio_chunks(self, timeout=0.1, max_chunks=None):
        chunk = self.get_audio_chunk(timeout=timeout)
        return [chunk] if chunk is not None else []

    @property
    def is_running(self):
        return self._is_running

    def capture_stats_snapshot(self):
        return {
            "dropped_chunks_count": int(self.dropped_chunks_count),
            "loopback_discontinuity_count": 0,
            "max_queue_chunk_samples": 0,
            "last_queue_chunk_samples": 0,
        }


def _wire_common_fakes(monkeypatch, audio_capture, session, *, gc_counter=None):
    """统一打桩 _interview_worker 的全部外部依赖."""

    monkeypatch.setattr(pipeline, "audio_capture", audio_capture)
    monkeypatch.setattr(pipeline, "get_stt_engine", lambda: _FakeEngine())
    monkeypatch.setattr(pipeline, "get_session", lambda: session)
    monkeypatch.setattr(pipeline, "broadcast", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_merge_buffer", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_question_group", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_reset_asr_merge_buffer", lambda: None)
    monkeypatch.setattr(pipeline, "_reset_pending_asr_group", lambda: None)
    # _stop_event 是模块级单例, 确保新一轮测试干净
    pipeline._stop_event.clear()
    pipeline._flush_stop_event.clear()
    pipeline._pause_event.clear()
    pipeline._interview_thread = None
    pipeline._interviewer_asr_thread = None
    pipeline._flush_thread = None
    pipeline._interviewer_runtime = None
    pipeline._last_interviewer_runtime_snapshot = None

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
    assert pipeline._flush_thread is None or not pipeline._flush_thread.is_alive()


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

    assert audio.start_calls == [(1, "assist", {})], (
        f"传了 device_id 时应走音频路径; 实际 start_calls={audio.start_calls}"
    )

    pipeline.stop_interview_loop()


def test_start_nonblocking_keeps_session_idle_when_audio_start_fails(monkeypatch):
    class _BrokenStartAudio(_RecordingAudioCapture):
        def start(self, device_id, owner=None, **kwargs):
            super().start(device_id, owner=owner, **kwargs)
            raise RuntimeError("boom")

    audio = _BrokenStartAudio()
    session = _FakeSession()
    session.is_recording = False
    session.is_paused = False
    broadcasts: list[dict] = []

    monkeypatch.setattr(pipeline, "stop_interview_loop", lambda: None)
    monkeypatch.setattr(pipeline, "audio_capture", audio)
    monkeypatch.setattr(pipeline, "get_session", lambda: session)
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)
    monkeypatch.setattr(pipeline, "_device_is_loopback", lambda _device_id: True)

    with pytest.raises(RuntimeError, match="boom"):
        pipeline.start_nonblocking(device_id=7)

    assert session.is_recording is False
    assert session.is_paused is False
    assert not any(
        event.get("type") == "recording" and event.get("value") is True
        for event in broadcasts
    )


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


def test_pause_unpause_keeps_interview_worker_alive_without_capture_error(monkeypatch):
    audio = _RecordingAudioCapture()
    candidate_audio = _RecordingAudioCapture()
    candidate_audio._is_running = False
    session = _FakeSession()
    session.last_device_id = 7
    _wire_common_fakes(monkeypatch, audio, session)

    cfg = type(
        "Cfg",
        (),
        {
            "position": "",
            "language": "zh",
            "transcription_min_sig_chars": 1,
        },
    )()
    broadcasts: list[dict] = []

    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(pipeline, "broadcast", broadcasts.append)
    monkeypatch.setattr(pipeline, "_candidate_audio_capture", candidate_audio)

    worker = threading.Thread(target=pipeline._interview_worker, daemon=True)
    pipeline._interview_thread = worker
    worker.start()
    time.sleep(0.15)

    pipeline.pause_interview()
    time.sleep(0.25)

    assert worker.is_alive(), "pause 后 interview worker 应继续存活，等待 resume"
    assert audio.stop_kwargs and audio.stop_kwargs[0].get("clear_queue") is False
    assert not any(
        event.get("type") == "error" and "音频采集异常中断" in event.get("message", "")
        for event in broadcasts
    )

    pipeline.unpause_interview()

    assert audio.start_calls[-1] == (7, "assist", {})
    assert worker.is_alive(), "resume 后应继续复用同一条 interview worker"

    pipeline._stop_event.set()
    audio._is_running = True
    worker.join(timeout=2.0)
    assert not worker.is_alive()


def test_interviewer_slow_asr_does_not_block_segment_production(monkeypatch):
    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    cfg = type(
        "Cfg",
        (),
        {
            "position": "",
            "language": "zh",
            "stt_provider": "whisper",
            "silence_threshold": 0.01,
            "silence_duration": 1.0,
            "assist_vad_min_speech_sec": 0.1,
            "assist_vad_max_speech_sec": 0.1,
            "transcription_min_sig_chars": 1,
        },
    )()
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)

    speech = np.ones(1600, dtype=np.float32) * 0.1
    chunks = [speech, speech]
    idx = {"n": 0}
    asr_started = threading.Event()
    release_asr = threading.Event()

    def _chunk_provider():
        n = idx["n"]
        if n < len(chunks):
            idx["n"] += 1
            return chunks[n]
        if idx["n"] == len(chunks):
            idx["n"] += 1
            while True:
                runtime = pipeline._interviewer_runtime
                if runtime is not None and runtime.segment_emitted >= 2:
                    break
                time.sleep(0.01)
            pipeline._stop_event.set()
        return None

    def _slow_asr(*_args, **_kwargs):
        asr_started.set()
        release_asr.wait(timeout=1.0)
        return "第一题"

    audio._chunk_provider = _chunk_provider
    monkeypatch.setattr(pipeline, "transcribe_with_fallback", _slow_asr)
    monkeypatch.setattr(
        pipeline,
        "_append_transcription_fragment",
        lambda *_args, **_kwargs: None,
    )

    worker = threading.Thread(target=pipeline._interview_worker, daemon=True)
    worker.start()

    assert asr_started.wait(timeout=1.0), "ASR worker 应该启动"
    deadline = time.time() + 1.0
    while time.time() < deadline:
        runtime = pipeline._interviewer_runtime
        if runtime is not None and runtime.segment_emitted >= 2:
            break
        time.sleep(0.01)
    runtime = pipeline._interviewer_runtime
    assert runtime is not None
    assert runtime.segment_emitted >= 2, "慢 ASR 时 ingest 仍应持续产出 segment"

    release_asr.set()
    worker.join(timeout=2.0)
    assert not worker.is_alive()


def test_stop_interview_loop_drains_pending_interviewer_segment_before_review_archive(monkeypatch):
    session = _FakeSession()
    session.is_recording = True
    archived_counts: list[int] = []

    runtime = pipeline._new_interviewer_runtime()
    pipeline._set_interviewer_runtime(runtime)
    runtime.segment_queue.put(
        pipeline.InterviewerSegment(
            audio=np.ones(1600, dtype=np.float32),
            sample_rate=16000,
            started_mono=1.0,
            ended_mono=1.1,
            audio_sec=0.1,
            flush_reason="stop_flush",
            capture_is_loopback=True,
        )
    )

    def _append(_cfg, sess, pub, _now, _force):
        sess.qa_pairs.append(pub)

    class _JoinThread:
        def is_alive(self):
            return False

        def join(self, timeout=None):
            return None

    monkeypatch.setattr(pipeline, "get_session", lambda: session)
    monkeypatch.setattr(pipeline, "broadcast", lambda _data: None)
    monkeypatch.setattr(pipeline.audio_capture, "stop", lambda owner=None: None)
    monkeypatch.setattr(pipeline._candidate_audio_capture, "stop", lambda owner=None: None)
    monkeypatch.setattr(pipeline, "transcribe_with_fallback", lambda *_a, **_k: "最后 flush 出来的问题")
    monkeypatch.setattr(pipeline, "_append_transcription_fragment", _append)
    monkeypatch.setattr(pipeline, "_try_flush_asr_merge_buffer", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_question_group", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_wait_for_answer_work_idle", lambda _timeout: True)
    monkeypatch.setattr(pipeline, "cancel_answer_work", lambda **_kwargs: None)
    monkeypatch.setattr(
        pipeline.review_integration,
        "on_assist_stop",
        lambda archived_session: archived_counts.append(len(archived_session.qa_pairs)),
    )

    pipeline._interview_thread = _JoinThread()
    pipeline._interviewer_asr_thread = threading.Thread(
        target=pipeline._interviewer_asr_worker,
        args=(runtime, session, type("Cfg", (), {"position": "", "language": "zh", "transcription_min_sig_chars": 1})()),
        daemon=True,
    )
    pipeline._interviewer_asr_thread.start()

    pipeline.stop_interview_loop()

    assert archived_counts == [1]


def test_interviewer_segment_respects_assist_vad_min_speech_sec(monkeypatch):
    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    cfg = type(
        "Cfg",
        (),
        {
            "position": "",
            "language": "zh",
            "stt_provider": "whisper",
            "silence_threshold": 0.01,
            "silence_duration": 0.0,
            "assist_vad_min_speech_sec": 0.1,
            "assist_vad_max_speech_sec": 5.0,
            "transcription_min_sig_chars": 1,
        },
    )()
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)

    published: list[str] = []
    chunks = [
        np.ones(1600, dtype=np.float32) * 0.1,
        np.zeros(1600, dtype=np.float32),
    ]
    idx = {"n": 0}

    def _chunk_provider():
        n = idx["n"]
        if n < len(chunks):
            idx["n"] += 1
            return chunks[n]
        pipeline._stop_event.set()
        return None

    audio._chunk_provider = _chunk_provider
    monkeypatch.setattr(pipeline, "transcribe_with_fallback", lambda *_a, **_k: "短问题")
    monkeypatch.setattr(
        pipeline,
        "_append_transcription_fragment",
        lambda _cfg, _session, pub, _now, _force: published.append(pub),
    )

    pipeline._interview_worker()

    assert published == ["短问题"]


def test_emit_interviewer_segment_drops_oldest_when_queue_full():
    runtime = pipeline._new_interviewer_runtime()
    runtime.segment_queue = queue.Queue(maxsize=1)
    old_segment = pipeline.InterviewerSegment(
        audio=np.ones(1600, dtype=np.float32),
        sample_rate=16000,
        started_mono=0.0,
        ended_mono=0.1,
        audio_sec=0.1,
        flush_reason="silence",
        capture_is_loopback=True,
    )
    new_segment = pipeline.InterviewerSegment(
        audio=np.ones(3200, dtype=np.float32),
        sample_rate=16000,
        started_mono=0.2,
        ended_mono=0.4,
        audio_sec=0.2,
        flush_reason="max_speech",
        capture_is_loopback=True,
    )
    runtime.segment_queue.put_nowait(old_segment)

    pipeline._emit_interviewer_segment(runtime, new_segment)

    kept = runtime.segment_queue.get_nowait()
    assert kept.flush_reason == "max_speech"
    assert runtime.segment_dropped == 1


def test_get_interviewer_runtime_snapshot_uses_last_snapshot_after_stop(monkeypatch):
    session = _FakeSession()
    session.is_recording = True
    runtime = pipeline._new_interviewer_runtime()
    runtime.segment_emitted = 3
    runtime.segment_dropped = 1
    runtime.max_observed_segment_queue_depth = 4
    pipeline._set_interviewer_runtime(runtime)
    pipeline._set_last_interviewer_runtime_snapshot(None)

    class _JoinThread:
        def is_alive(self):
            return False

        def join(self, timeout=None):
            return None

    monkeypatch.setattr(pipeline, "get_session", lambda: session)
    monkeypatch.setattr(pipeline, "broadcast", lambda _data: None)
    monkeypatch.setattr(pipeline.audio_capture, "stop", lambda owner=None, clear_queue=False: None)
    monkeypatch.setattr(pipeline._candidate_audio_capture, "stop", lambda owner=None, clear_queue=True: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_merge_buffer", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_question_group", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_wait_for_answer_work_idle", lambda _timeout: True)
    monkeypatch.setattr(pipeline, "cancel_answer_work", lambda **_kwargs: None)
    monkeypatch.setattr(pipeline.review_integration, "on_assist_stop", lambda _session: None)
    monkeypatch.setattr(pipeline, "get_config", lambda: type("Cfg", (), {"assist_stop_answer_wait_sec": 0})())
    monkeypatch.setattr(pipeline.audio_capture, "_dropped_chunks_count", 2, raising=False)

    pipeline._interview_thread = _JoinThread()
    pipeline._interviewer_asr_thread = _JoinThread()
    pipeline._candidate_thread = _JoinThread()
    pipeline._flush_thread = _JoinThread()

    pipeline.stop_interview_loop()

    snapshot = pipeline.get_interviewer_runtime_snapshot()
    assert snapshot is not None
    assert snapshot["live"] is False
    assert snapshot["segment_emitted"] == 3
    assert snapshot["segment_dropped"] == 1
    assert snapshot["raw_queue_drop_count"] == 2
    assert snapshot["max_observed_segment_queue_depth"] == 4


def test_refresh_interviewer_raw_drop_count_reads_capture_snapshot(monkeypatch):
    runtime = pipeline._new_interviewer_runtime()

    class _Capture:
        def capture_stats_snapshot(self):
            return {
                "dropped_chunks_count": 5,
                "loopback_discontinuity_count": 2,
                "max_queue_chunk_samples": 4096,
            }

    monkeypatch.setattr(pipeline, "audio_capture", _Capture())

    pipeline._refresh_interviewer_raw_drop_count(runtime)

    assert runtime.raw_queue_drop_count == 5
    assert runtime.loopback_discontinuity_count == 2
    assert runtime.max_raw_chunk_samples == 4096


def test_log_interviewer_chunk_gap_uses_audio_coverage_instead_of_loop_period(monkeypatch):
    runtime = pipeline._new_interviewer_runtime()
    warnings: list[tuple] = []
    monkeypatch.setattr(pipeline._ilog, "warning", lambda *args, **kwargs: warnings.append(args))

    pipeline._log_interviewer_chunk_gap(runtime, 10.0, 0.064)
    pipeline._log_interviewer_chunk_gap(runtime, 10.20, 0.064)
    assert warnings == []

    pipeline._log_interviewer_chunk_gap(runtime, 10.60, 0.064)
    assert warnings
    assert warnings[-1][0] == "INTERVIEWER_CHUNK_GAP gap_ms=%.0f"


def test_audio_capture_drain_chunks_feeds_interviewer_vad_per_chunk(monkeypatch):
    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    cfg = type(
        "Cfg",
        (),
        {
            "position": "",
            "language": "zh",
            "stt_provider": "whisper",
            "silence_threshold": 0.01,
            "silence_duration": 0.0,
            "assist_vad_min_speech_sec": 0.1,
            "assist_vad_max_speech_sec": 5.0,
            "transcription_min_sig_chars": 1,
        },
    )()
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)

    speech = np.ones(1600, dtype=np.float32) * 0.1
    silence = np.zeros(1600, dtype=np.float32)
    audio_batches = [[speech, silence]]
    published: list[str] = []

    def _drain_audio_chunks(timeout=0.1, max_chunks=None):
        if audio_batches:
            return audio_batches.pop(0)
        pipeline._stop_event.set()
        return []

    audio.drain_audio_chunks = _drain_audio_chunks
    audio.get_audio_chunk = lambda timeout=0.1: None
    monkeypatch.setattr(pipeline, "transcribe_with_fallback", lambda *_a, **_k: "逐块问题")
    monkeypatch.setattr(
        pipeline,
        "_append_transcription_fragment",
        lambda _cfg, _session, pub, _now, _force: published.append(pub),
    )

    pipeline._interview_worker()

    assert published == ["逐块问题"]


def test_interviewer_large_chunk_is_split_into_smaller_vad_feed_chunks(monkeypatch):
    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    cfg = type(
        "Cfg",
        (),
        {
            "position": "",
            "language": "zh",
            "stt_provider": "whisper",
            "silence_threshold": 0.01,
            "silence_duration": 0.0,
            "assist_vad_min_speech_sec": 0.1,
            "assist_vad_max_speech_sec": 5.0,
            "transcription_min_sig_chars": 1,
        },
    )()
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)

    speech = np.ones(1600, dtype=np.float32) * 0.1
    silence = np.zeros(1600, dtype=np.float32)
    audio_batches = [[np.concatenate([speech, silence])]]
    feed_lengths: list[int] = []

    class FakeVAD:
        def __init__(self, *args, **kwargs):
            self.last_flush_reason = "silence"
            self._calls = 0

        def feed(self, chunk):
            feed_lengths.append(len(chunk))
            self._calls += 1
            if self._calls == 10:
                return np.concatenate([speech, silence])
            return None

        def flush(self):
            return None

    def _drain_audio_chunks(timeout=0.1, max_chunks=None):
        if audio_batches:
            return audio_batches.pop(0)
        pipeline._stop_event.set()
        return []

    audio.drain_audio_chunks = _drain_audio_chunks
    audio.get_audio_chunk = lambda timeout=0.1: None
    monkeypatch.setattr(pipeline, "VADBuffer", FakeVAD)
    monkeypatch.setattr(pipeline, "transcribe_with_fallback", lambda *_a, **_k: "拆小帧问题")
    monkeypatch.setattr(
        pipeline,
        "_append_transcription_fragment",
        lambda *_args, **_kwargs: None,
    )

    pipeline._interview_worker()

    assert feed_lengths
    assert max(feed_lengths) <= pipeline._vad_feed_chunk_samples
    assert len(feed_lengths) >= 10


def test_stop_interview_loop_preserves_raw_queue_for_worker_tail_flush(monkeypatch):
    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    class _JoinThread:
        def is_alive(self):
            return False

        def join(self, timeout=None):
            return None

    pipeline._interview_thread = _JoinThread()
    pipeline._candidate_thread = _JoinThread()
    pipeline._interviewer_asr_thread = _JoinThread()
    pipeline._flush_thread = _JoinThread()
    pipeline._set_interviewer_runtime(pipeline._new_interviewer_runtime())
    monkeypatch.setattr(pipeline, "_wait_for_answer_work_idle", lambda _timeout: True)
    monkeypatch.setattr(pipeline, "cancel_answer_work", lambda **_kwargs: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_merge_buffer", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_try_flush_asr_question_group", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline.review_integration, "on_assist_stop", lambda _session: None)
    monkeypatch.setattr(pipeline, "get_config", lambda: type("Cfg", (), {"assist_stop_answer_wait_sec": 0})())

    pipeline.stop_interview_loop()

    assert audio.stop_calls[0] == "assist"
    assert audio.stop_kwargs[0] == {"clear_queue": False}


def test_worker_drains_remaining_raw_audio_after_stop_before_tail_flush(monkeypatch):
    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    cfg = type(
        "Cfg",
        (),
        {
            "position": "",
            "language": "zh",
            "stt_provider": "whisper",
            "silence_threshold": 0.01,
            "silence_duration": 0.0,
            "assist_vad_min_speech_sec": 0.1,
            "assist_vad_max_speech_sec": 5.0,
            "transcription_min_sig_chars": 1,
        },
    )()
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)

    speech = np.ones(1600, dtype=np.float32) * 0.1
    silence = np.zeros(1600, dtype=np.float32)
    drained_after_stop = {"done": False}
    published: list[str] = []

    def _drain_audio_chunks(timeout=0.1, max_chunks=None):
        if not pipeline._stop_event.is_set():
            pipeline._stop_event.set()
            return []
        if not drained_after_stop["done"]:
            drained_after_stop["done"] = True
            return [speech, silence]
        return []

    audio.drain_audio_chunks = _drain_audio_chunks
    monkeypatch.setattr(pipeline, "transcribe_with_fallback", lambda *_a, **_k: "停止前最后一句")
    monkeypatch.setattr(
        pipeline,
        "_append_transcription_fragment",
        lambda _cfg, _session, pub, _now, _force: published.append(pub),
    )

    pipeline._interview_worker()

    assert drained_after_stop["done"] is True
    assert published == ["停止前最后一句"]


def _wire_candidate_fakes(monkeypatch, audio_capture, session):
    """打桩 _candidate_worker 的外部依赖 (whisper provider, 远程关, streaming 关)."""
    monkeypatch.setattr(pipeline, "_candidate_audio_capture", audio_capture)
    pipeline._stop_event.clear()
    pipeline._pause_event.clear()
    pipeline._candidate_flush_event.clear()
    monkeypatch.setattr(pipeline, "get_session", lambda: session)
    monkeypatch.setattr(pipeline, "broadcast", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "_preload_candidate_whisper_async", lambda *a, **kw: None)
    monkeypatch.setattr(pipeline, "stop_interview_loop", lambda: None)


def test_candidate_worker_does_not_crash_on_flushed_segment_in_drain_batch(monkeypatch):
    """回归: 候选人 worker 原写法 `vad.feed(vad_chunk) or speech_audio`, 当 feed
    返回多元素 ndarray (一次真正的 flush) 时, `or` 对 ndarray 布尔求值抛 ValueError,
    worker 线程在 except 里被打死 → 该 flush 段永久丢失 + 本场后续候选人音频全漏。
    验证修复后 flush 段能正常 finalize 并发布, 线程不崩。
    """

    class _CandidateAudio:
        SAMPLE_RATE = 16000

        def drain_audio_chunks(self, timeout=0.1, max_chunks=None):
            # 第一轮返回 2s 语音 + 1.3s 静音 (跨过默认 silence_duration=1.2s),
            # 强制 VAD 在本 batch 内 flush 出一段; 之后停录退出。
            speech = np.ones(16000 * 2, dtype=np.float32) * 0.1
            silence = np.zeros(int(16000 * 1.3), dtype=np.float32)
            pipeline._stop_event.set()
            return [np.concatenate([speech, silence])]

        def stop(self, owner=None, **kwargs):
            pass

    session = _FakeSession()
    session.is_recording = True
    _wire_candidate_fakes(monkeypatch, _CandidateAudio(), session)

    cfg = type(
        "Cfg",
        (),
        {
            "candidate_asr_enabled": True,
            "candidate_stt_provider": "whisper",
            "candidate_remote_stt_enabled": False,
            "candidate_whisper_model": "base",
            "candidate_whisper_language": "zh",
            "candidate_streaming_asr_enabled": False,
            "candidate_streaming_asr_interval_ms": 1500,
            "silence_threshold": 0.01,
            "silence_duration": 1.2,
            "position": "",
            "language": "zh",
            "transcription_min_sig_chars": 1,
        },
    )()
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)

    published: list[str] = []

    monkeypatch.setattr(
        pipeline,
        "transcribe_with_fallback",
        lambda *_a, **_k: "候选人完整回答",
    )
    monkeypatch.setattr(
        pipeline,
        "_publish_candidate_transcription",
        lambda _session, text, *_a, **_kw: published.append(text),
    )

    # worker 是 while not _stop_event; 上面 drain 在第一轮就 set 了 stop 且 batch 内
    # 含一次 flush。修复前 `or` 在 flush 段上抛 ValueError, worker 崩溃, publish 为空。
    worker = threading.Thread(target=pipeline._candidate_worker, daemon=True)
    worker.start()
    worker.join(timeout=2.0)

    assert not worker.is_alive(), "候选人 worker 不应被 flush 段阻塞或崩溃"
    assert published == ["候选人完整回答"], (
        "flush 出的段必须被 finalize 并发布, 而非被 `or` 崩溃吞掉"
    )


# ---------- Fix: soundcard 设备断开检测 -----------------------------------


def test_interview_worker_detects_capture_stopped_and_exits(monkeypatch):
    """回归: soundcard _reader 线程异常退出后 audio_capture.is_running=False,
    但主循环只检查 _stop_event, 导致 pipeline 静默空转——设备断开后用户以为
    还在录音, 实际不再采集任何声音 (漏听)。
    修复后主循环检查 is_running, 断开时广播错误并退出。
    """
    audio = _RecordingAudioCapture()
    session = _FakeSession()
    _wire_common_fakes(monkeypatch, audio, session)

    broadcast_log: list[dict] = []
    monkeypatch.setattr(pipeline, "broadcast", lambda data: broadcast_log.append(data))

    # 模拟: 第一轮正常 (无音频), 第二轮标记设备断开
    iter_count = {"n": 0}

    def _chunk_provider():
        iter_count["n"] += 1
        if iter_count["n"] > 1:
            audio._is_running = False
        return None

    audio._chunk_provider = _chunk_provider

    # 用线程 + join(timeout) 防止回归时无限空转卡住测试
    worker = threading.Thread(target=pipeline._interview_worker, daemon=True)
    worker.start()
    worker.join(timeout=3.0)

    assert not worker.is_alive(), (
        "worker 应在设备断开后退出, 而非无限空转 (漏听回归)"
    )
    # 验证广播了错误消息
    error_msgs = [b for b in broadcast_log if b.get("type") == "error"]
    assert any("音频采集异常中断" in b.get("message", "") for b in error_msgs), (
        f"设备断开后应广播错误; 实际 broadcast_log={broadcast_log}"
    )
    # audio.stop 在 finally 里仍应被调用
    assert "assist" in audio.stop_calls
