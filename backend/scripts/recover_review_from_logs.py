"""Recover a review session from interview.log events.

This is intended for crash/force-close cases where review_sessions contains a
recording session but /api/assist/stop never ran, so review_turns were not
written.

Usage:
    python -m scripts.recover_review_from_logs --session-id 872
    python -m scripts.recover_review_from_logs --since "2026-06-24 10:48:35"
"""

from __future__ import annotations

import argparse
import ast
import os
import re
import sqlite3
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.storage import review  # noqa: E402
from services.storage.review import DB_PATH  # noqa: E402

TS_FORMAT = "%Y-%m-%d %H:%M:%S"
TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")
QA_ID_RE = re.compile(r"\bid=([^\s]+)")
SEGMENT_RE = re.compile(r"\bsegment=([^\s]+)")
CANDIDATE_QA_RE = re.compile(r"\bqa_id=([^\s]+)")
ANSWER_LEN_RE = re.compile(r"\banswer_len=(\d+)")
MODEL_RE = re.compile(r"\bmodel=([^\s]+)")


@dataclass
class CandidateSegment:
    text: str = ""
    is_final: bool = False


@dataclass
class LogTurn:
    qa_id: str
    seq: int
    question: str = ""
    reference_answer: str = ""
    answer_done: bool = False
    candidate_segments: "OrderedDict[str, CandidateSegment]" = field(default_factory=OrderedDict)

    @property
    def candidate_answer(self) -> str:
        return "\n".join(
            segment.text.strip()
            for segment in self.candidate_segments.values()
            if segment.text.strip()
        ).strip()


@dataclass
class LogSession:
    started_at: float
    ended_at: Optional[float] = None
    turns: "OrderedDict[str, LogTurn]" = field(default_factory=OrderedDict)
    last_event_at: Optional[float] = None


def _parse_ts(line: str) -> Optional[float]:
    match = TS_RE.search(line)
    if not match:
        return None
    return datetime.strptime(match.group(1), TS_FORMAT).timestamp()


def _parse_datetime(value: str) -> float:
    return datetime.strptime(value, TS_FORMAT).timestamp()


def _extract_repr(line: str, key: str) -> str:
    match = re.search(rf"\b{re.escape(key)}=('(?:\\.|[^'])*'|\"(?:\\.|[^\"])*\")", line)
    if not match:
        return ""
    try:
        value = ast.literal_eval(match.group(1))
    except Exception:
        return ""
    return str(value or "").strip()


def _clean_question(text: str) -> str:
    return " ".join((text or "").split()).strip()


