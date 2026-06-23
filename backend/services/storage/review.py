"""
面试复盘归档存储：session / turn / profile
"""
import json
import sqlite3
import threading
import time
from typing import Any, Optional

from services.storage.paths import sqlite_path

DB_PATH = sqlite_path("review.db")
_db_lock = threading.Lock()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    cols = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with _db_lock:
        conn = _conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS review_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                status TEXT NOT NULL DEFAULT 'recording',
                started_at REAL NOT NULL,
                ended_at REAL,
                source TEXT NOT NULL DEFAULT 'assist',
                title TEXT,
                company TEXT,
                role TEXT,
                jd_snapshot TEXT,
                resume_snapshot TEXT,
                interviewer_capture_enabled INTEGER NOT NULL DEFAULT 0,
                candidate_capture_enabled INTEGER NOT NULL DEFAULT 0,
                turn_count INTEGER NOT NULL DEFAULT 0,
                avg_score REAL,
                summary_markdown TEXT,
                strong_points_json TEXT,
                weak_points_json TEXT,
                behavior_traits_json TEXT,
                domain_summary_json TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS review_turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                qa_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                question_text TEXT NOT NULL,
                candidate_answer_text TEXT,
                original_candidate_answer_text TEXT,
                reference_answer_text TEXT,
                code_text TEXT,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                is_partial INTEGER NOT NULL DEFAULT 0,
                analysis_status TEXT NOT NULL DEFAULT 'pending',
                strengths_json TEXT,
                risks_json TEXT,
                evidence_json TEXT,
                behavior_signals_json TEXT,
                tags_json TEXT,
                scorecard_json TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                FOREIGN KEY (session_id) REFERENCES review_sessions(id)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS review_profile_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                generated_at REAL NOT NULL,
                session_count INTEGER NOT NULL DEFAULT 0,
                summary_json TEXT,
                strengths_json TEXT,
                weaknesses_json TEXT,
                behavior_traits_json TEXT,
                domain_mastery_json TEXT,
                trend_json TEXT
            )
        """)
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_review_turns_session_id ON review_turns(session_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_review_turns_qa_id ON review_turns(qa_id)")
            _ensure_column(conn, "review_turns", "original_candidate_answer_text", "TEXT")
        except Exception:
            pass
        conn.commit()
        conn.close()


init_db()


def create_session(
    started_at: float,
    interviewer_enabled: bool,
    candidate_enabled: bool,
    jd_snapshot: str = "",
    resume_snapshot: str = "",
    source: str = "assist",
    title: str = "",
    company: str = "",
    role: str = "",
) -> int:
    """创建新 session，返回 session_id"""
    now = time.time()
    with _db_lock:
        conn = _conn()
        conn.execute(
            """
            INSERT INTO review_sessions (
                status, started_at, source,
                title, company, role,
                interviewer_capture_enabled, candidate_capture_enabled,
                jd_snapshot, resume_snapshot,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "recording",
                started_at,
                source or "assist",
                title or None,
                company or None,
                role or None,
                1 if interviewer_enabled else 0,
                1 if candidate_enabled else 0,
                jd_snapshot or "",
                resume_snapshot or "",
                now,
                now,
            ),
        )
        conn.commit()
        session_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.close()
    return int(session_id)


