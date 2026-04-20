"""
简历上传历史：最多保留 10 条，文件落盘；解析失败也保留原文件。
列表按 last_used_at 升序：越早使用的在越上，最近上传/选用的在越下（与能力分析历史「新在上」相反，符合「使用顺序到最下」）。
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
import uuid
from typing import Any, Optional

from core.config import get_config, update_config
from services.resume import parse_resume_bytes, summarize_resume
from services.storage.paths import data_dir, sqlite_path

MAX_ENTRIES = 10
# 单次上传字节数上限。Router 层 (api.common.router) 也以此为流式校验阈值,
# 双方共用同一常量, 避免阈值漂移。
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
DB_PATH = sqlite_path("resume_history.db")
_db_lock = threading.Lock()


def _uploads_dir() -> str:
    d = os.path.join(data_dir(), "resume_uploads")
    os.makedirs(d, exist_ok=True)
    return d


def _ensure_resume_summary_column(conn: sqlite3.Connection) -> None:
    """旧库可能缺列，避免 SELECT/UPDATE 报错或 INSERT 与表结构不一致。"""
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(resume_entries)").fetchall()]
        if not cols or "resume_summary" in cols:
            return
        conn.execute("ALTER TABLE resume_entries ADD COLUMN resume_summary TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass


def _row_get(row: sqlite3.Row, key: str, default: Any = None) -> Any:
    try:
        v = row[key]
        return default if v is None else v
    except (KeyError, IndexError, TypeError):
        return default


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    _ensure_resume_summary_column(conn)
    return conn


def init_db() -> None:
    with _db_lock:
        conn = _conn()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS resume_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_filename TEXT NOT NULL,
                stored_basename TEXT NOT NULL UNIQUE,
                file_size INTEGER NOT NULL,
                created_at REAL NOT NULL,
                last_used_at REAL NOT NULL,
                parsed_ok INTEGER NOT NULL DEFAULT 0,
                preview TEXT,
                parse_error TEXT
            )
            """
        )
        _migrate_add_resume_summary(conn)
        conn.commit()
        conn.close()


