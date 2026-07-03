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
