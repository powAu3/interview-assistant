"""Knowledge base (Beta) — 本地笔记检索, 可选开启, 不影响主流程."""
from .indexer import (  # noqa: F401
    list_docs,
    reindex,
    reindex_file,
    remove_file,
    reset,
    stats,
)
from .recent_hits import RecentHits, global_recent_hits  # noqa: F401
from .retriever import retrieve  # noqa: F401
from .types import Chunk, KBHit, RawDoc, RawSection  # noqa: F401

__all__ = [
    "reindex",
    "reindex_file",
    "remove_file",
    "list_docs",
    "stats",
    "reset",
    "retrieve",
    "RecentHits",
    "global_recent_hits",
    "KBHit",
    "RawDoc",
    "Chunk",
    "RawSection",
]
