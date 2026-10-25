#!/usr/bin/env python3
"""One-click launcher: install backend/frontend deps, then start desktop mode.

Usage:
    python quick-start.py                  # first run installs deps, later runs start directly
    python quick-start.py --port 9090      # start on a custom port
    python quick-start.py --install-only   # only install dependencies
    python quick-start.py --force-install  # force pip/npm install again
    python quick-start.py --skip-install   # start immediately (same as an installed run)

依赖只在首次（或 requirements.txt / package.json 变化、node_modules 被删、
换了 Python 环境）时安装；之后每次启动直接进桌面模式，不再等 pip/npm。

The backend runs on 0.0.0.0 so mobile devices on the same LAN can
also access via http://<your-ip>:<port>.  A scannable QR code is
available in the web UI settings panel.
"""

import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")
DESKTOP_DIR = os.path.join(ROOT, "desktop")
REQUIREMENTS = os.path.join(BACKEND_DIR, "requirements.txt")
FRONTEND_PACKAGE_JSON = os.path.join(FRONTEND_DIR, "package.json")
INSTALL_MARKER = os.path.join(ROOT, ".quickstart-install.json")
HIDE_CONSOLE_ENV = "IA_HIDE_CONSOLE"
DEFAULT_PORT = 18080
DEFAULT_READY_TIMEOUT_SEC = 180


def _find_npm() -> str | None:
    return shutil.which("npm") or shutil.which("npm.cmd")


def _print_node_help() -> None:
    print("[ERROR] 未找到 npm。请先安装 Node.js 18+，然后重新运行 quick-start.py。")
    print("  下载: https://nodejs.org")


