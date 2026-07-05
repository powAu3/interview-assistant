/**
 * Reusable sample fixtures for both Playwright E2E tests and screenshot script.
 *
 * Keep this file framework-agnostic (no playwright imports) so it can be
 * required from `.mjs` and `.ts` callers alike.
 */

const now = () => Math.floor(Date.now() / 1000)
const sampleEpoch = now()
const daysAgo = (days) => sampleEpoch - (days * 24 * 60 * 60)
const daysFromNow = (days) => sampleEpoch + (days * 24 * 60 * 60)

export const SAMPLE_CONFIG = {
  models: [
    { name: 'GPT-4.1 Mini', supports_think: true, supports_vision: true, enabled: true },
    { name: 'DeepSeek V3', supports_think: true, supports_vision: false, enabled: true },
    { name: 'Qwen 2.5 72B', supports_think: false, supports_vision: false, enabled: true },
  ],
  active_model: 0,
  model_name: 'GPT-4.1 Mini',
  temperature: 0.2,
  max_tokens: 2048,
  think_mode: true,
  stt_provider: 'whisper',
  whisper_model: 'large-v3-turbo',
  whisper_language: 'zh',
  doubao_stt_app_id: '',
  doubao_stt_access_token: '',
  doubao_stt_resource_id: '',
  doubao_stt_boosting_table_id: '',
  generic_stt_api_base_url: '',
  generic_stt_api_key: '',
  generic_stt_model: '',
  candidate_asr_enabled: true,
  candidate_stt_provider: 'whisper',
  candidate_whisper_model: 'small',
  candidate_whisper_language: 'zh',
  candidate_remote_stt_enabled: false,
  candidate_context_enabled: true,
  candidate_context_wait_ms: 1200,
  candidate_context_max_chars: 1600,
  candidate_context_min_chars: 8,
  candidate_streaming_asr_enabled: true,
  candidate_streaming_asr_interval_ms: 900,
  candidate_mic_compatibility_mode: true,
  position: '后端开发工程师',
  language: '中文',
  auto_detect: true,
  silence_threshold: 0.01,
  silence_duration: 1.2,
  api_key_set: true,
  has_resume: true,
  resume_active_history_id: 3,
  resume_active_filename: '张三_后端开发.pdf',
  max_parallel_answers: 2,
  answer_autoscroll_bottom_px: 40,
  transcription_min_sig_chars: 3,
  assist_transcription_merge_gap_sec: 6,
  assist_transcription_merge_max_sec: 16,
  screen_capture_region: 'left_half',
  written_exam_mode: false,
  written_exam_think: false,
}

export const SAMPLE_WRITTEN_EXAM_CONFIG = {
  ...SAMPLE_CONFIG,
  written_exam_mode: true,
  written_exam_think: false,
}

export const SAMPLE_OPTIONS = {
  positions: ['后端开发工程师', '前端开发工程师', '全栈开发工程师', 'Java 工程师'],
  languages: ['中文', 'English'],
  stt_providers: ['whisper', 'doubao', 'generic'],
  whisper_models: ['large-v3-turbo', 'medium', 'small'],
  screen_capture_regions: ['full', 'left_half', 'right_half', 'top_half', 'bottom_half'],
}

export const SAMPLE_DEVICES = {
  devices: [
    { id: 1001, name: 'BlackHole 2ch ⟳', channels: 2, is_loopback: true, host_api: 'Core Audio' },
    { id: 1002, name: 'MacBook Pro 麦克风', channels: 1, is_loopback: false, host_api: 'Core Audio' },
    { id: 1003, name: '外接 USB 麦克风', channels: 1, is_loopback: false, host_api: 'Core Audio' },
    { id: 1004, name: '会议软件系统音频 ⟳', channels: 2, is_loopback: true, host_api: 'Core Audio' },
  ],
  platform: {
    platform: 'darwin',
    needs_virtual_device: true,
    instructions: '建议安装虚拟声卡采集系统音频',
  },
}

