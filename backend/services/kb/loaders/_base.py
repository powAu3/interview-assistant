"""Loader 基础设施：Protocol + 注册表 + 调度。"""
from __future__ import annotations

from pathlib import Path
from typing import Optional, Protocol, runtime_checkable

from ..types import RawDoc


@runtime_checkable
class Loader(Protocol):
    name: str
    extensions: tuple[str, ...]

    def load(self, file_path: Path, *, rel_path: str) -> RawDoc: ...


_REGISTRY: list[Loader] = []


def register(loader: Loader) -> None:
    _REGISTRY.append(loader)


def dispatch_loader(file_path: Path) -> Optional[Loader]:
    ext = file_path.suffix.lower()
    for loader in _REGISTRY:
        if ext in loader.extensions:
            return loader
    return None


def registered_loaders() -> list[Loader]:
    return list(_REGISTRY)


def clear_registry() -> None:
    """测试用：清空已注册的 loader。"""
    _REGISTRY.clear()
