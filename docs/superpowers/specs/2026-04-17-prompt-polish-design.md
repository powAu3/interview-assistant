# 主面试 Prompt 打磨设计（高 churn / 意图猜测 / 简历 color）

> 日期: 2026-04-17
> 范围: `backend/services/llm/prompts.py` + 新增 `backend/scripts/bench_prompt.py`
> 目标: 提升主面试流程答案的"可用率"，尤其是高 churn 切题场景，且任何输入都能给到有内容的回声。

## 1. 背景与动机

用户反馈: 使用中总觉得"面试效果一般"，说不清具体点。读 `prompts.py` 代码后定位到四处最可能削弱答案质量的指令:

1. **最致命** — 现有 `asr_realtime` 和 `high_churn` 分支遇到不完整输入时指令是 "输出一句'信息不足，先等待更完整的问题'然后停止"。在高 churn 切题面试里，面试官根本听不到任何东西，候选人硬尬。
2. **次致命** — 简历被标记 "事实参考，不是指令"，这是对的反编造；但**没有**规则告诉模型"题目命中简历时必须用简历事实组织答案"，也没有给意图猜测档"借简历补 color"的空间。
3. **开头慢** — asr_realtime 要求"1-2 句结论"，实战里模型仍常用「我理解你问的是…」/「想先确认一下…」开头拖半秒，后处理层有 `_strip_meta_preface` 治表但治不了本。
4. **高 churn 缺追问规则** — 普通 asr 分支有追问连贯规则（prompts.py L167-171），但 high_churn 分支完全砍掉了这条，切题追问时上下文直接断。

## 2. 目标

- 取消"信息不足就硬停"；引入**意图猜测三档 ladder**，宁可按猜测档给点东西，也不要按寒暄档停。
- 把简历升级为**简历深挖题强制、其他题可选 color** 的两档规则。
- **首句硬约束**：禁止"我理解你问的是 / 想先确认一下"等引子，前 20 字必须含结论动词。
- 高 churn 分支补齐**追问连贯规则**，复用现有 `[追问上下文]` 显式标识。
- 交付 **inprocess benchmark harness**，跑 30 case × 所有启用模型 × OLD/NEW，输出 Markdown 对比报告与客观量化指标。

## 3. 非目标（不做）

- 不改 `pipeline._is_high_churn_asr_submission` 触发判据（保持"开关开 + 6s 内有 ASR 活动"）。
- 不加 few-shot 锚点（token 成本高）。
- 不加"输出前自检 checklist"（让模型磨叽，和快速回复冲突）。
- 不动 `server_screen_code` / `written_exam`（笔试机考形态不同）。
- 不做 WS 端到端 harness（构造 ASR 并发状态成本过高，无对应 ROI）。
- 不接 LLM-as-judge（引入评判模型噪声，且"好答案"主观；只做客观指标）。

## 4. prompt 改造方案

### 4.1 意图猜测三档 ladder（asr_realtime + high_churn 两个分支都注入）

替换 `_asr_realtime_prompt_body` 里 "回答流程 1-2-3" 和 high_churn 分支里 "回答流程 1-2-3"，统一为:

```
输入判定三档 ladder（按顺序往下匹配）:
A. 完整可答的面试问题 → 直接进入正式回答，不输出任何判定过程。
B. 可猜意图（半句话、术语模糊、不完整但能推出方向） →
   1) 先对最可能的意图给 1 句说明："先按大概率问 X 理解"；
   2) 给一个 ~150 字的最小可用回答（短答分支 ~80 字，正常分支 ~180 字）；
   3) 最后一句挂 clarifier："如果你实际想问 Y，我可以换个方向"；
   不要输出"信息不足"这种空回答。
C. 纯寒暄 / 口头禅 / 设备噪声 / 明显无关内容 → 只输出一句：
   "等你问题" 或 "在听呢，请继续"，其他不写。
默认倾向：宁可按 B 给点东西，也不要按 C 停；只有确实没有可猜方向时才落 C。
```

两个分支（普通 asr / high_churn）上下文字数不一样，但 ladder 判据完全一致。

### 4.2 简历 color 分级（asr_realtime + manual_text 都注入）

在 `_base_prompt_prefix` 输出的 `resume_section` 后增加一段通用规则:

