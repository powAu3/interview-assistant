from __future__ import annotations

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.recover_review_from_logs import parse_log_sessions


def test_parse_log_sessions_recovers_question_and_candidate_answer(tmp_path: Path):
    log_path = tmp_path / "interview.log"
    log_path.write_text(
        "\n".join(
            [
                "2026-06-24 10:48:35 | INFO  | interview | INTERVIEW_START device=20000 loopback=False",
                "2026-06-24 10:49:01 | INFO  | interview | ASR_QUESTION turn=1 utterances=1 churn=False text='请介绍一下你的项目'",
                "2026-06-24 10:49:01 | INFO  | interview | ANSWER_START id=qa-1-100 model=demo source=conversation_loopback followup=False q='请介绍一下你的项目'",
                "2026-06-24 10:49:12 | INFO  | interview | CANDIDATE_ASR_PARTIAL segment=cand-1 qa_id=qa-1-100 provider=whisper raw=3.0s stt=800ms chars=4 text='我做了风控'",
                "2026-06-24 10:49:18 | INFO  | interview | CANDIDATE_ASR_FINAL segment=cand-1 qa_id=qa-1-100 provider=whisper raw=6.0s stt=900ms chars=15 replaced_partial=True text='我做了风控规则引擎'",
                "2026-06-24 10:49:20 | INFO  | interview | ANSWER_DONE id=qa-1-100 model=demo first_token=100ms total=1000ms answer_len=42 think_len=0",
            ]
        ),
        encoding="utf-8",
    )

    sessions = parse_log_sessions(log_path)

    assert len(sessions) == 1
    turns = list(sessions[0].turns.values())
    assert len(turns) == 1
    assert turns[0].qa_id == "qa-1-100"
    assert turns[0].question == "请介绍一下你的项目"
    assert turns[0].candidate_answer == "我做了风控规则引擎"
    assert turns[0].answer_done is True
