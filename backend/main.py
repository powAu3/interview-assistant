import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from core.config import get_config
from services.stt import get_stt_engine
from api.realtime import ws
from api import common, assist, practice, analytics, resume, jobs

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


class _SuppressStealthScreenAccessLog(logging.Filter):
    """手机「左屏审题」请求不写 access 日志，减少终端刷新导致 macOS 把终端抢到前台。"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        return "ask-from-server-screen" not in msg


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger("uvicorn.access").addFilter(_SuppressStealthScreenAccessLog())
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    ws.init_broadcast(loop, queue)
    dispatch_task = asyncio.create_task(ws.ws_dispatcher())
    threading.Thread(target=_preload_stt, daemon=True).start()
    yield
    assist.stop_interview_loop()
    dispatch_task.cancel()


def _preload_stt():
    try:
        cfg = get_config()
        engine = get_stt_engine()
        ws.broadcast({"type": "stt_status", "loaded": False, "loading": True})
        engine.load_model()
        ws.broadcast({"type": "stt_status", "loaded": True, "loading": False})
    except Exception as e:
        ws.broadcast({"type": "stt_status", "loaded": False, "loading": False, "error": str(e)})


app = FastAPI(title="学习助手", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(ws.router)
app.include_router(common.router, prefix="/api")
app.include_router(assist.router, prefix="/api")
app.include_router(practice.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(resume.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")


if os.path.isdir(FRONTEND_DIR):
    if os.path.isdir(os.path.join(FRONTEND_DIR, "assets")):
        app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Prevent path traversal: resolve to realpath and ensure under FRONTEND_DIR
        safe_dir = os.path.abspath(FRONTEND_DIR)
        file_path = os.path.abspath(os.path.join(FRONTEND_DIR, full_path))
        if not file_path.startswith(safe_dir):
            return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
