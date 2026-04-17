"""SQLite + FTS5 持久层：薄封装、短连接、写入持锁。"""
from __future__ import annotations

import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable, Optional

from .types import Chunk

_log = logging.getLogger(__name__)

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS kb_doc (
  id      INTEGER PRIMARY KEY,
  path    TEXT NOT NULL UNIQUE,
  mtime   REAL NOT NULL,
  size    INTEGER NOT NULL DEFAULT 0,
  loader  TEXT NOT NULL,
  title   TEXT,
  status  TEXT NOT NULL DEFAULT 'ok',
  error   TEXT
);

CREATE TABLE IF NOT EXISTS kb_chunk (
  id           INTEGER PRIMARY KEY,
  doc_id       INTEGER NOT NULL REFERENCES kb_doc(id) ON DELETE CASCADE,
  section_path TEXT,
  page         INTEGER,
  ord          INTEGER NOT NULL,
  text         TEXT NOT NULL,
  origin       TEXT NOT NULL DEFAULT 'text'
);

CREATE TABLE IF NOT EXISTS kb_attachment (
  id       INTEGER PRIMARY KEY,
  chunk_id INTEGER NOT NULL REFERENCES kb_chunk(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  mime     TEXT NOT NULL,
  path     TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
  section_path,
  text,
  content='kb_chunk',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS kb_chunk_ai AFTER INSERT ON kb_chunk BEGIN
  INSERT INTO kb_fts(rowid, section_path, text) VALUES (new.id, new.section_path, new.text);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunk_ad AFTER DELETE ON kb_chunk BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, section_path, text) VALUES ('delete', old.id, old.section_path, old.text);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunk_au AFTER UPDATE ON kb_chunk BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, section_path, text) VALUES ('delete', old.id, old.section_path, old.text);
  INSERT INTO kb_fts(rowid, section_path, text) VALUES (new.id, new.section_path, new.text);
END;
"""


class KBStore:
    """SQLite + FTS5 的薄封装。每次操作内部独立短连接，主流程不持有连接。"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    def init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(_SCHEMA_SQL)

    def list_tables(self) -> set[str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
            ).fetchall()
        return {r["name"] for r in rows}

    def upsert_doc(
        self,
        path: str,
        mtime: float,
        size: int,
        loader: str,
        title: Optional[str],
    ) -> int:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO kb_doc(path, mtime, size, loader, title, status, error)
                VALUES(?,?,?,?,?,'ok',NULL)
                ON CONFLICT(path) DO UPDATE SET
                    mtime=excluded.mtime,
                    size=excluded.size,
                    loader=excluded.loader,
                    title=excluded.title,
                    status='ok',
                    error=NULL
                """,
                (path, mtime, size, loader, title),
            )
            row = conn.execute("SELECT id FROM kb_doc WHERE path=?", (path,)).fetchone()
            return int(row["id"])

    def set_status(self, path: str, status: str, error: Optional[str]) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE kb_doc SET status=?, error=? WHERE path=?",
                (status, error, path),
            )

    def delete_doc(self, path: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM kb_doc WHERE path=?", (path,))

    def get_doc(self, path: str) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM kb_doc WHERE path=?", (path,)).fetchone()
        return dict(row) if row else None

    def list_docs(self, limit: Optional[int] = None) -> list[dict[str, Any]]:
        sql = (
            "SELECT d.*, "
            "(SELECT COUNT(*) FROM kb_chunk c WHERE c.doc_id=d.id) AS chunk_count "
            "FROM kb_doc d ORDER BY d.path"
        )
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        with self._connect() as conn:
            rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]

    def stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            doc_n = conn.execute("SELECT COUNT(*) AS n FROM kb_doc").fetchone()["n"]
            chunk_n = conn.execute("SELECT COUNT(*) AS n FROM kb_chunk").fetchone()["n"]
            last = conn.execute("SELECT MAX(mtime) AS m FROM kb_doc").fetchone()["m"]
        return {
            "total_docs": int(doc_n),
            "total_chunks": int(chunk_n),
            "last_mtime": float(last or 0),
        }

    def replace_chunks(self, doc_id: int, chunks: Iterable[Chunk]) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM kb_chunk WHERE doc_id=?", (doc_id,))
            conn.executemany(
                """
                INSERT INTO kb_chunk(doc_id, section_path, page, ord, text, origin)
                VALUES(?,?,?,?,?,?)
                """,
                [
                    (doc_id, c.section_path, c.page, c.ord, c.text, c.origin)
                    for c in chunks
                ],
            )

    def fts_search(
        self,
        query: str,
        limit: int,
        *,
        interrupt_connection: Optional[sqlite3.Connection] = None,
    ) -> list[dict[str, Any]]:
        """执行一次 FTS5 查询。传入 interrupt_connection 时由调用方自行管理连接。"""
        conn = interrupt_connection or self._connect()
        own_conn = interrupt_connection is None
        try:
            rows = conn.execute(
                """
                SELECT d.path, c.section_path, c.text, c.page, c.origin,
                       bm25(kb_fts) AS score
                FROM kb_fts
                JOIN kb_chunk c ON c.id = kb_fts.rowid
                JOIN kb_doc   d ON d.id = c.doc_id
                WHERE kb_fts MATCH ?
                ORDER BY score
                LIMIT ?
                """,
                (query, limit),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            if own_conn:
                conn.close()

    def open_connection(self) -> sqlite3.Connection:
        """retriever 自己管 interrupt 时用这个拿独立连接。"""
        return self._connect()