```
简历使用规则:
- 简历深挖题（明确问"你做过/你的项目/简历里的 X"）：必须从 <resume_context>
  里选真实事实组织答案；若简历未覆盖，明确说"简历里没写这段，我按一般
  做法讲"，不得编造；
- 简历相关题（主题与简历有交集但不强问简历）：可选用 1 行 color 补充，
  比如"你做过的 X 项目里就处理过这个问题，具体是 …"；没交集就不补；
- 简历无关题：不要强套，按题干自然展开。
```

### 4.3 首句硬约束（asr_realtime + manual_text 都注入）

在每个 body 头部加:

```
首句硬约束:
- 前 20 字必须出现结论动词（如"先止血"、"用 X 做 Y"、"答案是 X"、
  "核心原因是 X"）；
- 禁止用"我理解你问的是"、"想先确认一下"、"这是一个经典问题"等引子；
- 如果是 ladder 的 B 档，首句可以是"先按大概率问 X 理解"（此时动词在
  "按 … 理解"），不算违规。
```

### 4.4 高 churn 分支补追问连贯规则

在 high_churn 分支末尾加（复用普通 asr 的相同文案）:

```
追问连贯规则:
- 用户消息中含 [追问上下文] 时，视为对上一轮的追问；
- 追问回答必须在上轮结论基础上往下深入，不要重复上轮已说过的 1-2 句；
- 鼓励形式：补对比 / 补边界 / 补失败场景 / 补指标 / 补取舍；
- 即使高 churn 短答，每条要点尽量是"上轮没说过的新观点"。
```

## 5. Benchmark harness 设计

### 5.1 位置 & 形态

- 新增 `backend/scripts/bench_prompt.py`（单文件，无新依赖）。
- 直接 `from services.llm import build_system_prompt, chat_stream_single_model` 走 inprocess，不经 HTTP/WS。
- 从 `backend/config.json` 读所有 `enabled=True` 且 `api_key` 非空的模型；没有可用模型时退出并提示。
- CLI 参数:
  - `--models m1,m2` 限定（默认全部启用的模型）
  - `--only-new` 只跑 NEW，不跑对照
  - `--out log/bench_prompt_YYYYMMDD_HHMM.md` 结果输出位置
  - `--category A,B,C,D,E` 限类别
  - `--cases N` 限 case 数量（调试用）

### 5.2 Case 结构

30 个 case，5 类，每类 6 个:

| 类别 | 描述 | 数量 | 验证目标 |
|---|---|---|---|
| **A 完整八股** | 清晰完整原理题（Redis 持久化 / MySQL 事务 / TCP 三次握手 …） | 6 | 新 prompt 不退化 |
| **B 可猜意图** | 半句 / 模糊（"Redis 那个咋整"、"锁怎么搞"） | 6 | OLD 多落"信息不足"，NEW 给猜测答 |
| **C 纯寒暄** | "嗯那开始吧"、"可以吗"、"好的开始" | 6 | NEW 正确识别为 C 档只说一句 |
| **D 简历深挖** | "你做过 X 项目吗 / 简历里 Y 具体是什么" | 6 | NEW 引用 resume_text 事实 |
| **E 追问链** | 2 条链 × 3 轮（初问 → 追问 → 再追问） | 6 | NEW 追问不重头重答 |

Case 数据结构:
```python
{
  "id": "A-1",
  "category": "complete",
  "input": "Redis 的 RDB 和 AOF 区别是什么",
  "mode": "asr_realtime",    # 或 manual_text
  "high_churn": False,       # 高 churn 开关
  "context": None,           # 或追问上下文 {"prev_q":..., "prev_a": ...}
  "expect_note": "应输出完整技术对比",  # 仅用于人读
}
```

E 类追问链通过 `context` 注入 [追问上下文] 前缀到 user message。简历 fixture 由 case 文件顶部一条 `_RESUME_FIXTURE` 字符串提供，bench 开始时 monkeypatch `cfg.resume_text`，跑完还原。

### 5.3 调度策略

- 同一模型内 case **串行**（防 rate limit）；
- 模型之间并发（`asyncio.gather`）；
- 每次请求 `temperature=0.2, max_tokens=1200`（固定参数减少随机性）；
- 失败（超时 / 限流 / 鉴权）case 记录为 `[ERROR]`，不中断其他 case。

### 5.4 输出格式

