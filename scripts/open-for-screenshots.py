#!/usr/bin/env python3
"""打开浏览器到面试助手页面，便于截取界面截图并更新 docs/screenshots/。"""
import webbrowser

URL = "http://localhost:18080"

if __name__ == "__main__":
    print("正在打开浏览器:", URL)
    print("请先确保已启动应用（如 python start.py --mode network）")
    webbrowser.open(URL)
