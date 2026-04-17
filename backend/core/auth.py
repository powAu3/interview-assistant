"""LAN 访问鉴权模块。

设计目标:
1. 默认安全:启动时生成一次性 Bearer token,非环回(loopback)请求需带 token。
2. 不影响本地开发:127.0.0.1 / ::1 / localhost 直接放行,无需 token。
3. 可关闭(临时调试):设置环境变量 ``IA_AUTH_DISABLE=1`` 完全跳过鉴权。
4. token 来源优先级:``IA_AUTH_TOKEN`` 环境变量 > 自动生成。
5. token 通过 ``Authorization: Bearer`` HTTP 头或 ``?token=`` 查询参数传递。
   WebSocket 仅支持查询参数。
"""
from __future__ import annotations

import ipaddress
import os
import secrets
from typing import Optional

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", ""}

_token: Optional[str] = None
_initialized = False


def _resolve_token() -> str:
    env_token = (os.environ.get("IA_AUTH_TOKEN") or "").strip()
    if env_token:
        return env_token
    return secrets.token_urlsafe(24)


def init_auth() -> str:
    """Initialize auth token (idempotent). Returns the active token."""
    global _token, _initialized
    if not _initialized:
        _token = _resolve_token()
        _initialized = True
    return _token or ""


def get_token() -> str:
    if not _initialized:
        init_auth()
    return _token or ""


def is_auth_disabled() -> bool:
    return (os.environ.get("IA_AUTH_DISABLE") or "").strip() in ("1", "true", "yes", "on")


def is_loopback_host(host: Optional[str]) -> bool:
    if host is None:
        return True
    h = host.strip().lower()
    if h in _LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


def verify_token(candidate: Optional[str]) -> bool:
    if not candidate:
        return False
    expected = get_token()
    if not expected:
        return False
    return secrets.compare_digest(candidate.strip(), expected)


def extract_token_from_headers(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None
