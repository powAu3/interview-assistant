"""LLM 协议真烟测：对配置里的模型各打一次非流式+流式，验证协议层端到端。

用法（在 backend 目录）：
    python scripts/smoke_llm_protocols.py            # 测所有已启用模型
    python scripts/smoke_llm_protocols.py --index 2  # 只测指定模型

覆盖：api_type=openai(chat) / anthropic(messages) / responses(responses)。
单测（test_llm_protocols.py）用的是 mock HTTP；本脚本打真实 API，
用于验证 payload/SSE/鉴权在真实网关上工作正常。
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import get_config  # noqa: E402
from services.llm.streaming import chat_completion_create, chat_stream  # noqa: E402


def smoke_model(model_cfg) -> bool:
    label = f"[{model_cfg.name}] api_type={getattr(model_cfg, 'api_type', 'openai')} model={model_cfg.model}"
    print(f"\n=== {label} ===")
    ok = True

    # 1) 非流式（统一封装，协议内部分派）
    try:
        t0 = time.perf_counter()
        resp = chat_completion_create(
            model_cfg,
            [{"role": "user", "content": "只回复两个字：成功"}],
            temperature=0.1,
            max_tokens=16,
        )
        text = (resp.choices[0].message.content or "").strip()
        print(f"  非流式 OK ({time.perf_counter() - t0:.1f}s): {text[:40]!r}")
        if not text:
            ok = False
    except Exception as e:
        print(f"  非流式 FAIL: {type(e).__name__}: {str(e)[:160]}")
        return False

    # 2) 流式（openai 走 SDK/裸 HTTP，anthropic/responses 走 SSE 解析）
    try:
        t0 = time.perf_counter()
        chunks = 0
        first_ms = None
        for kind, piece in chat_stream(
            [{"role": "user", "content": "用一句话介绍 Redis"}],
            override_think_mode=False,
        ):
            if first_ms is None and piece.strip():
                first_ms = (time.perf_counter() - t0) * 1000
            chunks += 1
        if chunks == 0:
            raise RuntimeError("流式返回 0 个 chunk")
        print(f"  流式 OK ({time.perf_counter() - t0:.1f}s, 首字 {first_ms:.0f}ms, {chunks} chunks)")
    except Exception as e:
        print(f"  流式 FAIL: {type(e).__name__}: {str(e)[:160]}")
        ok = False
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="LLM 协议真烟测")
    parser.add_argument("--index", type=int, default=None, help="只测指定模型下标")
    args = parser.parse_args()

    cfg = get_config()
    targets = []
    if args.index is not None:
        targets = [cfg.models[args.index]]
    else:
        targets = [m for m in cfg.models if m.enabled and m.api_key]

    if not targets:
        print("没有可测的已启用模型（需配置 api_key）")
        return 1

    passed = 0
    for m in targets:
        if smoke_model(m):
            passed += 1

    print(f"\n===== 结果: {passed}/{len(targets)} 模型通过 =====")
    return 0 if passed == len(targets) else 1


if __name__ == "__main__":
    raise SystemExit(main())
