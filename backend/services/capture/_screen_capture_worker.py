"""独立子进程内截屏，避免在主进程/终端线程上触发图形栈；Windows 下父进程用 CREATE_NO_WINDOW 启动，无控制台窗口。
支持区域：full, left_half, right_half, top_half, bottom_half（通过 argv[1] 传入）。"""
from __future__ import annotations

import base64
import sys


def _region_for_monitor(mon: dict, kind: str) -> dict:
    """根据 kind 计算主显示器上的截取区域。"""
    left, top = mon["left"], mon["top"]
    w, h = mon["width"], mon["height"]
    if kind == "full":
        return {"left": left, "top": top, "width": w, "height": h}
    if kind == "left_half":
        return {"left": left, "top": top, "width": max(1, w // 2), "height": h}
    if kind == "right_half":
        half = w // 2
        return {"left": left + half, "top": top, "width": max(1, w - half), "height": h}
    if kind == "top_half":
        return {"left": left, "top": top, "width": w, "height": max(1, h // 2)}
    if kind == "bottom_half":
        half = h // 2
        return {"left": left, "top": top + half, "width": w, "height": max(1, h - half)}
    # 默认左半屏
    return {"left": left, "top": top, "width": max(1, w // 2), "height": h}


def main() -> None:
    try:
        import mss
        import mss.tools
    except ImportError:
        print("mss missing", file=sys.stderr)
        sys.exit(2)
    region_kind = (sys.argv[1] or "left_half").strip() if len(sys.argv) > 1 else "left_half"
    if region_kind not in ("full", "left_half", "right_half", "top_half", "bottom_half"):
        region_kind = "left_half"
    try:
        with mss.mss() as sct:
            if len(sct.monitors) < 2:
                print("no monitor", file=sys.stderr)
                sys.exit(3)
            mon = sct.monitors[1]
            region = _region_for_monitor(mon, region_kind)
            shot = sct.grab(region)
            png = mss.tools.to_png(shot.rgb, shot.size)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    sys.stdout.buffer.write(base64.b64encode(png))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
