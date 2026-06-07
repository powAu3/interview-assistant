import json
import os
import sqlite3
import threading
import time
from typing import Optional

from core.config import get_config
from core.logger import get_logger
from services.llm import get_client
from services.storage.paths import sqlite_path

DB_PATH = sqlite_path("knowledge.db")
_db_lock = threading.Lock()
_tag_log = get_logger("knowledge.tags")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db():
    with _db_lock:
        conn = _get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS question_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                qa_id TEXT,
                session_type TEXT,
                question TEXT,
                answer TEXT,
                candidate_answer TEXT,
                score REAL,
                tags TEXT,
                created_at REAL
            )
        """)
        _ensure_column(conn, "question_records", "qa_id", "TEXT")
        _ensure_column(conn, "question_records", "candidate_answer", "TEXT")
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_question_records_qa_id ON question_records(qa_id)")
        except Exception:
            pass
        conn.commit()
        conn.close()


init_db()


def _session_type_where(session_types: Optional[tuple[str, ...]]) -> tuple[str, list[str]]:
    if not session_types:
        return "", []
    placeholders = ",".join("?" for _ in session_types)
    return f" WHERE session_type IN ({placeholders})", list(session_types)


def _analysis_answer_text(answer: str = "", candidate_answer: str = "") -> str:
    candidate_clean = (candidate_answer or "").strip()
    answer_clean = (answer or "").strip()
    if candidate_clean:
        return (
            "候选人实际口述：\n"
            f"{candidate_clean}\n\n"
            "助手参考答案：\n"
            f"{answer_clean or '(无助手答案)'}"
        )
    return answer_clean


def extract_tags(question: str, answer: str = "", candidate_answer: str = "") -> list[str]:
    """Use LLM to extract 3-5 knowledge tags from a Q&A pair."""
    cfg = get_config()
    m = cfg.get_active_model()
    answer_for_tags = _analysis_answer_text(answer, candidate_answer)
    try:
        client = get_client()
        prompt = f"""从以下面试问答中提取 3-5 个知识点标签（技术关键词），直接返回 JSON 数组，不要其他内容。
如果存在“候选人实际口述”，优先依据候选人实际回答暴露出的知识点和能力点；助手参考答案只作为题目语境补充。

问题：{question[:300]}
回答：{answer_for_tags[:800] if answer_for_tags else '(无回答)'}

示例输出：["Redis", "缓存穿透", "布隆过滤器"]"""

        resp = client.chat.completions.create(
            model=m.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=200,
        )
        text = resp.choices[0].message.content or "[]"
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception as e:
        _tag_log.warning("extract_tags failed: %s", e, exc_info=True)
    return []


def save_record(
    session_type: str,
    question: str,
    answer: str,
    score: Optional[float] = None,
    tags: Optional[list[str]] = None,
    candidate_answer: str = "",
    qa_id: str = "",
):
    if tags is None:
        tags = extract_tags(question, answer, candidate_answer)
    with _db_lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO question_records (qa_id, session_type, question, answer, candidate_answer, score, tags, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (
                qa_id or "",
                session_type,
                question,
                answer,
                candidate_answer or "",
                score,
                json.dumps(tags, ensure_ascii=False),
                time.time(),
            ),
        )
        conn.commit()
        conn.close()


def update_candidate_answer_for_qa(
    qa_id: str,
    candidate_answer: str,
    *,
    refresh_tags: bool = True,
) -> bool:
    qa_key = (qa_id or "").strip()
    answer_text = (candidate_answer or "").strip()
    if not qa_key or not answer_text:
        return False
    with _db_lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT id, question, answer FROM question_records WHERE qa_id = ? ORDER BY created_at DESC LIMIT 1",
            (qa_key,),
        ).fetchone()
        conn.close()
        if not row:
            return False

    tags_json = None
    if refresh_tags:
        try:
            tags = extract_tags(row["question"] or "", row["answer"] or "", answer_text)
            if tags:
                tags_json = json.dumps(tags, ensure_ascii=False)
        except Exception:
            tags_json = None

    with _db_lock:
        conn = _get_conn()
        if tags_json is not None:
            conn.execute(
                "UPDATE question_records SET candidate_answer = ?, tags = ? WHERE id = ?",
                (answer_text, tags_json, row["id"]),
            )
        else:
            conn.execute(
                "UPDATE question_records SET candidate_answer = ? WHERE id = ?",
                (answer_text, row["id"]),
            )
        conn.commit()
        conn.close()
        return True


def get_summary(session_types: Optional[tuple[str, ...]] = None) -> list[dict]:
    """Return per-tag aggregated stats: avg score, count, recent trend."""
    where_sql, params = _session_type_where(session_types)
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute(
            f"SELECT tags, score, created_at FROM question_records{where_sql} ORDER BY created_at DESC",
            params,
        ).fetchall()
        conn.close()

    tag_data: dict[str, list[dict]] = {}
    for row in rows:
        try:
            tags = json.loads(row["tags"]) if row["tags"] else []
        except Exception:
            tags = []
        for tag in tags:
            if tag not in tag_data:
                tag_data[tag] = []
            tag_data[tag].append({"score": row["score"], "created_at": row["created_at"]})

    result = []
    for tag, entries in tag_data.items():
        scores = [e["score"] for e in entries if e["score"] is not None]
        avg_score = round(sum(scores) / len(scores), 1) if scores else None

        trend = "stable"
        if len(scores) >= 2:
            half = len(scores) // 2
            recent_avg = sum(scores[:half]) / half
            older_avg = sum(scores[half:]) / (len(scores) - half)
            if recent_avg - older_avg > 0.5:
                trend = "up"
            elif older_avg - recent_avg > 0.5:
                trend = "down"

        result.append({
            "tag": tag,
            "count": len(entries),
            "avg_score": avg_score,
            "trend": trend,
        })

    result.sort(key=lambda x: x["count"], reverse=True)
    return result


def get_history(
    page: int = 1,
    page_size: int = 20,
    session_types: Optional[tuple[str, ...]] = None,
) -> dict:
    offset = (page - 1) * page_size
    where_sql, params = _session_type_where(session_types)
    with _db_lock:
        conn = _get_conn()
        total = conn.execute(
            f"SELECT COUNT(*) as c FROM question_records{where_sql}",
            params,
        ).fetchone()["c"]
        rows = conn.execute(
            f"SELECT * FROM question_records{where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
        conn.close()

    records = []
    for row in rows:
        try:
            tags = json.loads(row["tags"]) if row["tags"] else []
        except Exception:
            tags = []
        records.append({
            "id": row["id"],
            "qa_id": row["qa_id"] if "qa_id" in row.keys() else "",
            "session_type": row["session_type"],
            "question": row["question"],
            "answer": row["answer"],
            "candidate_answer": row["candidate_answer"] if "candidate_answer" in row.keys() else "",
            "score": row["score"],
            "tags": tags,
            "created_at": row["created_at"],
        })

    return {"records": records, "total": total, "page": page, "page_size": page_size}


def reset_all():
    with _db_lock:
        conn = _get_conn()
        conn.execute("DELETE FROM question_records")
        conn.commit()
        conn.close()
