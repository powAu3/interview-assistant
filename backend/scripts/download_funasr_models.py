"""显式下载 FunASR 模型（设置页「下载模型」按钮等价于运行本脚本）。

用法：
    python scripts/download_funasr_models.py                # 下载默认 paraformer-zh
    python scripts/download_funasr_models.py sensevoice-small

模型从 ModelScope 拉取，缓存在 ~/.cache/modelscope（首次约 1GB，含标点模型）。
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.stt.engines import FUNASR_MODEL_REPOS, FunASRSTT


def main() -> int:
    parser = argparse.ArgumentParser(description="Download FunASR STT models")
    parser.add_argument(
        "model",
        nargs="?",
        default="paraformer-zh",
        choices=list(FUNASR_MODEL_REPOS),
        help="要下载的模型短名（默认 paraformer-zh）",
    )
    args = parser.parse_args()

    print(f"[FunASR] 开始下载/加载 {args.model} -> {FUNASR_MODEL_REPOS[args.model]}")
    engine = FunASRSTT(model_name=args.model)
    engine.load_model()
    if engine.is_loaded:
        print(f"[FunASR] {args.model} 已就绪（缓存目录 ~/.cache/modelscope）")
        return 0
    print("[FunASR] 加载未完成，请检查网络后重试")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