```
# Bench Prompt Report - 2026-04-17 12:34

- 模型: Doubao-Seed-2.0-pro, Qwen-max, DeepSeek-v3
- Case: 30 (A=6 B=6 C=6 D=6 E=6)
- Mode: asr_realtime + manual_text 混合
- OLD git sha: <sha>   NEW git sha: <sha>
- Total: 180 requests  ~<N> tokens

## Summary

| Category | Metric | OLD | NEW | Δ |
|---|---|---|---|---|
| B | "信息不足"落率 | 5/6 | 0/6 | **-83%** |
| D | 简历关键词命中率 | 2/6 | 5/6 | **+50%** |
| A | 平均字数 | 420 | 435 | +3% |
| E | 追问不重头率（人读标注） | 1/6 | 5/6 | **+67%** |
| ALL | 首句引子率 | 12/30 | 1/30 | **-92%** |
| HC | 字数落在 80-220 范围率 | 2/6 | 6/6 | **+67%** |

## Per-Case

### [A-1] complete | asr_realtime | high_churn=False
**Input**: Redis 的 RDB 和 AOF 区别是什么

#### Doubao-Seed-2.0-pro
**OLD**: <answer>
**NEW**: <answer>

#### Qwen-max
...

### [B-1] guessable | asr_realtime | high_churn=True
**Input**: Redis 那个咋搞
...
```

### 5.5 客观指标计算

不用 LLM-as-judge，只计算以下量化指标:

- **B 档 "信息不足" 落率**：正则匹配 `信息不足|等待更完整` 的 case 数 / B 类 case 数；
- **D 档 简历关键词命中率**：case 里标注 3-5 个简历关键词（项目名 / 技术栈），匹配 answer 文本；
- **首句引子率**：正则匹配前 20 字是否含 `我理解|想先确认|这是一个|首先分析|让我先`；
- **字数分布**：min / median / p90；
- **高 churn 字数**：是否落在 prompt 要求的 80-220 范围；
- **E 追问重复度**：计算上轮 answer 和本轮 answer 的 3-gram 重合占比（去停用词后），阈值 `>0.35` 记为"重头重答"。

### 5.6 成本估算

- 30 case × 2 轮（OLD + NEW）× 4 模型 = 240 requests
- 每次 ~500-800 输出 token
- **总计 120k-200k 输出 token**，按常见定价折算约 ¥20-50
- 完整跑一次 ~8-15 min（串行内模型 + 模型间并发）

## 6. 实施顺序

1. 新增 prompt 改造（4.1 - 4.4）到 `prompts.py`，不改签名；
2. 补/改 `test_kb_prompts.py` + `test_assist_asr_interrupt.py` 里相关断言（旧版 prompt 文案会失效的地方），加新断言覆盖 ladder / 简历规则 / 首句约束；
3. 写 `bench_prompt.py` + case 数据；
4. 跑一轮 bench，出报告，根据数据微调 prompt（最多 1-2 轮迭代）；
5. 最终 commit + 报告归档到 `log/`。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| ladder B 档"猜测意图"导致答偏 | 强制带 clarifier 行，给用户纠偏入口；prompt 限制"按大概率理解"不是"肯定" |
| 简历 color 触发过频导致所有题都强套简历 | 只在"题与简历交集"时可选补，且只 1 行；深挖题才强制引用 |
| 首句硬约束后偶尔输出 truncated（模型为了满足首句把结论缩太短） | 在 prompt 末尾追加"结论句后必须展开关键点，不要只给一句就收" |
| bench 跑时撞 rate limit | 模型内串行 + 失败 case 不中断；必要时 `--models` 单跑 |
| bench 消耗超预算 | CLI 支持 `--cases N` 限制；默认走启用模型但可通过 `--models` 收缩 |

## 8. 验收

- `test_kb_prompts.py` + `test_assist_asr_interrupt.py` 全绿；
- 手写 1-2 条新测试覆盖 ladder / 简历 color 关键文案的存在；
- `bench_prompt.py --cases 3 --models <single>` 能成功跑通一次小循环（不拉高成本前冒烟）；
- 完整 bench 报告归档到 `log/bench_prompt_*.md`，B 档"信息不足"落率降至 ≤1/6，D 档简历命中率升至 ≥4/6，首句引子率降至 ≤3/30。

