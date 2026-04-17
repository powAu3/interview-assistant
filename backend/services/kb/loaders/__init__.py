"""KB loaders —— 把各种文件格式转成统一的 RawDoc。导入即注册。"""
from ._base import (  # noqa: F401
    Loader,
    clear_registry,
    dispatch_loader,
    register,
    registered_loaders,
)
from . import markdown as _markdown  # noqa: F401
from . import txt as _txt  # noqa: F401
from . import docx as _docx  # noqa: F401
from . import pdf as _pdf  # noqa: F401

__all__ = [
    "Loader",
    "clear_registry",
    "dispatch_loader",
    "register",
    "registered_loaders",
]
