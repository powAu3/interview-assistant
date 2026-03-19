"""运行时数据目录：统一放在 backend/data/，并从旧版 backend/*.db 自动迁移一次。"""

from __future__ import annotations

import os

_STORAGE_PKG = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.abspath(os.path.join(_STORAGE_PKG, "..", ".."))


def backend_root() -> str:
    return _BACKEND_ROOT


def data_dir() -> str:
    d = os.path.join(_BACKEND_ROOT, "data")
    os.makedirs(d, exist_ok=True)
    return d


def sqlite_path(filename: str) -> str:
    """
    SQLite 文件路径（仅文件名，如 knowledge.db）。
    若 data/ 下不存在而 backend 根目录存在同名旧库，则整体迁移 .db 及 -wal/-shm。
    """
    d = data_dir()
    new_p = os.path.join(d, filename)
    old_p = os.path.join(_BACKEND_ROOT, filename)
    if not os.path.isfile(new_p) and os.path.isfile(old_p):
        try:
            os.replace(old_p, new_p)
            for ext in ("-wal", "-shm"):
                o2 = old_p + ext
                n2 = new_p + ext
                if os.path.isfile(o2):
                    try:
                        os.replace(o2, n2)
                    except OSError:
                        pass
        except OSError:
            pass
    return new_p
