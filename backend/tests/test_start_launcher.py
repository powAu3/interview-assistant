"""start.py 桌面模式启动监控：成功隐藏窗口 / 失败保留窗口并展示日志。"""

import importlib.util
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
START = ROOT / "start.py"


def load_start():
    spec = importlib.util.spec_from_file_location("start_launcher", START)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _patch_common(monkeypatch, tmp_path, *, ready, poll_results):
    start = load_start()
    log_path = tmp_path / "startup-console.log"
    monkeypatch.setattr(start, "STARTUP_LOG", str(log_path))
    monkeypatch.setattr(start.platform, "system", lambda: "Windows")
    monkeypatch.setattr(start, "_app_ready", lambda port, timeout=1.5: ready())
    popen_calls = []

    class FakeProc:
        def __init__(self):
            self._polls = iter(poll_results)
            self.waited = False

        def poll(self):
            try:
                return next(self._polls)
            except StopIteration:
                return None

        def wait(self, timeout=None):
            self.waited = True
            return 0

    procs = []

    def _popen(*a, **k):
        proc = FakeProc()
        if "env" in k:
            # 只记录 respawn 的 Popen（kill_port 的 netstat/taskkill 没有 env kwarg）
            popen_calls.append(k)
            procs.append(proc)
        return proc

    monkeypatch.setattr(start.subprocess, "Popen", _popen)
    monkeypatch.setattr(start.time, "sleep", lambda *_a: None)
    hide_calls = []
    monkeypatch.setattr(start, "_hide_own_console", lambda: hide_calls.append(True))
    return start, popen_calls, hide_calls, log_path, procs


def test_desktop_run_hides_console_when_ready(monkeypatch, tmp_path):
    start, popen_calls, hide_calls, log_path, procs = _patch_common(
        monkeypatch, tmp_path, ready=lambda: True, poll_results=[None],
    )
    monkeypatch.setattr(start.os, "environ", {**os.environ})

    with pytest.raises(SystemExit) as ei:
        start.run_desktop_mode(18080)
    assert ei.value.code == 0
    assert hide_calls == [True]
    # 隐藏后驻留：等子进程（应用）退出才结束
    assert procs and procs[0].waited is True
    # 子进程带隐藏标志启动且输出进日志文件
    kwargs = popen_calls[0]
    assert kwargs["env"][start.HIDE_CONSOLE_ENV] == "1"
    assert kwargs["creationflags"] == start.subprocess.CREATE_NO_WINDOW
    assert kwargs["stdout"] != start.subprocess.DEVNULL


def test_desktop_run_keeps_console_and_shows_log_on_failure(monkeypatch, tmp_path, capsys):
    start, _popen_calls, hide_calls, log_path, _procs = _patch_common(
        monkeypatch, tmp_path, ready=lambda: False, poll_results=[1],
    )
    log_path.write_text("[ERROR] npm install 失败\n", encoding="utf-8")
    monkeypatch.setattr(start.os, "environ", {**os.environ})
    monkeypatch.setattr("builtins.input", lambda *_a: "")

    with pytest.raises(SystemExit) as ei:
        start.run_desktop_mode(18080)
    assert ei.value.code == 1
    assert hide_calls == []  # 失败不隐藏，用户要看日志
    out = capsys.readouterr().out
    assert "启动失败" in out
    assert "npm install 失败" in out


def test_app_ready_accepts_any_http_response(monkeypatch):
    import urllib.error

    start = load_start()

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(start.urllib.request, "urlopen", lambda *a, **k: _Resp())
    assert start._app_ready(18080) is True

    def _raise_http_error(*a, **k):
        raise urllib.error.HTTPError("u", 401, "unauthorized", None, None)

    monkeypatch.setattr(start.urllib.request, "urlopen", _raise_http_error)
    assert start._app_ready(18080) is True

    monkeypatch.setattr(start.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("refused")))
    assert start._app_ready(18080) is False

