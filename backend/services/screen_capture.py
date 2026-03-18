"""本机主显示器左半屏截图：在独立子进程中执行，尽量不抢前台焦点（配合关闭该接口的 access 日志）。"""

from __future__ import annotations

import os
import subprocess
import sys


class ScreenCaptureError(Exception):
    """截屏不可用（无显示器、无权限、未安装 mss 等）。"""


def capture_primary_left_half_data_url() -> str:
    """
    在子进程内截取主显示器左半屏，返回 data:image/png;base64,...
    - Windows: CREATE_NO_WINDOW，不弹出控制台
    - 与主进程分离 session，降低终端/IDE 因本进程图形调用被抢焦点的概率
    """
    worker = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_screen_capture_worker.py")
    if not os.path.isfile(worker):
        raise ScreenCaptureError("截屏子进程脚本缺失")

    kwargs: dict = {
        "args": [sys.executable, worker],
        "capture_output": True,
        "timeout": 20,
        "stdin": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        # 不创建控制台窗口，避免闪屏与焦点扰动
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    else:
        kwargs["start_new_session"] = True

    try:
        proc = subprocess.run(**kwargs)
    except subprocess.TimeoutExpired as e:
        raise ScreenCaptureError("截屏子进程超时") from e
    except Exception as e:
        raise ScreenCaptureError(f"无法启动截屏子进程: {e}") from e

    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", errors="replace").strip() or f"exit {proc.returncode}"
        if proc.returncode == 2:
            raise ScreenCaptureError("缺少依赖 mss，请执行: pip install mss")
        if proc.returncode == 3:
            raise ScreenCaptureError("未检测到可用显示器（无图形界面或远程无头环境无法截屏）")
        raise ScreenCaptureError(
            "截屏失败。macOS 请在「隐私与安全性 → 屏幕录制」中允许运行后端的终端或 Python。"
            f" 详情: {err}"
        )

    raw = (proc.stdout or b"").decode("ascii", errors="strict").strip()
    if len(raw) < 100:
        raise ScreenCaptureError("截屏数据异常")
    return f"data:image/png;base64,{raw}"
