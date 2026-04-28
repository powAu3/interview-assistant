"""KB Beta HTTP API:

- GET  /api/kb/status         总开关 + 文档/分块计数 + 依赖可用性
- GET  /api/kb/docs           已索引文档列表
- POST /api/kb/search         手动检索 (Beta 面板用)
- GET  /api/kb/hits/recent    最近一段时间的命中历史
- POST /api/kb/upload         上传单个文件 (.md/.txt/.docx/.pdf 等),自动 reindex
- POST /api/kb/reindex        强制全量重建索引
- DELETE /api/kb/docs?path=   删除指定文档及其索引

所有写操作都会被 LAN 鉴权保护 (main.py middleware), 这里只做参数校验。
"""
from __future__ import annotations

import importlib
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.config import get_config
from core.resource_lanes import ResourceLaneBusyError, run_low_priority
from services.kb import indexer, retriever
from services.kb.recent_hits import global_recent_hits

router = APIRouter()


def _dep_ok(mod: str) -> bool:
    try:
        importlib.import_module(mod)
        return True
    except Exception:
        return False


async def _run_kb_low_priority(fn, *args):
    try:
        return await run_low_priority(fn, *args)
    except ResourceLaneBusyError as e:
        raise HTTPException(status_code=429, detail="后台低优先级队列繁忙，请稍后重试") from e


class SearchReq(BaseModel):
    query: str
    k: int = Field(default=4, ge=1, le=20)
    min_score: float = Field(default=0.0, ge=0.0)
    deadline_ms: Optional[int] = Field(default=None, ge=10, le=5000)


@router.get("/kb/status")
async def kb_status() -> dict:
    cfg = get_config()
    s = await _run_kb_low_priority(indexer.stats)
    deps = {
        "docx": _dep_ok("docx"),
        "pdf": _dep_ok("pypdf"),
        "ocr": _dep_ok("rapidocr_onnxruntime") and bool(getattr(cfg, "kb_ocr_enabled", False)),
        "vision": _dep_ok("fitz") and bool(getattr(cfg, "kb_vision_caption_enabled", False)),
    }
    return {
        "enabled": bool(getattr(cfg, "kb_enabled", False)),
        "trigger_modes": list(getattr(cfg, "kb_trigger_modes", []) or []),
        "top_k": int(getattr(cfg, "kb_top_k", 4) or 4),
        "deadline_ms": int(getattr(cfg, "kb_deadline_ms", 150) or 150),
        "asr_deadline_ms": int(getattr(cfg, "kb_asr_deadline_ms", 80) or 80),
        "deps": deps,
        **s,
    }


@router.get("/kb/docs")
async def kb_docs(limit: Optional[int] = None) -> dict:
    items = await _run_kb_low_priority(indexer.list_docs, limit)
    return {"items": items}


@router.post("/kb/search")
async def kb_search(req: SearchReq) -> dict:
    cfg = get_config()
    deadline = req.deadline_ms or int(getattr(cfg, "kb_deadline_ms", 150) or 150)
    hits = await _run_kb_low_priority(
        lambda: retriever.retrieve(
            req.query,
            req.k,
            deadline,
            mode="manual_text",
            force=True,
        )
    )
    if req.min_score > 0:
        hits = [h for h in hits if h.score >= req.min_score]
    excerpt_chars = int(getattr(cfg, "kb_prompt_excerpt_chars", 300) or 300)
    return {
        "hits": [
            {
                "path": h.path,
                "section_path": h.section_path,
                "page": h.page,
                "origin": h.origin,
                "score": h.score,
                "excerpt": h.excerpt(excerpt_chars),
            }
            for h in hits
        ]
    }


@router.get("/kb/hits/recent")
async def kb_hits_recent(limit: int = 50) -> dict:
    return {"items": global_recent_hits().list(limit=limit)}


def _safe_rel_path(subdir: str, filename: str, allowed_exts: set[str]) -> Path:
    """阻断 path traversal、绝对路径、不允许的扩展名 (.doc 单独 415)。"""
    name = (filename or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="filename required")
    if "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="filename must not contain path separators")

    sub = (subdir or "").strip().strip("/").strip("\\")
    if sub:
        if any(p in ("..", "") for p in Path(sub).parts) or Path(sub).is_absolute():
            raise HTTPException(status_code=400, detail="path traversal detected")
        rel = Path(sub) / name
    else:
        rel = Path(name)

    if any(p in ("..", "") for p in rel.parts) or rel.is_absolute():
        raise HTTPException(status_code=400, detail="path traversal detected")

    ext = rel.suffix.lower()
    if ext == ".doc":
        raise HTTPException(
            status_code=415,
            detail="不支持 .doc, 请在 Word 中另存为 .docx 后再上传。",
        )
    if ext not in allowed_exts:
        raise HTTPException(status_code=415, detail=f"扩展名 {ext} 不在白名单内")
    return rel


@router.post("/kb/upload")
async def kb_upload(
    file: UploadFile = File(...),
    subdir: str = Form(default=""),
) -> dict:
    cfg = get_config()
    allowed = {e.lower() for e in (getattr(cfg, "kb_file_extensions", []) or [])}
    rel = _safe_rel_path(subdir, file.filename or "", allowed)

    max_bytes = int(getattr(cfg, "kb_max_upload_bytes", 20 * 1024 * 1024) or 0)
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"文件超过限额 {max_bytes} bytes")

    kb_dir = Path(indexer.resolve_path(getattr(cfg, "kb_dir", "data/kb")))
    dest = kb_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(content)

    rel_str = str(rel).replace("\\", "/")
    info = await _run_kb_low_priority(indexer.reindex_file, rel_str)
    return {
        "path": rel_str,
        "size": len(content),
        "indexed": info,
    }


class ReindexReq(BaseModel):
    force: bool = False


@router.post("/kb/reindex")
async def kb_reindex(req: Optional[ReindexReq] = None) -> dict:
    info = await _run_kb_low_priority(indexer.reindex)
    return info


@router.delete("/kb/docs")
async def kb_delete_doc(path: str) -> dict:
    p = (path or "").strip()
    if not p:
        raise HTTPException(status_code=400, detail="path required")
    if Path(p).is_absolute() or any(part in ("..",) for part in Path(p).parts):
        raise HTTPException(status_code=400, detail="invalid path")
    await _run_kb_low_priority(indexer.remove_file, p)
    return {"ok": True, "path": p}
