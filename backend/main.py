import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from core.auth import (
    extract_token_from_headers,
    get_token,
    init_auth,
    is_auth_disabled,
    is_loopback_host,
    verify_token,
)
from core.config import get_config
from core.logger import setup_logging, get_logger
from services.stt import get_stt_engine
from api.realtime import ws
from api import common, assist, practice, analytics, resume, jobs

setup_logging()
_log = get_logger("app.main")

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


def _is_path_within_dir(base_dir: str, candidate_path: str) -> bool:
    try:
        base_abs = os.path.abspath(base_dir)
        candidate_abs = os.path.abspath(candidate_path)
        return os.path.commonpath([base_abs, candidate_abs]) == base_abs
    except ValueError:
        return False


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

    token = init_auth()
    if is_auth_disabled():
        _log.warning("AUTH DISABLED via IA_AUTH_DISABLE env (LAN access is open)")
    else:
        _log.info(
            "AUTH ready (loopback bypass; LAN clients must include token; len=%d)",
            len(token),
        )

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
    assist.init_background_workers()
    threading.Thread(target=_preload_stt, daemon=True).start()
    yield
    _log.info("SHUTDOWN cleaning up")
    assist.stop_interview_loop()
    assist.shutdown_background_workers()
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

# CORS: 显式允许 localhost / 私网地址,而非泛 ``*``。
# 「allow_credentials=True」与「allow_origins=['*']」并存会被浏览器拒绝。
_DEFAULT_ORIGIN_REGEX = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|\[::1\]|"
    r"10(\.\d{1,3}){3}|"
    r"192\.168(\.\d{1,3}){2}|"
    r"172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}"
    r")(:\d{1,5})?$"
)
_ALLOW_ORIGIN_REGEX = (
    os.environ.get("IA_CORS_REGEX") or _DEFAULT_ORIGIN_REGEX
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_ALLOW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 鉴权放行规则
_AUTH_BYPASS_PATH_PREFIXES = (
    "/assets/",
    "/static/",
)
_AUTH_BYPASS_EXACT = {
    "/",
    "/index.html",
    "/favicon.ico",
    "/robots.txt",
    "/api/auth/info",  # 仅环回返回真实 token,LAN 调用此处也不会泄露
}


def _request_needs_auth(path: str) -> bool:
    if path in _AUTH_BYPASS_EXACT:
        return False
    for prefix in _AUTH_BYPASS_PATH_PREFIXES:
        if path.startswith(prefix):
            return False
    # 仅 API 与 WebSocket(由路由内部校验)走鉴权
    if path.startswith("/api/"):
        return True
    return False


@app.middleware("http")
async def lan_auth_middleware(request: Request, call_next):
    if is_auth_disabled():
        return await call_next(request)
    path = request.url.path
    if not _request_needs_auth(path):
        return await call_next(request)
    client_host = request.client.host if request.client else None
    if is_loopback_host(client_host):
        return await call_next(request)
    token = extract_token_from_headers(request.headers.get("authorization"))
    if not token:
        token = request.query_params.get("token")
    if verify_token(token):
        return await call_next(request)
    return JSONResponse(
        {"detail": "未授权:LAN 访问需要在请求头 Authorization: Bearer 或 ?token= 中携带令牌。"},
        status_code=401,
    )


@app.get("/api/auth/info")
async def api_auth_info(request: Request):
    """返回当前会话的访问令牌。仅环回访问可拿到真实 token。"""
    client_host = request.client.host if request.client else None
    if is_auth_disabled():
        return {"required": False, "token": None}
    if not is_loopback_host(client_host):
        return JSONResponse(
            {"detail": "auth/info 仅允许环回访问,LAN 端请扫码获取带 token 的 URL。"},
            status_code=403,
        )
    return {"required": True, "token": get_token()}

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
        file_path = os.path.abspath(os.path.join(FRONTEND_DIR, full_path))
        if not _is_path_within_dir(FRONTEND_DIR, file_path):
            return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
