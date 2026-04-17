"""索引调度器：扫 kb_dir → dispatch loader → chunker → store。"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Optional

from core.config import get_config
from services.storage.paths import backend_root

from . import loaders as _loaders  # noqa: F401  触发 register 副作用
from .chunker import chunk_doc
from .store import KBStore

_log = logging.getLogger(__name__)

_store: Optional[KBStore] = None
_lock = threading.RLock()

_FAILED_DOC_EXTENSIONS = {".doc"}
_DOC_FAIL_MSG = "不支持 .doc，请在 Word 里另存为 .docx 后再上传"


def resolve_path(path_str: str) -> Path:
    """相对路径按 backend_root 解析; 绝对路径原样返回。"""
    p = Path(path_str)
    if p.is_absolute():
        return p
    return Path(backend_root()) / p


def _resolved_db_path() -> str:
    return str(resolve_path(get_config().kb_db_path))


def _get_store() -> KBStore:
    global _store
    with _lock:
        db_path = _resolved_db_path()
        if _store is None or _store.db_path != db_path:
            _store = KBStore(db_path)
            _store.init_schema()
        return _store


def reset() -> None:
    """测试辅助：丢弃单例，下次 _get_store() 会按当前 config 重建。"""
    global _store
    with _lock:
        _store = None


def list_docs(limit: Optional[int] = None) -> list[dict[str, Any]]:
    return _get_store().list_docs(limit=limit)


def stats() -> dict[str, Any]:
    return _get_store().stats()


def reindex() -> dict[str, Any]:
    cfg = get_config()
    kb_dir = resolve_path(cfg.kb_dir)
    kb_dir.mkdir(parents=True, exist_ok=True)
    store = _get_store()
    allowed = {ext.lower() for ext in cfg.kb_file_extensions}
    reindexed = 0
    on_disk: set[str] = set()

    for path in sorted(kb_dir.rglob("*")):
        if not path.is_file():
            continue
        try:
            rel = str(path.relative_to(kb_dir)).replace(os.sep, "/")
        except ValueError:
            continue
        ext = path.suffix.lower()
        on_disk.add(rel)

        if ext in _FAILED_DOC_EXTENSIONS:
            try:
                st = path.stat()
                store.upsert_doc(rel, st.st_mtime, st.st_size, "unsupported", None)
                store.set_status(rel, "failed", _DOC_FAIL_MSG)
            except Exception as e:  # pragma: no cover
                _log.warning("kb indexer 记录 .doc 失败 %s: %s", rel, e)
            continue

        if ext not in allowed:
            continue

        loader = _loaders.dispatch_loader(path)
        if loader is None:
            continue

        try:
            stat = path.stat()
        except OSError as e:
            _log.warning("kb indexer stat 失败 %s: %s", rel, e)
            continue

        existing = store.get_doc(rel)
        if (
            existing
            and existing["mtime"] == stat.st_mtime
            and existing["size"] == stat.st_size
            and existing["status"] == "ok"
        ):
            continue

        try:
            raw = loader.load(path, rel_path=rel)
            doc_id = store.upsert_doc(
                path=rel,
                mtime=stat.st_mtime,
                size=stat.st_size,
                loader=getattr(loader, "name", "unknown"),
                title=raw.title,
            )
            chunks = chunk_doc(raw, max_chars=cfg.kb_chunk_max_chars)
            store.replace_chunks(doc_id, chunks)
            reindexed += 1
        except Exception as e:
            _log.warning("kb indexer 加载 %s 失败：%s", rel, e)
            try:
                store.upsert_doc(
                    rel,
                    stat.st_mtime,
                    stat.st_size,
                    getattr(loader, "name", "unknown"),
                    None,
                )
                store.set_status(rel, "failed", str(e)[:500])
            except Exception as inner:  # pragma: no cover
                _log.warning("kb indexer 记录失败状态时再次失败 %s: %s", rel, inner)

    for row in store.list_docs():
        if row["path"] not in on_disk:
            store.delete_doc(row["path"])

    info = store.stats()
    info["reindexed_files"] = reindexed
    return info


def reindex_file(rel_path: str) -> dict[str, Any]:
    """按相对路径重建单文件索引；文件不存在时删除记录。"""
    cfg = get_config()
    path = resolve_path(cfg.kb_dir) / rel_path
    store = _get_store()
    if not path.exists():
        store.delete_doc(rel_path)
        return store.stats()
    return reindex()


def remove_file(rel_path: str) -> None:
    """删除索引 + 磁盘文件。失败不抛。"""
    store = _get_store()
    store.delete_doc(rel_path)
    full = resolve_path(get_config().kb_dir) / rel_path
    try:
        if full.exists():
            full.unlink()
    except Exception as e:  # pragma: no cover
        _log.warning("kb indexer remove_file 删除磁盘文件失败 %s: %s", rel_path, e)


__all__ = [
    "reset",
    "list_docs",
    "stats",
    "reindex",
    "reindex_file",
    "remove_file",
    "resolve_path",
]
