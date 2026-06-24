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

  if (pathname === '/api/token/stats') return SAMPLE_TOKEN_STATS

  if (method && method !== 'GET') return { ok: true }
  return {}
}
