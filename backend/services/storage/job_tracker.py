"""本地求职进度与 Offer 数据（SQLite，独立于 knowledge.db）。"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any, Optional

from services.storage.paths import sqlite_path

DB_PATH = sqlite_path("job_tracker.db")
_db_lock = threading.Lock()

# 与前端约定一致
STAGE_VALUES = (
    "applied",
    "written",
    "interview1",
    "interview2",
    "interview3",
    "hr",
    "offer",
    "rejected",
    "withdrawn",
)


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with _db_lock:
        conn = _get_conn()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company TEXT NOT NULL DEFAULT '',
                position TEXT NOT NULL DEFAULT '',
                city TEXT NOT NULL DEFAULT '',
                stage TEXT NOT NULL DEFAULT 'applied',
                applied_at REAL,
                next_followup_at REAL,
                interviewer_info TEXT NOT NULL DEFAULT '',
                feedback TEXT NOT NULL DEFAULT '',
                todos_json TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS offers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                application_id INTEGER NOT NULL UNIQUE,
                base_salary TEXT NOT NULL DEFAULT '',
                total_pkg_note TEXT NOT NULL DEFAULT '',
                bonus TEXT NOT NULL DEFAULT '',
                equity TEXT NOT NULL DEFAULT '',
                benefits_json TEXT NOT NULL DEFAULT '[]',
                wfh TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                pros TEXT NOT NULL DEFAULT '',
                cons TEXT NOT NULL DEFAULT '',
                deadline REAL,
                created_at REAL NOT NULL,
                FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
            )
            """
        )
        conn.commit()
        conn.close()


init_db()


def _now() -> float:
    return time.time()


def _row_app(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    try:
        d["todos"] = json.loads(d.pop("todos_json") or "[]")
    except json.JSONDecodeError:
        d["todos"] = []
    return d


def _row_offer(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    try:
        d["benefits"] = json.loads(d.pop("benefits_json") or "[]")
    except json.JSONDecodeError:
        d["benefits"] = []
    return d


def list_applications(
    stage: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: str = "updated_at",
    sort_dir: str = "desc",
) -> list[dict[str, Any]]:
    allowed_sort = {
        "company": "company",
        "position": "position",
        "stage": "stage",
        "applied_at": "applied_at",
        "next_followup_at": "next_followup_at",
        "updated_at": "updated_at",
        "sort_order": "sort_order",
    }
    col = allowed_sort.get(sort_by, "updated_at")
    direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
    clauses: list[str] = []
    params: list[Any] = []

    if stage:
        clauses.append("stage = ?")
        params.append(stage)
    if q and q.strip():
        like = f"%{q.strip()}%"
        clauses.append("(company LIKE ? OR position LIKE ? OR city LIKE ? OR notes LIKE ?)")
        params.extend([like, like, like, like])

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = f"SELECT * FROM applications{where} ORDER BY {col} {direction}, id DESC"

    with _db_lock:
        conn = _get_conn()
        cur = conn.execute(sql, params)
        rows = [_row_app(r) for r in cur.fetchall()]
        conn.close()
    return rows


def get_application(app_id: int) -> Optional[dict[str, Any]]:
    with _db_lock:
        conn = _get_conn()
        cur = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,))
        r = cur.fetchone()
        conn.close()
    return _row_app(r) if r else None


