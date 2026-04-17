"""PDF loader：L1 文本层（pypdf），L2 OCR / L3 Vision 均在索引期、opt-in。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from ..types import RawDoc, RawSection
from ._base import register
from ._ocr import ocr_image_file
from ._vision import render_pdf_page_to_png, vision_caption

_log = logging.getLogger(__name__)

try:
    from pypdf import PdfReader
    _PYPDF_OK = True
except Exception as e:  # pragma: no cover
    _log.info("pypdf not available: %s", e)
    _PYPDF_OK = False

_EMPTY_PAGE_THRESHOLD = 100


def _l2_ocr_enabled() -> bool:
    try:
        from core.config import get_config  # type: ignore
        return bool(getattr(get_config(), "kb_ocr_enabled", False))
    except Exception:  # pragma: no cover
        return False


def _l3_vision_enabled() -> bool:
    try:
        from core.config import get_config  # type: ignore
        return bool(getattr(get_config(), "kb_vision_caption_enabled", False))
    except Exception:  # pragma: no cover
        return False


def _kb_cache_root() -> Path:
    try:
        from core.config import get_config  # type: ignore
        from services.kb.indexer import resolve_path  # type: ignore
        return resolve_path(getattr(get_config(), "kb_cache_dir", "data/kb_cache"))
    except Exception:  # pragma: no cover
        return Path("data/kb_cache")


def _run_ocr_on_pdf_page(pdf_path: Path, page_idx: int) -> str:
    out = _kb_cache_root() / "ocr" / pdf_path.stem / f"page_{page_idx}.png"
    if not render_pdf_page_to_png(pdf_path, page_idx, out):
        return ""
    return ocr_image_file(out)


def _run_vision_caption(pdf_path: Path, page_idx: int) -> str:
    out = _kb_cache_root() / "vision" / pdf_path.stem / f"page_{page_idx}.png"
    if not render_pdf_page_to_png(pdf_path, page_idx, out):
        return ""
    cap = vision_caption(out)
    return cap or ""


class PdfLoader:
    name = "pdf"
    extensions = (".pdf",)

    def load(self, file_path: Path, *, rel_path: str) -> RawDoc:
        if not _PYPDF_OK:
            raise RuntimeError("pypdf 未安装：请 `pip install pypdf`")
        reader = PdfReader(str(file_path))
        title = _pdf_title(reader, rel_path)
        sections: list[RawSection] = []
        for idx, page in enumerate(reader.pages, start=1):
            try:
                text = (page.extract_text() or "").strip()
            except Exception as e:
                _log.warning("pypdf extract_text page %d 失败: %s", idx, e)
                text = ""
            if text:
                sections.append(
                    RawSection(
                        section_path=f"{title} > Page {idx}",
                        text=text,
                        page=idx,
                        origin="text",
                    )
                )
            is_image_page = len(text) < _EMPTY_PAGE_THRESHOLD
            if is_image_page and _l2_ocr_enabled():
                try:
                    ocr_text = _run_ocr_on_pdf_page(file_path, idx)
                except Exception as e:  # pragma: no cover
                    _log.warning("kb OCR 调用异常 %s p%d: %s", rel_path, idx, e)
                    ocr_text = ""
                if ocr_text:
                    sections.append(
                        RawSection(
                            section_path=f"{title} > Page {idx} (OCR)",
                            text=ocr_text,
                            page=idx,
                            origin="ocr",
                        )
                    )
            if _l3_vision_enabled():
                try:
                    cap = _run_vision_caption(file_path, idx)
                except Exception as e:  # pragma: no cover
                    _log.warning("kb Vision 调用异常 %s p%d: %s", rel_path, idx, e)
                    cap = ""
                if cap:
                    sections.append(
                        RawSection(
                            section_path=f"{title} > Page {idx} (Vision)",
                            text=cap,
                            page=idx,
                            origin="vision",
                        )
                    )
        return RawDoc(path=rel_path, title=title, loader="pdf", sections=sections)


def _pdf_title(reader: "PdfReader", rel_path: str) -> str:
    try:
        meta = reader.metadata
        if meta and getattr(meta, "title", None):
            t = str(meta.title).strip()
            if t:
                return t
    except Exception:
        pass
    return Path(rel_path).stem


if _PYPDF_OK:
    register(PdfLoader())

__all__ = ["PdfLoader"]
