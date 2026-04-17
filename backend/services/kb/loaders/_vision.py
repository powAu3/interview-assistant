"""PDF 页渲染 + 复用项目 vision 模型生成页内容描述。"""
from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)

_CAPTION_PROMPT = (
    "这是一份技术笔记中的 PDF 页面截图。请用 3-6 句简体中文概括页面的信息："
    "如果含有流程图/架构图，说明核心节点与关系；如果是代码，说明代码意图和关键 API；"
    "如果是表格，列出关键字段和示例行。不要编造页面里没有的信息。"
)


def render_pdf_page_to_png(
    pdf_path: Path, page_idx: int, out_path: Path, zoom: float = 2.0
) -> bool:
    """用 pymupdf 把 pdf_path 的第 page_idx 页（1-based）渲染为 PNG。失败返回 False。"""
    try:
        import fitz  # pymupdf
    except Exception as e:  # pragma: no cover
        _log.info("pymupdf 未安装，跳过 Vision 渲染: %s", e)
        return False
    try:
        doc = fitz.open(str(pdf_path))
        try:
            page = doc.load_page(page_idx - 1)
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            pix.save(str(out_path))
            return True
        finally:
            doc.close()
    except Exception as e:
        _log.warning("pymupdf 渲染失败 %s page %d: %s", pdf_path, page_idx, e)
        return False


def vision_caption(png_path: Path, *, deadline_s: float = 20.0) -> Optional[str]:
    """用项目已配置的 vision 模型生成一段页面描述；任何失败均返回 None。"""
    model_cfg = _pick_vision_model()
    if model_cfg is None:
        return None
    try:
        from services.llm import get_client_for_model  # type: ignore
        client = get_client_for_model(model_cfg)
    except Exception as e:  # pragma: no cover
        _log.info("kb vision 拿不到 client: %s", e)
        return None

    try:
        b64 = base64.b64encode(png_path.read_bytes()).decode("ascii")
    except Exception as e:  # pragma: no cover
        _log.warning("kb vision 读取渲染结果失败: %s", e)
        return None

    try:
        resp = client.chat.completions.create(
            model=model_cfg.model,
            temperature=0.0,
            max_tokens=400,
            timeout=deadline_s,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _CAPTION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"},
                        },
                    ],
                }
            ],
        )
    except Exception as e:  # pragma: no cover
        _log.warning("kb vision caption 失败: %s", e)
        return None

    try:
        content = (resp.choices[0].message.content or "").strip()
    except Exception:  # pragma: no cover
        return None
    return content or None


def _pick_vision_model():
    """复用 vision_verify 的选模型逻辑：supports_vision + enabled + 有 api_key。"""
    try:
        from core.config import get_config  # type: ignore
    except Exception:  # pragma: no cover
        return None
    cfg = get_config()
    for m in getattr(cfg, "models", []) or []:
        if (
            getattr(m, "supports_vision", False)
            and bool(getattr(m, "enabled", True))
            and getattr(m, "api_key", "")
            and getattr(m, "api_key") not in ("", "sk-your-api-key-here")
        ):
            return m
    return None
