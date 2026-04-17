"""RawDoc → Chunk：按段落切片，代码块/表格视为原子单元。"""
from __future__ import annotations

import re

from .types import Chunk, RawDoc

_CODE_FENCE_RE = re.compile(r"^\s*```")


def _split_plain_text(text: str, max_chars: int) -> list[str]:
    """按段落 / 硬切，保证每段 <= max_chars。"""
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    out: list[str] = []
    paragraphs = re.split(r"\n\s*\n", text)
    buf = ""
    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        if len(buf) + len(p) + 2 <= max_chars:
            buf = f"{buf}\n\n{p}" if buf else p
            continue
        if buf:
            out.append(buf)
            buf = ""
        if len(p) <= max_chars:
            buf = p
            continue
        start = 0
        while start < len(p):
            out.append(p[start : start + max_chars])
            start += max_chars
    if buf:
        out.append(buf)
    return out


def _split_with_code_blocks(text: str, max_chars: int) -> list[str]:
    """代码块当原子单元；单块超过 max_chars*2 时截断并追加 [截断] 标记。"""
    lines = text.splitlines()
    parts: list[str] = []
    buf_lines: list[str] = []
    in_code = False
    code_buf: list[str] = []

    def flush_plain() -> None:
        nonlocal buf_lines
        if not buf_lines:
            return
        chunk_text = "\n".join(buf_lines).strip()
        if chunk_text:
            parts.extend(_split_plain_text(chunk_text, max_chars))
        buf_lines = []

    for ln in lines:
        if _CODE_FENCE_RE.match(ln):
            if in_code:
                code_buf.append(ln)
                block = "\n".join(code_buf)
                if len(block) > max_chars * 2:
                    block = block[: max_chars * 2].rstrip() + "\n[截断]\n```"
                parts.append(block)
                code_buf = []
                in_code = False
            else:
                flush_plain()
                code_buf = [ln]
                in_code = True
            continue
        if in_code:
            code_buf.append(ln)
        else:
            buf_lines.append(ln)
    if in_code and code_buf:
        block = "\n".join(code_buf)
        if len(block) > max_chars * 2:
            block = block[: max_chars * 2].rstrip() + "\n[截断]"
        parts.append(block)
    flush_plain()
    return [p for p in parts if p.strip()]


def chunk_doc(doc: RawDoc, max_chars: int = 800) -> list[Chunk]:
    """对一个 RawDoc 做切片，产出带顺序号的 Chunk 列表。"""
    out: list[Chunk] = []
    ord_counter = 0
    for sec in doc.sections:
        pieces = _split_with_code_blocks(sec.text or "", max_chars)
        for piece in pieces:
            out.append(
                Chunk(
                    section_path=sec.section_path,
                    text=piece,
                    ord=ord_counter,
                    page=sec.page,
                    origin=sec.origin,
                    attachments=list(sec.attachments),
                )
            )
            ord_counter += 1
    return out


__all__ = ["chunk_doc"]
