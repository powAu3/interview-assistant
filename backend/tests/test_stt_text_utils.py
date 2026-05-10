from services.stt.text_utils import _postprocess


def test_postprocess_merges_slow_speech_intraword_period_for_chinese_phrase():
    assert _postprocess("请介绍。一下你最近做过的项目。") == "请介绍一下你最近做过的项目。"


def test_postprocess_removes_mid_sentence_period_before_short_followup_without_rewriting_content():
    assert _postprocess("请介绍。1下你最近做过的项目。") == "请介绍1下你最近做过的项目。"


def test_postprocess_removes_mid_sentence_period_before_short_cjk_followup():
    assert _postprocess("我最近在做。一个支付项目。") == "我最近在做一个支付项目。"
