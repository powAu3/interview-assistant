"""KB prompt 注入测试: build_system_prompt 接受 kb_hits 后输出 <kb_context>。"""
from __future__ import annotations

from services.kb.types import KBHit
from services.llm import build_system_prompt


def test_prompt_includes_kb_reference_section_when_hits_provided():
    hits = [
        KBHit(
            path="redis/persistence.md",
            section_path="Redis > RDB",
            text="RDB 是快照",
            score=1.0,
        ),
        KBHit(
            path="go/gmp.md",
            section_path="Go > GMP",
            text="GMP 调度器",
            score=0.9,
        ),
    ]
    prompt = build_system_prompt(mode="manual_text", kb_hits=hits)
    assert "<kb_context>" in prompt
    assert "</kb_context>" in prompt
    assert "Redis > RDB" in prompt
    assert "Go > GMP" in prompt
    assert "[1]" in prompt and "[2]" in prompt


def test_prompt_has_no_kb_section_when_no_hits():
    prompt = build_system_prompt(mode="manual_text", kb_hits=[])
    assert "<kb_context>" not in prompt


def test_prompt_has_no_kb_section_when_kb_hits_omitted():
    """老调用方不传 kb_hits 时, 行为不变 (不引入 kb_context)。"""
    prompt = build_system_prompt(mode="manual_text")
    assert "<kb_context>" not in prompt


def test_kb_section_marks_origin_for_vision_and_ocr():
    hits = [
        KBHit(
            path="a.pdf",
            section_path="A > Page 3",
            text="scanned 段落",
            score=1.0,
            page=3,
            origin="ocr",
        ),
        KBHit(
            path="b.pdf",
            section_path="B > Page 5",
            text="流程图描述",
            score=0.9,
            page=5,
            origin="vision",
        ),
    ]
    prompt = build_system_prompt(mode="manual_text", kb_hits=hits)
    assert "OCR" in prompt
    assert "Vision" in prompt
    assert "第 3 页" in prompt
    assert "第 5 页" in prompt


def test_kb_excerpt_truncates_long_text(monkeypatch):
    long_text = "Redis 持久化方式 " * 200
    hits = [KBHit(path="x.md", section_path="X", text=long_text, score=1.0)]

    from core.config import get_config

    cfg = get_config()
    cfg.kb_prompt_excerpt_chars = 80

    prompt = build_system_prompt(mode="manual_text", kb_hits=hits)
    kb_lines = [
        ln for ln in prompt.splitlines()
        if ln.startswith("    ") and "Redis" in ln
    ]
    assert kb_lines, "应至少有一行摘录"
    assert any(len(ln) <= 200 for ln in kb_lines)
    assert any(ln.strip().endswith("…") for ln in kb_lines)


def test_kb_section_appears_in_all_modes():
    hits = [KBHit(path="x.md", section_path="X", text="some", score=1.0)]
    for mode in ("asr_realtime", "manual_text", "server_screen_code", "written_exam"):
        prompt = build_system_prompt(mode=mode, kb_hits=hits)
        assert "<kb_context>" in prompt, f"mode={mode} 应注入 KB"
