"""CJK bigram 预处理。

SQLite FTS5 的 unicode61 tokenizer 把连续 CJK 文字当成一个 token, 导致
"快照" 这类短语在长文里查不到。标准解法是写入/查询两端都做 bigram 化:
连续 CJK 字符切成长度 2 的滑动窗口, 用空格隔开后交给 FTS5。

  "RDB 是 Redis 快照持久化"  →  "RDB 是 Redis 快照 照持 持久"
  "快照"                    →  "快照"            (1 个 bigram)
  "快"                      →  "快"              (长度 1 单字保留)
"""
from __future__ import annotations


def _is_cjk(ch: str) -> bool:
    if not ch:
        return False
    code = ord(ch)
    return (
        0x3040 <= code <= 0x30FF      # Hiragana / Katakana
        or 0x3400 <= code <= 0x4DBF   # CJK Extension A
        or 0x4E00 <= code <= 0x9FFF   # CJK Unified Ideographs
        or 0xF900 <= code <= 0xFAFF   # CJK Compatibility Ideographs
        or 0x20000 <= code <= 0x2FFFF # CJK Extension B+
    )


def cjk_bigram_text(text: str) -> str:
    """把文本里连续的 CJK 片段拆成 2-gram 并用空格分隔; 非 CJK 字符原样保留。"""
    if not text:
        return ""
    out: list[str] = []
    cjk_run: list[str] = []

    def flush_cjk() -> None:
        if not cjk_run:
            return
        s = "".join(cjk_run)
        if len(s) == 1:
            out.append(s)
        else:
            grams = [s[i : i + 2] for i in range(len(s) - 1)]
            out.append(" ".join(grams))
        cjk_run.clear()

    for ch in text:
        if _is_cjk(ch):
            cjk_run.append(ch)
        else:
            flush_cjk()
            out.append(ch)
    flush_cjk()
    return "".join(out)


def cjk_bigram_query_tokens(text: str) -> list[str]:
    """把查询串拆成 FTS5 可用的 token 列表: 非 CJK 段按空白切; CJK 段转成 bigrams。"""
    if not text:
        return []
    tokens: list[str] = []
    buf_non: list[str] = []
    buf_cjk: list[str] = []

    def flush_non() -> None:
        if buf_non:
            piece = "".join(buf_non)
            for w in piece.split():
                if w:
                    tokens.append(w)
            buf_non.clear()

    def flush_cjk() -> None:
        if buf_cjk:
            s = "".join(buf_cjk)
            if len(s) == 1:
                tokens.append(s)
            else:
                tokens.extend(s[i : i + 2] for i in range(len(s) - 1))
            buf_cjk.clear()

    for ch in text:
        if _is_cjk(ch):
            flush_non()
            buf_cjk.append(ch)
        else:
            flush_cjk()
            buf_non.append(ch)
    flush_non()
    flush_cjk()
    return tokens


__all__ = ["cjk_bigram_text", "cjk_bigram_query_tokens"]
