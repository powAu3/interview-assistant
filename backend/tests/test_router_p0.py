"""
Router-level P0 fixes (CR follow-up):
  - /resume 上传必须流式校验大小, 而不是把整个 body 读进内存
  - api_models_layout 的 order 列表必须排除 bool (Python isinstance(True, int) == True)
  - api_update_config 对非法 enum 必须 422, 不能静默 pop
"""

from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

common_router = importlib.import_module("api.common.router")


# ---------- /resume 上传防 OOM ------------------------------------------------


class _FakeRequest:
    def __init__(self, content_length: int | None):
        self.headers: dict[str, str] = {}
        if content_length is not None:
            self.headers["content-length"] = str(content_length)


class _ChunkedUpload:
    """模拟 starlette.UploadFile, 支持按 size 分片返回."""

    def __init__(self, filename: str, total_bytes: int, chunk: int = 1024 * 1024):
        self.filename = filename
        self._remaining = total_bytes
        self._chunk = chunk

    async def read(self, size: int = -1) -> bytes:
        if self._remaining <= 0:
            return b""
        n = self._remaining if size < 0 else min(size, self._remaining)
        self._remaining -= n
        return b"x" * n


def _run(coro):
    return asyncio.run(coro)


def test_resume_upload_rejects_oversized_content_length(monkeypatch):
    """声明的 Content-Length 超限时立即 413, 不读 body, 不进 add_upload."""

    add_upload_called = False

    def fake_add_upload(*args, **kwargs):
        nonlocal add_upload_called
        add_upload_called = True
        return {"ok": True}

    monkeypatch.setattr(common_router, "add_upload", fake_add_upload)

    too_big = common_router.RESUME_UPLOAD_MAX_BYTES + 1
    upload = _ChunkedUpload("big.pdf", total_bytes=too_big)
    request = _FakeRequest(content_length=too_big)

    with pytest.raises(HTTPException) as exc:
        _run(common_router.api_upload_resume(request, upload))

    assert exc.value.status_code == 413
    assert "10MB" in exc.value.detail
    assert add_upload_called is False


def test_resume_upload_aborts_when_streamed_size_exceeds_limit(monkeypatch):
    """Content-Length 缺失/伪造但实际 body 超限时, 流式累积也必须 413."""

    add_upload_called = False

    def fake_add_upload(*args, **kwargs):
        nonlocal add_upload_called
        add_upload_called = True
        return {"ok": True}

    monkeypatch.setattr(common_router, "add_upload", fake_add_upload)

    too_big = common_router.RESUME_UPLOAD_MAX_BYTES + 5 * 1024
    upload = _ChunkedUpload("big.pdf", total_bytes=too_big)
    request = _FakeRequest(content_length=None)

    with pytest.raises(HTTPException) as exc:
        _run(common_router.api_upload_resume(request, upload))

    assert exc.value.status_code == 413
    assert add_upload_called is False


def test_resume_upload_aborts_on_runaway_read(monkeypatch):
    """异常 file.read 实现 (size 参数被忽略, 永远返回非空但 total 不超限) 时,
    max_iters 兜底必须能终止循环, 防止 unbounded loop."""

    class _StuckUpload:
        filename = "stuck.bin"

        async def read(self, size: int = -1) -> bytes:
            # 永远返回 1 字节, 既不为空也不会让 total 在合理时间内突破 10MB
            return b"\x00"

    add_upload_called = False

    def fake_add_upload(*args, **kwargs):
        nonlocal add_upload_called
        add_upload_called = True
        return {"ok": True}

    monkeypatch.setattr(common_router, "add_upload", fake_add_upload)

    # 把 chunk 调到 1 字节, 让 max_iters = 10MB+2 == 真的小一点也行,
    # 但实际 1B chunk 跑 10M+2 次也只到 ~10MB, 超限会先触发. 因此这里改用更小阈值:
    monkeypatch.setattr(common_router, "RESUME_UPLOAD_MAX_BYTES", 16)
    monkeypatch.setattr(common_router, "_RESUME_UPLOAD_CHUNK", 1)

    request = _FakeRequest(content_length=None)

    with pytest.raises(HTTPException) as exc:
        _run(common_router.api_upload_resume(request, _StuckUpload()))

    # 两种合法终止: 413 (累计超限) 或 500 (跑满 max_iters), 都能保证不挂死.
    assert exc.value.status_code in (413, 500)
    assert add_upload_called is False


