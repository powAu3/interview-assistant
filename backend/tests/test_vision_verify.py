from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import vision_verify  # noqa: E402


def test_verify_blocking_sends_all_images_to_vision_model(monkeypatch):
    captured: dict[str, object] = {}
    model_cfg = SimpleNamespace(model="vision-model")

    class _Completions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content='{"verdict":"PASS","reason":"多图约束均匹配"}',
                        ),
                    ),
                ],
                usage=SimpleNamespace(prompt_tokens=7, completion_tokens=3),
            )

    client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=_Completions(),
        ),
    )

    monkeypatch.setattr(vision_verify, "_pick_vision_model_cfg", lambda: model_cfg)
    monkeypatch.setattr("services.llm.get_client_for_model", lambda _cfg: client)
    monkeypatch.setattr("services.llm._add_tokens", lambda *_args: None)

    result = vision_verify._verify_blocking(
        "```python\nprint('ok')\n```",
        ["data:image/png;base64,a", "Yg=="],
    )

    assert result == {"verdict": "PASS", "reason": "多图约束均匹配"}
    assert captured["model"] == "vision-model"
    content = captured["messages"][0]["content"]
    assert content[0]["type"] == "text"
    assert "print('ok')" in content[0]["text"]
    assert [part["image_url"]["url"] for part in content[1:]] == [
        "data:image/png;base64,a",
        "data:image/png;base64,Yg==",
    ]