export const SAMPLE_RESUME_HISTORY = {
  items: [
    {
      id: 2,
      original_filename: '李四_后端.pdf',
      file_size: 182304,
      created_at: now() - 86400,
      last_used_at: now() - 7200,
      parsed_ok: true,
      preview: '熟悉 Java / Spring Boot / MySQL / Redis，负责订单与库存链路。',
      parse_error: null,
      is_active: false,
    },
    {
      id: 3,
      original_filename: '张三_后端开发.pdf',
      file_size: 224512,
      created_at: now() - 3600,
      last_used_at: now() - 600,
      parsed_ok: true,
      preview: '3 年后端经验，负责高并发接口优化、缓存设计与监控治理。',
      parse_error: null,
      is_active: true,
    },
  ],
  max: 10,
}

export const SAMPLE_KNOWLEDGE_SUMMARY = {
  tags: [
    { tag: 'Redis', count: 11, avg_score: 7.4, trend: 'up' },
    { tag: 'MySQL', count: 9, avg_score: 6.8, trend: 'stable' },
    { tag: '消息队列', count: 8, avg_score: 6.1, trend: 'up' },
    { tag: '并发控制', count: 7, avg_score: 5.9, trend: 'down' },
    { tag: '系统设计', count: 6, avg_score: 5.6, trend: 'up' },
    { tag: '候选人口述表达', count: 5, avg_score: 6.2, trend: 'up' },
    { tag: '故障排查', count: 5, avg_score: 6.9, trend: 'stable' },
    { tag: '项目复盘', count: 4, avg_score: 5.4, trend: 'down' },
  ],
}

export const SAMPLE_KNOWLEDGE_HISTORY = {
  records: [
    {
      id: 101,
      session_type: 'assist',
      question: 'Redis 为什么会出现缓存穿透，如何治理？',
      answer: '可以通过布隆过滤器、缓存空值、接口限流三层处理。',
      score: 6.5,
      tags: ['Redis', '限流降级'],
      created_at: now() - 7200,
    },
    {
      id: 102,
      session_type: 'assist',
      question: '说一下 MySQL 索引失效的常见场景。',
      answer: '包括最左前缀不满足、函数操作列、类型隐式转换等。',
      score: 7.3,
      tags: ['MySQL'],
      created_at: now() - 5400,
    },
    {
      id: 103,
      session_type: 'assist',
      question: '候选人刚才通过麦克风说缓存击穿用互斥锁，你会怎么继续追问？',
      answer: '我的回答上下文：热点 key 过期后用互斥锁重建缓存，同时给缓存加随机过期时间，避免大量请求打到数据库。',
      score: 6.8,
      tags: ['Redis', '候选人口述表达'],
      created_at: now() - 3600,
    },
    {
      id: 104,
      session_type: 'assist',
      question: '如果线上接口 P99 突然升高，你会如何定位？',
      answer: '先看监控确认是整体流量、下游依赖还是数据库慢查询，再用 trace 还原链路，最后针对瓶颈做限流、缓存或 SQL 优化。',
      score: 6.9,
      tags: ['故障排查', '系统设计'],
      created_at: now() - 2400,
    },
    {
      id: 105,
      session_type: 'assist',
      question: '真实口述里提到“用了 MQ 削峰”，还应该补问哪些边界？',
      answer: '需要补充消息堆积、重复消费、幂等、失败重试和最终一致性的处理，不能只停留在“加了 MQ”。',
      score: 5.7,
      tags: ['消息队列', '项目复盘'],
      created_at: now() - 1800,
    },
  ],
  total: 5,
}

export const SAMPLE_TOKEN_STATS = {
  prompt: 4380,
  completion: 6210,
  total: 10590,
  by_model: {
    'GPT-4.1 Mini': { prompt: 2310, completion: 3340 },
    'DeepSeek V3': { prompt: 2070, completion: 2870 },
  },
}

function linkedApplicationSnapshot(app) {
  return {
    id: app.id,
    company: app.company,
    position: app.position,
    city: app.city,
    stage: app.stage,
    applied_at: app.applied_at,
    next_followup_at: app.next_followup_at,
    updated_at: app.updated_at,
  }
}