def test_resume_upload_passes_under_limit(monkeypatch):
    """正常大小走流式读后落到 add_upload."""

    seen: dict[str, object] = {}

    def fake_add_upload(content: bytes, filename: str):
        seen["content_len"] = len(content)
        seen["filename"] = filename
        return {"ok": True, "size": len(content)}

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(common_router, "add_upload", fake_add_upload)
    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    size = 200 * 1024
    upload = _ChunkedUpload("ok.pdf", total_bytes=size)
    request = _FakeRequest(content_length=size)

    result = _run(common_router.api_upload_resume(request, upload))

    assert result == {"ok": True, "size": size}
    assert seen["content_len"] == size
    assert seen["filename"] == "ok.pdf"


# ---------- api_models_layout: order 列表必须排除 bool ----------------------


class _FakeModel:
    def __init__(self, name: str):
        self.name = name

    def model_dump(self) -> dict:
        return {"name": self.name}

    def model_copy(self, update: dict):
        clone = _FakeModel(self.name)
        for k, v in update.items():
            setattr(clone, k, v)
        return clone


class _FakeCfg:
    def __init__(self, models: list[_FakeModel], active: int = 0):
        self.models = models
        self.active_model = active


def test_models_layout_order_ignores_bool(monkeypatch):
    """前端误传 [True, False, ...] 时, bool 必须被忽略, 不能当成 1/0."""

    fake_cfg = _FakeCfg(
        models=[_FakeModel("m0"), _FakeModel("m1"), _FakeModel("m2")],
        active=0,
    )
    monkeypatch.setattr(common_router, "get_config", lambda: fake_cfg)

    captured: dict[str, object] = {}

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        captured["update"] = args[0] if args else kwargs
        return None

    monkeypatch.setattr(common_router, "update_config", lambda d: None)
    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    body = {"order": [True, False, 0, 1, 2]}

    _run(common_router.api_models_layout(body))

    update = captured["update"]
    assert isinstance(update, dict)
    names = [m["name"] for m in update["models"]]
    # True/False 必须被忽略, 真实的 0/1/2 走进结果
    assert names == ["m0", "m1", "m2"]


def test_models_layout_order_preserves_legitimate_int_indices(monkeypatch):
    """合法 int 仍然按顺序选取, 排除 bool 不影响正常路径."""

    fake_cfg = _FakeCfg(
        models=[_FakeModel("a"), _FakeModel("b"), _FakeModel("c")],
        active=0,
    )
    monkeypatch.setattr(common_router, "get_config", lambda: fake_cfg)

    captured: dict[str, object] = {}

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        captured["update"] = args[0] if args else kwargs
        return None

    monkeypatch.setattr(common_router, "update_config", lambda d: None)
    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    _run(common_router.api_models_layout({"order": [2, 0, 1]}))

    names = [m["name"] for m in captured["update"]["models"]]
    assert names == ["c", "a", "b"]


def test_models_layout_rejects_disabling_every_model(monkeypatch):
    """至少保留一个启用模型，否则主流程会保存成功但答题必然不可用。"""

    fake_cfg = _FakeCfg(
        models=[_FakeModel("m0"), _FakeModel("m1")],
        active=0,
    )
    monkeypatch.setattr(common_router, "get_config", lambda: fake_cfg)

    update_called = False

    def fake_update_config(d):
        nonlocal update_called
        update_called = True

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(common_router, "update_config", fake_update_config)
    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    with pytest.raises(HTTPException) as exc:
        _run(common_router.api_models_layout({"enabled": [False, False]}))

    assert exc.value.status_code == 422
    assert "至少启用一个模型" in exc.value.detail
    assert update_called is False


# ---------- api_update_config: 非法 enum 必须 422 ---------------------------


class _Body:
    """伪造 ConfigUpdate 实例, 绕过 pydantic 校验直接喂给 api_update_config."""

    def __init__(self, **kw):
        self._data = kw

    def model_dump(self, exclude_none: bool = True):
        return dict(self._data)

    # 让 router 里 `body.whisper_language` 等取属性不报错
    def __getattr__(self, name):
        return self._data.get(name)


