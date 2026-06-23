"""
为 review 模块生成测试数据
"""
import time
from services.storage import review


def seed_review_data():
    """生成一些测试面试记录"""
    # Session 1: 已完成的后端面试
    session1 = review.create_session(
        started_at=time.time() - 86400 * 2,  # 2天前
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    review.add_turn(
        session_id=session1,
        qa_id="q1",
        seq=1,
        question_text="请介绍一下 Python 的 GIL（全局解释器锁）",
        candidate_answer_text="GIL 是 Python 解释器中的一个互斥锁，它确保同一时刻只有一个线程在执行 Python 字节码。这是因为 CPython 的内存管理不是线程安全的。GIL 的存在使得多线程程序在 CPU 密集型任务上无法充分利用多核 CPU，但对 I/O 密集型任务影响较小。",
        duration_ms=45000,
        is_partial=False,
        analysis_status="completed",
        strengths=["准确描述了 GIL 的本质", "提到了对多线程的影响", "区分了 CPU 密集和 I/O 密集场景"],
        risks=["可以补充如何绕过 GIL（multiprocessing、Cython）"],
        scorecard={"准确性": 8, "深度": 7, "表达": 8},
    )

    review.add_turn(
        session_id=session1,
        qa_id="q2",
        seq=2,
        question_text="Django 和 Flask 有什么区别？",
        candidate_answer_text="Django 是一个全栈框架，内置了 ORM、模板引擎、表单验证、用户认证等功能，适合快速开发大型应用。Flask 是一个轻量级框架，只提供核心功能，其他功能需要通过扩展添加，更灵活但需要更多配置。",
        duration_ms=38000,
        is_partial=False,
        analysis_status="completed",
        strengths=["准确区分了两者定位", "提到了适用场景"],
        risks=["未提及性能差异", "可以举实际项目例子"],
        scorecard={"准确性": 7, "深度": 6, "表达": 7},
    )

    review.add_turn(
        session_id=session1,
        qa_id="q3",
        seq=3,
        question_text="如何优化 SQL 查询性能？",
        candidate_answer_text="主要方法包括：1. 为常用查询字段建立索引；2. 避免 SELECT *，只查询需要的字段；3. 使用 JOIN 代替子查询；4. 分页查询大数据集；5. 使用缓存减少数据库访问；6. 定期分析慢查询日志。",
        code_text="""# 示例：添加索引
CREATE INDEX idx_user_email ON users(email);

# 避免 SELECT *
SELECT id, name, email FROM users WHERE status = 'active';""",
        duration_ms=62000,
        is_partial=False,
        analysis_status="completed",
        strengths=["系统性地列举了多种优化方法", "提供了代码示例", "覆盖了索引、查询优化、缓存等关键点"],
        risks=["未深入讲解索引选择原则", "可以补充 EXPLAIN 分析"],
        scorecard={"准确性": 9, "深度": 8, "表达": 9},
    )

    review.end_session(
        session_id=session1,
        ended_at=time.time() - 86400 * 2 + 3600,
        summary_markdown="""## 整体表现

候选人对 Python 和后端开发有扎实的基础，能够准确回答核心概念问题。表达清晰，逻辑性强。

**亮点：**
- 对 GIL、框架选型、SQL 优化等核心知识点掌握扎实
- 能够区分不同场景的适用方案
- 代码示例规范，有实战经验

**改进方向：**
- 可以更深入地讨论底层原理和源码实现
- 适当补充真实项目中的踩坑经验
- 对性能优化可以有更系统的方法论""",
        strong_points=["基础扎实", "表达清晰", "有实战经验"],
        weak_points=["深度可以更进一步", "缺少踩坑案例"],
    )

    # Session 2: 部分录制的前端面试
    session2 = review.create_session(
        started_at=time.time() - 86400,  # 1天前
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    review.add_turn(
        session_id=session2,
        qa_id="q1",
        seq=1,
        question_text="React Hooks 中 useEffect 的清理函数什么时候执行？",
        candidate_answer_text="清理函数会在组件卸载时执行，以及在下一次 effect 执行之前执行。这样可以避免内存泄漏，比如取消订阅、清除定时器等。",
        duration_ms=28000,
        is_partial=False,
        analysis_status="completed",
        strengths=["准确描述了执行时机", "提到了应用场景"],
        risks=["可以补充依赖数组的影响"],
        scorecard={"准确性": 8, "深度": 7, "表达": 8},
    )

    review.add_turn(
        session_id=session2,
        qa_id="q2",
        seq=2,
        question_text="什么是虚拟 DOM？它解决了什么问题？",
        candidate_answer_text="",  # 录制中断
        duration_ms=0,
        is_partial=True,
        analysis_status="pending",
    )

    review.end_session(
        session_id=session2,
        ended_at=time.time() - 86400 + 1800,
        summary_markdown="面试中途中断，仅完成第一题。从已完成的回答看，候选人基础不错。",
        strong_points=["React Hooks 基础扎实"],
        weak_points=[],
    )

    # Session 3: 进行中的面试
    session3 = review.create_session(
        started_at=time.time() - 600,  # 10分钟前
        interviewer_enabled=True,
        candidate_enabled=True,
    )

    review.add_turn(
        session_id=session3,
        qa_id="q1",
        seq=1,
        question_text="请介绍一下你最近做的项目",
        candidate_answer_text="我最近在做一个面试辅助系统，使用 FastAPI 做后端，React + TypeScript 做前端。系统支持实时语音识别、AI 答题辅助、面试复盘等功能。",
        duration_ms=42000,
        is_partial=False,
        analysis_status="pending",
    )

    print(f"[OK] Generated 3 test sessions:")
    print(f"  - Session {session1}: Completed backend interview (3 turns)")
    print(f"  - Session {session2}: Partial frontend interview (2 turns)")
    print(f"  - Session {session3}: Recording interview (1 turn)")


if __name__ == "__main__":
    seed_review_data()
