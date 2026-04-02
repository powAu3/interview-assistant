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
from core.logger import setup_logging, get_logger
from services.stt import get_stt_engine
from api.realtime import ws
from api import common, assist, practice, analytics, resume, jobs

setup_logging()
_log = get_logger("app.main")

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

    cfg = get_config()
    models_summary = ", ".join(
        f"{m.name}({'on' if m.enabled else 'off'})" for m in cfg.models
    )
    _log.info(
        "CONFIG stt=%s position=%s lang=%s models=[%s] temp=%.1f max_tokens=%d think=%s",
        cfg.stt_provider, cfg.position, cfg.language,
        models_summary, cfg.temperature, cfg.max_tokens, cfg.think_mode,
    )

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    ws.init_broadcast(loop, queue)
    dispatch_task = asyncio.create_task(ws.ws_dispatcher())
    threading.Thread(target=_preload_stt, daemon=True).start()
    yield
    _log.info("SHUTDOWN cleaning up")
    assist.stop_interview_loop()
    dispatch_task.cancel()


def _preload_stt():
    try:
        cfg = get_config()
        engine = get_stt_engine()
        _log.info("STT preload start provider=%s", cfg.stt_provider)
        ws.broadcast({"type": "stt_status", "loaded": False, "loading": True})
        engine.load_model()
        _log.info("STT preload done provider=%s", cfg.stt_provider)
        ws.broadcast({"type": "stt_status", "loaded": True, "loading": False})
    except Exception as e:
        _log.error("STT preload failed: %s", e, exc_info=True)
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
