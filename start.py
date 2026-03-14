#!/usr/bin/env python3
"""Unified launcher for the study assistant."""

import argparse
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")
FRONTEND_DIST = os.path.join(FRONTEND_DIR, "dist")
DESKTOP_DIR = os.path.join(ROOT, "desktop")


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _set_utf8_console():
    """Windows: switch active code page to UTF-8 so Unicode QR chars render."""
    if platform.system() != "Windows":
        return
    try:
        subprocess.run(["chcp", "65001"], capture_output=True, shell=True)
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass


def print_qrcode(url: str):
    _set_utf8_console()
    try:
        import qrcode
        qr = qrcode.QRCode(box_size=1, border=1)
        qr.add_data(url)
        qr.make(fit=True)
        try:
            qr.print_ascii(invert=True)
        except (UnicodeEncodeError, UnicodeDecodeError):
            print("  (二维码无法在当前终端显示，请直接访问上方链接)")
    except ImportError:
        print("  (安装 qrcode 库可显示二维码: pip install qrcode)")


def build_frontend():
    if os.path.isdir(FRONTEND_DIST):
        print("[OK] 前端已构建")
        return True
    print("[...] 构建前端...")
    if not os.path.isdir(os.path.join(FRONTEND_DIR, "node_modules")):
        print("  安装 npm 依赖...")
        r = subprocess.run(["npm", "install"], cwd=FRONTEND_DIR)
        if r.returncode != 0:
            print("[ERROR] npm install 失败")
            return False
    r = subprocess.run(["npm", "run", "build"], cwd=FRONTEND_DIR)
    if r.returncode != 0:
        print("[ERROR] 前端构建失败")
        return False
    print("[OK] 前端构建完成")
    return True


def ensure_electron():
    """Make sure desktop/node_modules/electron exists."""
    if os.path.isdir(os.path.join(DESKTOP_DIR, "node_modules", "electron")):
        return True
    print("[...] 安装 Electron 依赖...")
    r = subprocess.run(["npm", "install"], cwd=DESKTOP_DIR)
    return r.returncode == 0


def kill_port(port: int):
    """Kill any process occupying the given port."""
    system = platform.system()
    killed = False
    try:
        if system == "Windows":
            # netstat 找到 PID，再 taskkill
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True
            )
            for line in result.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    pid = parts[-1]
                    subprocess.run(["taskkill", "/F", "/PID", pid],
                                   capture_output=True)
                    print(f"[OK] 已终止占用端口 {port} 的进程 (PID {pid})")
                    killed = True
        else:
            # macOS / Linux: lsof
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True, text=True
            )
            pids = result.stdout.strip().split()
            for pid in pids:
                if pid:
                    subprocess.run(["kill", "-9", pid], capture_output=True)
                    print(f"[OK] 已终止占用端口 {port} 的进程 (PID {pid})")
                    killed = True
    except Exception as e:
        print(f"[WARN] 清理端口 {port} 时出错: {e}")
    if killed:
        time.sleep(0.5)  # 等待端口释放


def start_server(host: str, port: int):
    kill_port(port)
    os.chdir(BACKEND_DIR)
    if BACKEND_DIR not in sys.path:
        sys.path.insert(0, BACKEND_DIR)
    import uvicorn
    uvicorn.run("main:app", host=host, port=port, log_level="info", reload=False)


def run_desktop_mode(port: int):
    """Desktop mode: Electron window with content protection and global hotkeys."""
    npx = shutil.which("npx")
    if npx is None:
        print("[ERROR] 未找到 npx，请安装 Node.js")
        print("  或使用网络模式: python start.py --mode network")
        sys.exit(1)

    if not ensure_electron():
        print("[ERROR] Electron 安装失败")
        sys.exit(1)

    print("  启动 Electron 桌面模式...")
    print("  屏幕共享隐身: 已开启")
    print("  全局快捷键: Ctrl+B 显示/隐藏（任何时候都生效）")
    print("  系统托盘: 右键可切换置顶、隐身等选项")
    print()

    env = {**os.environ, "PORT": str(port)}
    proc = subprocess.run(
        [npx, "electron", "."],
        cwd=DESKTOP_DIR,
        env=env,
    )
    sys.exit(proc.returncode)


def run_network_mode(port: int):
    """Network mode: LAN accessible via browser."""
    ip = get_local_ip()
    local_url = f"http://localhost:{port}"
    network_url = f"http://{ip}:{port}"

    print(f"  局域网模式")
    print(f"  本机访问: {local_url}")
    print(f"  局域网访问: {network_url}")
    print()
    print("  手机扫码访问:")
    print_qrcode(network_url)

    start_server("0.0.0.0", port)


def main():
    parser = argparse.ArgumentParser(description="学习助手启动器")
    parser.add_argument("--mode", choices=["desktop", "network"], default="desktop",
                        help="运行模式: desktop (Electron 桌面窗口) 或 network (局域网浏览器访问)")
    parser.add_argument("--port", type=int, default=18080, help="服务端口 (默认 18080)")
    parser.add_argument("--no-build", action="store_true", help="跳过前端构建")
    args = parser.parse_args()

    print("=" * 50)
    print("  学习助手")
    print("=" * 50)
    print()

    if not args.no_build:
        if not build_frontend():
            print("\n前端构建失败，可以用 --no-build 跳过（需要先手动构建）")
            sys.exit(1)

    mode_label = "Electron 桌面窗口" if args.mode == "desktop" else "局域网浏览器"
    print()
    print(f"  平台: {platform.system()} {platform.machine()}")
    print(f"  模式: {mode_label}")
    print("=" * 50)
    print()

    if args.mode == "desktop":
        run_desktop_mode(args.port)
    else:
        run_network_mode(args.port)


if __name__ == "__main__":
    main()
