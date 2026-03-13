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
    return "\n\n".join(texts)


def parse_resume_bytes(content: bytes, filename: str) -> str:
    """Parse resume from uploaded bytes. Supports PDF and plain text."""
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
    elif ext in (".txt", ".md"):
        return content.decode("utf-8", errors="ignore")
    else:
        raise ValueError(f"不支持的文件格式: {ext}，请上传 PDF 或 TXT 文件")


def summarize_resume(text: str) -> str:
    """Return the resume text as-is (LLM will handle interpretation)."""
    if len(text) > 8000:
        return text[:8000] + "\n\n[简历内容过长，已截取前 8000 字符]"
    return text
