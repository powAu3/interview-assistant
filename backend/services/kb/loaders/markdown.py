"""Markdown loader：按 ATX 标题(`# / ## / ...`) 切 section，代码块原样保留。"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from ..types import RawDoc, RawSection
from ._base import register

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_CODE_FENCE_RE = re.compile(r"^\s*```")


class MarkdownLoader:
    name = "markdown"
    extensions = (".md", ".markdown")

    def load(self, file_path: Path, *, rel_path: str) -> RawDoc:
        text = file_path.read_text(encoding="utf-8", errors="replace")
        return _parse_markdown(text, rel_path=rel_path)


def _parse_markdown(text: str, *, rel_path: str) -> RawDoc:
    lines = text.splitlines()
    title: Optional[str] = None
    heading_stack: list[tuple[int, str]] = []
    sections: list[RawSection] = []
    buf: list[str] = []
    in_code = False
    current_sp = ""

    def flush() -> None:
        nonlocal buf
        if buf:
            txt = "\n".join(buf).strip()
            if txt:
                sections.append(RawSection(section_path=current_sp, text=txt))
            buf = []

    for ln in lines:
        if _CODE_FENCE_RE.match(ln):
            in_code = not in_code
            buf.append(ln)
            continue
        if in_code:
            buf.append(ln)
            continue
        m = _HEADING_RE.match(ln)
        if m:
            level = len(m.group(1))
            hd = m.group(2).strip()
            if title is None and level == 1:
                title = hd
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, hd))
            flush()
            current_sp = _format_section_path(title, heading_stack)
            continue
        buf.append(ln)
    flush()
    return RawDoc(
        path=rel_path,
        title=title,
        loader="markdown",
        sections=sections,
    )


def _format_section_path(title: Optional[str], stack: list[tuple[int, str]]) -> str:
    parts: list[str] = []
    if title:
        parts.append(title)
    for _, h in stack:
        if h and (not parts or parts[-1] != h):
            parts.append(h)
    return " > ".join(parts)


register(MarkdownLoader())

__all__ = ["MarkdownLoader"]
