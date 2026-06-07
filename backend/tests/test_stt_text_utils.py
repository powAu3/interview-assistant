from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.stt.text_utils import _postprocess, classify_asr_question_candidate, transcription_for_publish


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
