#!/usr/bin/env python3
"""预下载 faster-whisper 所有可选模型到本地缓存，避免首次使用时再下载。"""
import sys
import os

# 确保 backend 在 path 中
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from core.config import WHISPER_MODEL_OPTIONS


def main():
    from faster_whisper import WhisperModel

    print("预下载 Whisper 模型（faster-whisper 会从 Hugging Face 拉取到本地缓存）")
    print("模型列表:", ", ".join(WHISPER_MODEL_OPTIONS))
    print()

    for i, model_size in enumerate(WHISPER_MODEL_OPTIONS, 1):
        print(f"[{i}/{len(WHISPER_MODEL_OPTIONS)}] 正在下载/加载: {model_size} ...")
        try:
            # 使用 cpu + int8 预下载，兼容无 GPU 环境且体积较小
            model = WhisperModel(model_size, device="cpu", compute_type="int8")
            del model
            print(f"  OK: {model_size}")
        except Exception as e:
            print(f"  失败: {model_size} - {e}")
        print()

    print("全部完成。缓存目录通常为: ~/.cache/huggingface/hub")


if __name__ == "__main__":
    main()
