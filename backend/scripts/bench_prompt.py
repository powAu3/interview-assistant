"""Bench harness for prompt polish: 30 cases x all enabled models x OLD vs NEW.

Runs in-process against services.llm.build_system_prompt +
chat_stream_single_model. No WebSocket, no HTTP.

OLD vs NEW comparison strategy: OLD 对照需要先 git 检出 prompts.py
到 prompt polish 提交之前的版本再跑一次（`--only-new`）, 然后恢复
NEW 版本再跑一次, 两份报告人读对比。单次运行内 `_prompt_for_old`
和 `_prompt_for_new` 指向同一个 build_system_prompt, 因此如果同时
传 OLD+NEW variant, 两边输出会一致 (这是已知限制, 见 plan Task 6
Step 1)。日常最快的用法是 `--only-new`。

Usage:
    cd backend && python -m scripts.bench_prompt --out log/bench.md
    cd backend && python -m scripts.bench_prompt --models Doubao-Seed-2.0-pro --cases 5 --only-new
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable


# --- Case data ------------------------------------------------------------

RESUME_FIXTURE = (
    "姓名: 王小明\n"
    "2022-2024 字节跳动 · 后端开发\n"
    "- 负责订单系统 Kafka 消息链路重构, QPS 10w -> 30w\n"
    "- 主导 Redis 多活缓存迁移, 命中率从 82% 提升到 97%\n"
    "- 带过 3 人小组, 推进 MySQL 分库分表\n"
    "2020-2022 美团 · 后端实习 -> 初级\n"
    "- 用 Java / Spring Boot 做过支付回调对账服务\n"
    "技术栈: Java, Go, Kafka, Redis, MySQL, K8s\n"
)

RESUME_KEYWORDS = [
    "Kafka",
    "Redis",
    "字节",
    "美团",
    "分库分表",
    "订单系统",
    "缓存",
    "多活",
]


BENCH_CASES: list[dict[str, Any]] = [
    # A 完整八股 (6)
    {"id": "A-1", "category": "complete", "input": "Redis 的 RDB 和 AOF 区别是什么", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "A-2", "category": "complete", "input": "MySQL 事务的四个隔离级别分别解决什么问题", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "A-3", "category": "complete", "input": "TCP 三次握手具体流程和为什么不是两次", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "A-4", "category": "complete", "input": "Kafka 消息不丢失要怎么保证", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "A-5", "category": "complete", "input": "HTTPS 握手过程里对称和非对称加密分别在哪里用", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "A-6", "category": "complete", "input": "一致性哈希解决了什么问题, 有哪些常见坑", "mode": "asr_realtime", "high_churn": True, "context": None},

    # B 可猜意图 (6)
    {"id": "B-1", "category": "guessable", "input": "Redis 那个咋整", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "B-2", "category": "guessable", "input": "锁怎么搞", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "B-3", "category": "guessable", "input": "事务那个", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "B-4", "category": "guessable", "input": "高并发下", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "B-5", "category": "guessable", "input": "这个场景要", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "B-6", "category": "guessable", "input": "那个一致性", "mode": "asr_realtime", "high_churn": True, "context": None},

    # C 纯寒暄 (6)
    {"id": "C-1", "category": "smalltalk", "input": "嗯那我们开始吧", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "C-2", "category": "smalltalk", "input": "可以吗", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "C-3", "category": "smalltalk", "input": "好的", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "C-4", "category": "smalltalk", "input": "嗯嗯", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "C-5", "category": "smalltalk", "input": "能听见吗", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "C-6", "category": "smalltalk", "input": "稍等我喝口水", "mode": "asr_realtime", "high_churn": False, "context": None},

    # D 简历深挖 (6)
    {"id": "D-1", "category": "resume_deepdive", "input": "你简历里写的 Kafka 重构 QPS 10w 到 30w 具体怎么做的", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "D-2", "category": "resume_deepdive", "input": "你做过 Redis 多活缓存迁移吧, 讲一下命中率怎么从 82 到 97", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "D-3", "category": "resume_deepdive", "input": "你主导过分库分表, 当时怎么决定分片键的", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "D-4", "category": "resume_deepdive", "input": "在字节你带过 3 个人, 你怎么推动 MySQL 改造", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "D-5", "category": "resume_deepdive", "input": "你简历里没体现 K8s 实战, 但技术栈写了, 讲讲你的 K8s 经验", "mode": "manual_text", "high_churn": False, "context": None},
    {"id": "D-6", "category": "resume_deepdive", "input": "美团支付对账服务遇到过什么坑", "mode": "asr_realtime", "high_churn": True, "context": None},

    # E 追问链 (6 = 2 chains x 3 rounds)
    {"id": "E-1a", "category": "followup", "input": "介绍一下 Redis 缓存击穿怎么防", "mode": "asr_realtime", "high_churn": False, "context": None},
    {"id": "E-1b", "category": "followup", "input": "嗯, 那如果是缓存雪崩呢", "mode": "asr_realtime", "high_churn": False, "context": {"prev_idx": "E-1a"}},
    {"id": "E-1c", "category": "followup", "input": "线上监控怎么判定是哪一种", "mode": "asr_realtime", "high_churn": False, "context": {"prev_idx": "E-1b"}},
    {"id": "E-2a", "category": "followup", "input": "Kafka 为什么要有 ISR 机制", "mode": "asr_realtime", "high_churn": True, "context": None},
    {"id": "E-2b", "category": "followup", "input": "那 ISR 缩减会导致什么问题", "mode": "asr_realtime", "high_churn": True, "context": {"prev_idx": "E-2a"}},
    {"id": "E-2c", "category": "followup", "input": "生产里怎么配置 min.insync.replicas", "mode": "asr_realtime", "high_churn": True, "context": {"prev_idx": "E-2b"}},
]


# --- Metric helpers -------------------------------------------------------

_INFO_INSUFFICIENT_RE = re.compile(r"信息不足|等待更完整的?问题")
_PREAMBLE_RE = re.compile(
    r"我理解你问的是|想先确认一下|这是一个[^。\n]{0,40}(经典|完整)|首先分析一下|让我先"
)
_LADDER_B_RE = re.compile(r"按大概率(问|理解)")


def has_info_insufficient_phrase(text: str) -> bool:
    return bool(_INFO_INSUFFICIENT_RE.search(text or ""))


def has_preamble_phrase(text: str) -> bool:
    return bool(_PREAMBLE_RE.search(text or ""))


def first_sentence_is_compliant(text: str) -> bool:
    """True 表示首句没有违规引子。"""
    if not text:
        return True
    head = text.strip().splitlines()[0] if text.strip() else ""
    head_20 = head[:20]
    if _LADDER_B_RE.search(head):
        return True
    if _PREAMBLE_RE.search(head_20):
        return False
    return True


def resume_keyword_hits(answer: str, keywords: Iterable[str]) -> int:
    if not answer:
        return 0
    return sum(1 for kw in keywords if kw and kw in answer)


def _split_ngrams(text: str, n: int = 3) -> list[str]:
    cleaned = re.sub(r"[\s，。！？,.!?:;；：《》()（）\[\]【】\"'\n]+", "", text or "")
    if len(cleaned) < n:
        return []
    return [cleaned[i : i + n] for i in range(len(cleaned) - n + 1)]


def ngram_overlap_3(a: str, b: str) -> float:
    ga = set(_split_ngrams(a, 3))
    gb = set(_split_ngrams(b, 3))
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / max(len(ga), len(gb))


def word_count_cn(text: str) -> int:
    if not text:
        return 0
    cn = len(re.findall(r"[\u4e00-\u9fff]", text))
    en = len(re.findall(r"[A-Za-z]+", text))
    return cn + en


# --- Runner ---------------------------------------------------------------


@dataclass
class RunResult:
    case_id: str
    model_name: str
    variant: str  # "OLD" or "NEW"
    text: str
    elapsed_ms: int
    error: str | None = None


def _load_enabled_models(model_filter: set[str] | None):
    from core.config import get_config
    cfg = get_config()
    out = []
    for m in cfg.models:
        if not m.enabled or not (m.api_key or "").strip():
            continue
        if model_filter and m.name not in model_filter:
            continue
        out.append(m)
    return out


def _disable_ws_broadcast():
    """chat_stream_single_model 通过 _broadcast_tokens 调用 ws.broadcast,
    本地脚本运行无 WS; patch 为 no-op。"""
    try:
        import api.realtime.ws as ws_mod  # type: ignore
        ws_mod.broadcast = lambda payload: None  # type: ignore[assignment]
    except Exception:
        pass


def _set_resume(resume_text: str | None):
    from core.config import get_config
    get_config().resume_text = resume_text


# NOTE: OLD 对照需要先 git checkout 到 prompts.py 修改前的 commit 再跑一次,
# 然后恢复 NEW 版本再跑一次。本函数在单次运行内只拿到当前文件的 prompt;
# 想要真正的 before/after 对比, 请用 --only-new 分两次 commit 跑两遍。
def _prompt_for_old(case: dict[str, Any]) -> str:
    from services.llm import build_system_prompt
    return build_system_prompt(
        mode=case["mode"],
        high_churn_short_answer=case.get("high_churn", False),
    )


def _prompt_for_new(case: dict[str, Any]) -> str:
    from services.llm import build_system_prompt
    return build_system_prompt(
        mode=case["mode"],
        high_churn_short_answer=case.get("high_churn", False),
    )


def _run_one_case(
    model_cfg,
    case: dict[str, Any],
    variant: str,
    prompts_by_variant: dict[str, Callable[[dict[str, Any]], str]],
) -> RunResult:
    from services.llm import chat_stream_single_model

    system_prompt = prompts_by_variant[variant](case)
    user_text = case["input"]
    if case.get("context") and case["context"].get("prev_idx"):
        prev_idx = case["context"]["prev_idx"]
        user_text = f"[追问上下文] 上一轮用户问: (case {prev_idx})\n\n{user_text}"

    t0 = time.monotonic()
    chunks: list[str] = []
    try:
        for kind, txt in chat_stream_single_model(
            model_cfg,
            messages=[{"role": "user", "content": user_text}],
            system_prompt=system_prompt,
        ):
            if kind == "text" and txt:
                chunks.append(txt)
        return RunResult(
            case_id=case["id"],
            model_name=model_cfg.name,
            variant=variant,
            text="".join(chunks),
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
    except Exception as e:  # noqa: BLE001
        return RunResult(
            case_id=case["id"],
            model_name=model_cfg.name,
            variant=variant,
            text="",
            elapsed_ms=int((time.monotonic() - t0) * 1000),
            error=str(e),
        )


def _category_counts(cases: list[dict[str, Any]]) -> str:
    from collections import Counter
    c = Counter(x["category"] for x in cases)
    return " ".join(f"{k}={v}" for k, v in c.items())


def _count_where(arr: list[str], pred: Callable[[str], bool]) -> int:
    return sum(1 for x in arr if pred(x))


def _group_by_variant_cat(
    results: list[RunResult],
    cases: list[dict[str, Any]],
) -> dict[tuple[str, str], list[str]]:
    by_cat: dict[tuple[str, str], list[str]] = {}
    case_by_id = {c["id"]: c for c in cases}
    for r in results:
        if r.error:
            continue
        cat = case_by_id[r.case_id]["category"]
        by_cat.setdefault((r.variant, cat), []).append(r.text)
    return by_cat


def _summary_table(
    results: list[RunResult],
    cases: list[dict[str, Any]],
    models: list[Any],
) -> str:
    by_cat = _group_by_variant_cat(results, cases)
    variants = sorted({r.variant for r in results})

    def cell(variant: str, cat: str, pred: Callable[[str], bool]) -> str:
        arr = by_cat.get((variant, cat), [])
        return f"{_count_where(arr, pred)}/{len(arr)}" if arr else "n/a"

    rows: list[str] = []
    header = "| Category | Metric | " + " | ".join(variants) + " |"
    sep = "|---|---|" + "---|" * len(variants)
    rows.append(header)
    rows.append(sep)

    # B: 信息不足
    rows.append(
        "| B 可猜意图 | \"信息不足\"落率 | "
        + " | ".join(cell(v, "guessable", has_info_insufficient_phrase) for v in variants)
        + " |"
    )
    # D: 简历 >=2 keyword
    rows.append(
        "| D 简历深挖 | 简历关键词≥2命中 | "
        + " | ".join(
            cell(v, "resume_deepdive", lambda t: resume_keyword_hits(t, RESUME_KEYWORDS) >= 2)
            for v in variants
        )
        + " |"
    )
    # ALL: 首句引子率
    def all_for(variant: str) -> list[str]:
        out: list[str] = []
        for cat in ("complete", "guessable", "smalltalk", "resume_deepdive", "followup"):
            out.extend(by_cat.get((variant, cat), []))
        return out

    rows.append(
        "| ALL | 首句引子率 | "
        + " | ".join(
            f"{_count_where(all_for(v), lambda t: not first_sentence_is_compliant(t))}/{len(all_for(v))}"
            for v in variants
        )
        + " |"
    )
    # HC: word count range 80-220
    hc_ids = {c["id"] for c in cases if c["high_churn"]}
    def hc_in_range_ratio(variant: str) -> str:
        hc_results = [
            r for r in results
            if r.variant == variant and r.case_id in hc_ids and not r.error
        ]
        in_range = sum(1 for r in hc_results if 80 <= word_count_cn(r.text) <= 220)
        return f"{in_range}/{len(hc_results)}" if hc_results else "n/a"

    rows.append(
        "| HC | 字数 80-220 范围率 | "
        + " | ".join(hc_in_range_ratio(v) for v in variants)
        + " |"
    )
    return "\n".join(rows)


def _format_report(
    results: list[RunResult],
    cases: list[dict[str, Any]],
    models: list[Any],
    out_path: Path,
    variants_ran: tuple[str, ...],
):
    ts = time.strftime("%Y-%m-%d %H:%M", time.localtime())
    index: dict[tuple[str, str, str], RunResult] = {
        (r.case_id, r.model_name, r.variant): r for r in results
    }

    lines: list[str] = []
    lines.append(f"# Bench Prompt Report - {ts}")
    lines.append("")
    lines.append(f"- 模型: {', '.join(m.name for m in models)}")
    lines.append(f"- Case: {len(cases)} ({_category_counts(cases)})")
    lines.append(f"- Variants: {', '.join(variants_ran)}")
    lines.append(f"- Total requests: {len(results)}")
    err_n = sum(1 for r in results if r.error)
    if err_n:
        lines.append(f"- Errors: {err_n}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(_summary_table(results, cases, models))
    lines.append("")
    lines.append("## Per-Case")
    lines.append("")
    for c in cases:
        lines.append(
            f"### [{c['id']}] {c['category']} | {c['mode']} | high_churn={c['high_churn']}"
        )
        lines.append(f"**Input**: {c['input']}")
        lines.append("")
        for m in models:
            lines.append(f"#### {m.name}")
            for variant in variants_ran:
                r = index.get((c["id"], m.name, variant))
                if not r:
                    continue
                header = f"**{variant}** ({r.elapsed_ms} ms"
                if r.error:
                    header += ", error)"
                else:
                    header += ")"
                lines.append(header)
                if r.error:
                    lines.append(f"> `{r.error}`")
                else:
                    lines.append("")
                    lines.append(r.text.strip() or "(empty)")
                lines.append("")
            lines.append("")
        lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", help="逗号分隔模型名, 默认所有启用", default="")
    parser.add_argument("--cases", type=int, default=0, help="只跑前 N 个 case, 0 表示全部")
    parser.add_argument("--only-new", action="store_true", help="只跑 NEW, 跳过 OLD 对照")
    parser.add_argument("--out", default="log/bench_prompt.md")
    parser.add_argument(
        "--category",
        help="逗号分隔的类别过滤 (complete/guessable/smalltalk/resume_deepdive/followup)",
        default="",
    )
    args = parser.parse_args()

    _disable_ws_broadcast()

    model_filter = {s.strip() for s in args.models.split(",") if s.strip()} or None
    models = _load_enabled_models(model_filter)
    if not models:
        print("没有可用的启用模型（检查 config.json 的 enabled + api_key）", file=sys.stderr)
        sys.exit(2)

    cases = list(BENCH_CASES)
    if args.category:
        cat_filter = {s.strip() for s in args.category.split(",") if s.strip()}
        cases = [c for c in cases if c["category"] in cat_filter]
    if args.cases > 0:
        cases = cases[: args.cases]

    variants_ran: tuple[str, ...] = ("NEW",) if args.only_new else ("OLD", "NEW")
    prompts_by_variant: dict[str, Callable[[dict[str, Any]], str]] = {
        "OLD": _prompt_for_old,
        "NEW": _prompt_for_new,
    }

    _set_resume(RESUME_FIXTURE)
    results: list[RunResult] = []
    interrupted = False
    try:
        total = len(models) * len(cases) * len(variants_ran)
        done = 0
        for m in models:
            for variant in variants_ran:
                for c in cases:
                    done += 1
                    print(
                        f"[{done}/{total}] {m.name} | {variant} | {c['id']} ...",
                        flush=True,
                    )
                    r = _run_one_case(m, c, variant, prompts_by_variant)
                    results.append(r)
                    if r.error:
                        print(f"    ERROR: {r.error}", file=sys.stderr)
    except KeyboardInterrupt:
        interrupted = True
        print("\n[interrupted] writing partial report...", file=sys.stderr)
    finally:
        _set_resume(None)

    out_path = Path(args.out)
    _format_report(results, cases, models, out_path, variants_ran)
    tag = " (partial, interrupted)" if interrupted else ""
    print(f"\nReport written: {out_path.resolve()}{tag}")


if __name__ == "__main__":
    main()
