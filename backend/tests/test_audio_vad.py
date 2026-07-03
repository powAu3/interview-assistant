from __future__ import annotations

from pathlib import Path
import sys

import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.audio import VADBuffer
from services.audio import AudioCapture


def test_vad_flushes_when_max_speech_duration_reached():
    vad = VADBuffer(
        sample_rate=10,
        silence_threshold=0.01,
        silence_duration=99.0,
        min_speech_duration=0.1,
        max_speech_duration=0.5,
    )

    result = vad.feed(np.ones(5, dtype=np.float32) * 0.1)

    assert result is not None
    assert len(result) == 5


def test_vad_rollover_preserves_tail_after_max_speech_flush():
    vad = VADBuffer(
        sample_rate=10,
        silence_threshold=0.01,
        silence_duration=99.0,
        min_speech_duration=0.1,
        max_speech_duration=0.5,
        rollover_duration=0.2,
    )

    first = vad.feed(np.ones(5, dtype=np.float32) * 0.1)
    assert first is not None
    assert len(first) == 5

    vad.feed(np.ones(1, dtype=np.float32) * 0.1)
    pending = vad.pending_audio()

    assert pending is not None
    assert len(pending) == 3


def test_vad_min_speech_duration_drops_short_segment():
    """短于 min_speech_duration 的片段应被丢弃; 长于则保留。

    注意: speech_duration 把尾部静音 padding 也计入 (VADBuffer 既有行为),
    所以这里用 (语音+静音) 总采样数控制阈值两侧。
    """
    # sample_rate=10; min_speech_duration=0.5 -> 阈值 5 采样 (含尾部静音)
    vad = VADBuffer(
        sample_rate=10,
        silence_threshold=0.01,
        silence_duration=0.0,  # 第二静音帧即触发判定
        min_speech_duration=0.5,
    )

    # 2 语音 + 2 静音 = 4 采样 (0.4s < 0.5) -> 丢弃
    vad.feed(np.ones(2, dtype=np.float32) * 0.1)          # 语音帧
    vad.feed(np.zeros(1, dtype=np.float32))               # 静音帧1: 起计时
    dropped = vad.feed(np.zeros(1, dtype=np.float32))     # 静音帧2: 判定 -> 丢弃
    assert dropped is None

    # 4 语音 + 2 静音 = 6 采样 (0.6s >= 0.5) -> 保留
    vad.feed(np.ones(4, dtype=np.float32) * 0.1)          # 语音帧
    vad.feed(np.zeros(1, dtype=np.float32))               # 静音帧1
    kept = vad.feed(np.zeros(1, dtype=np.float32))        # 静音帧2: 判定 -> 保留
    assert kept is not None
    assert len(kept) == 6


def test_vad_preroll_preserves_leading_audio_before_voice_threshold():
    vad = VADBuffer(
        sample_rate=10,
        silence_threshold=0.01,
        silence_duration=0.0,
        min_speech_duration=0.2,
        preroll_duration=0.2,
    )

    vad.feed(np.ones(1, dtype=np.float32) * 0.005)       # 预卷帘静音/低声
    vad.feed(np.ones(2, dtype=np.float32) * 0.1)         # 开始说话
    vad.feed(np.zeros(1, dtype=np.float32))              # 触发静音
    kept = vad.feed(np.zeros(1, dtype=np.float32))       # flush

    assert kept is not None
    assert len(kept) == 5


def test_vad_silence_duration_uses_audio_samples_not_wall_clock():
    vad = VADBuffer(
        sample_rate=10,
        silence_threshold=0.01,
        silence_duration=0.2,
        min_speech_duration=0.2,
    )

    vad.feed(np.ones(2, dtype=np.float32) * 0.1)
    assert vad.feed(np.zeros(1, dtype=np.float32)) is None
    kept = vad.feed(np.zeros(1, dtype=np.float32))

    assert kept is not None
    assert len(kept) == 4


def test_audio_capture_push_splits_large_chunk_before_queue():
    capture = AudioCapture()
    large = np.ones(capture.MAX_QUEUE_CHUNK_SAMPLES * 2 + 100, dtype=np.float32) * 0.1

    capture._push(large)

    chunks = capture.drain_audio_chunks(timeout=0.0, max_chunks=10)
    assert len(chunks) == 3
    assert max(len(chunk) for chunk in chunks) == capture.MAX_QUEUE_CHUNK_SAMPLES
    assert sum(len(chunk) for chunk in chunks) == len(large)


def test_audio_capture_stats_snapshot_reports_queue_chunk_and_discontinuity():
    capture = AudioCapture()
    capture._loopback_discontinuity_count = 3
    capture._push(np.ones(1280, dtype=np.float32) * 0.1)

    stats = capture.capture_stats_snapshot()

    assert stats["loopback_discontinuity_count"] == 3
    assert stats["max_queue_chunk_samples"] == 1280
    assert stats["last_queue_chunk_samples"] == 1280


def test_audio_capture_loopback_min_chunk_samples_is_smaller_than_max():
    capture = AudioCapture()

    assert capture.MIN_LOOPBACK_QUEUE_CHUNK_SAMPLES < capture.MAX_QUEUE_CHUNK_SAMPLES
