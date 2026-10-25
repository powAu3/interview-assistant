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


def test_build_start_command_controls_rebuild_flag():
    quick_start = load_quick_start()

    rebuild_cmd = quick_start.build_start_command(["--port", "9090"], rebuild=True)
    assert rebuild_cmd == [
        sys.executable,
        os.path.join(str(ROOT), "start.py"),
        "--mode",
        "desktop",
        "--rebuild",
        "--port",
        "9090",
    ]

    no_rebuild_cmd = quick_start.build_start_command(["--port", "9090"], rebuild=False)
    assert no_rebuild_cmd == [
        sys.executable,
        os.path.join(str(ROOT), "start.py"),
        "--mode",
        "desktop",
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


def test_install_marker_skips_and_reruns_install(monkeypatch, tmp_path):
    quick_start = load_quick_start()
    marker = tmp_path / "marker.json"
    monkeypatch.setattr(quick_start, "INSTALL_MARKER", str(marker))
    monkeypatch.setattr(quick_start, "_install_fingerprint", lambda: "fp-1")

    ran = []
    monkeypatch.setattr(
        quick_start,
        "install_dependencies",
        lambda: ran.append(True) or True,
    )

    # 未装过：执行安装并写标记
    assert quick_start.main(["--install-only"]) == 0
    assert ran == [True]
    assert marker.exists()

    # 标记有效：跳过安装
    assert quick_start.main(["--install-only"]) == 0
    assert ran == [True]

    # --force-install：强制重装
    assert quick_start.main(["--force-install", "--install-only"]) == 0
    assert ran == [True, True]

    # 指纹变化（依赖清单改了）：自动重装
    monkeypatch.setattr(quick_start, "_install_fingerprint", lambda: "fp-2")
    assert quick_start.main(["--install-only"]) == 0
    assert ran == [True, True, True]


def test_frontend_needs_rebuild_detects_stale_dist(tmp_path, monkeypatch):
    quick_start = load_quick_start()
    frontend = tmp_path / "frontend"
    src = frontend / "src"
    src.mkdir(parents=True)
    (src / "App.tsx").write_text("x", encoding="utf-8")

    monkeypatch.setattr(quick_start, "FRONTEND_DIR", str(frontend))

    # dist 不存在：需要重建
    assert quick_start._frontend_needs_rebuild() is True

    dist = frontend / "dist"
    dist.mkdir()
    dist_index = dist / "index.html"
    dist_index.write_text("built", encoding="utf-8")
    # dist 比源码新：不需要重建
    import time

    future = time.time() + 60
    os.utime(dist_index, (future, future))
    assert quick_start._frontend_needs_rebuild() is False

    # 源码更新：需要重建（把新文件的时间戳拨到 dist 之后）
    new_file = src / "New.tsx"
    new_file.write_text("y", encoding="utf-8")
    os.utime(new_file, (future + 120, future + 120))
    assert quick_start._frontend_needs_rebuild() is True


def test_launch_start_command_hides_windows_console(monkeypatch, tmp_path):
    quick_start = load_quick_start()
    popen_calls = []
    hide_calls = []
    wait_calls = []

    monkeypatch.setattr(quick_start, "STARTUP_LOG", str(tmp_path / "startup-console.log"))
    monkeypatch.setattr(quick_start, "_is_windows", lambda: True)
    monkeypatch.setattr(quick_start, "_hidden_creationflags", lambda: 1234)
    monkeypatch.setattr(quick_start, "_hide_console_window", lambda: hide_calls.append(True))
    monkeypatch.setattr(quick_start, "_wait_for_app_ready", lambda port: wait_calls.append(port) or True)
    monkeypatch.setattr(quick_start, "_frontend_needs_rebuild", lambda: False)

    app_wait_calls = []

    def fake_popen(cmd, **kwargs):
        popen_calls.append((cmd, kwargs))

        class Proc:
            def wait(self):
                app_wait_calls.append(True)
                return 0

        return Proc()

    monkeypatch.setattr(quick_start.subprocess, "Popen", fake_popen)

    assert quick_start.launch_start_command(["--port", "9090"]) == 0
    # 隐藏后驻留：等待应用退出，python 不提前退出（否则 cmd 会把窗口画回来）
    assert app_wait_calls == [True]
    assert popen_calls[0][0] == quick_start.build_start_command(["--port", "9090"], rebuild=False)
    assert popen_calls[0][1]["cwd"] == quick_start.ROOT
    assert popen_calls[0][1]["creationflags"] == 1234
    assert popen_calls[0][1]["env"][quick_start.HIDE_CONSOLE_ENV] == "1"
    assert popen_calls[0][1]["stdin"] == quick_start.subprocess.DEVNULL
    # 子进程输出重定向到启动日志（失败时可展示），不再丢弃
    assert popen_calls[0][1]["stdout"] != quick_start.subprocess.DEVNULL
    assert popen_calls[0][1]["stderr"] == quick_start.subprocess.STDOUT
    assert wait_calls == [9090]
    assert hide_calls == [True]


def test_launch_start_command_keeps_console_and_shows_log_on_failure(monkeypatch, tmp_path, capsys):
    quick_start = load_quick_start()
    log_path = tmp_path / "startup-console.log"
    log_path.write_text("[ERROR] 端口被占用\n", encoding="utf-8")
    monkeypatch.setattr(quick_start, "STARTUP_LOG", str(log_path))
    monkeypatch.setattr(quick_start, "_is_windows", lambda: True)
    monkeypatch.setattr(quick_start, "_wait_for_app_ready", lambda port: False)
    monkeypatch.setattr(quick_start, "_frontend_needs_rebuild", lambda: False)
    monkeypatch.setattr(quick_start.subprocess, "Popen", lambda *a, **k: object())
    monkeypatch.setattr("builtins.input", lambda *_a: "")

    assert quick_start.launch_start_command([]) == 1
    out = capsys.readouterr().out
    assert "启动失败" in out
    assert "端口被占用" in out


def test_launch_start_command_keeps_console_when_ready_wait_times_out(monkeypatch, tmp_path):
    quick_start = load_quick_start()
    hide_calls = []

    monkeypatch.setattr(quick_start, "STARTUP_LOG", str(tmp_path / "startup-console.log"))
    monkeypatch.setattr(quick_start, "_is_windows", lambda: True)
    monkeypatch.setattr(quick_start.subprocess, "Popen", lambda *args, **kwargs: object())
    monkeypatch.setattr(quick_start, "_wait_for_app_ready", lambda port: False)
    monkeypatch.setattr(quick_start, "_hide_console_window", lambda: hide_calls.append(True))
    monkeypatch.setattr(quick_start, "_frontend_needs_rebuild", lambda: False)
    monkeypatch.setattr("builtins.input", lambda *_a: "")

    # 超时 = 启动失败：返回 1，窗口保留给用户看日志，不隐藏
    assert quick_start.launch_start_command([]) == 1
    assert hide_calls == []


def test_extract_port_supports_separate_and_equals_forms():
    quick_start = load_quick_start()

    assert quick_start._extract_port(["--port", "9090"]) == 9090
    assert quick_start._extract_port(["--port=19090"]) == 19090
    assert quick_start._extract_port(["--port", "bad"]) == 18080
    assert quick_start._extract_port([]) == 18080


def test_launch_start_command_foreground_uses_blocking_call(monkeypatch):
    quick_start = load_quick_start()
    calls = []

    monkeypatch.setattr(quick_start, "_is_windows", lambda: True)
    monkeypatch.setattr(quick_start, "_frontend_needs_rebuild", lambda: True)

    def fake_call(cmd, cwd=None):
        calls.append((cmd, cwd))
        return 7

    monkeypatch.setattr(quick_start.subprocess, "call", fake_call)

    assert quick_start.launch_start_command(["--port", "9090"], foreground=True) == 7
    assert calls == [(quick_start.build_start_command(["--port", "9090"], rebuild=True), quick_start.ROOT)]
