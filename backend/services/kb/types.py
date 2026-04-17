"""KB 数据契约：loader/chunker/retriever 之间传递的 dataclass。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

Origin = Literal["text", "ocr", "vision", "mixed"]


@dataclass
class Attachment:
    kind: Literal["pdf_page_image", "embedded_image"]
    mime: str
    path: str


@dataclass
class RawSection:
    """loader 产出的中间表示 —— 一段原始文本 + 结构信息，未切片。"""

    section_path: str
    text: str
    page: Optional[int] = None
    origin: Origin = "text"
    attachments: list[Attachment] = field(default_factory=list)


@dataclass
class RawDoc:
    """loader 产出的文件级对象。"""

    path: str
    title: Optional[str]
    loader: str
    sections: list[RawSection] = field(default_factory=list)


@dataclass
class Chunk:
    """chunker 产出的最终索引单元。"""

    section_path: str
    text: str
    ord: int
    page: Optional[int] = None
    origin: Origin = "text"
    attachments: list[Attachment] = field(default_factory=list)


@dataclass
class KBHit:
    """retriever 返回给调用方的命中记录。"""

    path: str
    section_path: str
    text: str
    score: float
    page: Optional[int] = None
    origin: Origin = "text"

    def excerpt(self, max_chars: int) -> str:
        if len(self.text) <= max_chars:
            return self.text
        return self.text[:max_chars].rstrip() + "…"
