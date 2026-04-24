/**
 * Reusable sample fixtures for both Playwright E2E tests and screenshot script.
 *
 * Keep this file framework-agnostic (no playwright imports) so it can be
 * required from `.mjs` and `.ts` callers alike.
 */

const now = () => Math.floor(Date.now() / 1000)

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
  practice_tts_provider: 'edge_tts',
  edge_tts_available: true,
  edge_tts_status_detail: 'edge-tts Python 包可用',
  edge_tts_voice_female: 'zh-CN-XiaoxiaoNeural',
  edge_tts_voice_male: 'zh-CN-YunxiNeural',
  edge_tts_rate: '+0%',
  edge_tts_pitch: '+0Hz',
  volcengine_tts_appkey: '',
  volcengine_tts_token: '',
  practice_tts_speaker_female: 'zh_female_qingxin',
  practice_tts_speaker_male: 'zh_male_chunhou',
  position: '后端开发工程师',
  language: '中文',
  practice_audience: 'social',
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
}

export const SAMPLE_OPTIONS = {
  positions: ['后端开发工程师', '前端开发工程师', '全栈开发工程师', 'Java 工程师'],
  languages: ['中文', 'English'],
  practice_audiences: ['social', 'campus_intern'],
  practice_tts_providers: ['edge_tts', 'local', 'volcengine'],
  stt_providers: ['whisper', 'doubao', 'iflytek'],
  whisper_models: ['large-v3-turbo', 'medium', 'small'],
  screen_capture_regions: ['full', 'left_half', 'right_half', 'top_half', 'bottom_half'],
}

export const SAMPLE_DEVICES = {
  devices: [
    { id: 1001, name: 'BlackHole 2ch ⟳', channels: 2, is_loopback: true, host_api: 'Core Audio' },
    { id: 1002, name: 'MacBook Pro 麦克风', channels: 1, is_loopback: false, host_api: 'Core Audio' },
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
      session_type: 'practice',
      question: '说一下 MySQL 索引失效的常见场景。',
      answer: '包括最左前缀不满足、函数操作列、类型隐式转换等。',
      score: 7.3,
      tags: ['MySQL'],
      created_at: now() - 5400,
    },
  ],
  total: 2,
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

function createPracticePhases() {
  return [
    {
      phase_id: 'opening',
      label: '开场',
      category: 'opening',
      focus: ['岗位匹配', '自我定位'],
      follow_up_budget: 0,
      answer_mode: 'voice',
      question: '先做一个 90 秒左右的自我介绍，重点讲你和后端岗位的匹配度。',
      written_prompt: '',
      artifact_notes: [],
    },
    {
      phase_id: 'project',
      label: '项目深挖',
      category: 'project',
      focus: ['判断', '验证', '取舍'],
      follow_up_budget: 1,
      answer_mode: 'voice',
      question: '讲讲你做过的高并发接口优化，重点说清楚你的判断和验证。',
      written_prompt: '',
      artifact_notes: [],
    },
    {
      phase_id: 'coding',
      label: '代码与 SQL',
      category: 'coding',
      focus: ['正确性', '边界', '解释'],
      follow_up_budget: 0,
      answer_mode: 'voice+code',
      question: '写一段 SQL，统计最近 7 天每个用户的订单数。',
      written_prompt: '给定 orders(user_id, created_at, amount) 表，请输出最近 7 天每个用户的订单数。',
      artifact_notes: ['只统计最近 7 天', '返回 user_id 和 order_count'],
    },
  ]
}

