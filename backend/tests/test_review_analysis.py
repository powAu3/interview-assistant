"""
测试 review 分析功能（不需要真实 API key）
"""
import pytest
from unittest.mock import patch, MagicMock
from services import review_analysis
from core.config import ModelConfig


def _mock_review_config():
    mock_config = MagicMock()
    mock_config.get_review_model.return_value = ModelConfig(
        name="lite-ark",
        api_base_url="https://api.example.com/v1",
        api_key="test-key-123",
        model="doubao-seed-2-0-lite-260428",
    )
    return mock_config


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


def test_analyze_turn_returns_asr_correction_evidence():
    with patch('services.review_analysis.correct_asr_errors') as mock_correct, \
         patch('services.review_analysis.get_active_llm_client') as mock_client:
        mock_correct.return_value = "Redis 有字符串和哈希"
        mock_client.side_effect = ValueError("No API key")

        result = review_analysis.analyze_turn(
            question="Redis 有哪些数据结构？",
            candidate_answer="red 地址有字符串和哈希",
            reference_answer="参考答案",
        )

        assert result["corrected_answer"] == "Redis 有字符串和哈希"
        assert result["evidence"]["asr_correction"]["original"] == "red 地址有字符串和哈希"


def test_analyze_turn_preserves_structured_evidence():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content='''```json
{
  "strengths": ["术语准确"],
  "risks": ["缺少扩容方案"],
  "scorecard": {"准确性": 8, "深度": 5, "表达": 7},
  "evidence": {
    "improvement_advice": "补充扩容后的缓存击穿处理",
    "follow_up_questions": ["热点 key 失效时怎么保护数据库？"],
    "tags": ["Redis", "缓存击穿"]
  }
}
```'''))]
    )

    with patch('services.review_analysis.correct_asr_errors', return_value="Redis 回答"), \
         patch('services.review_analysis.get_config', return_value=_mock_review_config()), \
         patch('services.review_analysis.get_active_llm_client', return_value=(mock_client, "doubao-seed-2-0-lite-260428")):
        result = review_analysis.analyze_turn(
            question="Redis 缓存击穿怎么处理？",
            candidate_answer="Redis 回答",
            reference_answer="参考答案",
        )

    assert result["scorecard"]["深度"] == 5
    assert result["evidence"]["improvement_advice"] == "补充扩容后的缓存击穿处理"
    assert result["evidence"]["follow_up_questions"] == ["热点 key 失效时怎么保护数据库？"]
    assert result["evidence"]["tags"] == ["Redis", "缓存击穿"]


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


def test_run_asr_correction_check_success():
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content="我做过 Redis 缓存，MySQL 查询会先看布隆过滤器。"))]
    )

    with patch('services.review_analysis.get_config', return_value=_mock_review_config()), \
         patch('services.review_analysis.get_active_llm_client', return_value=(mock_client, "doubao-seed-2-0-lite-260428")):
        result = review_analysis.run_asr_correction_check(
            question="请介绍缓存优化",
            candidate_answer="我做过 red 地址缓存，麦 SQL 查询会先看布隆过绿器。",
        )

    assert result["ok"] is True
    assert result["model_name"] == "lite-ark"
    assert result["model"] == "doubao-seed-2-0-lite-260428"
    assert result["changed"] is True
    assert "Redis" in result["corrected"]
    kwargs = mock_client.chat.completions.create.call_args.kwargs
    assert kwargs["extra_body"] == {
        "thinking": {"type": "disabled"},
        "think_mode": False,
        "enable_thinking": False,
    }


def test_run_asr_correction_check_returns_blocked_error():
    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = PermissionError("Your request was blocked")

    with patch('services.review_analysis.get_config', return_value=_mock_review_config()), \
         patch('services.review_analysis.get_active_llm_client', return_value=(mock_client, "doubao-seed-2-0-lite-260428")):
        result = review_analysis.run_asr_correction_check(
            question="请介绍缓存优化",
            candidate_answer="我做过 red 地址缓存，麦 SQL 查询会先看布隆过绿器。",
        )

    assert result["ok"] is False
    assert result["changed"] is False
    assert result["corrected"] == result["original"]
    assert "blocked" in result["detail"]


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
        mock_config.get_review_model.return_value = mock_model
        mock_get_config.return_value = mock_config

        client, model_name = review_analysis.get_active_llm_client()

        assert client is not None
        assert model_name == "test-model"
        assert "api.example.com" in str(client.base_url)

