from __future__ import annotations

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.session import Session


def test_add_user_message_strips_images_before_history_storage():
    session = Session()

    session.add_user_message(
        [
            {"type": "text", "text": "截图题面"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,a"}},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,b"}},
        ]
    )

    assert session.conversation_history == [
        {"role": "user", "content": "截图题面 [图片已省略 x2]"}
    ]


def test_get_conversation_messages_for_llm_strips_legacy_images():
    session = Session()
    session.conversation_history.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "旧截图题"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,legacy"}},
            ],
        }
    )
    session.add_assistant_message("旧答案")

    messages = session.get_conversation_messages_for_llm()

    assert messages[0] == {"role": "user", "content": "旧截图题 [图片已省略 x1]"}
    assert "image_url" not in str(messages)
    assert session.last_llm_history_stats["stripped_images"] == 1


def test_get_conversation_messages_for_llm_supports_lightweight_profile():
    session = Session()
    for idx in range(4):
        session.add_user_message(f"问题{idx}" + "a" * 900)
        session.add_assistant_message(f"答案{idx}" + "b" * 900)
    session.system_summary = "summary" * 100

    messages = session.get_conversation_messages_for_llm(
        turns=1,
        max_chars_per_message=200,
        include_summary=False,
        total_char_budget=350,
        profile="asr_light",
    )

    assert len(messages) <= 2
    assert all(len(msg["content"]) <= 201 for msg in messages)
    assert "summary" not in str(messages)
    assert session.last_llm_history_stats["profile"] == "asr_light"
    assert session.last_llm_history_stats["history_messages"] == 2
    assert session.last_llm_history_stats["trimmed_text_chars"] <= 350


def test_get_conversation_messages_for_llm_zero_turns_returns_no_history():
    session = Session()
    session.add_user_message("上一题")
    session.add_assistant_message("上一题答案")

    messages = session.get_conversation_messages_for_llm(
        turns=0,
        include_summary=False,
        total_char_budget=0,
        profile="none",
    )

    assert messages == []
    assert session.last_llm_history_stats["history_messages"] == 0