def test_update_config_rejects_invalid_screen_capture_region(monkeypatch):
    """非法 screen_capture_region 必须 422, 而不是静默 pop."""

    monkeypatch.setattr(
        common_router, "SCREEN_CAPTURE_REGION_OPTIONS", ("full", "left_half")
    )
    update_called = False

    def fake_update_config(d):
        nonlocal update_called
        update_called = True

    monkeypatch.setattr(common_router, "update_config", fake_update_config)

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    body = _Body(screen_capture_region="not_a_real_region")

    with pytest.raises(HTTPException) as exc:
        _run(common_router.api_update_config(body))

    assert exc.value.status_code == 422
    assert "screen_capture_region" in exc.value.detail
    assert update_called is False


def test_update_config_rejects_invalid_practice_audience(monkeypatch):
    monkeypatch.setattr(
        common_router, "PRACTICE_AUDIENCE_OPTIONS", ("campus_intern", "social")
    )
    update_called = False

    def fake_update_config(d):
        nonlocal update_called
        update_called = True

    monkeypatch.setattr(common_router, "update_config", fake_update_config)

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    body = _Body(practice_audience="senior_hunter")

    with pytest.raises(HTTPException) as exc:
        _run(common_router.api_update_config(body))

    assert exc.value.status_code == 422
    assert "practice_audience" in exc.value.detail
    assert update_called is False


def test_update_config_treats_empty_enum_as_reset(monkeypatch):
    """空字符串视为「重置」, 应被 pop 掉 (而非 422), 让默认值生效。"""

    monkeypatch.setattr(
        common_router, "SCREEN_CAPTURE_REGION_OPTIONS", ("full", "left_half")
    )
    monkeypatch.setattr(
        common_router, "PRACTICE_AUDIENCE_OPTIONS", ("campus_intern", "social")
    )

    captured: dict[str, dict] = {}

    def fake_update_config(d):
        captured["d"] = dict(d)

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(common_router, "update_config", fake_update_config)
    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    body = _Body(screen_capture_region="", practice_audience="")

    result = _run(common_router.api_update_config(body))

    assert result == {"ok": True}
    # 两个空字符串都被 pop 掉, 不出现在最终 update payload 中
    assert "screen_capture_region" not in captured["d"]
    assert "practice_audience" not in captured["d"]


def test_update_config_accepts_valid_enum(monkeypatch):
    """合法 enum 路径不应被新校验破坏."""

    monkeypatch.setattr(
        common_router, "SCREEN_CAPTURE_REGION_OPTIONS", ("full", "left_half")
    )
    monkeypatch.setattr(
        common_router, "PRACTICE_AUDIENCE_OPTIONS", ("campus_intern", "social")
    )

    seen: dict[str, object] = {}

    def fake_update_config(d):
        seen["d"] = dict(d)

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(common_router, "update_config", fake_update_config)
    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)

    body = _Body(screen_capture_region="left_half", practice_audience="social")

    result = _run(common_router.api_update_config(body))

    assert result == {"ok": True}
    assert seen["d"]["screen_capture_region"] == "left_half"
    assert seen["d"]["practice_audience"] == "social"


def test_update_config_rejects_all_disabled_models(monkeypatch):
    """完整模型配置保存也不能留下 0 个启用模型。"""

    update_called = False

    def fake_update_config(d):
        nonlocal update_called
        update_called = True

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(common_router, "update_config", fake_update_config)
    monkeypatch.setattr(common_router, "run_in_threadpool", fake_run_in_threadpool)
    monkeypatch.setattr(
        common_router,
        "get_config",
        lambda: _FakeCfg(models=[_FakeModel("old")], active=0),
    )

    body = _Body(
        models=[
            {
                "name": "main",
                "api_base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "model": "gpt-4o-mini",
                "supports_think": False,
                "supports_vision": False,
                "enabled": False,
            }
        ]
    )

    with pytest.raises(HTTPException) as exc:
        _run(common_router.api_update_config(body))

    assert exc.value.status_code == 422
    assert "至少启用一个模型" in exc.value.detail
    assert update_called is False
