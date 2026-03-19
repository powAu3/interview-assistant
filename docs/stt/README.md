# 语音识别热词（豆包 ASR）

- **词表文件**：[doubao_hotwords_面试技术词表.txt](./doubao_hotwords_面试技术词表.txt)（每行一词，UTF-8）
- **配置与上传步骤**：见上级文档 [豆包语音识别.md](../豆包语音识别.md) 第三节「热词表」

本地 **Whisper** 使用的技术词库与纠错规则在代码中维护：`backend/services/stt.py` 内 `TECH_VOCAB`、`TERM_CORRECTIONS`（非本目录文件）。