export const SAMPLE_JOB_TRACKER_APPLICATIONS = [
  {
    id: 1,
    company: 'MiniMax',
    position: 'AI 产品工程师',
    city: '上海',
    notes: '主线案例：两轮面试都已经串起来，适合验证岗位时间线。',
    stage: 'interview2',
    updated_at: daysAgo(1),
    created_at: daysAgo(14),
    applied_at: daysAgo(12),
    next_followup_at: daysFromNow(1),
    interviewer_info: '',
    feedback: '',
    todos: [
      { id: 'todo-mm-1', title: '补一遍系统设计容量估算', done: false },
      { id: 'todo-mm-2', title: '周一前跟进 recruiter', done: false },
    ],
    sort_order: 0,
    review_summary: {
      review_count: 2,
      latest_review_id: 902,
      latest_avg_score: 7.2,
      latest_review_at: daysAgo(1),
      latest_status: 'completed',
    },
  },
  {
    id: 2,
    company: 'DeepSeek',
    position: '平台后端工程师',
    city: '北京',
    notes: '终态案例：HR 挂，但复盘仍保留。',
    stage: 'hr_rejected',
    updated_at: daysAgo(2),
    created_at: daysAgo(22),
    applied_at: daysAgo(20),
    next_followup_at: null,
    interviewer_info: '',
    feedback: '',
    todos: [
      { id: 'todo-ds-1', title: '重写离职动机表达', done: false },
    ],
    sort_order: 1,
    review_summary: {
      review_count: 2,
      latest_review_id: 904,
      latest_avg_score: 5.9,
      latest_review_at: daysAgo(2),
      latest_status: 'completed',
    },
  },
  {
    id: 3,
    company: '飞书',
    position: '增长产品经理',
    city: '上海',
    notes: 'Offer 案例：保留轻量展示。',
    stage: 'offer',
    updated_at: daysAgo(3),
    created_at: daysAgo(19),
    applied_at: daysAgo(18),
    next_followup_at: daysFromNow(3),
    interviewer_info: '',
    feedback: '',
    todos: [],
    sort_order: 2,
    review_summary: {
      review_count: 1,
      latest_review_id: 905,
      latest_avg_score: 8.4,
      latest_review_at: daysAgo(3),
      latest_status: 'completed',
    },
  },
  {
    id: 4,
    company: '小红书',
    position: '前端工程师',
    city: '上海',
    notes: '无复盘案例：默认轻量视图。',
    stage: 'written',
    updated_at: daysAgo(1),
    created_at: daysAgo(7),
    applied_at: daysAgo(6),
    next_followup_at: daysFromNow(2),
    interviewer_info: '',
    feedback: '',
    todos: [
      { id: 'todo-xhs-1', title: '准备笔试：JS 异步和性能题', done: false },
      { id: 'todo-xhs-2', title: '补一遍 CSS 布局和手写题', done: false },
    ],
    sort_order: 3,
    review_summary: {
      review_count: 0,
      latest_review_id: null,
      latest_avg_score: null,
      latest_review_at: null,
      latest_status: null,
    },
  },
  {
    id: 5,
    company: 'Moonshot AI',
    position: '后端工程师',
    city: '北京',
    notes: '二面挂案例：更常见的失败终态。',
    stage: 'interview2_rejected',
    updated_at: daysAgo(4),
    created_at: daysAgo(15),
    applied_at: daysAgo(14),
    next_followup_at: null,
    interviewer_info: '',
    feedback: '',
    todos: [],
    sort_order: 4,
    review_summary: {
      review_count: 1,
      latest_review_id: 906,
      latest_avg_score: 6.3,
      latest_review_at: daysAgo(4),
      latest_status: 'completed',
    },
  },
  {
    id: 6,
    company: 'Bilibili',
    position: '服务端工程师',
    city: '上海',
    notes: '一面挂案例：更早轮次失败也能直接挂回应聘主线。',
    stage: 'interview1_rejected',
    updated_at: daysAgo(6),
    created_at: daysAgo(13),
    applied_at: daysAgo(12),
    next_followup_at: null,
    interviewer_info: '',
    feedback: '',
    todos: [
      { id: 'todo-bili-1', title: '补一版项目亮点的 STAR 说法', done: false },
    ],
    sort_order: 5,
    review_summary: {
      review_count: 1,
      latest_review_id: 907,
      latest_avg_score: 5.4,
      latest_review_at: daysAgo(6),
      latest_status: 'completed',
    },
  },
]

export const SAMPLE_JOB_TRACKER_OFFERS = [
  {
    id: 301,
    application_id: 3,
    base_salary: '45k x 16',
    total_pkg_note: '年度总包约 78w',
    bonus: '10%',
    equity: '少量 RSU',
    benefits: ['补充公积金', '午晚餐', '年度体检'],
    wfh: '每周 2 天',
    location: '上海',
    pros: '业务成熟、反馈快',
    cons: '节奏偏快',
    deadline: daysFromNow(5),
    created_at: daysAgo(3),
    company: '飞书',
    position: '增长产品经理',
  },
]

