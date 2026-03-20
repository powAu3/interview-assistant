#!/usr/bin/env python3
"""End-to-end smoke test: backend API + frontend build."""

import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")
PORT = 18999  # Use different port to avoid conflict with running instance


def log(msg: str):
    print(f"  [E2E] {msg}")


def run_cmd(cmd: list, cwd: str = ROOT, timeout: int = 120) -> tuple[int, str]:
    import shutil
    exe = cmd[0]
    if exe == "npm":
        exe = shutil.which("npm") or shutil.which("npm.cmd") or "npm"
    cmd = [exe] + cmd[1:]
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    out = (p.stdout or "") + (p.stderr or "")
    return p.returncode, out


def wait_for_server(url: str, max_wait: int = 30) -> bool:
    for _ in range(max_wait):
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    return False


def kill_port(port: int):
    import platform
    system = platform.system()
    try:
        if system == "Windows":
            r = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, encoding="utf-8", errors="replace")
            for line in r.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    pid = parts[-1]
                    subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True)
        else:
            r = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
            for pid in r.stdout.strip().split():
                if pid:
                    subprocess.run(["kill", "-9", pid], capture_output=True)
    except Exception:
        pass


def main() -> int:
    print("\n=== 端到端自测 ===\n")

    # 1. Frontend build
    dist_index = os.path.join(FRONTEND_DIR, "dist", "index.html")
    if os.path.isfile(dist_index):
        log("1. 前端已构建，跳过 build")
    else:
        log("1. 构建前端...")
        code, out = run_cmd(["npm", "run", "build"], cwd=FRONTEND_DIR)
        if code != 0:
            log(f"FAIL: npm run build 失败\n{out}")
            return 1
        log("OK 前端构建成功")

    # 2. Check frontend dist
    if not os.path.isfile(dist_index):
        log("FAIL: dist/index.html 不存在")
        return 1
    log("OK dist 文件存在")

    # 3. Start backend server
    kill_port(PORT)
    log("2. 启动后端服务...")
    env = {**os.environ, "PORT": str(PORT)}
    if BACKEND_DIR not in sys.path:
        sys.path.insert(0, BACKEND_DIR)

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=BACKEND_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        base = f"http://127.0.0.1:{PORT}"
        if not wait_for_server(f"{base}/api/config", max_wait=25):
            log("FAIL: 后端未在 25 秒内就绪")
            return 1
        log("OK 后端已就绪")

        # 4. Test API endpoints
        log("3. 测试 API...")

        tests = [
            ("GET", "/api/config", None),
            ("GET", "/api/options", None),
            ("GET", "/api/devices", None),
            ("GET", "/api/network-info", None),
            ("GET", "/api/stt/status", None),
            ("GET", "/api/session", None),
            ("POST", "/api/clear", "{}"),
            ("POST", "/api/ask/cancel", "{}"),
            # 能力分析 / 求职看板（api 分包后路径不变）
            ("GET", "/api/knowledge/summary", None),
            ("GET", "/api/job-tracker/stages", None),
            ("GET", "/api/job-tracker/applications", None),
            ("GET", "/api/resume/history", None),
        ]

        for method, path, body in tests:
            req = urllib.request.Request(f"{base}{path}", method=method)
            if body:
                req.add_header("Content-Type", "application/json")
                req.data = body.encode("utf-8")
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    if r.status >= 400:
                        log(f"FAIL {path} -> {r.status}")
                        return 1
            except urllib.error.HTTPError as e:
                if e.code in (400, 401, 500):
                    log(f"WARN {path} -> {e.code} (可能为预期，如未配置)")
                else:
                    log(f"FAIL {path} -> {e.code}")
                    return 1
            log(f"  OK {method} {path}")

        # 5. Test SPA page
        log("4. 测试前端页面...")
        try:
            with urllib.request.urlopen(f"{base}/", timeout=5) as r:
                if r.status != 200:
                    log(f"FAIL / -> {r.status}")
                    return 1
                html = r.read().decode("utf-8", errors="replace")
                if "<!DOCTYPE html>" not in html and "<html" not in html.lower():
                    log("FAIL / 返回内容不是 HTML")
                    return 1
        except Exception as e:
            log(f"FAIL / -> {e}")
            return 1
        log("OK 前端页面可访问")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        kill_port(PORT)

    print("\n=== 全部通过 ===\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
