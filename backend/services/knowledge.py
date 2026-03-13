import json
import os
import sqlite3
import threading
import time
from typing import Optional

from core.config import get_config
from services.llm import get_client

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "knowledge.db")
_db_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with _db_lock:
        conn = _get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS question_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_type TEXT,
                question TEXT,
                answer TEXT,
                score REAL,
                tags TEXT,
                created_at REAL
            )
        """)
        conn.commit()
        conn.close()


init_db()


def extract_tags(question: str, answer: str = "") -> list[str]:
    """Use LLM to extract 3-5 knowledge tags from a Q&A pair."""
    cfg = get_config()
    m = cfg.get_active_model()
    try:
        client = get_client()
        prompt = f"""从以下面试问答中提取 3-5 个知识点标签（技术关键词），直接返回 JSON 数组，不要其他内容。

问题：{question[:300]}
回答：{answer[:500] if answer else '(无回答)'}

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
    except Exception:
        pass
    return []


def save_record(
    session_type: str,
    question: str,
    answer: str,
    score: Optional[float] = None,
    tags: Optional[list[str]] = None,
):
    if tags is None:
        tags = extract_tags(question, answer)
    with _db_lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO question_records (session_type, question, answer, score, tags, created_at) VALUES (?,?,?,?,?,?)",
            (session_type, question, answer, score, json.dumps(tags, ensure_ascii=False), time.time()),
        )
        conn.commit()
        conn.close()


def get_summary() -> list[dict]:
    """Return per-tag aggregated stats: avg score, count, recent trend."""
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute("SELECT tags, score, created_at FROM question_records ORDER BY created_at DESC").fetchall()
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


def get_history(page: int = 1, page_size: int = 20) -> dict:
    offset = (page - 1) * page_size
    with _db_lock:
        conn = _get_conn()
        total = conn.execute("SELECT COUNT(*) as c FROM question_records").fetchone()["c"]
        rows = conn.execute(
            "SELECT * FROM question_records ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (page_size, offset),
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
            "session_type": row["session_type"],
            "question": row["question"],
            "answer": row["answer"],
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