def parse_log_sessions(log_path: Path, *, until: Optional[float] = None) -> list[LogSession]:
    sessions: list[LogSession] = []
    current: Optional[LogSession] = None
    pending_question = ""

    with log_path.open("r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            ts = _parse_ts(line)
            if until is not None and ts is not None and ts > until:
                if current is not None:
                    current.ended_at = current.last_event_at or until
                    sessions.append(current)
                break
            if ts is not None and current is not None:
                current.last_event_at = ts

            if "INTERVIEW_START" in line:
                if current is not None:
                    sessions.append(current)
                current = LogSession(started_at=ts or time.time(), last_event_at=ts)
                pending_question = ""
                continue

            if current is None:
                continue

            if "INTERVIEW_STOP" in line:
                current.ended_at = ts or current.last_event_at
                sessions.append(current)
                current = None
                pending_question = ""
                continue

            if "ASR_QUESTION" in line and "text=" in line:
                pending_question = _clean_question(_extract_repr(line, "text"))
                continue

            if "ANSWER_START" in line:
                qa_match = QA_ID_RE.search(line)
                if not qa_match:
                    continue
                qa_id = qa_match.group(1)
                turn = current.turns.get(qa_id)
                if turn is None:
                    turn = LogTurn(qa_id=qa_id, seq=len(current.turns) + 1)
                    current.turns[qa_id] = turn
                question = _clean_question(_extract_repr(line, "q"))
                turn.question = question or pending_question or turn.question
                pending_question = ""
                continue

            if "ANSWER_DONE" in line:
                qa_match = QA_ID_RE.search(line)
                if not qa_match:
                    continue
                qa_id = qa_match.group(1)
                turn = current.turns.get(qa_id)
                if turn is None:
                    turn = LogTurn(qa_id=qa_id, seq=len(current.turns) + 1)
                    current.turns[qa_id] = turn
                model = MODEL_RE.search(line)
                answer_len = ANSWER_LEN_RE.search(line)
                model_name = model.group(1) if model else "unknown"
                chars = answer_len.group(1) if answer_len else "unknown"
                turn.answer_done = True
                turn.reference_answer = (
                    f"系统参考答案已生成（模型 {model_name}，日志仅保留长度 {chars} 字，未保存全文）。"
                )
                continue

            if "CANDIDATE_ASR_" in line and "qa_id=" in line and "text=" in line:
                qa_match = CANDIDATE_QA_RE.search(line)
                seg_match = SEGMENT_RE.search(line)
                if not qa_match:
                    continue
                qa_id = qa_match.group(1)
                segment_id = seg_match.group(1) if seg_match else f"{qa_id}-segment-{len(current.turns)}"
                text = _extract_repr(line, "text")
                if not text:
                    continue
                turn = current.turns.get(qa_id)
                if turn is None:
                    turn = LogTurn(qa_id=qa_id, seq=len(current.turns) + 1)
                    current.turns[qa_id] = turn
                existing = turn.candidate_segments.get(segment_id)
                is_final = "CANDIDATE_ASR_FINAL" in line
                if existing is None or is_final or not existing.is_final:
                    turn.candidate_segments[segment_id] = CandidateSegment(
                        text=text,
                        is_final=is_final,
                    )

    if current is not None:
        sessions.append(current)
    return sessions


def select_log_session(
    sessions: list[LogSession],
    *,
    started_at: Optional[float],
    since: Optional[float],
    until: Optional[float],
) -> Optional[LogSession]:
    candidates = sessions
    if since is not None:
        candidates = [
            sess for sess in candidates
            if (sess.last_event_at or sess.started_at) >= since and sess.started_at <= (until or time.time())
        ]
    if until is not None:
        candidates = [sess for sess in candidates if sess.started_at <= until]
    if started_at is not None:
        candidates = sorted(candidates, key=lambda sess: abs(sess.started_at - started_at))
    else:
        candidates = sorted(candidates, key=lambda sess: sess.started_at, reverse=True)
    for sess in candidates:
        if any(turn.question for turn in sess.turns.values()):
            return sess
    return None


def _delete_existing_turns(session_id: int) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM review_turns WHERE session_id = ?", (session_id,))
        conn.execute(
            "UPDATE review_sessions SET turn_count = 0, updated_at = ? WHERE id = ?",
            (time.time(), session_id),
        )
        conn.commit()


def recover_session(
    log_session: LogSession,
    *,
    session_id: Optional[int],
    overwrite: bool,
    dry_run: bool,
) -> int:
    turns = [turn for turn in log_session.turns.values() if turn.question.strip()]
    if not turns:
        raise RuntimeError("日志会话里没有可恢复的问题")

    if session_id is None:
        if dry_run:
            return 0
        session_id = review.create_session(
            started_at=log_session.started_at,
            interviewer_enabled=True,
            candidate_enabled=True,
            source="log_recovery",
            title="日志恢复的面试复盘",
        )
    else:
        detail = review.get_session_detail(session_id)
        if detail is None:
            raise RuntimeError(f"review session 不存在: {session_id}")
        if detail.get("turn_count", 0) > 0 and not overwrite:
            raise RuntimeError(f"session {session_id} 已有 turns；如需重建请加 --overwrite")
        if not dry_run:
            _delete_existing_turns(session_id)

    for idx, turn in enumerate(turns, start=1):
        candidate_answer = turn.candidate_answer
        is_partial = not candidate_answer or not turn.answer_done
        if dry_run:
            print(
                f"[DRY] #{idx} {turn.qa_id} partial={is_partial} "
                f"question={turn.question[:80]!r} candidate_chars={len(candidate_answer)}"
            )
            continue
        review.add_turn(
            session_id=session_id,
            qa_id=turn.qa_id,
            seq=idx,
            question_text=turn.question,
            candidate_answer_text=candidate_answer,
            reference_answer_text=turn.reference_answer,
            duration_ms=0,
            is_partial=is_partial,
            analysis_status="pending",
        )

    if not dry_run:
        ended_at = log_session.ended_at or log_session.last_event_at or time.time()
        status = "partial_capture" if any(
            (not turn.candidate_answer) or (not turn.answer_done)
            for turn in turns
        ) else "completed"
        review.end_session(session_id=session_id, status=status, ended_at=ended_at)
    return int(session_id or 0)


def main() -> None:
    backend_dir = Path(__file__).resolve().parent.parent
    default_log = backend_dir.parent / "log" / "interview.log"
    parser = argparse.ArgumentParser(description="Recover review turns from interview.log")
    parser.add_argument("--log", default=str(default_log), help="interview.log path")
    parser.add_argument("--session-id", type=int, default=None, help="existing review session id")
    parser.add_argument("--since", default="", help='start time, e.g. "2026-06-24 10:48:35"')
    parser.add_argument("--until", default="", help='end time, e.g. "2026-06-24 11:40:00"')
    parser.add_argument("--overwrite", action="store_true", help="replace existing turns for session")
    parser.add_argument("--dry-run", action="store_true", help="show recovered turns without writing")
    args = parser.parse_args()

    log_path = Path(args.log)
    if not log_path.exists():
        raise SystemExit(f"日志不存在: {log_path}")

    target_session = None
    if args.session_id is not None:
        target_session = review.get_session_detail(args.session_id)
        if target_session is None:
            raise SystemExit(f"review session 不存在: {args.session_id}")
    elif not args.since:
        target_session = review.get_current_session()

    since = _parse_datetime(args.since) if args.since else None
    until = _parse_datetime(args.until) if args.until else None
    started_at = float(target_session["started_at"]) if target_session else since

    sessions = parse_log_sessions(log_path, until=until)
    selected = select_log_session(
        sessions,
        started_at=started_at,
        since=since,
        until=until,
    )
    if selected is None:
        raise SystemExit("没有找到匹配的日志会话")

    target_id = args.session_id or (int(target_session["id"]) if target_session else None)
    print(
        "选中日志会话: "
        f"start={datetime.fromtimestamp(selected.started_at).strftime(TS_FORMAT)} "
        f"last={datetime.fromtimestamp(selected.last_event_at or selected.started_at).strftime(TS_FORMAT)} "
        f"turns={len(selected.turns)} target_session={target_id or 'new'}"
    )
    recovered_id = recover_session(
        selected,
        session_id=target_id,
        overwrite=args.overwrite,
        dry_run=args.dry_run,
    )
    if args.dry_run:
        print("[DRY] 未写入数据库")
    else:
        print(f"[OK] 已恢复到 review session {recovered_id}")


if __name__ == "__main__":
    main()
