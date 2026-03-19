"""独立子进程内截屏，避免在主进程/终端线程上触发图形栈；Windows 下父进程用 CREATE_NO_WINDOW 启动，无控制台窗口。"""
from __future__ import annotations

import base64
import sys


def main() -> None:
    try:
        import mss
        import mss.tools
    except ImportError:
        print("mss missing", file=sys.stderr)
        sys.exit(2)
    try:
        with mss.mss() as sct:
            if len(sct.monitors) < 2:
                print("no monitor", file=sys.stderr)
                sys.exit(3)
            mon = sct.monitors[1]
            w, h = mon["width"], mon["height"]
            region = {
                "left": mon["left"],
                "top": mon["top"],
                "width": max(1, w // 2),
                "height": h,
            }
            shot = sct.grab(region)
            png = mss.tools.to_png(shot.rgb, shot.size)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    sys.stdout.buffer.write(base64.b64encode(png))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
