from __future__ import annotations

import asyncio
from pathlib import Path
import importlib
import sys


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

common_router = importlib.import_module("api.common.router")
ws_mod = importlib.import_module("api.realtime.ws")
assist_pipeline = importlib.import_module("api.assist.pipeline")


class DummyUpload:
    def __init__(self, filename: str, content: bytes):
        self.filename = filename
        self._content = content

    async def read(self) -> bytes:
        return self._content


def test_api_upload_resume_offloads_blocking_work_to_threadpool(monkeypatch):
    called: dict[str, object] = {}

    def fake_add_upload(content: bytes, filename: str):
        return {"ok": True, "filename": filename, "size": len(content)}

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        called["fn"] = fn
        called["args"] = args
        called["kwargs"] = kwargs
        return fn(*args, **kwargs)

    monkeypatch.setattr(common_router, "add_upload", fake_add_upload)
    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    result = asyncio.run(
        common_router.api_upload_resume(DummyUpload("resume.txt", b"hello world"))
    )

    assert called["fn"] is fake_add_upload
    assert called["args"] == (b"hello world", "resume.txt")
    assert result["ok"] is True


def test_broadcast_counts_and_drops_when_queue_is_full(monkeypatch):
    class InlineLoop:
        def call_soon_threadsafe(self, callback, *args):
            callback(*args)

    class FullQueue:
        def put_nowait(self, data):
            raise asyncio.QueueFull

    monkeypatch.setattr(ws_mod, "_loop", InlineLoop())
    monkeypatch.setattr(ws_mod, "_msg_queue", FullQueue())
    monkeypatch.setattr(ws_mod, "_broadcast_drop_count", 0, raising=False)

    ws_mod.broadcast({"type": "audio_level", "value": 0.42})

    assert ws_mod._broadcast_drop_count == 1


def test_submit_knowledge_record_uses_bounded_worker(monkeypatch):
    submitted: list[tuple[str, str]] = []

    class FakeWorker:
        def submit(self, question: str, answer: str) -> bool:
            submitted.append((question, answer))
            return True

    monkeypatch.setattr(assist_pipeline, "_knowledge_worker", FakeWorker(), raising=False)

    assert assist_pipeline._submit_knowledge_record("说说 Redis 持久化", "先讲 RDB，再讲 AOF") is True
    assert submitted == [("说说 Redis 持久化", "先讲 RDB，再讲 AOF")]