export const SAMPLE_APPLICATION_REVIEWS = {
  1: [
    {
      id: 902,
      status: 'completed',
      started_at: daysAgo(1.2),
      ended_at: daysAgo(1),
      title: '二面复盘',
      company: 'MiniMax',
      role: 'AI 产品工程师',
      turn_count: 6,
      avg_score: 7.2,
      summary_preview: '系统设计和项目拆解更稳了，但 trade-off 讲得还不够彻底。',
      updated_at: daysAgo(1),
    },
    {
      id: 901,
      status: 'completed',
      started_at: daysAgo(5.4),
      ended_at: daysAgo(5.1),
      title: '一面复盘',
      company: 'MiniMax',
      role: 'AI 产品工程师',
      turn_count: 5,
      avg_score: 6.8,
      summary_preview: '项目背景说清楚了，但容量估算和指标拆分还比较虚。',
      updated_at: daysAgo(5.1),
    },
  ],
  2: [
    {
      id: 904,
      status: 'completed',
      started_at: daysAgo(2.3),
      ended_at: daysAgo(2),
      title: 'HR 面复盘',
      company: 'DeepSeek',
      role: '平台后端工程师',
      turn_count: 5,
      avg_score: 5.9,
      summary_preview: '离职动机和职业规划回答偏空，HR 风险点比技术问题更突出。',
      updated_at: daysAgo(2),
    },
    {
      id: 903,
      status: 'completed',
      started_at: daysAgo(10.2),
      ended_at: daysAgo(10),
      title: '技术面复盘',
      company: 'DeepSeek',
      role: '平台后端工程师',
      turn_count: 5,
      avg_score: 7.8,
      summary_preview: '数据库和缓存基础扎实，整体表达也比较稳。',
      updated_at: daysAgo(10),
    },
  ],
  3: [
    {
      id: 905,
      status: 'completed',
      started_at: daysAgo(3.2),
      ended_at: daysAgo(3),
      title: 'Offer 前复盘',
      company: '飞书',
      role: '增长产品经理',
      turn_count: 5,
      avg_score: 8.4,
      summary_preview: '业务拆解和实验设计都比较稳，已经走到 offer 阶段。',
      updated_at: daysAgo(3),
    },
  ],
  5: [
    {
      id: 906,
      status: 'completed',
      started_at: daysAgo(4.4),
      ended_at: daysAgo(4),
      title: '二面复盘',
      company: 'Moonshot AI',
      role: '后端工程师',
      turn_count: 5,
      avg_score: 6.3,
      summary_preview: '八股和项目都还行，但系统设计追问没有顶住，最终卡在二面。',
      updated_at: daysAgo(4),
    },
  ],
  6: [
    {
      id: 907,
      status: 'completed',
      started_at: daysAgo(6.3),
      ended_at: daysAgo(6),
      title: '一面复盘',
      company: 'Bilibili',
      role: '服务端工程师',
      turn_count: 5,
      avg_score: 5.4,
      summary_preview: '项目亮点能讲出来，但第一轮深挖时细节承托不够，卡在一面。',
      updated_at: daysAgo(6),
    },
  ],
}

