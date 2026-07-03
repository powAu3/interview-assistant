from __future__ import annotations

import importlib
from pathlib import Path
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def test_offer_create_rejects_missing_application(tmp_path: Path, monkeypatch):
    jobs_router = importlib.import_module("api.jobs.router")
    from services.storage import job_tracker as jt

    monkeypatch.setattr(jt, "DB_PATH", str(tmp_path / "job_tracker.db"))
    jt.init_db()

    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api")

    with TestClient(app) as client:
        res = client.post("/api/job-tracker/offers", json={"application_id": 999})

    assert res.status_code == 404
    assert res.json()["detail"] == "Application not found"


def test_applications_include_review_summary_and_review_list(tmp_path: Path, monkeypatch):
    jobs_router = importlib.import_module("api.jobs.router")
    from services.storage import job_tracker as jt
    from services.storage import review
    import time

    monkeypatch.setattr(jt, "DB_PATH", str(tmp_path / "job_tracker.db"))
    monkeypatch.setattr(review, "DB_PATH", str(tmp_path / "review.db"))
    jt.init_db()
    review.init_db()

    app_row = jt.create_application({"company": "ACME", "position": "后端"})
    session_id = review.create_session(
        started_at=time.time() - 10,
        interviewer_enabled=True,
        candidate_enabled=True,
        application_id=app_row["id"],
        title="ACME 一面",
    )
    review.end_session(session_id, status="completed", ended_at=time.time())
    review.update_session_summary(session_id, "## 总结\n还不错", [], [], avg_score=7.5)

    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api")

    with TestClient(app) as client:
        list_res = client.get("/api/job-tracker/applications")
        reviews_res = client.get(f"/api/job-tracker/applications/{app_row['id']}/reviews")

    assert list_res.status_code == 200
    item = list_res.json()["items"][0]
    assert item["review_summary"]["review_count"] == 1
    assert item["review_summary"]["latest_review_id"] == session_id
    assert item["review_summary"]["latest_avg_score"] == 7.5

    assert reviews_res.status_code == 200
    review_item = reviews_res.json()["items"][0]
    assert review_item["id"] == session_id
    assert review_item["summary_preview"].startswith("## 总结")
