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
_UNSET = object()
AUTO_REVIEW_SYNC_MIN_TURNS = 5
_DEFAULT_REVIEW_TITLES = {"", "手动复盘", "面试详情", "复盘"}
_DEFAULT_COMPANY_VALUES = {"", "新公司", "未命名公司"}
_DEFAULT_ROLE_VALUES = {"", "岗位", "岗位未填写"}
MAX_REVIEW_PAGE_SIZE = 100
_TERMINAL_APPLICATION_STAGES = {
    "written_rejected",
    "interview1_rejected",
    "interview2_rejected",
    "interview3_rejected",
    "hr_rejected",
    "rejected",
    "withdrawn",
}


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _bounded_int(value: Any, *, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _is_default_review_title(value: Any) -> bool:
    return _clean_text(value) in _DEFAULT_REVIEW_TITLES


def _is_default_company(value: Any) -> bool:
    return _clean_text(value) in _DEFAULT_COMPANY_VALUES


def _is_default_role(value: Any) -> bool:
    return _clean_text(value) in _DEFAULT_ROLE_VALUES


def _build_review_title(company: Any, role: Any) -> str:
    company_text = _clean_text(company)
    role_text = _clean_text(role)
    if company_text and role_text:
        return f"{company_text} - {role_text}"
    return company_text or role_text or ""


def is_auto_sync_eligible_session(session: Optional[dict[str, Any]]) -> bool:
    if not session:
        return False
    try:
        return int(session.get("turn_count") or 0) >= AUTO_REVIEW_SYNC_MIN_TURNS
    except (TypeError, ValueError):
        return False


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
                application_id INTEGER,
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
            _ensure_column(conn, "review_sessions", "application_id", "INTEGER")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_review_sessions_application_id ON review_sessions(application_id)")
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
    application_id: Optional[int] = None,
) -> int:
    """创建新 session，返回 session_id"""
    now = time.time()
    with _db_lock:
        conn = _conn()
        conn.execute(
            """
            INSERT INTO review_sessions (
                status, started_at, source,
                title, company, role, application_id,
                interviewer_capture_enabled, candidate_capture_enabled,
                jd_snapshot, resume_snapshot,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "recording",
                started_at,
                source or "assist",
                title or None,
                company or None,
                role or None,
                int(application_id) if application_id is not None else None,
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
    page = _bounded_int(page, fallback=1, minimum=1, maximum=1_000_000)
    page_size = _bounded_int(page_size, fallback=20, minimum=1, maximum=MAX_REVIEW_PAGE_SIZE)
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
    for item in items:
        item["auto_sync_eligible"] = is_auto_sync_eligible_session(item)
        application_id = item.get("application_id")
        item["application"] = _application_brief(application_id) if application_id else None
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
    session["auto_sync_eligible"] = is_auto_sync_eligible_session(session)
    application_id = session.get("application_id")
    session["application"] = _application_brief(application_id) if application_id else None

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
    sync_application_todos_for_session(session_id)


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
    session_id: Optional[int] = None
    with _db_lock:
        conn = _conn()
        now = time.time()
        row = conn.execute(
            "SELECT session_id, evidence_json FROM review_turns WHERE id = ?",
            (turn_id,),
        ).fetchone()
        if row:
            session_id = int(row["session_id"])

        # 构建动态 SQL
        fields = ["analysis_status = ?"]
        params = [analysis_status]
        if strengths is not None:
            fields.append("strengths_json = ?")
            params.append(json.dumps(strengths or [], ensure_ascii=False))
        if risks is not None:
            fields.append("risks_json = ?")
            params.append(json.dumps(risks or [], ensure_ascii=False))
        if evidence is not None:
            existing_evidence: dict[str, Any] = {}
            if row and row["evidence_json"]:
                try:
                    parsed = json.loads(row["evidence_json"])
                    if isinstance(parsed, dict):
                        existing_evidence = parsed
                except (json.JSONDecodeError, TypeError):
                    existing_evidence = {}
            fields.append("evidence_json = ?")
            params.append(json.dumps({**existing_evidence, **(evidence or {})}, ensure_ascii=False))
        if scorecard is not None:
            fields.append("scorecard_json = ?")
            params.append(json.dumps(scorecard or {}, ensure_ascii=False))

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
    if session_id is not None:
        sync_application_todos_for_session(session_id)


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
    sync_application_todos_for_session(session_id)


def update_session_info(
    session_id: int,
    title: Optional[str] = None,
    company: Optional[str] = None,
    role: Optional[str] = None,
    application_id: Any = _UNSET,
):
    """更新会话的标题、公司、岗位信息"""
    old_application_id = _patch_review_session_fields(
        session_id,
        title=title,
        company=company,
        role=role,
        application_id=application_id,
    )
    if old_application_id is None and title is None and company is None and role is None and application_id is _UNSET:
        return
    detail = get_session_detail(session_id)
    linked_application_id = int(detail["application_id"]) if detail and detail.get("application_id") else None
    if application_id is not _UNSET:
        new_application_id = int(application_id) if application_id is not None else None
        if old_application_id is not None and old_application_id != new_application_id:
            _remove_review_todos_from_application(session_id, old_application_id)
    if linked_application_id is not None:
        sync_application_link_metadata_for_session(session_id)
        sync_application_todos_for_session(session_id)


def _patch_review_session_fields(
    session_id: int,
    *,
    title: Optional[str] = None,
    company: Optional[str] = None,
    role: Optional[str] = None,
    application_id: Any = _UNSET,
) -> Optional[int]:
    now = time.time()
    old_application_id: Optional[int] = None
    with _db_lock:
        conn = _conn()
        if application_id is not _UNSET:
            row = conn.execute(
                "SELECT application_id FROM review_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if row and row["application_id"] is not None:
                old_application_id = int(row["application_id"])

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
        if application_id is not _UNSET:
            updates.append("application_id = ?")
            params.append(int(application_id) if application_id is not None else None)

        if not updates:
            conn.close()
            return old_application_id

        updates.append("updated_at = ?")
        params.append(now)
        params.append(session_id)

        conn.execute(
            f"UPDATE review_sessions SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        conn.commit()
        conn.close()
    return old_application_id


def _application_brief(application_id: Any) -> Optional[dict[str, Any]]:
    try:
        from services.storage import job_tracker

        app = job_tracker.get_application(int(application_id))
    except Exception:
        return None
    if not app:
        return None
    return {
        "id": app["id"],
        "company": app.get("company", ""),
        "position": app.get("position", ""),
        "city": app.get("city", ""),
        "stage": app.get("stage", ""),
        "applied_at": app.get("applied_at"),
        "next_followup_at": app.get("next_followup_at"),
        "updated_at": app.get("updated_at"),
    }


def get_application_review_summaries(application_ids: list[int]) -> dict[int, dict[str, Any]]:
    ids = sorted({int(i) for i in application_ids if int(i) > 0})
    if not ids:
        return {}
    placeholders = ",".join("?" * len(ids))
    with _db_lock:
        conn = _conn()
        rows = conn.execute(
            f"""
            SELECT id, application_id, status, started_at, ended_at, turn_count, avg_score
            FROM review_sessions
            WHERE application_id IN ({placeholders})
            ORDER BY application_id ASC, COALESCE(ended_at, started_at) DESC, id DESC
            """,
            ids,
        ).fetchall()
        conn.close()

    summaries: dict[int, dict[str, Any]] = {
        app_id: {
            "review_count": 0,
            "latest_review_id": None,
            "latest_avg_score": None,
            "latest_review_at": None,
            "latest_status": None,
            "linked_review_count": 0,
            "latest_linked_review_id": None,
            "latest_linked_avg_score": None,
            "latest_linked_review_at": None,
            "latest_linked_status": None,
        }
        for app_id in ids
    }
    for row in rows:
        app_id = int(row["application_id"])
        summary = summaries[app_id]
        summary["linked_review_count"] += 1
        if summary["latest_linked_review_id"] is None:
            summary["latest_linked_review_id"] = int(row["id"])
            summary["latest_linked_avg_score"] = row["avg_score"]
            summary["latest_linked_review_at"] = row["ended_at"] if row["ended_at"] is not None else row["started_at"]
            summary["latest_linked_status"] = row["status"]
        if not is_auto_sync_eligible_session(dict(row)):
            continue
        summary["review_count"] += 1
        if summary["latest_review_id"] is None:
            summary["latest_review_id"] = int(row["id"])
            summary["latest_avg_score"] = row["avg_score"]
            summary["latest_review_at"] = row["ended_at"] if row["ended_at"] is not None else row["started_at"]
            summary["latest_status"] = row["status"]
    return summaries


def list_reviews_for_application(application_id: int) -> list[dict[str, Any]]:
    with _db_lock:
        conn = _conn()
        rows = conn.execute(
            """
            SELECT id, status, started_at, ended_at, title, company, role,
                   turn_count, avg_score, summary_markdown, updated_at
            FROM review_sessions
            WHERE application_id = ?
            ORDER BY COALESCE(ended_at, started_at) DESC, id DESC
            """,
            (int(application_id),),
        ).fetchall()
        conn.close()
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["auto_sync_eligible"] = is_auto_sync_eligible_session(item)
        if item.get("summary_markdown"):
            item["summary_preview"] = str(item["summary_markdown"]).strip()[:180]
        item.pop("summary_markdown", None)
        out.append(item)
    return out


def _review_todo_prefix(session_id: int) -> str:
    return f"review-{int(session_id)}-"


def _turn_avg_score(turn: dict[str, Any]) -> Optional[float]:
    scorecard = turn.get("scorecard") or {}
    if not isinstance(scorecard, dict) or not scorecard:
        return None
    values: list[float] = []
    for value in scorecard.values():
        try:
            values.append(float(value))
        except (TypeError, ValueError):
            continue
    if not values:
        return None
    return sum(values) / len(values)


def _build_review_todos(detail: dict[str, Any]) -> list[dict[str, Any]]:
    session_id = int(detail["id"])
    todos: list[dict[str, Any]] = []
    for idx, point in enumerate((detail.get("weak_points") or [])[:3], start=1):
        text = str(point).strip()
        if text:
            todos.append({
                "id": f"{_review_todo_prefix(session_id)}weak-{idx}",
                "title": f"复盘补强：{text}",
                "done": False,
            })
    low_turns = []
    for turn in detail.get("turns") or []:
        avg = _turn_avg_score(turn)
        if avg is not None and avg < 6:
            low_turns.append((avg, turn))
    low_turns.sort(key=lambda item: item[0])
    for _avg, turn in low_turns[:2]:
        question = str(turn.get("question_text") or "").strip()
        if len(question) > 42:
            question = question[:42] + "..."
        todos.append({
            "id": f"{_review_todo_prefix(session_id)}turn-{turn.get('id') or turn.get('seq')}",
            "title": f"复练第 {turn.get('seq')} 题：{question}",
            "done": False,
        })
    return todos


def sync_application_todos_for_session(session_id: int) -> bool:
    detail = get_session_detail(session_id)
    if not detail or not detail.get("application_id"):
        return False
    application_id = int(detail["application_id"])
    if not is_auto_sync_eligible_session(detail):
        _remove_review_todos_from_application(session_id, application_id)
        return False
    try:
        from services.storage import job_tracker

        app = job_tracker.get_application(application_id)
    except Exception:
        return False
    if not app:
        return False

    prefix = _review_todo_prefix(session_id)
    generated = _build_review_todos(detail)
    existing_todos = app.get("todos") or []
    existing_by_id = {
        str(todo.get("id")): todo
        for todo in existing_todos
        if isinstance(todo, dict) and todo.get("id")
    }
    kept = [
        todo
        for todo in existing_todos
        if not (isinstance(todo, dict) and str(todo.get("id", "")).startswith(prefix))
    ]
    next_todos = list(kept)
    for todo in generated:
        old = existing_by_id.get(todo["id"]) or {}
        next_todos.append({**todo, "done": bool(old.get("done", False))})
    job_tracker.patch_application(int(app["id"]), {"todos": next_todos})
    return True


def sync_application_link_metadata_for_session(session_id: int) -> bool:
    detail = get_session_detail(session_id)
    if not detail or not detail.get("application_id"):
        return False
    try:
        from services.storage import job_tracker

        app = job_tracker.get_application(int(detail["application_id"]))
    except Exception:
        return False
    if not app:
        return False

    session_patch: dict[str, Any] = {}
    app_patch: dict[str, Any] = {}

    session_company = _clean_text(detail.get("company"))
    session_role = _clean_text(detail.get("role"))
    app_company = _clean_text(app.get("company"))
    app_position = _clean_text(app.get("position"))
    app_stage = _clean_text(app.get("stage"))

    if _is_default_company(session_company) and not _is_default_company(app_company):
        session_patch["company"] = app_company
    if _is_default_role(session_role) and not _is_default_role(app_position):
        session_patch["role"] = app_position
    if _is_default_company(app_company) and not _is_default_company(session_company):
        app_patch["company"] = session_company
    if _is_default_role(app_position) and not _is_default_role(session_role):
        app_patch["position"] = session_role

    next_company = session_patch.get("company", session_company)
    next_role = session_patch.get("role", session_role)
    if _is_default_review_title(detail.get("title")):
        next_title = _build_review_title(next_company, next_role)
        if next_title:
            session_patch["title"] = next_title

    session_time = detail.get("ended_at") if detail.get("ended_at") is not None else detail.get("started_at")
    if (
        session_time is not None
        and app.get("next_followup_at") is None
        and app_stage not in _TERMINAL_APPLICATION_STAGES
    ):
        app_patch["next_followup_at"] = float(session_time)

    if session_patch:
        _patch_review_session_fields(session_id, **session_patch)
    if app_patch:
        job_tracker.patch_application(int(app["id"]), app_patch)
    return bool(session_patch or app_patch)


def sync_review_metadata_from_application(application_id: int) -> int:
    try:
        from services.storage import job_tracker

        app = job_tracker.get_application(int(application_id))
    except Exception:
        return 0
    if not app:
        return 0

    with _db_lock:
        conn = _conn()
        rows = conn.execute(
            "SELECT id, title, company, role FROM review_sessions WHERE application_id = ?",
            (int(application_id),),
        ).fetchall()
        conn.close()

    updated = 0
    for row in rows:
        patch: dict[str, Any] = {}
        if _is_default_company(row["company"]) and not _is_default_company(app.get("company")):
            patch["company"] = _clean_text(app.get("company"))
        if _is_default_role(row["role"]) and not _is_default_role(app.get("position")):
            patch["role"] = _clean_text(app.get("position"))
        next_company = patch.get("company", _clean_text(row["company"]))
        next_role = patch.get("role", _clean_text(row["role"]))
        if _is_default_review_title(row["title"]):
            next_title = _build_review_title(next_company, next_role)
            if next_title:
                patch["title"] = next_title
        if patch:
            _patch_review_session_fields(int(row["id"]), **patch)
            updated += 1
    return updated


def _remove_review_todos_from_application(session_id: int, application_id: int) -> bool:
    try:
        from services.storage import job_tracker

        app = job_tracker.get_application(int(application_id))
    except Exception:
        return False
    if not app:
        return False
    prefix = _review_todo_prefix(session_id)
    existing_todos = app.get("todos") or []
    next_todos = [
        todo
        for todo in existing_todos
        if not (isinstance(todo, dict) and str(todo.get("id", "")).startswith(prefix))
    ]
    if len(next_todos) == len(existing_todos):
        return False
    job_tracker.patch_application(int(app["id"]), {"todos": next_todos})
    return True

