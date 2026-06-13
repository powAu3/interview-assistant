#!/usr/bin/env python3
"""One-click launcher: install backend/frontend deps, then start desktop mode.

Usage:
    python quick-start.py                  # install + start on port 18080
    python quick-start.py --port 9090      # install + start on a custom port
    python quick-start.py --install-only   # only install dependencies
    python quick-start.py --skip-install   # start immediately

The backend runs on 0.0.0.0 so mobile devices on the same LAN can
also access via http://<your-ip>:<port>.  A scannable QR code is
available in the web UI settings panel.
"""

import argparse
import ctypes
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


def build_start_command(extra_args: list[str]) -> list[str]:
    return [
        sys.executable,
        os.path.join(ROOT, "start.py"),
        "--mode",
        "desktop",
        "--rebuild",
        *extra_args,
    ]


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


def _get_json(url: str, timeout: float = 2.0) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            import json

            return json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
    except (OSError, urllib.error.URLError, ValueError):
        return None


def _wait_for_app_ready(port: int, timeout_sec: int = DEFAULT_READY_TIMEOUT_SEC) -> bool:
    deadline = time.monotonic() + max(5, timeout_sec)
    base = f"http://127.0.0.1:{port}"
    print(f"[...] 等待桌面应用加载完成 (端口 {port})...")
    while time.monotonic() < deadline:
        if _get_json(f"{base}/api/options", timeout=1.5) is not None:
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
    cmd = build_start_command(extra_args)
    if _is_windows() and not foreground:
        env = {**os.environ, HIDE_CONSOLE_ENV: "1"}
        subprocess.Popen(
            cmd,
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            creationflags=_hidden_creationflags(),
        )
        port = _extract_port(extra_args)
        if _wait_for_app_ready(port):
            print("[OK] 桌面应用已加载完成，命令行窗口即将隐藏。")
            _hide_console_window()
        else:
            print("[WARN] 桌面应用启动等待超时，保留命令行窗口便于查看。")
        return 0

    return subprocess.call(cmd, cwd=ROOT)


def parse_args(argv: list[str]) -> tuple[argparse.Namespace, list[str]]:
    parser = argparse.ArgumentParser(
        description="面试助手一键启动器：先安装依赖，再启动桌面模式。未知参数会继续传给 start.py。",
    )
    parser.add_argument("--skip-install", action="store_true", help="跳过 install 步骤，直接启动")
    parser.add_argument("--install-only", action="store_true", help="只安装依赖，不启动应用")
    parser.add_argument("--foreground", action="store_true", help="Windows 下也保留命令行窗口并显示启动日志")
    return parser.parse_known_args(argv)


def main(argv: list[str] | None = None) -> int:
    args, start_args = parse_args(sys.argv[1:] if argv is None else argv)

    if not args.skip_install:
        if not install_dependencies():
            return 1

    if args.install_only:
        return 0

    return launch_start_command(start_args, foreground=args.foreground)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
