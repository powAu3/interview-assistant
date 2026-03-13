import os


def parse_pdf(file_path: str) -> str:
    """Extract text content from a PDF resume."""
    import pdfplumber

    texts = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                texts.append(text.strip())
    result = "\n\n".join(texts)
    if not result.strip():
        raise ValueError(
            "PDF 解析结果为空（可能是纯图片格式的 PDF）。"
            "请尝试用文字版 PDF，或转换为 DOCX/TXT 后重新上传。"
        )
    return result


def _parse_docx(content: bytes) -> str:
    """Extract text from a .docx file."""
    import zipfile
    import xml.etree.ElementTree as ET
    from io import BytesIO

    paragraphs = []
    with zipfile.ZipFile(BytesIO(content)) as z:
        if "word/document.xml" not in z.namelist():
            raise ValueError("无效的 DOCX 文件")
        with z.open("word/document.xml") as f:
            tree = ET.parse(f)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        for p in tree.iter(f"{{{ns['w']}}}p"):
            texts = [t.text for t in p.iter(f"{{{ns['w']}}}t") if t.text]
            if texts:
                paragraphs.append("".join(texts))
    return "\n".join(paragraphs)


def parse_resume_bytes(content: bytes, filename: str) -> str:
    """Parse resume from uploaded bytes. Supports PDF, DOCX, DOC, TXT, MD."""
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            return parse_pdf(tmp_path)
        finally:
            os.unlink(tmp_path)
    elif ext in (".docx", ".doc"):
        try:
            return _parse_docx(content)
        except Exception as e:
            if ext == ".doc":
                raise ValueError(
                    "不支持旧版 .doc 格式，请用 Word 另存为 .docx 后重试"
                ) from e
            raise
    elif ext in (".txt", ".md"):
        return content.decode("utf-8", errors="ignore")
    else:
        raise ValueError(f"不支持的文件格式: {ext}，请上传 PDF / DOCX / TXT / MD 文件")


def summarize_resume(text: str) -> str:
    """Return the resume text as-is (LLM will handle interpretation)."""
    if len(text) > 8000:
        return text[:8000] + "\n\n[简历内容过长，已截取前 8000 字符]"
    return text