def _migrate_add_resume_summary(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("ALTER TABLE resume_entries ADD COLUMN resume_summary TEXT")
    except sqlite3.OperationalError:
        pass


init_db()


def _safe_ext(filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in (".pdf", ".docx", ".doc", ".txt", ".md"):
        ext = ".bin"
    return ext[:12]


def _delete_row_and_file(conn: sqlite3.Connection, entry_id: int) -> None:
    row = conn.execute(
        "SELECT stored_basename FROM resume_entries WHERE id = ?", (entry_id,)
    ).fetchone()
    if not row:
        return
    basename = row["stored_basename"]
    conn.execute("DELETE FROM resume_entries WHERE id = ?", (entry_id,))
    path = os.path.join(_uploads_dir(), basename)
    if os.path.isfile(path):
        try:
            os.unlink(path)
        except OSError:
            pass


def _clear_config_if_active(entry_id: int) -> None:
    cfg = get_config()
    if cfg.resume_active_history_id == entry_id:
        update_config({"resume_text": None, "resume_active_history_id": None})


def _evict_excess(conn: sqlite3.Connection) -> None:
    total = conn.execute("SELECT COUNT(*) AS c FROM resume_entries").fetchone()["c"]
    excess = int(total) - MAX_ENTRIES
    if excess <= 0:
        return
    rows = conn.execute(
        """
        SELECT id FROM resume_entries
        ORDER BY last_used_at ASC, id ASC
        LIMIT ?
        """,
        (excess,),
    ).fetchall()
    for row in rows:
        eid = int(row["id"])
        _clear_config_if_active(eid)
        _delete_row_and_file(conn, eid)


def _row_to_item(row: sqlite3.Row, active_id: Optional[int]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "original_filename": row["original_filename"],
        "file_size": row["file_size"],
        "created_at": row["created_at"],
        "last_used_at": row["last_used_at"],
        "parsed_ok": bool(row["parsed_ok"]),
        "preview": row["preview"] or "",
        "parse_error": row["parse_error"] or None,
        "is_active": active_id is not None and int(row["id"]) == int(active_id),
    }


def list_entries() -> list[dict[str, Any]]:
    """按 last_used_at 升序：旧在上、新在下。"""
    cfg = get_config()
    active_id = cfg.resume_active_history_id
    with _db_lock:
        conn = _conn()
        rows = conn.execute(
            "SELECT * FROM resume_entries ORDER BY last_used_at ASC, id ASC"
        ).fetchall()
        conn.close()
    return [_row_to_item(r, active_id) for r in rows]


def get_filename_for_id(entry_id: int) -> Optional[str]:
    with _db_lock:
        conn = _conn()
        row = conn.execute(
            "SELECT original_filename FROM resume_entries WHERE id = ?", (entry_id,)
        ).fetchone()
        conn.close()
    return row["original_filename"] if row else None


def add_upload(content: bytes, original_filename: str) -> dict[str, Any]:
    """
    先落盘并写入历史，再尝试解析。
    解析失败仍保留记录；仅解析成功时写入 resume_text 并设为当前选用。
    """
    if not original_filename:
        raise ValueError("未选择文件")
    # Defense-in-depth: router 层会先做流式 413, 但本函数也可能被脚本/测试直接调用,
    # 因此保留同一阈值校验, 防止单元测试或非 HTTP 调用绕过限制。
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("文件大小不能超过 10MB")

    now = time.time()
    ext = _safe_ext(original_filename)
    stored_basename = f"{uuid.uuid4().hex}{ext}"
    disk_path = os.path.join(_uploads_dir(), stored_basename)

    with open(disk_path, "wb") as f:
        f.write(content)

    preview_text: Optional[str] = None
    parse_error: Optional[str] = None
    parsed_ok = False
    summary: Optional[str] = None

    try:
        text = parse_resume_bytes(content, original_filename)
        summary = summarize_resume(text)
        parsed_ok = True
        preview_text = (summary or "")[:500]
    except Exception as e:
        parse_error = str(e)[:500]

    history_id: int
    with _db_lock:
        conn = _conn()
        try:
            conn.execute(
                """
                INSERT INTO resume_entries (
                    original_filename, stored_basename, file_size,
                    created_at, last_used_at, parsed_ok, preview, parse_error, resume_summary
                ) VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (
                    original_filename[:512],
                    stored_basename,
                    len(content),
                    now,
                    now,
                    1 if parsed_ok else 0,
                    preview_text or "",
                    parse_error,
                    summary if summary else "",
                ),
            )
            conn.commit()
            history_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
            _evict_excess(conn)
            conn.commit()
        except Exception:
            conn.rollback()
            conn.close()
            try:
                if os.path.isfile(disk_path):
                    os.unlink(disk_path)
            except OSError:
                pass
            raise
        conn.close()

    result = {
        "ok": True,
        "history_id": history_id,
        "parsed": parsed_ok,
        "length": len(summary) if summary else None,
        "preview": (summary[:200] if summary else None),
        "parse_error": parse_error,
    }

    if parsed_ok and summary is not None:
        update_config(
            {"resume_text": summary, "resume_active_history_id": history_id}
        )

    return result


def _read_entry_bytes(entry_id: int) -> tuple[bytes, str, str]:
    with _db_lock:
        conn = _conn()
        row = conn.execute(
            "SELECT stored_basename, original_filename FROM resume_entries WHERE id = ?",
            (entry_id,),
        ).fetchone()
        conn.close()
    if not row:
        raise FileNotFoundError("记录不存在")
    basename = row["stored_basename"]
    orig = row["original_filename"]
    path = os.path.join(_uploads_dir(), basename)
    if not os.path.isfile(path):
        raise FileNotFoundError("文件已丢失")
    with open(path, "rb") as f:
        return f.read(), orig, basename


def apply_entry(entry_id: int) -> dict[str, Any]:
    """从历史选用：若库中已有完整 resume_summary 则直接选用（秒开）；否则从文件解析后写入。"""
    now = time.time()
    with _db_lock:
        conn = _conn()
        row = conn.execute("SELECT * FROM resume_entries WHERE id = ?", (entry_id,)).fetchone()
        conn.close()
    if not row:
        raise FileNotFoundError("记录不存在")

    cached = (_row_get(row, "resume_summary", "") or "").strip()
    if cached:
        with _db_lock:
            conn = _conn()
            conn.execute(
                "UPDATE resume_entries SET last_used_at = ? WHERE id = ?",
                (now, entry_id),
            )
            conn.commit()
            conn.close()
        update_config({"resume_text": cached, "resume_active_history_id": entry_id})
        return {
            "ok": True,
            "history_id": entry_id,
            "length": len(cached),
            "preview": cached[:200],
            "from_cache": True,
        }

    content, original_filename, _ = _read_entry_bytes(entry_id)
    try:
        text = parse_resume_bytes(content, original_filename)
        summary = summarize_resume(text)
    except Exception as e:
        raise ValueError(str(e)) from e

    preview_text = (summary or "")[:500]
    with _db_lock:
        conn = _conn()
        conn.execute(
            """
            UPDATE resume_entries
            SET last_used_at = ?, parsed_ok = 1, preview = ?, parse_error = NULL,
                resume_summary = ?
            WHERE id = ?
            """,
            (now, preview_text, summary, entry_id),
        )
        conn.commit()
        conn.close()

    update_config({"resume_text": summary, "resume_active_history_id": entry_id})

    return {
        "ok": True,
        "history_id": entry_id,
        "length": len(summary),
        "preview": summary[:200],
        "from_cache": False,
    }


def delete_entry(entry_id: int) -> None:
    with _db_lock:
        conn = _conn()
        _clear_config_if_active(entry_id)
        _delete_row_and_file(conn, entry_id)
        conn.commit()
        conn.close()


def get_entry_detail(entry_id: int) -> dict[str, Any]:
    """返回单条历史摘要用于预览/编辑。不在此接口同步全量重解析 PDF（大文件会拖垮请求）。"""
    cfg = get_config()
    active_id = cfg.resume_active_history_id
    with _db_lock:
        conn = _conn()
        row = conn.execute("SELECT * FROM resume_entries WHERE id = ?", (entry_id,)).fetchone()
        conn.close()
    if not row:
        raise FileNotFoundError("记录不存在")
    rs = (_row_get(row, "resume_summary", "") or "").strip()
    preview = (_row_get(row, "preview", "") or "").strip()
    # 优先完整摘要；否则仅展示入库时的 preview（通常约 500 字）；选用一次后会写入 resume_summary
    summary_text = rs if rs else preview
    base = _row_to_item(row, active_id)
    base["summary"] = summary_text
    base["summary_is_full"] = bool(rs)
    return base


def update_entry_summary(entry_id: int, summary: str) -> dict[str, Any]:
    summary = (summary or "").strip()
    if len(summary) > 400_000:
        raise ValueError("简历摘要过长（上限约 40 万字符）")
    preview_text = summary[:500]
    with _db_lock:
        conn = _conn()
        row = conn.execute("SELECT id FROM resume_entries WHERE id = ?", (entry_id,)).fetchone()
        if not row:
            conn.close()
            raise FileNotFoundError("记录不存在")
        conn.execute(
            """
            UPDATE resume_entries
            SET resume_summary = ?, preview = ?, parsed_ok = 1, parse_error = NULL
            WHERE id = ?
            """,
            (summary, preview_text, entry_id),
        )
        conn.commit()
        conn.close()
    cfg = get_config()
    if cfg.resume_active_history_id == entry_id:
        update_config({"resume_text": summary})
    return {"ok": True, "length": len(summary)}
