"""
Stress test: 53-round simulated interview via /api/ask + WebSocket.
Measures: first-token latency, total response time, follow-up context, stability.
"""

import asyncio
import json
import time
import sys
import os
import statistics
from dataclasses import dataclass, field

import aiohttp

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:18080")
WS_URL = BASE.replace("http", "ws") + "/ws"
API_ASK = BASE + "/api/ask"
API_SESSION = BASE + "/api/session"
API_CLEAR = BASE + "/api/clear"

QUESTIONS: list[tuple[str, str]] = [
    ("独立", "请介绍一下 Redis 的基本数据结构"),
    ("独立", "MySQL 的事务隔离级别有哪些"),
    ("追问", "那 MVCC 是怎么实现的"),
    ("追问", "可重复读和读已提交的区别是什么"),
    ("独立", "说说 TCP 三次握手的过程"),
    ("追问", "为什么不能两次握手"),
    ("追问", "那四次挥手呢"),
    ("独立", "介绍一下 Go 的 GMP 调度模型"),
    ("追问", "那 goroutine 和线程的区别呢"),
    ("独立", "什么是分布式一致性？CAP 定理是什么"),
    ("追问", "那 Raft 协议怎么保证一致性"),
    ("追问", "Raft 和 Paxos 的区别"),
    ("独立", "说说 HTTP/2 相比 HTTP/1.1 的改进"),
    ("追问", "多路复用具体是怎么实现的"),
    ("独立", "什么是微服务架构？和单体架构的区别"),
    ("追问", "微服务之间怎么通信"),
    ("追问", "gRPC 和 REST 怎么选"),
    ("独立", "说说你对 Docker 容器化的理解"),
    ("追问", "Docker 和虚拟机有什么区别"),
    ("独立", "什么是 B+ 树？为什么 MySQL 用 B+ 树做索引"),
    ("追问", "那为什么不用哈希索引"),
    ("追问", "联合索引的最左前缀原则是什么"),
    ("独立", "介绍一下 Redis 的持久化机制"),
    ("追问", "RDB 和 AOF 怎么选"),
    ("独立", "什么是死锁？怎么预防"),
    ("追问", "那乐观锁和悲观锁呢"),
    ("独立", "说说 Kafka 的架构设计"),
    ("追问", "Kafka 怎么保证消息不丢失"),
    ("追问", "消费者组的 rebalance 机制是什么"),
    ("独立", "讲讲你对 CDN 的理解"),
    ("独立", "什么是一致性哈希？解决什么问题"),
    ("追问", "虚拟节点是怎么回事"),
    ("独立", "Python 的 GIL 是什么？为什么有 GIL"),
    ("追问", "那 Python 怎么做并发"),
    ("追问", "协程和多线程怎么选"),
    ("独立", "说说 Linux 进程调度算法"),
    ("独立", "什么是缓存穿透、缓存击穿、缓存雪崩"),
    ("追问", "布隆过滤器怎么解决缓存穿透"),
    ("独立", "JWT 和 Session 认证的区别"),
    ("追问", "JWT 的安全风险有哪些"),
    ("独立", "说说 ElasticSearch 的倒排索引"),
    ("追问", "ES 和 MySQL 全文检索的区别"),
    ("独立", "什么是限流？常见的限流算法有哪些"),
    ("追问", "令牌桶和漏桶的区别"),
    ("独立", "说说你对 Kubernetes 的理解"),
    ("追问", "Pod 和容器的关系"),
    ("独立", "什么是设计模式中的观察者模式"),
    ("独立", "讲讲数据库分库分表的策略"),
    ("追问", "分表后怎么做全局排序和分页"),
    ("独立", "说说 WebSocket 和 HTTP 长轮询的区别"),
    ("追问", "WebSocket 断线重连怎么做"),
    ("独立", "什么是零拷贝？sendfile 的原理"),
    ("追问", "mmap 和 sendfile 的区别"),
]


@dataclass
class RoundResult:
    idx: int
    q_type: str
    question: str
    first_token_ms: float = 0.0
    total_ms: float = 0.0
    answer_len: int = 0
    answer_preview: str = ""
    has_context_ref: bool = False
    error: str = ""


