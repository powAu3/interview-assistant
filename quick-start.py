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
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")
DESKTOP_DIR = os.path.join(ROOT, "desktop")
REQUIREMENTS = os.path.join(BACKEND_DIR, "requirements.txt")


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


def parse_args(argv: list[str]) -> tuple[argparse.Namespace, list[str]]:
    parser = argparse.ArgumentParser(
        description="面试助手一键启动器：先安装依赖，再启动桌面模式。未知参数会继续传给 start.py。",
    )
    parser.add_argument("--skip-install", action="store_true", help="跳过 install 步骤，直接启动")
    parser.add_argument("--install-only", action="store_true", help="只安装依赖，不启动应用")
    return parser.parse_known_args(argv)


def main(argv: list[str] | None = None) -> int:
    args, start_args = parse_args(sys.argv[1:] if argv is None else argv)

    if not args.skip_install:
        if not install_dependencies():
            return 1

    if args.install_only:
        return 0

    return subprocess.call(build_start_command(start_args))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
