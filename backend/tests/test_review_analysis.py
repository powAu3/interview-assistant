"""
测试 review 分析功能（不需要真实 API key）
"""
import pytest
from unittest.mock import patch, MagicMock
from services import review_analysis
from core.config import ModelConfig


def test_analyze_turn_no_active_model():
    """测试没有有效模型配置时返回空结果"""
    with patch('services.review_analysis.get_active_llm_client') as mock_client:
        mock_client.side_effect = ValueError("No API key")

        result = review_analysis.analyze_turn(
            question="什么是 Python GIL？",
            candidate_answer="GIL 是全局解释器锁",
            reference_answer="参考答案",
        )

        assert result["strengths"] == []
        assert result["risks"] == []
        assert result["scorecard"] == {}
        assert result["evidence"] == {}


def test_generate_summary_no_active_model():
    """测试没有有效模型配置时返回提示信息"""
    with patch('services.review_analysis.get_active_llm_client') as mock_client:
        mock_client.side_effect = ValueError("No API key")

        result = review_analysis.generate_summary(
            turns=[{"question_text": "Q1", "candidate_answer_text": "A1"}],
        )

        assert "未配置" in result["summary_markdown"]
        assert result["strong_points"] == []
        assert result["weak_points"] == []


def test_generate_summary_empty_turns():
    """测试空 turns 时返回提示"""
    result = review_analysis.generate_summary(turns=[])

    assert "未录制" in result["summary_markdown"]
    assert result["strong_points"] == []
    assert result["weak_points"] == []


def test_get_active_llm_client():
    """测试获取激活模型客户端"""
    with patch('services.review_analysis.get_config') as mock_get_config:
        mock_config = MagicMock()
        mock_model = ModelConfig(
            name="Test Model",
            api_base_url="https://api.example.com/v1",
            api_key="test-key-123",
            model="test-model",
        )
        mock_config.get_active_model.return_value = mock_model
        mock_get_config.return_value = mock_config

        client, model_name = review_analysis.get_active_llm_client()

        assert client is not None
        assert model_name == "test-model"
        assert "api.example.com" in str(client.base_url)

