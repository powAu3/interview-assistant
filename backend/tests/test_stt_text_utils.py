from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.stt.text_utils import (
    _postprocess,
    build_asr_question_group_text,
    classify_asr_question_candidate,
    join_transcription_fragments,
    transcription_for_publish,
)


def test_postprocess_merges_slow_speech_intraword_period_for_chinese_phrase():
    assert _postprocess("请介绍。一下你最近做过的项目。") == "请介绍一下你最近做过的项目。"


def test_postprocess_removes_mid_sentence_period_before_short_followup_without_rewriting_content():
    assert _postprocess("请介绍。1下你最近做过的项目。") == "请介绍1下你最近做过的项目。"


def test_postprocess_removes_mid_sentence_period_before_short_cjk_followup():
    assert _postprocess("我最近在做。一个支付项目。") == "我最近在做一个支付项目。"


def test_postprocess_repairs_common_asr_number_followup_noise():
    assert _postprocess("你能说1。下为什么？") == "你能说一下为什么？"


def test_transcription_for_publish_filters_interview_boilerplate():
    assert transcription_for_publish("欢迎参与AI面试，如果音量过大或过小请调整你的设备音量", 2) is None
    assert transcription_for_publish("请介绍一下 Redis 持久化", 2) == "请介绍一下 Redis 持久化"


def test_join_transcription_fragments_dedupes_overlap_boundary():
    joined = join_transcription_fragments([
        "如果线上性能突然下降，你会先看",
        "你会先看什么指标",
    ])

    assert joined == "如果线上性能突然下降，你会先看什么指标"


def test_classify_asr_question_candidate_ignores_interview_ending_boilerplate():
    kind, cleaned = classify_asr_question_candidate("时间差不多了咱们今天的面试就先。", 2)
    assert kind == "ignore"
    assert cleaned == "时间差不多了咱们今天的面试就先"


def test_classify_asr_question_candidate_keeps_problem_statement():
    kind, cleaned = classify_asr_question_candidate("题目就是找出不重复的最长子串。", 2)
    assert kind == "candidate"
    assert "最长子串" in cleaned


def test_classify_asr_question_candidate_keeps_concept_comparison():
    kind, cleaned = classify_asr_question_candidate("rules 跟 skills 有什么区别呢？", 2)
    assert kind == "promote"
    assert "skills" in cleaned


def test_project_negation_tail_is_candidate_and_kept_in_question_group():
    kind, cleaned = classify_asr_question_candidate("不要结合项目", 2)
    assert kind == "candidate"
    assert cleaned == "不要结合项目"

    grouped = build_asr_question_group_text([
        "rules 和 skills 的区别是什么",
        "不要结合项目",
    ])
    assert "rules 和 skills 的区别是什么" in grouped
    assert "不要结合项目" in grouped


def test_postprocess_repairs_whisper_boundary_terms_from_tts_replay():
    assert _postprocess("Rose和Skills的区别是什么?") == "rules和Skills的区别是什么?"
    assert _postprocess("Rose和SQL的区别是什么?") == "rules和Skills的区别是什么?"
    assert _postprocess("如 Redis和SQL的区别也是什么?") == "rules和Skills的区别是什么?"
    assert _postprocess("如 Redis和SQL的区别试试什么?") == "rules和Skills的区别是什么?"
    assert _postprocess("如 Redis、ZSET的区别是什么?") == "rules和Skills的区别是什么?"
    assert _postprocess("不要结合效果母。") == "不要结合项目。"
    assert _postprocess("SQL所以失效你会怎么排查。") == "SQL 索引失效你会怎么排查。"
    assert _postprocess("那准备的验重。") == "那怎么验证。"


# ---------------------------------------------------------------------------
# whisper 幻觉「连续循环」检测（误杀防护）
# ---------------------------------------------------------------------------

def test_has_repeated_ngram_catches_consecutive_loops():
    from services.stt.engines import _has_repeated_ngram

    assert _has_repeated_ngram("a new version of a new version of a new version of the file")
    assert _has_repeated_ngram("就是就是就是就是这样")
    assert _has_repeated_ngram("In this video I'll show you how to make it work work work work done")


def test_has_repeated_ngram_keeps_scattered_repeats():
    from services.stt.engines import _has_repeated_ngram

    # 正常口语：同一介词短语散布出现 3 次不应整段丢弃
    assert not _has_repeated_ngram(
        "the capacity of the cache, the eviction of the keys, the lifetime of the entries"
    )
    # 中文短语气词重复但非连续循环
    assert not _has_repeated_ngram("就是想问一下缓存这块，然后就是并发场景下怎么保证一致性")


def test_funasr_load_auto_threads_no_name_error(monkeypatch):
    """FunASR 加载走 stt_infer_threads=0 自动路径时不应 NameError（os 未导入曾导致崩溃）。"""
    import sys
    from types import SimpleNamespace
    import unittest.mock as mock

    import services.stt.engines as eng

    fake_mod = SimpleNamespace(AutoModel=lambda **kwargs: (captured.update(kwargs), object())[1])
    captured = {}
    monkeypatch.setitem(sys.modules, "funasr", fake_mod)
    torch_mock = mock.MagicMock()
    torch_mock.cuda.is_available.return_value = False
    monkeypatch.setitem(sys.modules, "torch", torch_mock)

    engine = eng.FunASRSTT(model_name="paraformer-zh")
    engine.load_model()  # stt_infer_threads 默认 0 → 走自动路径

    assert torch_mock.set_num_threads.called
    threads = torch_mock.set_num_threads.call_args.args[0]
    assert 1 <= threads <= 8
