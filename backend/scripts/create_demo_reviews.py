"""
创建演示用的面试复盘记录
用法：python -m scripts.create_demo_reviews
"""
import sys
import time
from pathlib import Path
from datetime import datetime, timedelta
import random

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.storage import review
from core.logger import get_logger

logger = get_logger(__name__)


DEMO_SESSIONS = [
    {
        'company': '字节跳动',
        'role': '后端开发工程师',
        'started_offset_days': -7,
        'duration_min': 45,
        'turns': [
            {
                'question': '请简单介绍一下你最近做过的项目',
                'candidate_answer': '我最近主要做的是一个面试辅助系统，主要功能包括实时语音识别、LLM答题辅助和面试复盘分析。技术栈用的是Python FastAPI后端，前端是React+TypeScript。',
                'reference_answer': '可以从项目背景、技术选型、个人职责和项目成果等角度展开介绍。',
            },
            {
                'question': 'Python的GIL是什么？它会带来什么问题？',
                'candidate_answer': 'GIL是全局解释器锁，保证同一时刻只有一个线程执行Python字节码。主要问题是多线程无法利用多核CPU，CPU密集型任务性能受限。',
                'reference_answer': 'GIL（Global Interpreter Lock）是CPython中的互斥锁，防止多个线程同时执行Python字节码。影响：1) 多线程无法并行执行CPU密集任务 2) I/O密集任务影响较小 3) 可通过多进程绕过。',
            },
            {
                'question': '如何设计一个高并发的抢购系统？',
                'candidate_answer': '我觉得可以用Redis做库存预减，消息队列削峰，数据库层面加乐观锁。',
                'reference_answer': '1) 前端：按钮防抖、验证码 2) 接入层：限流、CDN 3) 服务层：Redis库存预减、令牌桶 4) 数据层：分库分表、读写分离 5) 异步：MQ削峰填谷 6) 兜底：降级、熔断。',
            },
        ],
    },
    {
        'company': '腾讯',
        'role': 'Python后端开发',
        'started_offset_days': -5,
        'duration_min': 50,
        'turns': [
            {
                'question': '讲讲Python装饰器的实现原理',
                'candidate_answer': '装饰器本质是高阶函数，接收一个函数返回一个新函数。通过闭包保存原函数引用，在新函数中加入额外逻辑。',
                'reference_answer': '装饰器是返回函数的函数，利用闭包机制。@decorator语法糖等价于func = decorator(func)。常见应用：日志、权限、缓存、重试等。',
            },
            {
                'question': 'MySQL索引失效的场景有哪些？',
                'candidate_answer': '用函数、左模糊查询、类型转换、or条件、不等于会导致索引失效。',
                'reference_answer': '1) 列上使用函数 2) 隐式类型转换 3) 左模糊或全模糊like 4) 联合索引不满足最左前缀 5) 使用!=或<> 6) or连接且一侧无索引 7) 索引列参与计算。',
            },
            {
                'question': 'Redis持久化方式及区别？',
                'candidate_answer': 'RDB快照，全量备份，恢复快但可能丢数据。AOF记录命令，数据安全但文件大。',
                'reference_answer': 'RDB：二进制快照，fork子进程备份，恢复快但会丢失最后一次快照后的数据。AOF：追加命令日志，可配置fsync策略（always/everysec/no），更安全但文件大、恢复慢。混合持久化：RDB+增量AOF。',
            },
        ],
    },
    {
        'company': 'Anthropic',
        'role': 'Senior Backend Engineer',
        'started_offset_days': -2,
        'duration_min': 60,
        'turns': [
            {
                'question': 'Explain how you would design a distributed rate limiter',
                'candidate_answer': 'Use Redis with sliding window algorithm, store request timestamps in sorted set, count within time window. Consider using Lua script for atomic operations.',
                'reference_answer': 'Approaches: 1) Token bucket in Redis with atomic incr/decr 2) Sliding window with sorted sets 3) Fixed window with distributed counters 4) Consider consistency vs availability tradeoff. Implementation: Lua scripts for atomicity, local cache for performance, fallback strategy.',
            },
            {
                'question': 'How do you handle database migrations in production with zero downtime?',
                'candidate_answer': 'Use backward compatible changes, deploy code first then schema, add new columns as nullable, use feature flags.',
                'reference_answer': 'Best practices: 1) Make changes backward compatible 2) Use expand-migrate-contract pattern 3) Deploy in phases: add new column (nullable) → deploy code using both → backfill data → make non-nullable → remove old column 4) Use blue-green deployment or canary releases.',
            },
        ],
    },
    {
        'company': '美团',
        'role': 'Java后端开发',
        'started_offset_days': -10,
        'duration_min': 40,
        'turns': [
            {
                'question': 'Spring Bean的生命周期是怎样的？',
                'candidate_answer': '实例化、属性填充、初始化、使用、销毁。初始化前后有BeanPostProcessor的回调。',
                'reference_answer': '完整流程：1) 实例化Bean 2) 设置属性值 3) BeanNameAware等Aware接口回调 4) BeanPostProcessor前置处理 5) InitializingBean或init-method 6) BeanPostProcessor后置处理 7) 使用 8) DisposableBean或destroy-method。',
            },
            {
                'question': 'JVM内存模型和垃圾回收算法？',
                'candidate_answer': '堆分新生代和老年代，方法区存类信息。GC算法有标记清除、复制、标记整理。',
                'reference_answer': '内存区域：堆（新生代Eden+Survivor、老年代）、方法区/元空间、栈、程序计数器、本地方法栈。GC算法：标记-清除（碎片）、复制（空间浪费）、标记-整理（慢）。分代收集：新生代复制，老年代标记-整理。',
            },
        ],
    },
]