export const SAMPLE_REVIEW_SESSIONS = {
  total: 10,
  page: 1,
  page_size: 20,
  items: [
    {
      id: 910,
      status: 'analyzing',
      started_at: daysAgo(0.08),
      ended_at: daysAgo(0.03),
      title: '模拟实时面试 · 复盘生成中',
      company: 'Cursor',
      role: '全栈工程师',
      turn_count: 5,
      avg_score: null,
      updated_at: daysAgo(0.03),
      source: 'assist',
      auto_sync_eligible: true,
      application_id: null,
      application: null,
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: null,
      strong_points: [],
      weak_points: [],
      behavior_traits: [],
      domain_summary: null,
      created_at: daysAgo(0.08),
    },
    {
      id: 909,
      status: 'recorded',
      started_at: daysAgo(0.35),
      ended_at: daysAgo(0.3),
      title: '临时 mock 复盘',
      company: '手动测试',
      role: '后端开发工程师',
      turn_count: 3,
      avg_score: null,
      updated_at: daysAgo(0.3),
      source: 'manual',
      auto_sync_eligible: false,
      application_id: null,
      application: null,
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: null,
      strong_points: [],
      weak_points: [],
      behavior_traits: [],
      domain_summary: null,
      created_at: daysAgo(0.35),
    },
    {
      id: 908,
      status: 'analysis_failed',
      started_at: daysAgo(0.6),
      ended_at: daysAgo(0.55),
      title: '提示词模式排错复盘',
      company: '内部测试',
      role: 'Prompt 模拟',
      turn_count: 4,
      avg_score: null,
      updated_at: daysAgo(0.55),
      source: 'assist',
      auto_sync_eligible: true,
      application_id: null,
      application: null,
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: null,
      strong_points: [],
      weak_points: [],
      behavior_traits: [],
      domain_summary: null,
      created_at: daysAgo(0.6),
    },
    {
      ...SAMPLE_APPLICATION_REVIEWS[1][0],
      source: 'manual',
      auto_sync_eligible: true,
      application_id: 1,
      application: linkedApplicationSnapshot(SAMPLE_JOB_TRACKER_APPLICATIONS[0]),
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: '系统设计和项目拆解更稳了，但 trade-off 讲得还不够彻底。',
      strong_points: ['问题拆解更有层次', '案例比上一轮更贴题'],
      weak_points: ['trade-off 解释偏短', '容量估算仍需补强'],
      behavior_traits: ['表达更沉稳'],
      domain_summary: null,
      created_at: daysAgo(1),
    },
    {
      ...SAMPLE_APPLICATION_REVIEWS[2][0],
      source: 'manual',
      auto_sync_eligible: true,
      application_id: 2,
      application: linkedApplicationSnapshot(SAMPLE_JOB_TRACKER_APPLICATIONS[1]),
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: '离职动机和职业规划回答偏空，HR 风险点比技术问题更突出。',
      strong_points: ['技术经历能自圆其说'],
      weak_points: ['离职动机表达不够稳', '职业规划过于泛化'],
      behavior_traits: ['情绪稳定'],
      domain_summary: null,
      created_at: daysAgo(2),
    },
    {
      ...SAMPLE_APPLICATION_REVIEWS[3][0],
      source: 'manual',
      auto_sync_eligible: true,
      application_id: 3,
      application: linkedApplicationSnapshot(SAMPLE_JOB_TRACKER_APPLICATIONS[2]),
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: '业务拆解和实验设计都比较稳，已经走到 offer 阶段。',
      strong_points: ['业务 sense 稳', '实验设计意识强'],
      weak_points: ['少数案例还可再量化'],
      behavior_traits: ['表达利落'],
      domain_summary: null,
      created_at: daysAgo(3),
    },
    {
      ...SAMPLE_APPLICATION_REVIEWS[5][0],
      source: 'manual',
      auto_sync_eligible: true,
      application_id: 5,
      application: linkedApplicationSnapshot(SAMPLE_JOB_TRACKER_APPLICATIONS[4]),
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: '八股和项目都还行，但系统设计追问没有顶住，最终卡在二面。',
      strong_points: ['数据库基础不错'],
      weak_points: ['系统设计深挖没顶住'],
      behavior_traits: ['回答节奏偏快'],
      domain_summary: null,
      created_at: daysAgo(4),
    },
    {
      ...SAMPLE_APPLICATION_REVIEWS[1][1],
      source: 'manual',
      auto_sync_eligible: true,
      application_id: 1,
      application: linkedApplicationSnapshot(SAMPLE_JOB_TRACKER_APPLICATIONS[0]),
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: '项目背景说清楚了，但容量估算和指标拆分还比较虚。',
      strong_points: ['项目背景清楚'],
      weak_points: ['容量估算偏虚', '指标拆分不够细'],
      behavior_traits: ['愿意补充细节'],
      domain_summary: null,
      created_at: daysAgo(5),
    },
    {
      ...SAMPLE_APPLICATION_REVIEWS[6][0],
      source: 'manual',
      auto_sync_eligible: true,
      application_id: 6,
      application: linkedApplicationSnapshot(SAMPLE_JOB_TRACKER_APPLICATIONS[5]),
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: '项目亮点能讲出来，但第一轮深挖时细节承托不够，卡在一面。',
      strong_points: ['主项目主线能讲清楚'],
      weak_points: ['追问细节承托不够', '亮点还不够量化'],
      behavior_traits: ['开场状态不错，后程有点飘'],
      domain_summary: null,
      created_at: daysAgo(6),
    },
    {
      ...SAMPLE_APPLICATION_REVIEWS[2][1],
      source: 'manual',
      auto_sync_eligible: true,
      application_id: 2,
      application: linkedApplicationSnapshot(SAMPLE_JOB_TRACKER_APPLICATIONS[1]),
      interviewer_capture_enabled: true,
      candidate_capture_enabled: true,
      summary_markdown: '数据库和缓存基础扎实，整体表达也比较稳。',
      strong_points: ['数据库和缓存基础扎实', '回答有结构'],
      weak_points: ['跨团队协作案例偏少'],
      behavior_traits: ['整体稳'],
      domain_summary: null,
      created_at: daysAgo(10),
    },
  ],
}