export function createSamplePracticeSession(overrides = {}) {
  const phases = createPracticePhases()
  const currentTurn = {
    turn_id: 'turn-project-1',
    phase_id: 'project',
    phase_label: '项目深挖',
    category: 'project',
    answer_mode: 'voice',
    question: '讲讲你做过的高并发接口优化，重点说清楚你的判断和验证。',
    prompt_script: '讲讲你做过的高并发接口优化，重点说清楚你的判断和验证。',
    stage_prompt: '项目深挖：本轮重点盯判断 / 验证 / 取舍。',
    interviewer_signal: 'probe',
    transition_line: '现在我想往项目里压一层，重点听你的判断和验证。',
    written_prompt: '',
    artifact_notes: [],
    asked_at: now() * 1000,
    follow_up_of: null,
    transcript: '',
    code_text: '',
    duration_ms: 0,
  }

  return {
    status: 'awaiting_answer',
    context: {
      position: '后端开发工程师',
      language: '中文',
      audience: 'social',
      audience_label: '社招',
      resume_text: '3 年后端经验，负责高并发接口优化、缓存设计与监控治理。',
      jd_text: '负责交易、库存与履约链路的后端开发，要求能独立排障与优化。',
      interviewer_style: 'calm_pressing',
    },
    blueprint: {
      opening_script: '我们先从开场开始，你把主线讲稳一点。',
      phases,
    },
    current_phase_index: 1,
    current_turn: currentTurn,
    turn_history: [
      {
        turn_id: 'turn-opening-1',
        phase_id: 'opening',
        phase_label: '开场',
        category: 'opening',
        answer_mode: 'voice',
        question: phases[0].question,
        prompt_script: phases[0].question,
        stage_prompt: '开场与岗位匹配：本轮重点盯岗位匹配 / 自我定位。',
        interviewer_signal: 'warm-open',
        transition_line: '我们先从开场开始，你把主线讲稳一点。',
        written_prompt: '',
        artifact_notes: [],
        asked_at: now() * 1000 - 180000,
        follow_up_of: null,
        transcript: '我过去 3 年主要做交易链路和缓存优化。',
        code_text: '',
        duration_ms: 92000,
        decision: 'advance',
        scorecard: { structure: 8, confidence: 7 },
      },
    ],
    interviewer_persona: {
      tone: 'calm-pressing',
      style: '像国内一线技术面试官，礼貌但不放水，会追问证据、取舍和复盘。',
      project_bias: '项目题优先追 why / how / validation，不让候选人停在结果层。',
      bar_raising_rule: '回答一旦缺少证据、边界或实现，就优先追问而不是轻易放过。',
    },
    report_markdown: '',
    created_at: now() * 1000 - 240000,
    finished_at: null,
    ...overrides,
  }
}

export const SAMPLE_PRACTICE_SPEAKING_SESSION = createSamplePracticeSession({
  status: 'awaiting_answer',
})

export const SAMPLE_PRACTICE_CODING_SESSION = createSamplePracticeSession({
  status: 'awaiting_answer',
  current_phase_index: 2,
  current_turn: {
    turn_id: 'turn-coding-1',
    phase_id: 'coding',
    phase_label: '代码与 SQL',
    category: 'coding',
    answer_mode: 'voice+code',
    question: '写一段 SQL，统计最近 7 天每个用户的订单数。',
    prompt_script: '写一段 SQL，统计最近 7 天每个用户的订单数。',
    stage_prompt: '代码 / SQL 与实现解释：本轮重点盯正确性 / 边界 / 解释。',
    interviewer_signal: 'implementation-check',
    transition_line: '最后来一道实现题，边写边解释你的边界处理。',
    written_prompt: '给定 orders(user_id, created_at, amount) 表，请输出最近 7 天每个用户的订单数。',
    artifact_notes: ['只统计最近 7 天', '返回 user_id 和 order_count'],
    asked_at: now() * 1000,
    follow_up_of: null,
    transcript: '',
    code_text: '',
    duration_ms: 0,
  },
})

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

  if (pathname === '/api/preflight/scenarios') {
    return {
      scenarios: [
        { id: 'self_intro', label: '自我介绍', question: '请做一个 1 分钟自我介绍。', recommended: true },
        { id: 'project', label: '项目追问', question: '说一个你最熟悉的项目。', recommended: false },
      ],
    }
  }
  if (pathname === '/api/preflight/run') return { ok: true }
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

  if (pathname === '/api/job-tracker/stages') {
    return {
      stages: [
        { id: 'wishlist', label: '感兴趣' },
        { id: 'applied', label: '已投递' },
        { id: 'interview', label: '面试中' },
        { id: 'offer', label: 'Offer' },
        { id: 'rejected', label: '已结束' },
      ],
    }
  }
  if (pathname === '/api/job-tracker/applications') return { applications: [] }

  if (pathname === '/api/practice/status') return { ok: true }
  if (pathname === '/api/token/stats') return SAMPLE_TOKEN_STATS

  if (method && method !== 'GET') return { ok: true }
  return {}
}