def create_demo_session(session_data):
    """创建一个演示会话"""
    # 计算时间戳
    now = datetime.now()
    started_dt = now + timedelta(days=session_data['started_offset_days'])
    started_at = started_dt.timestamp()
    ended_at = started_at + session_data['duration_min'] * 60

    # 创建 session
    session_id = review.create_session(
        started_at=started_at,
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    # 添加 turns
    for idx, turn_data in enumerate(session_data['turns'], start=1):
        review.add_turn(
            session_id=session_id,
            qa_id=f"demo_{session_id}_{idx}",
            seq=idx,
            question_text=turn_data['question'],
            candidate_answer_text=turn_data['candidate_answer'],
            reference_answer_text=turn_data['reference_answer'],
            duration_ms=random.randint(60000, 180000),  # 1-3分钟
            is_partial=False,
            analysis_status='pending',
        )

    # 结束 session
    review.end_session(session_id=session_id, ended_at=ended_at)

    # 更新公司和岗位信息
    import sqlite3
    db_path = Path(__file__).parent.parent / 'data' / 'review.db'
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE review_sessions
        SET company = ?, role = ?
        WHERE id = ?
        """,
        (session_data['company'], session_data['role'], session_id)
    )
    conn.commit()
    conn.close()

    return session_id


def main():
    """主函数"""
    print("正在创建演示面试记录...")

    created_count = 0
    for session_data in DEMO_SESSIONS:
        try:
            session_id = create_demo_session(session_data)
            created_count += 1
            print(f"[OK] 创建会话 {session_id}: {session_data['company']} - {session_data['role']}")
        except Exception as e:
            print(f"[ERROR] 创建失败: {e}")
            logger.error(f"Failed to create demo session: {e}", exc_info=True)

    print(f"\n成功创建 {created_count} 个演示会话")

    # 显示统计
    stats = review.get_session_list(page=1, page_size=1)
    print(f"数据库中现有 {stats['total']} 场面试记录")


if __name__ == '__main__':
    main()