function createTurns(session) {
  return [
    {
      id: session.id * 10 + 1,
      session_id: session.id,
      qa_id: `qa-${session.id}-1`,
      seq: 1,
      question_text: '请讲一个你最有代表性的项目。',
      candidate_answer_text: `${session.company} 这场我先讲了项目背景、目标和自己负责的关键环节。`,
      original_candidate_answer_text: null,
      reference_answer_text: '建议按背景、挑战、决策、结果展开。',
      code_text: null,
      duration_ms: 78000,
      is_partial: false,
      analysis_status: 'completed',
      strengths: ['结构完整'],
      risks: [],
      evidence: null,
      scorecard: { clarity: 8, depth: 7, relevance: 8 },
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
    {
      id: session.id * 10 + 2,
      session_id: session.id,
      qa_id: `qa-${session.id}-2`,
      seq: 2,
      question_text: '如果再来一轮追问，你最需要补哪块？',
      candidate_answer_text: '我会优先补 trade-off、容量估算或者动机表达里最薄的那一环。',
      original_candidate_answer_text: null,
      reference_answer_text: '明确指出最弱环节并给出补强计划。',
      code_text: null,
      duration_ms: 52000,
      is_partial: false,
      analysis_status: 'completed',
      strengths: ['能识别自身薄弱点'],
      risks: session.avg_score != null && session.avg_score < 6.5 ? ['需要继续打磨'] : [],
      evidence: null,
      scorecard: { clarity: 7, depth: 7, relevance: 8 },
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
  ]
}

export const SAMPLE_REVIEW_SESSION_DETAILS = Object.fromEntries(
  SAMPLE_REVIEW_SESSIONS.items.map((session) => [
    session.id,
    {
      ...session,
      turns: createTurns(session),
    },
  ]),
)

/**
 * Default API payload resolver. Returns response body for the given pathname.
 * Returns null when the route should be left to the next handler.
 */
export function resolveApiPayload(pathname, method) {
  if (pathname === '/api/config') return SAMPLE_CONFIG
  if (pathname === '/api/options') return SAMPLE_OPTIONS
  if (pathname === '/api/devices') return SAMPLE_DEVICES
  if (pathname === '/api/network-info') return { ip: '127.0.0.1', port: 18999 }
  if (pathname === '/api/stt/status') return { loaded: true, loading: false }
  if (pathname === '/api/session') return { session_id: 'mock-session', started_at: now() }
  if (pathname === '/api/clear') return { ok: true }
  if (pathname === '/api/ask/cancel') return { ok: true, cancelled: 0 }
  if (pathname === '/api/audio-test/input/status') {
    return {
      running: true,
      device_id: 1002,
      rms: 0.043,
      peak: 0.18,
      level_pct: 64,
      has_signal: true,
      error: null,
    }
  }
  if (pathname === '/api/audio-test/input/start') {
    return {
      running: true,
      device_id: 1002,
      rms: 0.035,
      peak: 0.16,
      level_pct: 58,
      has_signal: true,
      error: null,
    }
  }
  if (pathname === '/api/audio-test/input/stop') return { running: false }

  if (pathname === '/api/preflight/scenarios') {
    return {
      scenarios: [
        { id: 'self_intro', label: '自我介绍', question: '请做一个 1 分钟自我介绍。', recommended: true },
        { id: 'project', label: '项目追问', question: '说一个你最熟悉的项目。', recommended: false },
      ],
    }
  }
  if (pathname === '/api/preflight/run') return { ok: true }
  if (pathname === '/api/exam-preflight/run') return { ok: true }
  if (pathname === '/api/exam-preflight/status') {
    return {
      running: false,
      question: '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。',
      steps: {},
    }
  }
  if (pathname === '/api/models/health' && method === 'GET') {
    return { health: { 0: 'ok', 1: 'ok', 2: 'error' } }
  }
  if (pathname === '/api/models/health') return { ok: true }

  if (pathname === '/api/resume/history') return SAMPLE_RESUME_HISTORY
  if (/^\/api\/resume\/history\/\d+$/.test(pathname) && method === 'GET') {
    const id = Number(pathname.split('/').pop())
    const item = SAMPLE_RESUME_HISTORY.items.find((x) => x.id === id)
    return item ? { ...item, summary: item.preview, summary_is_full: true } : { detail: 'Not found' }
  }
  if (/^\/api\/resume\/history\/\d+$/.test(pathname)) return { ok: true }
  if (/^\/api\/resume\/history\/\d+\/apply$/.test(pathname)) {
    return { ok: true, history_id: 3, length: 1500, preview: '已选用' }
  }

  if (pathname === '/api/knowledge/summary') return SAMPLE_KNOWLEDGE_SUMMARY
  if (pathname === '/api/knowledge/history') return SAMPLE_KNOWLEDGE_HISTORY
  if (pathname === '/api/knowledge/reset') return { ok: true }

  if (pathname === '/api/review/sessions') return SAMPLE_REVIEW_SESSIONS
  if (/^\/api\/review\/sessions\/\d+\/generate$/.test(pathname)) {
    return { status: 'started', message: '已开始生成复盘' }
  }
  if (/^\/api\/review\/sessions\/manual$/.test(pathname)) {
    return { session_id: 999, turn_count: 5, status: 'completed' }
  }
  if (/^\/api\/review\/sessions\/\d+$/.test(pathname) && method === 'GET') {
    const id = Number(pathname.split('/').pop())
    return SAMPLE_REVIEW_SESSION_DETAILS[id] ?? { detail: 'Not found' }
  }
  if (/^\/api\/review\/sessions\/\d+$/.test(pathname) && method === 'PATCH') {
    return { success: true, synced_todos: true }
  }
  if (pathname === '/api/review/asr-correction-test') {
    return {
      ok: true,
      model_name: 'GPT-4.1 Mini',
      model: 'gpt-4.1-mini',
      original: '缓存击穿可以加锁',
      corrected: '缓存击穿可以加互斥锁重建热点缓存',
      changed: true,
      detail: 'mock',
    }
  }
  if (pathname === '/api/review/current') return { session: null }
  if (pathname === '/api/review/profile') return { summary: null }

  if (pathname === '/api/job-tracker/stages') {
    return {
      stages: [
        { id: 'applied', label: '已投递' },
        { id: 'written', label: '测评' },
        { id: 'interview1', label: '一面' },
        { id: 'interview2', label: '二面' },
        { id: 'interview3', label: '三面' },
        { id: 'hr', label: 'HR 面' },
        { id: 'offer', label: 'Offer' },
        { id: 'written_rejected', label: '测评挂' },
        { id: 'interview1_rejected', label: '一面挂' },
        { id: 'interview2_rejected', label: '二面挂' },
        { id: 'interview3_rejected', label: '三面挂' },
        { id: 'hr_rejected', label: 'HR 挂' },
        { id: 'withdrawn', label: '已放弃' },
      ],
    }
  }
  if (pathname === '/api/job-tracker/applications') return { items: SAMPLE_JOB_TRACKER_APPLICATIONS }
  if (/^\/api\/job-tracker\/applications\/\d+\/reviews$/.test(pathname)) {
    const appId = Number(pathname.split('/')[4])
    return { items: SAMPLE_APPLICATION_REVIEWS[appId] ?? [] }
  }
  if (pathname === '/api/job-tracker/offers') return { items: SAMPLE_JOB_TRACKER_OFFERS }
  if (pathname === '/api/job-tracker/compare') return { items: SAMPLE_JOB_TRACKER_OFFERS }

  if (pathname === '/api/token/stats') return SAMPLE_TOKEN_STATS

  if (method && method !== 'GET') return { ok: true }
  return {}
}
