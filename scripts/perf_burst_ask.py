"""真实面试场景压测：连续提交 N 个问题, 每个问题后端走 max_parallel_answers=2 双路并发.

跑法:
    python scripts/perf_burst_ask.py            # 默认 50 题, 间隔 1.5s
    python scripts/perf_burst_ask.py 30 2.0     # 30 题, 间隔 2.0s

期间用浏览器 profile/snapshot 观察 UI 性能; 后端 log 里能看到 LLM 调用耗时.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from urllib import request as urlreq
from urllib.error import URLError

API_URL = "http://127.0.0.1:18080/api/ask"

# 50 道真实面试题, 涵盖语言/算法/系统设计/项目深挖/行为面, 长度差异化以模拟自然
# 输入. 故意混入需要长答案的(系统设计/项目)和需要短答案的(基础概念).
QUESTIONS: list[str] = [
    # === Java 基础 (8) ===
    "讲讲 Java 中 HashMap 在 1.8 后的扩容流程, 为什么改成尾插法",
    "synchronized 和 ReentrantLock 有什么区别, 各自适合什么场景",
    "JVM 的内存模型 JMM 中 happens-before 规则你能说几条",
    "ThreadLocal 内存泄漏是怎么发生的, 怎么避免",
    "ConcurrentHashMap 1.7 的分段锁和 1.8 的 CAS+synchronized 谁更好",
    "Java 中的强软弱虚四种引用各自什么场景用",
    "字符串拼接到底什么时候用 + 什么时候用 StringBuilder",
    "Java 中的 volatile 能保证原子性吗, 为什么",
    # === 算法 (10) ===
    "给一个数组找出和为 target 的两数下标, 最优解空间复杂度多少",
    "如何判断单链表是否有环, 入环节点怎么找",
    "二叉树的中序遍历用迭代怎么写",
    "实现一个 LRU 缓存, 要求 get/put 都是 O(1)",
    "字符串最长公共子序列 LCS 怎么做, 状态转移方程是什么",
    "给一个旋转有序数组找出最小元素, O(logn) 怎么实现",
    "口算: 1000 万整数排序占多少内存, 用什么算法最优",
    "Top K 问题用堆做时间复杂度是多少, 能不能更快",
    "动态规划和贪心的本质区别, 怎么判断一个题能不能用贪心",
    "给一个有向图判断是否有环, BFS 和 DFS 各自怎么实现",
    # === Spring (6) ===
    "Spring 的 Bean 生命周期讲一下",
    "@Transactional 失效的场景有哪些",
    "Spring Boot 的自动装配原理, @EnableAutoConfiguration 怎么生效",
    "Spring AOP 是怎么实现的, JDK 动态代理和 CGLIB 怎么选",
    "循环依赖三级缓存, 为什么是三级而不是二级",
    "Spring MVC 的请求处理流程你能讲清楚吗",
    # === 数据库 (8) ===
    "MySQL 索引的 B+ 树和 B 树区别在哪, 为什么 InnoDB 选 B+",
    "explain 里 type 列从最优到最差有哪些值",
    "MVCC 是怎么实现的, undo log 在其中的作用",
    "什么情况下索引会失效, 列举 5 种",
    "redis 的过期 key 是怎么删的, 内存淘汰策略有哪些",
    "redis 缓存穿透/击穿/雪崩的区别和解决方案",
    "redis 的持久化 RDB 和 AOF 怎么选, 各自的优劣",
    "分布式锁用 redis 做, setnx 和 redlock 的争议在哪",
    # === 系统设计 (6) ===
    "设计一个短链接服务, 6 位短码够用吗, 怎么生成",
    "设计一个秒杀系统, 怎么扛住瞬时百万 QPS",
    "设计一个 IM 系统, 长连接怎么管, 消息怎么不丢不重",
    "设计微博 feed 流, 推模式和拉模式怎么权衡",
    "如何设计一个限流系统, 滑动窗口和令牌桶选哪个",
    "如何设计一个分布式 ID 生成器, 雪花算法的痛点是什么",
    # === 中间件 / 网络 (6) ===
    "Kafka 怎么保证消息不丢, ack=all 还能丢吗",
    "Kafka 怎么保证消息有序, 全局有序怎么做",
    "RocketMQ 和 Kafka 各自适合什么场景",
    "TCP 的三次握手为什么不是两次或四次",
    "HTTPS 握手过程讲一下, 中间人攻击怎么防",
    "为什么 HTTP/2 用了 HPACK, 它解决了什么问题",
    # === 项目 / 行为面 (6) ===
    "讲一个你做过最有挑战的项目, 你的角色和贡献是什么",
    "你做过的项目里有没有遇到过线上事故, 怎么排查的",
    "你为什么从上一家公司离职",
    "你未来 3 年的职业规划是什么",
    "你怎么平衡技术深度和业务交付的优先级",
    "如果让你重做之前的某个项目, 你会怎么改进架构",
]


def post_ask(text: str) -> tuple[bool, float, str]:
    payload = json.dumps({"text": text}).encode("utf-8")
    req = urlreq.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    try:
        with urlreq.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            elapsed = (time.time() - t0) * 1000
            return True, elapsed, body
    except URLError as e:
        elapsed = (time.time() - t0) * 1000
        return False, elapsed, f"URLError: {e.reason}"
    except Exception as e:  # noqa: BLE001
        elapsed = (time.time() - t0) * 1000
        return False, elapsed, f"{type(e).__name__}: {e}"


async def main(n: int, gap_sec: float) -> None:
    n = max(1, min(n, len(QUESTIONS)))
    qs = QUESTIONS[:n]
    print(f"[perf] 提交 {n} 题, 间隔 {gap_sec}s, 后端走 2 路并发, 总计预期 {n * 2} 路 LLM 调用")
    print(f"[perf] 第一题: {qs[0]}")

    overall_t0 = time.time()
    ok = 0
    fail = 0
    for i, q in enumerate(qs, 1):
        success, ms, body = await asyncio.to_thread(post_ask, q)
        marker = "✓" if success else "✗"
        if success:
            ok += 1
        else:
            fail += 1
        print(f"[{i:>2}/{n}] {marker} {ms:>5.0f}ms  {q[:36]}{'…' if len(q) > 36 else ''}")
        if not success:
            print(f"        body: {body[:120]}")
        if i < n:
            await asyncio.sleep(gap_sec)

    total = time.time() - overall_t0
    print(
        f"[perf] 全部提交完成: {ok} ok / {fail} fail / 用时 {total:.1f}s "
        f"(剩下要等 LLM 流式答完, 看前端 UI / log/app.log)"
    )


if __name__ == "__main__":
    n_arg = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    gap_arg = float(sys.argv[2]) if len(sys.argv) > 2 else 1.5
    asyncio.run(main(n_arg, gap_arg))