def create_application(data: dict[str, Any]) -> dict[str, Any]:
    stage = data.get("stage") or "applied"
    if stage not in STAGE_VALUES:
        stage = "applied"
    now = _now()
    todos = data.get("todos")
    if todos is not None:
        todos_json = json.dumps(todos, ensure_ascii=False)
    else:
        todos_json = "[]"

    with _db_lock:
        conn = _get_conn()
        cur = conn.execute(
            """
            INSERT INTO applications (
                company, position, city, stage, applied_at, next_followup_at,
                interviewer_info, feedback, todos_json, notes, created_at, updated_at, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(data.get("company") or ""),
                str(data.get("position") or ""),
                str(data.get("city") or ""),
                stage,
                data.get("applied_at"),
                data.get("next_followup_at"),
                str(data.get("interviewer_info") or ""),
                str(data.get("feedback") or ""),
                todos_json,
                str(data.get("notes") or ""),
                now,
                now,
                int(data.get("sort_order") or 0),
            ),
        )
        new_id = cur.lastrowid
        conn.commit()
        conn.close()
    return get_application(new_id)  # type: ignore


def patch_application(app_id: int, data: dict[str, Any]) -> Optional[dict[str, Any]]:
    existing = get_application(app_id)
    if not existing:
        return None

    company = str(data["company"]) if "company" in data else existing["company"]
    position = str(data["position"]) if "position" in data else existing["position"]
    city = str(data["city"]) if "city" in data else existing["city"]
    stage = data["stage"] if "stage" in data else existing["stage"]
    if stage not in STAGE_VALUES:
        stage = existing["stage"]
    applied_at = data["applied_at"] if "applied_at" in data else existing.get("applied_at")
    next_followup_at = data["next_followup_at"] if "next_followup_at" in data else existing.get("next_followup_at")
    interviewer_info = (
        str(data["interviewer_info"]) if "interviewer_info" in data else existing["interviewer_info"]
    )
    feedback = str(data["feedback"]) if "feedback" in data else existing["feedback"]
    notes = str(data["notes"]) if "notes" in data else existing["notes"]
    sort_order = int(data["sort_order"]) if "sort_order" in data else int(existing.get("sort_order") or 0)

    if "todos" in data:
        todos_json = json.dumps(data["todos"], ensure_ascii=False)
    else:
        todos_json = json.dumps(existing.get("todos") or [], ensure_ascii=False)

    now = _now()
    with _db_lock:
        conn = _get_conn()
        conn.execute(
            """
            UPDATE applications SET
                company = ?, position = ?, city = ?, stage = ?,
                applied_at = ?, next_followup_at = ?,
                interviewer_info = ?, feedback = ?, todos_json = ?, notes = ?,
                sort_order = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                company,
                position,
                city,
                stage,
                applied_at,
                next_followup_at,
                interviewer_info,
                feedback,
                todos_json,
                notes,
                sort_order,
                now,
                app_id,
            ),
        )
        conn.commit()
        conn.close()
    return get_application(app_id)


def delete_application(app_id: int) -> bool:
    with _db_lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
        conn.commit()
        deleted = cur.rowcount > 0
        conn.close()
    return deleted


def batch_update_stage(ids: list[int], stage: str) -> int:
    if stage not in STAGE_VALUES:
        return 0
    if not ids:
        return 0
    now = _now()
    placeholders = ",".join("?" * len(ids))
    with _db_lock:
        conn = _get_conn()
        cur = conn.execute(
            f"UPDATE applications SET stage = ?, updated_at = ? WHERE id IN ({placeholders})",
            [stage, now, *ids],
        )
        conn.commit()
        count = cur.rowcount
        conn.close()
    return count


# --- Offers ---


def get_offer_by_application(application_id: int) -> Optional[dict[str, Any]]:
    with _db_lock:
        conn = _get_conn()
        cur = conn.execute(
            "SELECT * FROM offers WHERE application_id = ?", (application_id,)
        )
        r = cur.fetchone()
        conn.close()
    return _row_offer(r) if r else None


def get_offer(offer_id: int) -> Optional[dict[str, Any]]:
    with _db_lock:
        conn = _get_conn()
        cur = conn.execute("SELECT * FROM offers WHERE id = ?", (offer_id,))
        r = cur.fetchone()
        conn.close()
    return _row_offer(r) if r else None


