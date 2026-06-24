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
    loopback_bypass_allowed,
    origin_allows_loopback_bypass,
    verify_token,
)
from core.config import get_config
from core.env import env_int
from core.logger import setup_logging, get_logger
from services.stt import get_stt_engine
from api.realtime import ws
from api import common, assist, analytics, resume, jobs, review
from api import kb as kb_api

setup_logging()
_log = get_logger("app.main")

# H5: 扩大广播队列容量，避免 LLM 流式输出被截断
_BQ_SIZE = env_int("IA_BROADCAST_QUEUE_SIZE", 2000, minimum=1)

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
        _log.info("AUTH disabled (set IA_AUTH_ENABLE=1 or IA_AUTH_TOKEN to protect LAN access)")
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
    queue: asyncio.Queue = asyncio.Queue(maxsize=_BQ_SIZE)
    ws.init_broadcast(loop, queue)
    dispatch_task = asyncio.create_task(ws.ws_dispatcher())
    heartbeat_task = asyncio.create_task(ws.ws_heartbeat())
    assist.init_background_workers()
    threading.Thread(target=_preload_stt, daemon=True).start()
    assist.preload_candidate_asr_if_enabled()
    try:
        from services.storage.resume_history import restore_active_resume
        if restore_active_resume():
            _log.info("Resume auto-restored from history (id=%s)", cfg.resume_active_history_id)
    except Exception as e:
        _log.debug("Resume auto-restore skipped: %s", e)
    yield
    _log.info("SHUTDOWN cleaning up")
    assist.stop_interview_loop()
    assist.shutdown_background_workers()
    dispatch_task.cancel()
    heartbeat_task.cancel()


def _preload_stt():
    try:
        cfg = get_config()
        engine = get_stt_engine()
        _log.info("STT preload start provider=%s", cfg.stt_provider)
        is_remote = cfg.stt_provider in ("doubao", "generic")
        if not is_remote:
            ws.broadcast({"type": "stt_status", "loaded": False, "loading": True, "provider": cfg.stt_provider})
        engine.load_model()
        loaded = bool(engine.is_loaded) if not is_remote else True
        _log.info("STT preload done provider=%s loaded=%s", cfg.stt_provider, loaded)
        ws.broadcast({"type": "stt_status", "loaded": loaded, "loading": False, "provider": cfg.stt_provider})
    except Exception as e:
        _log.error("STT preload failed: %s", e, exc_info=True)
        ws.broadcast({"type": "stt_status", "loaded": False, "loading": False, "provider": get_config().stt_provider, "error": str(e)})
    try:
        from services.stt.factory import preload_whisper_fallback
        preload_whisper_fallback()
    except Exception as e:
        _log.debug("Whisper fallback preload skipped: %s", e)


app = FastAPI(title="学习助手", lifespan=lifespan)

# CORS: 默认只允许后端自身的 loopback origin。局域网扫码页面与桌面端均为同源访问,
# 不需要跨源；如确需单独前端直连后端，可通过 IA_CORS_REGEX 显式放宽。
# 「allow_credentials=True」与「allow_origins=['*']」并存会被浏览器拒绝。
_DEFAULT_CORS_PORT = env_int("PORT", 18080, minimum=1)
_DEFAULT_ORIGIN_REGEX = (
    rf"^https?://("
    rf"localhost|127\.0\.0\.1|\[::1\]"
    rf"):{_DEFAULT_CORS_PORT}$"
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


_AUTH_PROTECTED_EXACT = {
    "/docs",
    "/redoc",
    "/openapi.json",
}
_AUTH_PROTECTED_PREFIXES = (
    "/api/",
    "/docs/",   # FastAPI 子路径如 /docs/oauth2-redirect
    "/redoc/",
)


def _request_needs_auth(path: str) -> bool:
    if path in _AUTH_BYPASS_EXACT:
        return False
    for prefix in _AUTH_BYPASS_PATH_PREFIXES:
        if path.startswith(prefix):
            return False
    if path in _AUTH_PROTECTED_EXACT:
        return True
    for prefix in _AUTH_PROTECTED_PREFIXES:
        if path.startswith(prefix):
            return True
    return False


def _origin_allows_loopback_bypass(request: Request) -> bool:
    return origin_allows_loopback_bypass(
        request.headers.get("origin"),
        request.url.hostname,
        request.url.scheme,
        request.url.port,
    )


@app.middleware("http")
async def lan_auth_middleware(request: Request, call_next):
    if is_auth_disabled():
        return await call_next(request)
    path = request.url.path
    if not _request_needs_auth(path):
        return await call_next(request)
    client_host = request.client.host if request.client else None
    if loopback_bypass_allowed(
        client_host,
        request.headers.get("origin"),
        request.url.hostname,
        request.url.scheme,
        request.url.port,
    ):
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
app.include_router(analytics.router, prefix="/api")
app.include_router(resume.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(review.router, prefix="/api")
app.include_router(kb_api.router, prefix="/api")


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