def get_current_session() -> Optional[dict[str, Any]]:
    """获取当前进行中的 session（status=recording）"""
    with _db_lock:
        conn = _conn()
        row = conn.execute(
            "SELECT * FROM review_sessions WHERE status = 'recording' ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
        conn.close()
    if not row:
        return None
    return dict(row)


def end_session(
    session_id: int,
    status: str = "completed",
    ended_at: Optional[float] = None,
    summary_markdown: str = "",
    strong_points: Optional[list[str]] = None,
    weak_points: Optional[list[str]] = None,
    behavior_traits: Optional[list[str]] = None,
) -> None:
    """结束 session，切换状态"""
    now = time.time()
    if ended_at is None:
        ended_at = now

    with _db_lock:
        conn = _conn()
        conn.execute(
            """
            UPDATE review_sessions
            SET status = ?, ended_at = ?, updated_at = ?,
                summary_markdown = ?,
                strong_points_json = ?,
                weak_points_json = ?,
                behavior_traits_json = ?
            WHERE id = ?
            """,
            (
                status,
                ended_at,
                now,
                summary_markdown or "",
                json.dumps(strong_points or [], ensure_ascii=False),
                json.dumps(weak_points or [], ensure_ascii=False),
                json.dumps(behavior_traits or [], ensure_ascii=False),
                session_id,
            ),
        )
        conn.commit()
        conn.close()


def add_turn(
    session_id: int,
    qa_id: str,
    seq: int,
    question_text: str,
    candidate_answer_text: str = "",
    reference_answer_text: str = "",
    code_text: str = "",
    duration_ms: int = 0,
    is_partial: bool = False,
    analysis_status: str = "pending",
    strengths: Optional[list[str]] = None,
    risks: Optional[list[str]] = None,
    evidence: Optional[dict[str, Any]] = None,
    scorecard: Optional[dict[str, Any]] = None,
) -> int:
    """添加一轮 turn，返回 turn_id，并更新 session 的 turn_count"""
    now = time.time()
    with _db_lock:
        conn = _conn()
        conn.execute(
            """
            INSERT INTO review_turns (
                session_id, qa_id, seq,
                question_text, candidate_answer_text, reference_answer_text, code_text,
                duration_ms, is_partial, analysis_status,
                strengths_json, risks_json, evidence_json, scorecard_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                qa_id or "",
                seq,
                question_text or "",
                candidate_answer_text or "",
                reference_answer_text or "",
                code_text or "",
                duration_ms,
                1 if is_partial else 0,
                analysis_status,
                json.dumps(strengths or [], ensure_ascii=False),
                json.dumps(risks or [], ensure_ascii=False),
                json.dumps(evidence or {}, ensure_ascii=False),
                json.dumps(scorecard or {}, ensure_ascii=False),
                now,
                now,
            ),
        )
        turn_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        # 更新 session 的 turn_count
        conn.execute(
            """
            UPDATE review_sessions
            SET turn_count = (SELECT COUNT(*) FROM review_turns WHERE session_id = ?),
                updated_at = ?
            WHERE id = ?
            """,
            (session_id, now, session_id),
        )

        conn.commit()
        conn.close()
    return int(turn_id)


def list_sessions(page: int = 1, page_size: int = 20) -> dict[str, Any]:
    """列表页分页"""
    offset = (page - 1) * page_size
    with _db_lock:
        conn = _conn()
        total = conn.execute("SELECT COUNT(*) as c FROM review_sessions").fetchone()["c"]
        rows = conn.execute(
            """
            SELECT * FROM review_sessions
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
            """,
            (page_size, offset),
        ).fetchall()
        conn.close()
    items = [dict(row) for row in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def get_session_detail(session_id: int) -> Optional[dict[str, Any]]:
    """详情页：session + turns，并解析 JSON 字段"""
    with _db_lock:
        conn = _conn()
        session_row = conn.execute(
            "SELECT * FROM review_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not session_row:
            conn.close()
            return None
        turn_rows = conn.execute(
            "SELECT * FROM review_turns WHERE session_id = ? ORDER BY seq ASC",
            (session_id,),
        ).fetchall()
        conn.close()

    session = dict(session_row)

    # 解析 session JSON 字段
    for field in ["strong_points", "weak_points", "behavior_traits", "domain_summary"]:
        json_field = f"{field}_json"
        if json_field in session and session[json_field]:
            try:
                session[field] = json.loads(session[json_field])
            except (json.JSONDecodeError, TypeError):
                session[field] = [] if field != "domain_summary" else {}
        else:
            session[field] = [] if field != "domain_summary" else {}

    # 解析 turn JSON 字段
    turns = []
    for row in turn_rows:
        turn = dict(row)
        for field in ["strengths", "risks", "evidence", "behavior_signals", "tags", "scorecard"]:
            json_field = f"{field}_json"
            if json_field in turn and turn[json_field]:
                try:
                    turn[field] = json.loads(turn[json_field])
                except (json.JSONDecodeError, TypeError):
                    turn[field] = [] if field in ["strengths", "risks", "behavior_signals", "tags"] else {}
            else:
                turn[field] = [] if field in ["strengths", "risks", "behavior_signals", "tags"] else {}
        turns.append(turn)

    session["turns"] = turns
    return session


def update_session_status(session_id: int, status: str):
    """更新 session 状态"""
    with _db_lock:
        conn = _conn()
        now = time.time()
        conn.execute(
            "UPDATE review_sessions SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, session_id),
        )
        conn.commit()
        conn.close()


def update_turn_analysis(
    turn_id: int,
    analysis_status: str,
    strengths: Optional[list[str]] = None,
    risks: Optional[list[str]] = None,
    evidence: Optional[dict] = None,
    scorecard: Optional[dict[str, int]] = None,
    corrected_answer: Optional[str] = None,
):
    """更新 turn 的分析结果（含 ASR 纠错后的回答）"""
    with _db_lock:
        conn = _conn()
        now = time.time()

        # 构建动态 SQL
        fields = [
            "analysis_status = ?",
            "strengths_json = ?",
            "risks_json = ?",
            "evidence_json = ?",
            "scorecard_json = ?",
        ]
        params = [
            analysis_status,
            json.dumps(strengths or [], ensure_ascii=False) if strengths is not None else None,
            json.dumps(risks or [], ensure_ascii=False) if risks is not None else None,
            json.dumps(evidence or {}, ensure_ascii=False) if evidence is not None else None,
            json.dumps(scorecard or {}, ensure_ascii=False) if scorecard is not None else None,
        ]

        # 如果提供了纠正后的回答，添加到更新字段
        if corrected_answer is not None:
            fields.append(
                "original_candidate_answer_text = COALESCE(NULLIF(original_candidate_answer_text, ''), candidate_answer_text)"
            )
            fields.append("candidate_answer_text = ?")
            params.append(corrected_answer)

        fields.append("updated_at = ?")
        params.append(now)
        params.append(turn_id)

        sql = f"UPDATE review_turns SET {', '.join(fields)} WHERE id = ?"
        conn.execute(sql, params)
        conn.commit()
        conn.close()


def update_session_summary(
    session_id: int,
    summary_markdown: str,
    strong_points: list[str],
    weak_points: list[str],
    avg_score: Optional[float] = None,
):
    """更新 session 的整体总结"""
    with _db_lock:
        conn = _conn()
        now = time.time()
        conn.execute(
            """
            UPDATE review_sessions
            SET summary_markdown = ?,
                strong_points_json = ?,
                weak_points_json = ?,
                avg_score = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                summary_markdown,
                json.dumps(strong_points, ensure_ascii=False),
                json.dumps(weak_points, ensure_ascii=False),
                avg_score,
                now,
                session_id,
            ),
        )
        conn.commit()
        conn.close()


def update_session_info(
    session_id: int,
    title: Optional[str] = None,
    company: Optional[str] = None,
    role: Optional[str] = None,
):
    """更新会话的标题、公司、岗位信息"""
    now = time.time()
    with _db_lock:
        conn = _conn()

        updates = []
        params = []

        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if company is not None:
            updates.append("company = ?")
            params.append(company)
        if role is not None:
            updates.append("role = ?")
            params.append(role)

        if not updates:
            conn.close()
            return

        updates.append("updated_at = ?")
        params.append(now)
        params.append(session_id)

        conn.execute(
            f"UPDATE review_sessions SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        conn.commit()
        conn.close()

