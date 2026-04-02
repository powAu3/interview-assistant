"""Centralized logging configuration.

Log files are written to <project_root>/log/ with daily rotation.
- interview.log  — transcription, answer, pipeline events
- error.log      — ERROR+ from all modules
- app.log        — general application log (INFO+)

Usage in any module:
    from core.logger import get_logger
    logger = get_logger(__name__)
"""

import logging
import os
import sys
from logging.handlers import TimedRotatingFileHandler

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROJECT_ROOT = os.path.dirname(_BACKEND_DIR)
LOG_DIR = os.path.join(_PROJECT_ROOT, "log")

_LOG_FORMAT = "%(asctime)s | %(levelname)-5s | %(name)s | %(message)s"
_LOG_DATE_FMT = "%Y-%m-%d %H:%M:%S"

_initialized = False


def _ensure_log_dir():
    os.makedirs(LOG_DIR, exist_ok=True)


def _make_file_handler(
    filename: str,
    level: int = logging.DEBUG,
    when: str = "midnight",
    backup_count: int = 30,
) -> TimedRotatingFileHandler:
    path = os.path.join(LOG_DIR, filename)
    handler = TimedRotatingFileHandler(
        path, when=when, backupCount=backup_count, encoding="utf-8"
    )
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_LOG_DATE_FMT))
    handler.suffix = "%Y-%m-%d"
    return handler


def setup_logging():
    """Call once at application startup (idempotent)."""
    global _initialized
    if _initialized:
        return
    _initialized = True

    _ensure_log_dir()

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    # --- interview.log: transcription / answer / pipeline ---
    interview_handler = _make_file_handler("interview.log", logging.DEBUG)
    logging.getLogger("interview").addHandler(interview_handler)
    logging.getLogger("interview").setLevel(logging.DEBUG)
    logging.getLogger("interview").propagate = False

    # --- error.log: ERROR+ from all modules ---
    error_handler = _make_file_handler("error.log", logging.ERROR)
    root.addHandler(error_handler)

    # --- app.log: general INFO+ ---
    app_handler = _make_file_handler("app.log", logging.INFO)
    root.addHandler(app_handler)

    # --- console: keep existing uvicorn style, WARNING+ for our code ---
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers if not isinstance(h, TimedRotatingFileHandler)):
        console = logging.StreamHandler(sys.stderr)
        console.setLevel(logging.WARNING)
        console.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_LOG_DATE_FMT))
        root.addHandler(console)


def get_logger(name: str) -> logging.Logger:
    """Return a module-level logger. Call setup_logging() once before using."""
    return logging.getLogger(name)


def get_interview_logger() -> logging.Logger:
    """Dedicated logger for interview events (transcription, answer, pipeline)."""
    return logging.getLogger("interview")
