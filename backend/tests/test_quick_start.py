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


def test_install_dependencies_runs_python_frontend_and_desktop_installs(monkeypatch):
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
        (["npm", "install"], quick_start.DESKTOP_DIR),
    ]