def _run_step(label: str, cmd: list[str], cwd: str) -> bool:
    print(f"[...] {label}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        print(f"[ERROR] {label} 失败")
        return False
    return True


def install_dependencies() -> bool:
    """Install Python and frontend dependencies before launching.

    Electron desktop dependencies are intentionally NOT installed here.
    `start.py --mode desktop` already owns that responsibility via
    `ensure_electron()`, which avoids duplicate install flows and reduces
    the chance of Electron postinstall interruptions during quick start.
    """
    npm = _find_npm()
    if npm is None:
        _print_node_help()
        return False

    steps = [
        ("安装后端 Python 依赖", [sys.executable, "-m", "pip", "install", "-r", REQUIREMENTS], ROOT),
        ("安装前端 npm 依赖", [npm, "install"], FRONTEND_DIR),
    ]
    for label, cmd, cwd in steps:
        if not _run_step(label, cmd, cwd):
            return False
    print("[OK] install 步骤完成")
    return True


# ---------------------------------------------------------------------------
# 安装标记：装过就不再跑 pip/npm（依赖清单/环境变化时自动失效）
# ---------------------------------------------------------------------------

def _install_fingerprint() -> str:
    """依赖指纹：Python 解释器 + requirements/package.json 内容 + node_modules 是否存在。"""
    h = hashlib.sha256()
    h.update(sys.executable.encode("utf-8", errors="replace"))
    h.update(f"py{sys.version_info.major}.{sys.version_info.minor}".encode())
    for path in (REQUIREMENTS, FRONTEND_PACKAGE_JSON, os.path.join(FRONTEND_DIR, "package-lock.json")):
        try:
            with open(path, "rb") as f:
                h.update(f.read())
        except OSError:
            h.update(b"missing:" + path.encode("utf-8", errors="replace"))
    h.update(b"node_modules=" + (b"1" if os.path.isdir(os.path.join(FRONTEND_DIR, "node_modules")) else b"0"))
    return h.hexdigest()[:16]


def _install_is_done() -> bool:
    try:
        with open(INSTALL_MARKER, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return False
    return isinstance(data, dict) and data.get("fingerprint") == _install_fingerprint()


def _mark_install_done() -> None:
    try:
        with open(INSTALL_MARKER, "w", encoding="utf-8") as f:
            json.dump({"fingerprint": _install_fingerprint(), "at": time.strftime("%Y-%m-%d %H:%M:%S")}, f)
    except OSError:
        pass


def _frontend_needs_rebuild() -> bool:
    """dist 不存在或前端源码比 dist 新时才重建，避免每次启动都全量 vite build。"""
    dist_index = os.path.join(FRONTEND_DIR, "dist", "index.html")
    if not os.path.isfile(dist_index):
        return True
    try:
        dist_mtime = os.path.getmtime(dist_index)
    except OSError:
        return True

    candidates = [
        os.path.join(FRONTEND_DIR, "package.json"),
        os.path.join(FRONTEND_DIR, "index.html"),
        os.path.join(FRONTEND_DIR, "vite.config.ts"),
        os.path.join(FRONTEND_DIR, "tailwind.config.js"),
    ]
    src_dir = os.path.join(FRONTEND_DIR, "src")
    for dirpath, dirnames, filenames in os.walk(src_dir):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        candidates.extend(os.path.join(dirpath, name) for name in filenames)
    for path in candidates:
        try:
            if os.path.getmtime(path) > dist_mtime:
                return True
        except OSError:
            continue
    return False


def build_start_command(extra_args: list[str], *, rebuild: bool) -> list[str]:
    cmd = [
        sys.executable,
        os.path.join(ROOT, "start.py"),
        "--mode",
        "desktop",
    ]
    if rebuild:
        cmd.append("--rebuild")
    cmd.extend(extra_args)
    return cmd


def _is_windows() -> bool:
    return os.name == "nt"


def _hidden_creationflags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)


def _hide_console_window() -> None:
    if not _is_windows():
        return
    try:
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            time.sleep(0.25)
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        pass


def _extract_port(extra_args: list[str]) -> int:
    for i, arg in enumerate(extra_args):
        if arg == "--port" and i + 1 < len(extra_args):
            try:
                return int(extra_args[i + 1])
            except ValueError:
                return DEFAULT_PORT
        if arg.startswith("--port="):
            try:
                return int(arg.split("=", 1)[1])
            except ValueError:
                return DEFAULT_PORT
    return DEFAULT_PORT


def _current_primary_stt_provider() -> str:
    try:
        import json

        with open(os.path.join(BACKEND_DIR, "config.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        return str(data.get("stt_provider") or "whisper").strip().lower()
    except Exception:
        return "whisper"


def _app_reachable(url: str, timeout: float = 1.5) -> bool:
    """端口上有 HTTP 响应即认为服务已起（401/404 也算，鉴权无关）。"""
    try:
        with urllib.request.urlopen(url, timeout=timeout):
            return True
    except urllib.error.HTTPError:
        return True
    except (OSError, ValueError):
        return False


def _get_json(url: str, timeout: float = 2.0) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            import json

            return json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
    except (OSError, urllib.error.URLError, ValueError):
        return None


STARTUP_LOG = os.path.join(ROOT, "log", "startup-console.log")


def _print_startup_log_tail(lines_n: int = 20) -> None:
    try:
        with open(STARTUP_LOG, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return
    tail = "\n".join(content.splitlines()[-lines_n:])[-2400:]
    if tail.strip():
        print("-" * 56)
        print(tail)
        print("-" * 56)
        print(f"  完整日志: {STARTUP_LOG}")


def _wait_for_app_ready(port: int, timeout_sec: int = DEFAULT_READY_TIMEOUT_SEC) -> bool:
    deadline = time.monotonic() + max(5, timeout_sec)
    base = f"http://127.0.0.1:{port}"
    print(f"[...] 等待桌面应用加载完成 (端口 {port})...")
    while time.monotonic() < deadline:
        if _app_reachable(f"{base}/api/options"):
            break
        time.sleep(0.5)
    else:
        return False

    if _current_primary_stt_provider() != "whisper":
        return True

    while time.monotonic() < deadline:
        status = _get_json(f"{base}/api/stt/status", timeout=1.5)
        if status and status.get("loaded") and not status.get("loading"):
            return True
        time.sleep(0.8)
    return False


def launch_start_command(extra_args: list[str], *, foreground: bool = False) -> int:
    rebuild = _frontend_needs_rebuild()
    if not rebuild:
        print("[OK] 前端 dist 未过期，跳过重建（改过前端源码会自动重建）")
    cmd = build_start_command(extra_args, rebuild=rebuild)
    if _is_windows() and not foreground:
        env = {**os.environ, HIDE_CONSOLE_ENV: "1"}
        try:
            os.makedirs(os.path.dirname(STARTUP_LOG), exist_ok=True)
            logf = open(STARTUP_LOG, "ab")
        except OSError:
            logf = subprocess.DEVNULL
        proc = subprocess.Popen(
            cmd,
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=logf,
            stderr=subprocess.STDOUT,
            env=env,
            creationflags=_hidden_creationflags(),
        )
        if hasattr(logf, "close"):
            logf.close()
        port = _extract_port(extra_args)
        if _wait_for_app_ready(port):
            # 隐藏后必须驻留：python 一退出，cmd 就会把窗口画回来。
            # 驻留期间替应用占住这个隐藏控制台；应用退出（托盘退出/关窗）
            # 后本进程结束，交互式 cmd 恢复提示符，bat 场景整窗关闭。
            print("[OK] 桌面应用已加载完成，窗口已隐藏（关闭应用后本窗口恢复）。")
            _hide_console_window()
            try:
                proc.wait()
            except KeyboardInterrupt:
                pass
            return 0
        print("[ERROR] 桌面应用启动失败，最近输出：")
        _print_startup_log_tail()
        print("  常见原因：端口被占用 / 依赖缺失 / 前端构建失败。")
        try:
            input("  按回车关闭窗口...")
        except EOFError:
            time.sleep(5)
        return 1

    return subprocess.call(cmd, cwd=ROOT)


def parse_args(argv: list[str]) -> tuple[argparse.Namespace, list[str]]:
    parser = argparse.ArgumentParser(
        description="面试助手一键启动器：首次自动安装依赖，之后直接启动桌面模式。未知参数会继续传给 start.py。",
    )
    parser.add_argument("--skip-install", action="store_true", help="跳过 install 步骤，直接启动")
    parser.add_argument("--force-install", action="store_true", help="强制重新执行 pip/npm 安装")
    parser.add_argument("--install-only", action="store_true", help="只安装依赖，不启动应用")
    parser.add_argument("--foreground", action="store_true", help="Windows 下也保留命令行窗口并显示启动日志")
    return parser.parse_known_args(argv)


def main(argv: list[str] | None = None) -> int:
    args, start_args = parse_args(sys.argv[1:] if argv is None else argv)

    if not args.skip_install:
        if args.force_install or not _install_is_done():
            if not install_dependencies():
                return 1
            _mark_install_done()
        else:
            print("[OK] 依赖此前已安装且无变化，跳过 pip/npm（--force-install 可强制重装）")

    if args.install_only:
        return 0

    return launch_start_command(start_args, foreground=args.foreground)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
