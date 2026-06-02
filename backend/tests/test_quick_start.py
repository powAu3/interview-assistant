import importlib.util
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
QUICK_START = ROOT / "quick-start.py"


def load_quick_start():
    spec = importlib.util.spec_from_file_location("quick_start", QUICK_START)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_build_start_command_preserves_port_and_adds_rebuild():
    quick_start = load_quick_start()

    cmd = quick_start.build_start_command(["--port", "9090"])

    assert cmd == [
        sys.executable,
        os.path.join(str(ROOT), "start.py"),
        "--mode",
        "desktop",
        "--rebuild",
        "--port",
        "9090",
    ]


def test_install_dependencies_runs_python_and_frontend_installs(monkeypatch):
    quick_start = load_quick_start()
    calls = []

    monkeypatch.setattr(quick_start, "_find_npm", lambda: "npm")

    def fake_run(cmd, cwd=None):
        calls.append((cmd, cwd))

        class Result:
            returncode = 0

        return Result()

    monkeypatch.setattr(quick_start.subprocess, "run", fake_run)

    assert quick_start.install_dependencies() is True
    assert calls == [
        ([sys.executable, "-m", "pip", "install", "-r", quick_start.REQUIREMENTS], quick_start.ROOT),
        (["npm", "install"], quick_start.FRONTEND_DIR),
    ]


def test_launch_start_command_hides_windows_console(monkeypatch):
    quick_start = load_quick_start()
    popen_calls = []

    monkeypatch.setattr(quick_start, "_is_windows", lambda: True)
    monkeypatch.setattr(quick_start, "_hidden_creationflags", lambda: 1234)

    def fake_popen(cmd, **kwargs):
        popen_calls.append((cmd, kwargs))

        class Proc:
            pass

        return Proc()

    monkeypatch.setattr(quick_start.subprocess, "Popen", fake_popen)

    assert quick_start.launch_start_command(["--port", "9090"]) == 0
    assert popen_calls[0][0] == quick_start.build_start_command(["--port", "9090"])
    assert popen_calls[0][1]["cwd"] == quick_start.ROOT
    assert popen_calls[0][1]["creationflags"] == 1234
    assert popen_calls[0][1]["env"][quick_start.HIDE_CONSOLE_ENV] == "1"
    assert popen_calls[0][1]["stdin"] == quick_start.subprocess.DEVNULL
    assert popen_calls[0][1]["stdout"] == quick_start.subprocess.DEVNULL
    assert popen_calls[0][1]["stderr"] == quick_start.subprocess.DEVNULL


def test_launch_start_command_foreground_uses_blocking_call(monkeypatch):
    quick_start = load_quick_start()
    calls = []

    monkeypatch.setattr(quick_start, "_is_windows", lambda: True)

    def fake_call(cmd, cwd=None):
        calls.append((cmd, cwd))
        return 7

    monkeypatch.setattr(quick_start.subprocess, "call", fake_call)

    assert quick_start.launch_start_command(["--port", "9090"], foreground=True) == 7
    assert calls == [(quick_start.build_start_command(["--port", "9090"]), quick_start.ROOT)]
