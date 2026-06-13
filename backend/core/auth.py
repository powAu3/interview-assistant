"""LAN 访问鉴权模块。

设计目标:
1. 默认本地无感:未显式开启时完全跳过鉴权,避免影响 localhost / Vite 开发流。
2. 局域网模式安全:设置 ``IA_AUTH_ENABLE=1`` 后生成 Bearer token,非环回(loopback)请求需带 token。
3. 本地仍放行:鉴权开启时 127.0.0.1 / ::1 / localhost 直接放行,无需 token。
4. 可关闭(临时调试):设置环境变量 ``IA_AUTH_DISABLE=1`` 强制跳过鉴权。
5. token 来源优先级:``IA_AUTH_TOKEN`` 环境变量 > 自动生成。设置 ``IA_AUTH_TOKEN`` 也会隐式开启鉴权。
6. token 通过 ``Authorization: Bearer`` HTTP 头或 ``?token=`` 查询参数传递。
   WebSocket 仅支持查询参数。
"""
from __future__ import annotations

import ipaddress
import os
import secrets
from typing import Optional
from urllib.parse import urlparse

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}

_token: Optional[str] = None
_initialized = False


def _env_truthy(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in ("1", "true", "yes", "on")


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
    if _env_truthy("IA_AUTH_DISABLE"):
        return True
    if _env_truthy("IA_AUTH_ENABLE"):
        return False
    return not bool((os.environ.get("IA_AUTH_TOKEN") or "").strip())


def is_loopback_host(host: Optional[str]) -> bool:
    """判断客户端 host 是否环回。

    安全默认:host 为空字符串 / None(无法识别客户端)时一律视为非环回,
    强制走鉴权路径,避免在反向代理 / 异常 ASGI 场景下绕过 LAN token。
    """
    if not host:
        return False
    h = host.strip().lower()
    if not h:
        return False
    if h in _LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


def _default_port_for_scheme(scheme: Optional[str]) -> int:
    return 443 if (scheme or "").lower() in ("https", "wss") else 80


def origin_allows_loopback_bypass(
    origin: Optional[str],
    request_host: Optional[str],
    request_scheme: str = "http",
    request_port: Optional[int] = None,
) -> bool:
    """Loopback auth bypass is only safe for non-browser or same-origin requests."""
    if not origin:
        # CLI/local service calls usually do not send Origin. Allow them only after
        # client_host has already been proven loopback by loopback_bypass_allowed().
        return True
    try:
        parsed = urlparse(origin)
        origin_port = parsed.port or _default_port_for_scheme(parsed.scheme)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    if not is_loopback_host(parsed.hostname):
        return False
    if not is_loopback_host(request_host):
        return False
    effective_request_port = request_port or _default_port_for_scheme(request_scheme)
    return origin_port == effective_request_port


def loopback_bypass_allowed(
    client_host: Optional[str],
    origin: Optional[str],
    request_host: Optional[str],
    request_scheme: str = "http",
    request_port: Optional[int] = None,
) -> bool:
    return is_loopback_host(client_host) and origin_allows_loopback_bypass(
        origin,
        request_host,
        request_scheme,
        request_port,
    )


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