def create_or_update_offer(data: dict[str, Any]) -> dict[str, Any]:
    application_id = int(data["application_id"])
    now = _now()
    benefits = data.get("benefits")
    if isinstance(benefits, list):
        benefits_json = json.dumps(benefits, ensure_ascii=False)
    else:
        benefits_json = json.dumps([], ensure_ascii=False)

    existing = get_offer_by_application(application_id)
    with _db_lock:
        conn = _get_conn()
        if existing:
            conn.execute(
                """
                UPDATE offers SET
                    base_salary = ?, total_pkg_note = ?, bonus = ?, equity = ?,
                    benefits_json = ?, wfh = ?, location = ?, pros = ?, cons = ?, deadline = ?
                WHERE application_id = ?
                """,
                (
                    str(data.get("base_salary") or ""),
                    str(data.get("total_pkg_note") or ""),
                    str(data.get("bonus") or ""),
                    str(data.get("equity") or ""),
                    benefits_json,
                    str(data.get("wfh") or ""),
                    str(data.get("location") or ""),
                    str(data.get("pros") or ""),
                    str(data.get("cons") or ""),
                    data.get("deadline"),
                    application_id,
                ),
            )
            oid = int(existing["id"])
        else:
            cur = conn.execute(
                """
                INSERT INTO offers (
                    application_id, base_salary, total_pkg_note, bonus, equity,
                    benefits_json, wfh, location, pros, cons, deadline, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    application_id,
                    str(data.get("base_salary") or ""),
                    str(data.get("total_pkg_note") or ""),
                    str(data.get("bonus") or ""),
                    str(data.get("equity") or ""),
                    benefits_json,
                    str(data.get("wfh") or ""),
                    str(data.get("location") or ""),
                    str(data.get("pros") or ""),
                    str(data.get("cons") or ""),
                    data.get("deadline"),
                    now,
                ),
            )
            oid = int(cur.lastrowid)
        conn.commit()
        conn.close()
    out = get_offer(oid)
    assert out is not None
    return out


def patch_offer(offer_id: int, data: dict[str, Any]) -> Optional[dict[str, Any]]:
    existing = get_offer(offer_id)
    if not existing:
        return None

    def pick(key: str, default: str = "") -> str:
        if key in data:
            return str(data.get(key) or "")
        return str(existing.get(key) or default)

    benefits = data["benefits"] if "benefits" in data else existing.get("benefits")
    if isinstance(benefits, list):
        benefits_json = json.dumps(benefits, ensure_ascii=False)
    else:
        benefits_json = json.dumps(existing.get("benefits") or [], ensure_ascii=False)

    deadline = existing.get("deadline")
    if "deadline" in data:
        deadline = data["deadline"]

    with _db_lock:
        conn = _get_conn()
        conn.execute(
            """
            UPDATE offers SET
                base_salary = ?, total_pkg_note = ?, bonus = ?, equity = ?,
                benefits_json = ?, wfh = ?, location = ?, pros = ?, cons = ?, deadline = ?
            WHERE id = ?
            """,
            (
                pick("base_salary"),
                pick("total_pkg_note"),
                pick("bonus"),
                pick("equity"),
                benefits_json,
                pick("wfh"),
                pick("location"),
                pick("pros"),
                pick("cons"),
                deadline,
                offer_id,
            ),
        )
        conn.commit()
        conn.close()
    return get_offer(offer_id)


def list_offers() -> list[dict[str, Any]]:
    with _db_lock:
        conn = _get_conn()
        cur = conn.execute(
            """
            SELECT o.*, a.company, a.position
            FROM offers o
            JOIN applications a ON a.id = o.application_id
            ORDER BY o.id DESC
            """
        )
        rows = cur.fetchall()
        conn.close()
    out = []
    for r in rows:
        d = _row_offer(r)
        d["company"] = r["company"]
        d["position"] = r["position"]
        out.append(d)
    return out


def delete_offer(offer_id: int) -> bool:
    with _db_lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM offers WHERE id = ?", (offer_id,))
        conn.commit()
        ok = cur.rowcount > 0
        conn.close()
    return ok


def compare_offers(offer_ids: list[int]) -> list[dict[str, Any]]:
    if not offer_ids:
        return []
    placeholders = ",".join("?" * len(offer_ids))
    with _db_lock:
        conn = _get_conn()
        cur = conn.execute(
            f"""
            SELECT o.*, a.company, a.position
            FROM offers o
            JOIN applications a ON a.id = o.application_id
            WHERE o.id IN ({placeholders})
            """,
            offer_ids,
        )
        rows = cur.fetchall()
        conn.close()

    by_id = {r["id"]: r for r in rows}
    result = []
    for oid in offer_ids:
        if oid not in by_id:
            continue
        r = by_id[oid]
        base = _row_offer(r)
        base["company"] = r["company"]
        base["position"] = r["position"]
        result.append(base)
    return result


def list_stages() -> list[str]:
    return list(STAGE_VALUES)
