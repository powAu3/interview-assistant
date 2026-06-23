"""
测试 review 分析功能（不需要真实 API key）
"""
import pytest
from services import review_analysis


def test_analyze_turn_no_api_key():
    """测试没有 API key 时返回空结果"""
    result = review_analysis.analyze_turn(
        question="什么是 Python GIL？",
        candidate_answer="GIL 是全局解释器锁",
        reference_answer="参考答案",
        api_key="",
    )

    assert result["strengths"] == []
    assert result["risks"] == []
    assert result["scorecard"] == {}
    assert result["evidence"] == {}


def test_generate_summary_no_api_key():
    """测试没有 API key 时返回提示信息"""
    result = review_analysis.generate_summary(
        turns=[{"question_text": "Q1", "candidate_answer_text": "A1"}],
        api_key="",
    )

    assert "未配置" in result["summary_markdown"]
    assert result["strong_points"] == []
    assert result["weak_points"] == []


def test_generate_summary_empty_turns():
    """测试空 turns 时返回提示"""
    result = review_analysis.generate_summary(
        turns=[],
        api_key="fake-key",
    )

    assert "未录制" in result["summary_markdown"]
    assert result["strong_points"] == []
    assert result["weak_points"] == []


def test_lite_ark_client_creation():
    """测试 Lite Ark 客户端创建"""
    client = review_analysis.get_lite_ark_client("test-key")
    assert client is not None
    assert review_analysis.LITE_ARK_API_BASE in str(client.base_url)
