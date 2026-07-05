"""
为求职看板 + 面试复盘生成一组可重复刷新的演示数据。

用法:
  python -m scripts.seed_job_tracker_demo
  python -m scripts.seed_job_tracker_demo --clean-only

说明:
  - 只会清理并重建带内部 demo marker 的样例数据，不影响用户自己的真实记录。
  - 会同时创建 applications、offers，以及 1 对多 review sessions。
  - 会刻意包含 1 条短复盘(<5 轮)，用于验证它能出现在时间线里，但不会进入看板摘要/自动待办。
  - 会包含不同终态样例：面试挂、HR 挂、主动放弃，方便直接看 UI 状态。
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.storage import job_tracker as jt
from services.storage import review


DEMO_APP_MARKER = "[demo:job-tracker-review-v1]"
DEMO_SESSION_MARKER = "__demo_job_tracker_review_v1__"


def _now() -> float:
    return time.time()


def _days_ago(days: float) -> float:
    return _now() - (days * 24 * 60 * 60)


def _days_from_now(days: float) -> float:
    return _now() + (days * 24 * 60 * 60)


def _clear_demo_review_sessions() -> int:
    conn = sqlite3.connect(review.DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id FROM review_sessions WHERE jd_snapshot = ?",
        (DEMO_SESSION_MARKER,),
    ).fetchall()
    session_ids = [int(row["id"]) for row in rows]
    if session_ids:
        placeholders = ",".join("?" * len(session_ids))
        conn.execute(f"DELETE FROM review_turns WHERE session_id IN ({placeholders})", session_ids)
        conn.execute(f"DELETE FROM review_sessions WHERE id IN ({placeholders})", session_ids)
    conn.commit()
    conn.close()
    return len(session_ids)


def _clear_demo_applications() -> int:
    conn = sqlite3.connect(jt.DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id FROM applications WHERE notes LIKE ?",
        (f"%{DEMO_APP_MARKER}%",),
    ).fetchall()
    app_ids = [int(row["id"]) for row in rows]
    if app_ids:
        placeholders = ",".join("?" * len(app_ids))
        conn.execute(f"DELETE FROM offers WHERE application_id IN ({placeholders})", app_ids)
        conn.execute(f"DELETE FROM applications WHERE id IN ({placeholders})", app_ids)
    conn.commit()
    conn.close()
    return len(app_ids)


def clear_demo_data() -> tuple[int, int]:
    removed_sessions = _clear_demo_review_sessions()
    removed_apps = _clear_demo_applications()
    return removed_apps, removed_sessions


def _demo_note(extra: str) -> str:
    text = extra.strip()
    return f"{DEMO_APP_MARKER}\n{text}" if text else DEMO_APP_MARKER


def _create_review_session(
    app: dict[str, Any],
    *,
    started_at: float,
    duration_min: int,
    title: str,
    company: str,
    role: str,
    summary_markdown: str,
    strong_points: list[str],
    weak_points: list[str],
    avg_score: float | None,
    turns: list[dict[str, Any]],
) -> int:
    session_id = review.create_session(
        started_at=started_at,
        interviewer_enabled=True,
        candidate_enabled=True,
        source="manual",
        title=title,
        company=company,
        role=role,
        application_id=int(app["id"]),
        jd_snapshot=DEMO_SESSION_MARKER,
    )
    for idx, turn in enumerate(turns, start=1):
        turn_id = review.add_turn(
            session_id=session_id,
            qa_id=f"demo-{session_id}-{idx}",
            seq=idx,
            question_text=str(turn["question"]),
            candidate_answer_text=str(turn["answer"]),
            reference_answer_text=str(turn.get("reference_answer") or ""),
            duration_ms=int(turn.get("duration_ms") or 90000),
            analysis_status="pending",
        )
        scorecard = turn.get("scorecard")
        strengths = turn.get("strengths") or []
        risks = turn.get("risks") or []
        evidence = {"demo_seed": True}
        if scorecard is not None or strengths or risks:
            review.update_turn_analysis(
                turn_id=turn_id,
                analysis_status="completed",
                strengths=[str(item) for item in strengths],
                risks=[str(item) for item in risks],
                evidence=evidence,
                scorecard={str(k): float(v) for k, v in (scorecard or {}).items()},
            )

    review.end_session(
        session_id=session_id,
        status="completed",
        ended_at=started_at + (duration_min * 60),
    )
    review.sync_application_link_metadata_for_session(session_id)
    review.update_session_summary(
        session_id=session_id,
        summary_markdown=summary_markdown,
        strong_points=strong_points,
        weak_points=weak_points,
        avg_score=avg_score,
    )
    return session_id


def seed_demo_data() -> dict[str, Any]:
    created_apps: list[dict[str, Any]] = []
    created_review_count = 0

    minimax = jt.create_application({
        "company": "MiniMax",
        "position": "AI 产品工程师",
        "city": "上海",
        "stage": "interview2",
        "applied_at": _days_ago(12),
        "next_followup_at": _days_from_now(1.5),
        "todos": [
            {"id": "manual-minimax-prep", "title": "准备二面：梳理上线指标与反馈闭环", "done": False},
        ],
        "notes": _demo_note("多轮推进中的主案例，用来看 1 对多复盘时间线。"),
    })
    created_apps.append(minimax)
    for session in [
        {
            "started_at": _days_ago(8),
            "duration_min": 46,
            "title": "手动复盘",
            "company": "新公司",
            "role": "岗位",
            "summary_markdown": "缓存命中率和方案边界讲得比较完整，但指标拆解还偏泛。",
            "strong_points": ["能主动讲约束条件", "追问时不容易慌"],
            "weak_points": ["指标体系拆得不够细", "没有把线上回路讲完整"],
            "avg_score": 6.4,
            "turns": [
                {
                    "question": "你怎么定义一个 AI 面试辅助产品的北极星指标？",
                    "answer": "我会先看真实面试中的留存和使用频次，再结合面试结束后的复盘完成率。",
                    "scorecard": {"clarity": 7, "depth": 6, "relevance": 7},
                    "strengths": ["知道先找北极星指标"],
                    "risks": ["量化口径还不够细"],
                },
                {
                    "question": "如果识别准确率下降，你会怎么定位？",
                    "answer": "先分设备、场景和说话人，再看是采集、VAD 还是 ASR 的问题。",
                    "scorecard": {"clarity": 7, "depth": 7, "relevance": 8},
                },
                {
                    "question": "怎么验证提词功能真的提升通过率？",
                    "answer": "我会做 AB，比较提词使用组和不用组的通过率。",
                    "scorecard": {"clarity": 6, "depth": 5, "relevance": 6},
                    "risks": ["因果和偏差控制不足"],
                },
                {
                    "question": "如何设计用户反馈闭环？",
                    "answer": "记录面试后是否复盘、是否修改简历、是否补练知识点。",
                    "scorecard": {"clarity": 6, "depth": 6, "relevance": 7},
                },
                {
                    "question": "怎么平衡回答质量和实时性？",
                    "answer": "把实时回答和详细回答拆开，并根据问题紧急度切换。",
                    "scorecard": {"clarity": 7, "depth": 6, "relevance": 7},
                },
                {
                    "question": "讲一个你最近推动过的跨团队项目。",
                    "answer": "我推动了语音采集、LLM 和前端联调，让面试录制和复盘打通。",
                    "scorecard": {"clarity": 7, "depth": 6, "relevance": 7},
                },
            ],
        },
        {
            "started_at": _days_ago(2.1),
            "duration_min": 58,
            "title": "手动复盘",
            "company": "新公司",
            "role": "岗位",
            "summary_markdown": "方案对比更有层次了，但成本模型和实验设计仍然可以再落一点。",
            "strong_points": ["结构更稳", "能主动补 trade-off"],
            "weak_points": ["成本测算略虚", "AB 实验防偏差设计欠缺"],
            "avg_score": 7.2,
            "turns": [
                {
                    "question": "如果做多模型并行回答，你怎么控成本？",
                    "answer": "我会先按场景分层，只让少量高价值问题走多模型，其余走单模型。",
                    "scorecard": {"clarity": 8, "depth": 7, "relevance": 8},
                },
                {
                    "question": "怎么判断用户真正需要详细模式？",
                    "answer": "结合问题类型、历史停留时长和用户显式切换行为来判断。",
                    "scorecard": {"clarity": 7, "depth": 7, "relevance": 8},
                },
                {
                    "question": "如果实时提词误导了用户，怎么止损？",
                    "answer": "先做明显披露，再支持撤回和来源说明，减少错误建议的影响。",
                    "scorecard": {"clarity": 8, "depth": 7, "relevance": 8},
                },
                {
                    "question": "多端录音不同步怎么排查？",
                    "answer": "先看时间戳链路，再看缓冲区、丢包和重采样。",
                    "scorecard": {"clarity": 7, "depth": 7, "relevance": 7},
                },
                {
                    "question": "面试复盘和求职看板为什么要绑定？",
                    "answer": "因为一个岗位会走多轮面试，绑定后可以把弱项沉淀成行动项。",
                    "scorecard": {"clarity": 8, "depth": 8, "relevance": 8},
                },
                {
                    "question": "怎么定义这次联动做成了？",
                    "answer": "用户不用手工重复记两遍，同一岗位的时间线能自然形成。",
                    "scorecard": {"clarity": 7, "depth": 7, "relevance": 8},
                },
                {
                    "question": "如果用户只是测试录音怎么办？",
                    "answer": "少于 5 轮的复盘不自动同步摘要和待办，避免污染看板。",
                    "scorecard": {"clarity": 8, "depth": 8, "relevance": 8},
                },
            ],
        },
        {
            "started_at": _days_ago(0.4),
            "duration_min": 12,
            "title": "手动复盘",
            "company": "新公司",
            "role": "岗位",
            "summary_markdown": "一段短测试片段，只验证录音和转写链路。",
            "strong_points": ["链路正常"],
            "weak_points": ["不计入正式复盘"],
            "avg_score": 5.5,
            "turns": [
                {
                    "question": "能听到我吗？",
                    "answer": "可以，音量正常。",
                    "scorecard": {"clarity": 6, "depth": 5, "relevance": 6},
                },
                {
                    "question": "现在开始测试第二题。",
                    "answer": "第二题也能正常转写。",
                    "scorecard": {"clarity": 6, "depth": 5, "relevance": 6},
                },
                {
                    "question": "结束前再复述一次重点。",
                    "answer": "重点是确认录音、ASR 和复盘挂载没问题。",
                    "scorecard": {"clarity": 6, "depth": 6, "relevance": 6},
                },
            ],
        },
    ]:
        _create_review_session(minimax, **session)
        created_review_count += 1

    deepseek = jt.create_application({
        "company": "DeepSeek",
        "position": "平台后端工程师",
        "city": "北京",
        "stage": "hr_rejected",
        "applied_at": _days_ago(20),
        "notes": _demo_note("终态案例，用来看已挂岗位仍然保留完整复盘时间线。"),
    })
    created_apps.append(deepseek)
    for session in [
        {
            "started_at": _days_ago(15),
            "duration_min": 52,
            "title": "手动复盘",
            "company": "新公司",
            "role": "岗位",
            "summary_markdown": "技术面整体不错，表达节奏比较稳。",
            "strong_points": ["数据库和缓存基础扎实", "回答有结构"],
            "weak_points": ["跨团队协作案例偏少"],
            "avg_score": 7.8,
            "turns": [
                {"question": "讲一下 MySQL 索引失效场景。", "answer": "函数、隐式转换、左模糊都会导致失效。", "scorecard": {"clarity": 8, "depth": 8, "relevance": 8}},
                {"question": "Redis 持久化怎么选？", "answer": "看恢复速度和数据安全要求，通常 RDB+AOF。", "scorecard": {"clarity": 8, "depth": 7, "relevance": 8}},
                {"question": "怎么做慢查询治理？", "answer": "先定位热点，再看索引、SQL 改写和缓存。", "scorecard": {"clarity": 7, "depth": 7, "relevance": 8}},
                {"question": "讲一个你做过的线上事故。", "answer": "我讲了缓存雪崩和回滚过程。", "scorecard": {"clarity": 8, "depth": 7, "relevance": 7}},
                {"question": "如何设计限流中间件？", "answer": "可以用令牌桶，核心在原子扣减和可观测性。", "scorecard": {"clarity": 8, "depth": 8, "relevance": 8}},
            ],
        },
        {
            "started_at": _days_ago(6),
            "duration_min": 35,
            "title": "手动复盘",
            "company": "新公司",
            "role": "岗位",
            "summary_markdown": "HR 面主要问题在动机和稳定性表达，技术并不是主要扣分点。",
            "strong_points": ["技术经历能自圆其说"],
            "weak_points": ["离职动机表达不够稳", "职业规划过于泛化"],
            "avg_score": 5.9,
            "turns": [
                {"question": "为什么想离开上一家公司？", "answer": "我想寻找更有挑战的新方向。", "scorecard": {"clarity": 6, "depth": 5, "relevance": 6}, "risks": ["动机略虚"]},
                {"question": "未来 2 年职业规划是什么？", "answer": "希望继续做平台后端，也会关注 AI 工具方向。", "scorecard": {"clarity": 6, "depth": 5, "relevance": 6}},
                {"question": "为什么选择我们？", "answer": "我认可你们在工程效率上的积累。", "scorecard": {"clarity": 6, "depth": 5, "relevance": 6}},
                {"question": "最大的沟通冲突是什么？", "answer": "我讲了跨团队接口延期的一次协作。", "scorecard": {"clarity": 6, "depth": 6, "relevance": 6}},
                {"question": "薪资预期怎么考虑？", "answer": "我会综合岗位匹配和成长空间。", "scorecard": {"clarity": 6, "depth": 5, "relevance": 6}},
            ],
        },
    ]:
        _create_review_session(deepseek, **session)
        created_review_count += 1

    lark = jt.create_application({
        "company": "飞书",
        "position": "增长产品经理",
        "city": "上海",
        "stage": "offer",
        "applied_at": _days_ago(18),
        "next_followup_at": _days_from_now(3),
        "notes": _demo_note("Offer 案例，用来看分数 badge、时间和 offer 信息。"),
    })
    jt.create_or_update_offer({
        "application_id": lark["id"],
        "base_salary": "45k x 16",
        "total_pkg_note": "年度总包约 78w",
        "bonus": "10%",
        "equity": "少量 RSU",
        "benefits": ["补充公积金", "午晚餐", "年度体检"],
        "wfh": "每周 2 天",
        "location": "上海",
        "pros": "业务成熟、反馈快",
        "cons": "节奏偏快",
        "deadline": _days_from_now(5),
    })
    created_apps.append(lark)
    _create_review_session(
        lark,
        started_at=_days_ago(9),
        duration_min=50,
        title="手动复盘",
        company="新公司",
        role="岗位",
        summary_markdown="产品 sense 和数据验证都比较稳，已经到了 offer 阶段。",
        strong_points=["业务拆解清楚", "实验设计意识强"],
        weak_points=["少数案例还可以再量化"],
        avg_score=8.4,
        turns=[
            {"question": "你最近做过最有效的一次增长实验是什么？", "answer": "我讲了引导链路改版，把激活率提升了 12%。", "scorecard": {"clarity": 8, "depth": 8, "relevance": 9}},
            {"question": "怎么判断一个功能值得继续投？", "answer": "看留存、转化和长期成本是否匹配。", "scorecard": {"clarity": 8, "depth": 8, "relevance": 8}},
            {"question": "如果目标冲突，怎么排优先级？", "answer": "按目标收益、实现成本和窗口期综合排序。", "scorecard": {"clarity": 8, "depth": 8, "relevance": 8}},
            {"question": "讲一个失败实验。", "answer": "我分享了一个短信召回策略，虽然打开率高但留存差。", "scorecard": {"clarity": 8, "depth": 8, "relevance": 8}},
            {"question": "怎么和研发磨一个增长方案？", "answer": "先统一目标，再把实验条件拆成可落地的里程碑。", "scorecard": {"clarity": 8, "depth": 8, "relevance": 8}},
        ],
    )
    created_review_count += 1

    xhs = jt.create_application({
        "company": "小红书",
        "position": "前端工程师",
        "city": "上海",
        "stage": "written",
        "applied_at": _days_ago(6),
        "next_followup_at": _days_from_now(2),
        "todos": [
            {"id": "manual-xhs-1", "title": "准备笔试：JS 异步和性能题", "done": False},
            {"id": "manual-xhs-2", "title": "补一遍 CSS 布局和手写题", "done": False},
        ],
        "notes": _demo_note("无复盘案例，用来观察默认表格和详情在轻状态下的密度。"),
    })
    created_apps.append(xhs)

    hik = jt.create_application({
        "company": "海康威视",
        "position": "数据平台工程师",
        "city": "杭州",
        "stage": "withdrawn",
        "applied_at": _days_ago(25),
        "notes": _demo_note("已放弃案例，用来看终态但非挂掉的文案。"),
    })
    created_apps.append(hik)
    _create_review_session(
        hik,
        started_at=_days_ago(21),
        duration_min=40,
        title="手动复盘",
        company="新公司",
        role="岗位",
        summary_markdown="技术面还行，但最终因为岗位方向不一致主动放弃。",
        strong_points=["数据建模基础扎实"],
        weak_points=["岗位兴趣不够匹配"],
        avg_score=6.1,
        turns=[
            {"question": "讲讲你做过的数据建模方案。", "answer": "我讲了订单和行为域拆分的思路。", "scorecard": {"clarity": 7, "depth": 6, "relevance": 7}},
            {"question": "如何做数据质量治理？", "answer": "先有校验规则，再有追责和回滚流程。", "scorecard": {"clarity": 6, "depth": 6, "relevance": 7}},
            {"question": "怎么设计离线和实时链路？", "answer": "批流分层，统一指标口径。", "scorecard": {"clarity": 6, "depth": 6, "relevance": 6}},
            {"question": "讲一个跨团队推进项目。", "answer": "我讲了指标平台接入过程。", "scorecard": {"clarity": 6, "depth": 6, "relevance": 6}},
            {"question": "为什么后来没继续推进？", "answer": "岗位方向和我现在想做的产品化方向不太一致。", "scorecard": {"clarity": 7, "depth": 6, "relevance": 7}},
        ],
    )
    created_review_count += 1

    moonshot = jt.create_application({
        "company": "Moonshot AI",
        "position": "后端工程师",
        "city": "北京",
        "stage": "interview2_rejected",
        "applied_at": _days_ago(14),
        "notes": _demo_note("二面挂案例，用来看更常见的面试失败终态展示。"),
    })
    created_apps.append(moonshot)
    _create_review_session(
        moonshot,
        started_at=_days_ago(10),
        duration_min=44,
        title="手动复盘",
        company="新公司",
        role="岗位",
        summary_markdown="一面基础还可以，二面挂点主要在系统设计展开不够，取舍也说得偏虚。",
        strong_points=["基础问题回答比较稳", "接口设计思路清楚"],
        weak_points=["系统设计展开不足", "容量估算和 trade-off 不够具体"],
        avg_score=6.3,
        turns=[
            {"question": "讲一下 Redis 和本地缓存怎么配合。", "answer": "我会按热点分层，本地缓存兜短 TTL，Redis 做主缓存。", "scorecard": {"clarity": 7, "depth": 6, "relevance": 7}},
            {"question": "如果要设计一个高并发消息投递系统，你会怎么拆？", "answer": "我先拆接入层、队列层、消费层，再看幂等、重试和监控。", "scorecard": {"clarity": 6, "depth": 6, "relevance": 7}, "risks": ["架构图能说，但容量估算偏弱"]},
            {"question": "怎么做消息去重？", "answer": "可以用业务 id 幂等表，或者消费侧状态机。", "scorecard": {"clarity": 6, "depth": 6, "relevance": 7}},
            {"question": "如果队列堆积，你优先看什么？", "answer": "先看生产消费速率差，再看热点 key、慢消费者和下游依赖。", "scorecard": {"clarity": 7, "depth": 6, "relevance": 7}},
            {"question": "你怎么证明这个方案能撑住峰值？", "answer": "我会补压测、容量预算和降级策略，但这块我当时讲得不够细。", "scorecard": {"clarity": 6, "depth": 5, "relevance": 6}, "risks": ["峰值容量和降级策略没有讲透"]},
        ],
    )
    created_review_count += 1

    return {
        "applications": created_apps,
        "review_count": created_review_count,
    }


def print_seed_summary(seed_result: dict[str, Any]) -> None:
    print("\n[demo] 已创建演示数据")
    for app in seed_result["applications"]:
        summaries = review.get_application_review_summaries([int(app["id"])])
        summary = summaries.get(int(app["id"])) or {}
        latest = summary.get("latest_avg_score")
        latest_text = f"{float(latest):.1f}" if latest is not None else "--"
        print(
            f"  - {app['company']} | {app['position']} | {app['stage']} | "
            f"复盘 {summary.get('review_count', 0)} 场 | 最近得分 {latest_text}"
        )
    print(f"\n[demo] 共创建 {len(seed_result['applications'])} 条岗位，{seed_result['review_count']} 场复盘")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo data for job tracker and review timeline")
    parser.add_argument("--clean-only", action="store_true", help="只清理旧的 demo 数据，不重建")
    parser.add_argument("--no-clean", action="store_true", help="不清理旧 demo，直接追加（一般不建议）")
    args = parser.parse_args()

    if not args.no_clean:
        removed_apps, removed_sessions = clear_demo_data()
        print(f"[demo] 已清理旧样例: applications={removed_apps}, review_sessions={removed_sessions}")

    if args.clean_only:
        return

    seed_result = seed_demo_data()
    print_seed_summary(seed_result)


if __name__ == "__main__":
    main()
