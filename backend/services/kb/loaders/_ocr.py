"""OCR 封装（rapidocr-onnxruntime, opt-in）。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

_ocr_engine: Any = None


def _get_engine() -> Any:
    global _ocr_engine
    if _ocr_engine is not None:
        return _ocr_engine
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
        _ocr_engine = RapidOCR()
    except Exception as e:  # pragma: no cover
        _log.info("rapidocr 未安装或加载失败，禁用 OCR: %s", e)
        _ocr_engine = False
    return _ocr_engine


def ocr_image_file(image_path: Path) -> str:
    engine = _get_engine()
    if not engine:
        return ""
    try:
        result, _ = engine(str(image_path))
    except Exception as e:  # pragma: no cover
        _log.warning("rapidocr 调用失败: %s", e)
        return ""
    if not result:
        return ""
    lines = [
        item[1]
        for item in result
        if isinstance(item, (list, tuple)) and len(item) >= 2
    ]
    return "\n".join(line for line in lines if isinstance(line, str)).strip()
