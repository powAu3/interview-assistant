"""
Realistic interview simulation: tests STT vocabulary handling, follow-up
context, and performance under oral-style Chinese-English mixed input.

Simulates what ASR might produce from a real interviewer — broken sentences,
filler words, mis-transcribed tech terms, rapid follow-ups.
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

# fmt: off
# (类型, 问题文本 — 模拟 ASR 口语转写结果)
# "asr_sim" = 模拟 ASR 可能转出的不标准文本
# "followup" = 追问（连问）
# "rapid" = 快速连问，间隔极短
QUESTIONS: list[tuple[str, str]] = [
    # ── 第一组：基础技术名词识别 ──
    ("独立", "嗯...那个，你跟我讲讲 Redis 的那个数据结构呗，就是它有哪些 data structure"),
    ("追问", "哦那个 sorted set 它底层是用什么实现的，是那个...skiplist 还是啥"),
    ("追问", "那跳表和 b plus tree 比有什么优势呢"),

    # ── 第二组：中英混合专有名词（模拟 ASR 不标准转写）──
    ("独立", "你用过 Kubernetes 吗，就是 k8s 那个容器编排"),
    ("追问", "那个 pod 里面可以跑几个 container，它们共享什么 namespace"),
    ("追问", "service 和 ingress 有啥区别，我老搞混"),
    ("rapid", "那 helm chart 你用过吗"),

    # ── 第三组：口语化 + 停顿 + 模糊表达 ──
    ("独立", "emmm 就是那个...MySQL 的那个锁嘛，你讲讲行锁表锁 gap lock 什么的"),
    ("追问", "那 deadlock 怎么排查啊，show engine innodb status 能看到吗"),
    ("追问", "乐观锁就是 CAS 对吧，那 ABA 问题怎么搞"),

    # ── 第四组：连续快速追问（测性能 + 上下文） ──
    ("独立", "说一下 go 语言的 goroutine 和 channel"),
    ("rapid", "那 channel 有 buffer 和没 buffer 啥区别"),
    ("rapid", "那 select 语句是干嘛的"),
    ("rapid", "context 包呢"),

    # ── 第五组：混合缩写 + 技术栈 ──
    ("独立", "呃你们项目用的是什么 CI CD 流程，Jenkins 还是 GitHub Actions"),
    ("追问", "Docker compose 和 k8s 部署有什么不一样，production 环境用哪个"),
    ("追问", "那个 Dockerfile 的 multi stage build 有啥好处"),

    # ── 第六组：ASR 可能混淆的同音词 ──
    ("独立", "你知道 gRPC 吗，就是 google 的那个 RPC 框架，和 REST API 比怎么样"),
    ("追问", "protobuf 序列化比 JSON 快多少，为什么"),
    ("追问", "那 HTTP 2 的 multiplexing 和 gRPC 有什么关系"),

    # ── 第七组：框架 + 版本号 ──
    ("独立", "React 18 的 concurrent mode 和之前有啥区别...就是那个 suspense"),
    ("追问", "那 useEffect 的 cleanup 什么时候会执行"),
    ("追问", "那 React 和 Vue 3 的 composition API 你觉得哪个好用"),

    # ── 第八组：算法 + 口语化描述 ──
    ("独立", "那个...就是 LRU 缓存怎么实现嘛，你写过吗"),
    ("追问", "时间复杂度要 O(1) 的话是不是得用 hashmap 加 linked list"),
    ("追问", "那 LFU 呢，和 LRU 有啥区别"),

    # ── 第九组：系统设计 + 模糊输入 ──
    ("独立", "如果让你设计一个...嗯...就是秒杀系统吧，怎么搞"),
    ("追问", "那个流量削峰用 MQ 可以吗，Kafka 还是 RabbitMQ"),
    ("追问", "那库存扣减怎么保证不超卖，Redis lua 脚本？"),
    ("rapid", "分布式锁用 Redis 还是 ZooKeeper"),

    # ── 第十组：网络 + 安全 ──
    ("独立", "HTTPS 的握手过程讲一下，就是 TLS handshake"),
    ("追问", "那个 certificate chain 怎么验证的"),
    ("追问", "对称加密和非对称加密在 TLS 里各起什么作用"),

    # ── 第十一组：数据库深入 ──
    ("独立", "PostgreSQL 和 MySQL 你更偏好哪个...就是在实际项目中"),
    ("追问", "PG 的 MVCC 和 MySQL 的有啥不一样"),
    ("追问", "那个 vacuum 是干嘛的，autovacuum 有什么坑"),

    # ── 第十二组：微服务架构 ──
    ("独立", "微服务的那个...就是服务发现是怎么做的，Consul 还是 Nacos"),
    ("追问", "那熔断降级呢，Hystrix 还是 Sentinel"),
    ("追问", "链路追踪用过什么，Jaeger 还是 Zipkin 还是 SkyWalking"),

    # ── 第十三组：性能优化 + 场景题 ──
    ("独立", "线上有个接口突然变慢了，你怎么排查"),
    ("rapid", "如果是 MySQL 慢查询呢"),
    ("rapid", "那 explain 看哪些字段"),
    ("rapid", "index 没走到怎么办"),

    # ── 第十四组：操作系统 + 底层 ──
    ("独立", "说一下 Linux 的 epoll 和 select 还有 poll 的区别"),
    ("追问", "那个 epoll 的 ET 和 LT 模式呢"),
    ("追问", "Nginx 用的是哪种模型"),

    # ── 第十五组：最后几道口语化问题 ──
    ("独立", "你对 WebAssembly 了解多少，WASM 那个"),
    ("追问", "那它可以替代 JavaScript 吗"),
    ("独立", "最后一个问题，你平时怎么学习新技术的，有什么 tech blog 或者 GitHub 项目推荐吗"),
]
# fmt: on


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


async def run_test():
    print(f"\n{'='*76}")
    print(f"  真实面试场景模拟 — {len(QUESTIONS)} 轮对话")
    print(f"  测试: 中英混合名词 | 口语停顿 | 连续追问性能 | 上下文关联")
    print(f"{'='*76}\n")

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

        rapid_latencies: list[float] = []
        group_start: float | None = None
        prev_type = ""

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
                    print(f"  [{idx+1:02d}/{len(QUESTIONS)}] {q_type:4s} | ERROR: {r.error}")
                    await asyncio.sleep(0.3)
                    continue
            except Exception as e:
                r.error = str(e)
                print(f"  [{idx+1:02d}/{len(QUESTIONS)}] {q_type:4s} | ERROR: {r.error}")
                await asyncio.sleep(0.3)
                continue

            try:
                await asyncio.wait_for(done_event.wait(), timeout=90.0)
            except asyncio.TimeoutError:
                r.error = "timeout(90s)"

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

            if r.q_type in ("追问", "rapid") and answer_buf:
                ctx_markers = [
                    "上面", "前面", "刚才", "补充", "继续", "之前",
                    "提到", "所述", "上文", "前文", "上一", "接着",
                    "的确", "没错", "正如", "如你所说", "基于",
                ]
                r.has_context_ref = any(m in answer_buf[:400] for m in ctx_markers)

            if q_type == "rapid":
                rapid_latencies.append(r.first_token_ms)

            status = "OK" if not r.error else r.error
            ctx = " [CTX]" if r.has_context_ref else ""
            ft = f"{r.first_token_ms:.0f}ms"
            ft_flag = " *" if r.first_token_ms < 500 else " ~" if r.first_token_ms < 2000 else " !"
            trunc_q = question[:35] + "..." if len(question) > 35 else question
            print(
                f"  [{idx+1:02d}/{len(QUESTIONS)}] {q_type:4s} |"
                f" ft:{ft:>7s}{ft_flag} |"
                f" total:{r.total_ms:>7.0f}ms |"
                f" len:{r.answer_len:>5d} |"
                f" {status}{ctx}"
                f"  {trunc_q}"
            )

            if q_type == "rapid":
                delay = 0.3
            elif q_type == "追问":
                delay = 0.8
            else:
                delay = 1.5
            await asyncio.sleep(delay)

        listener.cancel()
        try:
            await listener
        except asyncio.CancelledError:
            pass
        await ws.close()

        try:
            session_resp = await http.get(API_SESSION)
            session_data = await session_resp.json()
            final_qa_count = len(session_data.get("qa_pairs", []))
        except Exception:
            final_qa_count = -1

    # ── REPORT ──
    print(f"\n{'='*76}")
    print(f"  REPORT: 真实面试场景模拟")
    print(f"{'='*76}\n")

    ok = [r for r in results if not r.error]
    err = [r for r in results if r.error]
    followups = [r for r in ok if r.q_type in ("追问", "rapid")]
    rapids = [r for r in ok if r.q_type == "rapid"]
    normals = [r for r in ok if r.q_type == "独立"]

    print(f"  Total: {len(results)}  OK: {len(ok)}  Fail: {len(err)}  Session QA: {final_qa_count}")
    print()

    def _stats(label: str, values: list[float]):
        if not values:
            return
        s = sorted(values)
        print(f"  [{label}]")
        print(f"    P50={s[len(s)//2]:.0f}ms  P90={s[int(len(s)*0.9)]:.0f}ms  AVG={statistics.mean(s):.0f}ms  MIN={s[0]:.0f}ms  MAX={s[-1]:.0f}ms")

    _stats("First Token (all)", [r.first_token_ms for r in ok if r.first_token_ms > 0])
    _stats("First Token (独立)", [r.first_token_ms for r in normals if r.first_token_ms > 0])
    _stats("First Token (追问)", [r.first_token_ms for r in followups if r.first_token_ms > 0])
    _stats("First Token (rapid)", [r.first_token_ms for r in rapids if r.first_token_ms > 0])
    print()

    _stats("Total Time (all)", [r.total_ms for r in ok])
    _stats("Answer Length", [float(r.answer_len) for r in ok])
    print()

    if followups:
        ctx_n = sum(1 for r in followups if r.has_context_ref)
        print(f"  [Context Ref]  {ctx_n}/{len(followups)} ({ctx_n/len(followups)*100:.0f}%) followups reference prior context")

    if rapids:
        print(f"  [Rapid Fire]   {len(rapids)} rapid questions, avg ft={statistics.mean([r.first_token_ms for r in rapids]):.0f}ms")
    print()

    n = len(ok)
    if n >= 10:
        first_half_ft = [r.first_token_ms for r in ok[:n//2] if r.first_token_ms > 0]
        second_half_ft = [r.first_token_ms for r in ok[n//2:] if r.first_token_ms > 0]
        if first_half_ft and second_half_ft:
            avg1 = statistics.mean(first_half_ft)
            avg2 = statistics.mean(second_half_ft)
            delta = (avg2 - avg1) / avg1 * 100 if avg1 > 0 else 0
            print(f"  [Stability]  1st-half ft avg={avg1:.0f}ms  2nd-half ft avg={avg2:.0f}ms  delta={delta:+.1f}%")
            if abs(delta) < 25:
                print(f"               Stable")
            elif delta > 25:
                print(f"               WARNING: degradation in 2nd half")
            else:
                print(f"               Good: faster in 2nd half (warmup effect)")
    print()

    # Tech term coverage check
    tech_terms_in_answers = {}
    key_terms = [
        "Redis", "skiplist", "B+", "Kubernetes", "k8s", "Pod", "Ingress",
        "MySQL", "deadlock", "InnoDB", "CAS", "goroutine", "channel",
        "Docker", "gRPC", "protobuf", "HTTP/2", "React", "Suspense",
        "LRU", "HashMap", "Kafka", "RabbitMQ", "Lua", "TLS", "HTTPS",
        "PostgreSQL", "MVCC", "vacuum", "Consul", "Nacos", "epoll",
        "WebAssembly", "WASM",
    ]
    all_answer_text = " ".join(r.answer_preview for r in ok)
    found = [t for t in key_terms if t.lower() in all_answer_text.lower()]
    not_found = [t for t in key_terms if t.lower() not in all_answer_text.lower()]
    print(f"  [Tech Terms]  {len(found)}/{len(key_terms)} key terms appeared in answers (preview)")
    if not_found:
        print(f"               Missing from preview (may be in full answer): {', '.join(not_found[:10])}")

    if err:
        print(f"\n  [Failures]")
        for r in err:
            print(f"    [{r.idx+1:02d}] {r.error}: {r.question[:50]}")

    print(f"\n{'='*76}")
    ok_pct = len(ok) / len(results) * 100 if results else 0
    ft_500 = sum(1 for r in ok if 0 < r.first_token_ms < 500)
    ft_pct = ft_500 / len(ok) * 100 if ok else 0
    ctx_pct = sum(1 for r in followups if r.has_context_ref) / len(followups) * 100 if followups else 0

    print(f"  Success rate: {ok_pct:.0f}% {'PASS' if ok_pct >= 90 else 'FAIL'}")
    print(f"  First token <500ms: {ft_pct:.0f}% {'PASS' if ft_pct >= 40 else 'CHECK'}")
    print(f"  Context association: {ctx_pct:.0f}% {'PASS' if ctx_pct >= 25 else 'CHECK'}")
    print(f"  Completed {len(ok)}/{len(QUESTIONS)} rounds {'PASS' if len(ok) >= 50 else 'CHECK'}")
    print(f"{'='*76}\n")


if __name__ == "__main__":
    asyncio.run(run_test())
