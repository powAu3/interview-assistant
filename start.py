#!/usr/bin/env python3
"""One-click startup script for AI Interview Assistant."""

import argparse
import os
import platform
import socket
import subprocess
import sys
import time
import threading
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")
FRONTEND_DIST = os.path.join(FRONTEND_DIR, "dist")


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def print_qrcode(url: str):
    try:
        import qrcode
        qr = qrcode.QRCode(box_size=1, border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except ImportError:
        print(f"  (安装 qrcode 库可显示二维码: pip install qrcode)")


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


def wait_for_server(port: int, timeout: float = 30) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/options", timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def start_server(host: str, port: int):
    os.chdir(BACKEND_DIR)
    if BACKEND_DIR not in sys.path:
        sys.path.insert(0, BACKEND_DIR)
    import uvicorn
    uvicorn.run("main:app", host=host, port=port, log_level="info", reload=False)


def create_tray_icon_image():
    """Create a small PIL Image for the system tray icon."""
    try:
        from PIL import Image, ImageDraw
        size = 64
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle([4, 4, size - 4, size - 4], radius=12, fill="#6366f1")
        cx, cy = size // 2, size // 2
        draw.rounded_rectangle([cx - 6, cy - 18, cx + 6, cy + 2], radius=5, fill="white")
        draw.arc([cx - 12, cy - 18, cx + 12, cy + 6], start=0, end=180, fill="white", width=2)
        draw.line([cx, cy + 6, cx, cy + 14], fill="white", width=2)
        draw.line([cx - 8, cy + 14, cx + 8, cy + 14], fill="white", width=2)
        return img
    except Exception:
        from PIL import Image
        return Image.new("RGBA", (64, 64), "#6366f1")


def run_desktop_mode(port: int):
    """Desktop mode: native GUI window with Boss Key hide support."""
    try:
        import webview
    except ImportError:
        print("[ERROR] 桌面 GUI 模式需要 pywebview")
        print("  安装: pip install pywebview")
        print("  或使用网络模式: python start.py --mode network")
        sys.exit(1)

    server_thread = threading.Thread(
        target=start_server, args=("127.0.0.1", port), daemon=True
    )
    server_thread.start()

    print("  等待服务启动...")
    if not wait_for_server(port):
        print("[ERROR] 服务启动超时")
        sys.exit(1)

    print("  服务就绪，启动 GUI 窗口...")
    print("  快捷键: Ctrl+B 隐藏窗口，通过系统托盘恢复")

    url = f"http://127.0.0.1:{port}"
    _visible = {"value": True}

    class BossKeyApi:
        def hide_window(self):
            if not _visible["value"]:
                return
            _visible["value"] = False
            window.hide()
            if platform.system() == "Darwin":
                try:
                    from AppKit import NSApp, NSApplicationActivationPolicyAccessory
                    NSApp.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
                except Exception:
                    pass

        def show_window(self):
            if _visible["value"]:
                return
            if platform.system() == "Darwin":
                try:
                    from AppKit import NSApp, NSApplicationActivationPolicyRegular
                    NSApp.setActivationPolicy_(NSApplicationActivationPolicyRegular)
                    NSApp.activateIgnoringOtherApps_(True)
                except Exception:
                    pass
            _visible["value"] = True
            window.show()
            window.restore()

    boss_api = BossKeyApi()

    window = webview.create_window(
        "学习助手",
        url,
        width=1200,
        height=800,
        resizable=True,
        min_size=(800, 500),
        text_select=True,
        js_api=boss_api,
    )

    def start_tray():
        try:
            import pystray
            icon_image = create_tray_icon_image()

            def on_show(icon, item):
                boss_api.show_window()

            def on_hide(icon, item):
                boss_api.hide_window()

            def on_quit(icon, item):
                icon.stop()
                window.destroy()

            tray = pystray.Icon(
                "interview-assistant",
                icon_image,
                "学习助手",
                menu=pystray.Menu(
                    pystray.MenuItem("显示窗口", on_show, default=True),
                    pystray.MenuItem("隐藏窗口 (Ctrl+B)", on_hide),
                    pystray.Menu.SEPARATOR,
                    pystray.MenuItem("退出", on_quit),
                ),
            )
            tray.run()
        except ImportError:
            print("  [提示] 安装 pystray 可启用系统托盘: pip install pystray")
        except Exception as e:
            print(f"  [提示] 系统托盘启动失败: {e}")

    def on_loaded():
        threading.Thread(target=start_tray, daemon=True).start()

    webview.start(func=on_loaded)


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
                        help="运行模式: desktop (原生 GUI 窗口) 或 network (局域网浏览器访问)")
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

    mode_label = "桌面 GUI 窗口" if args.mode == "desktop" else "局域网浏览器"
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
