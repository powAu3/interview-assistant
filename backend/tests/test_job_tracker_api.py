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