async def run_stress_test():
    print(f"\n{'='*72}")
    print(f"  面试压力测试 — {len(QUESTIONS)} 轮对话")
    print("  目标: 首包 < 500ms | 追问关联 | 长时间运行稳定性")
    print(f"{'='*72}\n")

    results: list[RoundResult] = []

    async with aiohttp.ClientSession() as http:
        resp = await http.post(API_CLEAR)
        print(f"[INIT] Clear session: {resp.status}")
        await asyncio.sleep(0.5)

        ws = await http.ws_connect(WS_URL, heartbeat=30)
        init_msg = await asyncio.wait_for(ws.receive_json(), timeout=5)
        print(f"[WS]  连接成功, type={init_msg.get('type')}\n")

        current_qa_id: str | None = None
        first_chunk_mono: float | None = None
        answer_buf: str = ""
        done_event = asyncio.Event()
        error_msg: str = ""

        async def ws_listener():
            nonlocal current_qa_id, first_chunk_mono, answer_buf, done_event, error_msg
            try:
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = json.loads(msg.data)
                        t = data.get("type", "")
                        qid = data.get("id", "")

                        if t == "answer_start":
                            current_qa_id = qid
                            first_chunk_mono = None
                            answer_buf = ""
                            error_msg = ""

                        elif t == "answer_chunk" and qid == current_qa_id:
                            if first_chunk_mono is None:
                                first_chunk_mono = time.monotonic()
                            answer_buf += data.get("chunk", "")

                        elif t == "answer_done" and qid == current_qa_id:
                            answer_buf = data.get("answer", answer_buf)
                            done_event.set()

                        elif t == "answer_cancelled" and qid == current_qa_id:
                            error_msg = "cancelled"
                            done_event.set()

                        elif t == "error":
                            error_msg = data.get("message", "unknown error")
                            done_event.set()

                    elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                        break
            except asyncio.CancelledError:
                pass

        listener = asyncio.create_task(ws_listener())

        for idx, (q_type, question) in enumerate(QUESTIONS):
            r = RoundResult(idx=idx, q_type=q_type, question=question)
            results.append(r)

            done_event.clear()
            current_qa_id = None
            first_chunk_mono = None
            answer_buf = ""
            error_msg = ""

            send_mono = time.monotonic()

            try:
                resp = await http.post(API_ASK, json={"text": question})
                if resp.status != 200:
                    body = await resp.text()
                    r.error = f"HTTP {resp.status}: {body[:80]}"
                    print(f"  [{idx+1:02d}/{len(QUESTIONS)}] {q_type:2s} | ERROR: {r.error}")
                    await asyncio.sleep(0.3)
                    continue
            except Exception as e:
                r.error = str(e)
                print(f"  [{idx+1:02d}/{len(QUESTIONS)}] {q_type:2s} | ERROR: {r.error}")
                await asyncio.sleep(0.3)
                continue

            try:
                await asyncio.wait_for(done_event.wait(), timeout=60.0)
            except asyncio.TimeoutError:
                r.error = "timeout(60s)"

            end_mono = time.monotonic()

            if error_msg and not r.error:
                r.error = error_msg

            r.total_ms = (end_mono - send_mono) * 1000
            if first_chunk_mono is not None:
                r.first_token_ms = (first_chunk_mono - send_mono) * 1000
            else:
                r.first_token_ms = r.total_ms

            r.answer_len = len(answer_buf)
            r.answer_preview = answer_buf[:80].replace("\n", "\\n") if answer_buf else ""

            if r.q_type == "追问" and answer_buf:
                ctx_markers = [
                    "上面", "前面", "刚才", "补充", "继续", "之前",
                    "提到", "所述", "上文", "前文", "上一", "接着",
                ]
                r.has_context_ref = any(m in answer_buf[:300] for m in ctx_markers)

            status = "OK" if not r.error else r.error
            ctx = " [CTX✓]" if r.has_context_ref else ""
            ft = f"{r.first_token_ms:.0f}ms"
            ft_flag = " ⚡" if r.first_token_ms < 500 else " ⚠️" if r.first_token_ms < 2000 else " 🐢"
            print(
                f"  [{idx+1:02d}/{len(QUESTIONS)}] {q_type:2s} |"
                f" 首包:{ft:>8s}{ft_flag} |"
                f" 总:{r.total_ms:>8.0f}ms |"
                f" 答:{r.answer_len:>5d}字 |"
                f" {status}{ctx}"
            )

            delay = 0.8 if q_type == "追问" else 1.5
            await asyncio.sleep(delay)

        listener.cancel()
        try:
            await listener
        except asyncio.CancelledError:
            pass
        await ws.close()

        # Fetch final session state
        try:
            session_resp = await http.get(API_SESSION)
            session_data = await session_resp.json()
            final_qa_count = len(session_data.get("qa_pairs", []))
            final_trans_count = len(session_data.get("transcriptions", []))
        except Exception:
            final_qa_count = -1
            final_trans_count = -1

    # === REPORT ===
    print(f"\n{'='*72}")
    print("  📊 压力测试报告")
    print(f"{'='*72}\n")

    ok_results = [r for r in results if not r.error]
    err_results = [r for r in results if r.error]
    followup_ok = [r for r in ok_results if r.q_type == "追问"]

    print(f"  总轮数: {len(results)},  成功: {len(ok_results)},  失败: {len(err_results)}")
    print(f"  Session 最终状态: qa_pairs={final_qa_count}, transcriptions={final_trans_count}")
    print()

    if ok_results:
        ft_list = [r.first_token_ms for r in ok_results if r.first_token_ms > 0]
        total_list = [r.total_ms for r in ok_results]
        answer_lens = [r.answer_len for r in ok_results]

        print("  ┌──────────────────────────────────────┐")
        print("  │         首包延迟 (first token)        │")
        print("  ├──────────────────────────────────────┤")
        if ft_list:
            ft_sorted = sorted(ft_list)
            p50 = ft_sorted[len(ft_sorted)//2]
            p90 = ft_sorted[int(len(ft_sorted)*0.9)]
            p99 = ft_sorted[min(int(len(ft_sorted)*0.99), len(ft_sorted)-1)]
            avg = statistics.mean(ft_list)
            under_500 = sum(1 for x in ft_list if x < 500)
            under_1000 = sum(1 for x in ft_list if x < 1000)
            print(f"  │  P50:  {p50:>8.0f} ms                   │")
            print(f"  │  P90:  {p90:>8.0f} ms                   │")
            print(f"  │  P99:  {p99:>8.0f} ms                   │")
            print(f"  │  AVG:  {avg:>8.0f} ms                   │")
            print(f"  │  MIN:  {min(ft_list):>8.0f} ms                   │")
            print(f"  │  MAX:  {max(ft_list):>8.0f} ms                   │")
            print(f"  │  < 500ms:  {under_500}/{len(ft_list)} ({under_500/len(ft_list)*100:.0f}%)              │")
            print(f"  │  <1000ms:  {under_1000}/{len(ft_list)} ({under_1000/len(ft_list)*100:.0f}%)              │")
        print("  └──────────────────────────────────────┘")
        print()

        print("  ┌──────────────────────────────────────┐")
        print("  │         总耗时 (端到端)               │")
        print("  ├──────────────────────────────────────┤")
        t_sorted = sorted(total_list)
        print(f"  │  P50:  {t_sorted[len(t_sorted)//2]:>8.0f} ms                   │")
        print(f"  │  P90:  {t_sorted[int(len(t_sorted)*0.9)]:>8.0f} ms                   │")
        print(f"  │  AVG:  {statistics.mean(total_list):>8.0f} ms                   │")
        print("  └──────────────────────────────────────┘")
        print()

        print("  ┌──────────────────────────────────────┐")
        print("  │         回答长度 (字)                 │")
        print("  ├──────────────────────────────────────┤")
        print(f"  │  AVG:  {statistics.mean(answer_lens):>8.0f}                      │")
        print(f"  │  MIN:  {min(answer_lens):>8d}                      │")
        print(f"  │  MAX:  {max(answer_lens):>8d}                      │")
        print("  └──────────────────────────────────────┘")
        print()

        if followup_ok:
            ctx_count = sum(1 for r in followup_ok if r.has_context_ref)
            print("  ┌──────────────────────────────────────┐")
            print("  │         追问上下文关联                │")
            print("  ├──────────────────────────────────────┤")
            print(f"  │  追问总数:   {len(followup_ok):>3d}                       │")
            print(f"  │  检测到上文: {ctx_count:>3d} ({ctx_count/len(followup_ok)*100:.0f}%)                   │")
            print("  └──────────────────────────────────────┘")
            print()

        # Stability: compare first half vs second half
        n = len(ok_results)
        if n >= 10:
            first_half = [r.total_ms for r in ok_results[:n//2]]
            second_half = [r.total_ms for r in ok_results[n//2:]]
            avg_first = statistics.mean(first_half)
            avg_second = statistics.mean(second_half)
            delta_pct = (avg_second - avg_first) / avg_first * 100 if avg_first > 0 else 0

            ft_first = [r.first_token_ms for r in ok_results[:n//2] if r.first_token_ms > 0]
            ft_second = [r.first_token_ms for r in ok_results[n//2:] if r.first_token_ms > 0]
            ft_avg_first = statistics.mean(ft_first) if ft_first else 0
            ft_avg_second = statistics.mean(ft_second) if ft_second else 0
            ft_delta = (ft_avg_second - ft_avg_first) / ft_avg_first * 100 if ft_avg_first > 0 else 0

            print("  ┌──────────────────────────────────────┐")
            print("  │         长时间运行稳定性              │")
            print("  ├──────────────────────────────────────┤")
            print(f"  │  前半段总耗时 AVG: {avg_first:>7.0f} ms          │")
            print(f"  │  后半段总耗时 AVG: {avg_second:>7.0f} ms          │")
            print(f"  │  总耗时变化:       {delta_pct:>+7.1f}%             │")
            print(f"  │  前半段首包 AVG:   {ft_avg_first:>7.0f} ms          │")
            print(f"  │  后半段首包 AVG:   {ft_avg_second:>7.0f} ms          │")
            print(f"  │  首包变化:         {ft_delta:>+7.1f}%             │")
            if abs(delta_pct) < 25 and abs(ft_delta) < 30:
                print("  │  结论: ✅ 稳定, 无明显性能退化        │")
            elif delta_pct > 25:
                print("  │  结论: ⚠️  后半段变慢, 可能有性能退化 │")
            else:
                print("  │  结论: ✅ 后半段更快 (缓存/预热效果)  │")
            print("  └──────────────────────────────────────┘")

    if err_results:
        print("\n  ---- 失败列表 ----")
        for r in err_results:
            print(f"    [{r.idx+1:02d}] {r.error}: {r.question[:40]}")

    # Pass/Fail verdict
    print(f"\n{'='*72}")
    ok_pct = len(ok_results) / len(results) * 100 if results else 0
    ft_under_500 = sum(1 for r in ok_results if r.first_token_ms < 500 and r.first_token_ms > 0) if ok_results else 0
    ft_pct_500 = ft_under_500 / len(ok_results) * 100 if ok_results else 0

    verdicts = []
    verdicts.append(f"  成功率: {ok_pct:.0f}% {'✅' if ok_pct >= 90 else '❌'}")
    verdicts.append(f"  首包 <500ms 占比: {ft_pct_500:.0f}% {'✅' if ft_pct_500 >= 50 else '⚠️'}")
    if followup_ok:
        ctx_pct = sum(1 for r in followup_ok if r.has_context_ref) / len(followup_ok) * 100
        verdicts.append(f"  追问关联率: {ctx_pct:.0f}% {'✅' if ctx_pct >= 30 else '⚠️'}")
    verdicts.append(f"  完成 {len(QUESTIONS)} 轮: {'✅' if len(ok_results) >= 50 else '⚠️'}")
    for v in verdicts:
        print(v)
    print(f"{'='*72}\n")


if __name__ == "__main__":
    asyncio.run(run_stress_test())
