"""Plain text loader：按空行切段。"""
from __future__ import annotations

import re
from pathlib import Path

from ..types import RawDoc, RawSection
from ._base import register

_BLANK_LINES_RE = re.compile(r"\n\s*\n+")


class TxtLoader:
    name = "txt"
    extensions = (".txt", ".log")

    def load(self, file_path: Path, *, rel_path: str) -> RawDoc:
        text = file_path.read_text(encoding="utf-8", errors="replace").strip()
        title = Path(rel_path).stem
        sections: list[RawSection] = []
        if text:
            parts = _BLANK_LINES_RE.split(text)
            for i, p in enumerate(parts):
                p = p.strip()
                if not p:
                    continue
                sections.append(RawSection(section_path=f"{title} > §{i + 1}", text=p))
        return RawDoc(path=rel_path, title=title, loader="txt", sections=sections)


register(TxtLoader())

__all__ = ["TxtLoader"]
