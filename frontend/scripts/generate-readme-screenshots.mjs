import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIR = path.resolve(__dirname, '..')
const REPO_DIR = path.resolve(FRONTEND_DIR, '..')
const OUTPUT_DIR = path.resolve(REPO_DIR, 'docs', 'screenshots')
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const now = Math.floor(Date.now() / 1000)

const SAMPLE_CONFIG = {
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

const SAMPLE_OPTIONS = {
  positions: ['后端开发工程师', '前端开发工程师', '全栈开发工程师', 'Java 工程师'],
  languages: ['中文', 'English'],
  practice_audiences: ['social', 'campus_intern'],
  stt_providers: ['whisper', 'doubao', 'iflytek'],
  whisper_models: ['large-v3-turbo', 'medium', 'small'],
  screen_capture_regions: ['full', 'left_half', 'right_half', 'top_half', 'bottom_half'],
}

const SAMPLE_DEVICES = {
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

const SAMPLE_RESUME_HISTORY = {
  items: [
    {
      id: 2,
      original_filename: '李四_后端.pdf',
      file_size: 182304,
      created_at: now - 86400,
      last_used_at: now - 7200,
      parsed_ok: true,
      preview: '熟悉 Java / Spring Boot / MySQL / Redis，负责订单与库存链路。',
      parse_error: null,
      is_active: false,
    },
    {
      id: 3,
      original_filename: '张三_后端开发.pdf',
      file_size: 224512,
      created_at: now - 3600,
      last_used_at: now - 600,
      parsed_ok: true,
      preview: '3 年后端经验，负责高并发接口优化、缓存设计与监控治理。',
      parse_error: null,
      is_active: true,
    },
  ],
  max: 10,
}

const SAMPLE_RESUME_DETAILS = {
  2: {
    ...SAMPLE_RESUME_HISTORY.items[0],
    summary:
      '李四，2 年后端经验，熟悉 Java、Spring Boot、MySQL、Redis，参与订单履约链路开发和接口优化。',
    summary_is_full: true,
  },
  3: {
    ...SAMPLE_RESUME_HISTORY.items[1],
    summary:
      '张三，3 年后端开发经验。负责交易链路接口性能优化、Redis 缓存架构升级、日志与告警体系建设，支撑峰值流量活动。',
    summary_is_full: true,
  },
}

const SAMPLE_KNOWLEDGE_SUMMARY = {
  tags: [
    { tag: 'Redis', count: 11, avg_score: 7.4, trend: 'up' },
    { tag: 'MySQL', count: 9, avg_score: 6.8, trend: 'stable' },
    { tag: '消息队列', count: 8, avg_score: 6.1, trend: 'up' },
    { tag: '并发控制', count: 7, avg_score: 5.9, trend: 'down' },
    { tag: '系统设计', count: 6, avg_score: 5.6, trend: 'up' },
    { tag: 'JVM', count: 5, avg_score: 5.2, trend: 'stable' },
    { tag: '限流降级', count: 4, avg_score: 4.8, trend: 'down' },
    { tag: 'Linux', count: 4, avg_score: 6.4, trend: 'up' },
  ],
}

const SAMPLE_KNOWLEDGE_HISTORY = {
  records: [
    {
      id: 101,
      session_type: 'assist',
      question: 'Redis 为什么会出现缓存穿透，如何治理？',
      answer: '可以通过布隆过滤器、缓存空值、接口限流三层处理。',
      score: 6.5,
      tags: ['Redis', '限流降级'],
      created_at: now - 7200,
    },
    {
      id: 102,
      session_type: 'practice',
      question: '说一下 MySQL 索引失效的常见场景。',
      answer: '包括最左前缀不满足、函数操作列、类型隐式转换等。',
      score: 7.3,
      tags: ['MySQL'],
      created_at: now - 5400,
    },
    {
      id: 103,
      session_type: 'assist',
      question: '消息队列如何保证最终一致性？',
      answer: '常见做法包括本地消息表、事务消息、补偿任务与幂等设计。',
      score: 6.1,
      tags: ['消息队列', '系统设计'],
      created_at: now - 3600,
    },
    {
      id: 104,
      session_type: 'practice',
      question: '高并发库存扣减怎么避免超卖？',
      answer: '可以结合 Redis 原子扣减、数据库乐观锁和异步回写。',
      score: 5.4,
      tags: ['并发控制', '系统设计'],
      created_at: now - 1800,
    },
  ],
  total: 4,
}

const SAMPLE_RESUME_OPTIMIZATION = `## 匹配结论

**匹配度：82 / 100**

### 优势

- 有高并发接口优化和缓存治理经历，和 JD 的交易链路场景匹配度高。
- 具备 Redis、MySQL、消息队列的实战经验，覆盖核心技术栈。
- 有监控告警和稳定性治理内容，容易拉开和“只写业务”的候选人差距。

### 需要补强

- 简历里对系统设计结果量化不足，建议补充峰值 QPS、时延下降和成本优化数据。
- 云原生与容器化经验提及较少，可以补一句部署或运维协作经验。

### 推荐改写

| JD 要求 | 简历现状 | 建议写法 |
| --- | --- | --- |
| 高并发交易接口优化 | 只写了“优化接口性能” | 改成“负责交易接口性能优化，P99 时延下降 38%，峰值吞吐提升 2.1 倍” |
| Redis / MQ 实战 | 技术关键词较散 | 合并成“主导 Redis 缓存与 MQ 异步解耦方案，降低数据库热点压力” |
| 稳定性建设 | 体现不够 | 增加“补齐日志、告警、压测与故障复盘闭环” |
`

const ASSIST_INIT = {
  type: 'init',
  transcriptions: [
    '请你讲一下 Redis 持久化机制，以及 AOF 和 RDB 的取舍。',
    '如果主从切换发生，客户端和缓存层怎么降低业务感知？',
  ],
  qa_pairs: [
    {
      id: 'qa-redis',
      question: 'Redis 持久化机制，以及 AOF 和 RDB 的取舍。',
      answer: `Redis 线上一般不会只选 RDB 或只选 AOF，而是把两者放在一起看：RDB 解决“恢复快”，AOF 解决“数据更完整”，真正的取舍点是你的业务更怕恢复慢还是更怕丢数据。

如果面试里展开讲，我会分五层说：

1. RDB 是周期性快照，优点是文件紧凑、恢复快，适合冷启动和全量恢复；缺点是两次快照之间如果实例宕机，会丢掉最后那段数据。
2. AOF 是把写命令按策略追加到日志里，优点是数据完整性更高；缺点是文件会更大，恢复速度更慢，而且 fsync 配置不当会影响延迟。
3. 生产上通常会同时开启：重启恢复时优先用 AOF，没有 AOF 再回退到 RDB，这样能兼顾恢复能力和启动速度。
4. 再往下追问，就要补充 AOF 重写、主从复制、哨兵切换、磁盘瓶颈和热点流量下的稳定性边界。
5. 如果想回答得更像真实线上经验，可以补一句：持久化只能解决“重启后怎么恢复”，不能单独解决“故障期间是否丢数据”，还得结合主从和故障转移一起看。

\`\`\`text
冷启动恢复：优先 AOF，没有再用 RDB
高峰期关注：fsync 策略、磁盘 IO、重写时机
\`\`\`
`,
      thinkContent: '先给核心判断，再补机制、取舍和线上边界。',
      timestamp: now - 120,
      source: 'conversation_loopback',
      model_name: 'GPT-4.1 Mini',
    },
    {
      id: 'qa-failover',
      question: '主从切换时，客户端和缓存层怎么降低业务感知？',
      answer: `可以从三层回答：

1. **连接层**：客户端配置重试、超时和故障转移，避免把瞬时切换放大成全链路失败。
2. **缓存层**：热点 key 预热、降级兜底、短期限流，避免切换期间缓存击穿。
3. **观测层**：监控主从延迟、切换耗时和错误率，方便快速判断是否需要人工介入。`,
      thinkContent: '',
      timestamp: now - 40,
      source: 'manual_text',
      model_name: 'DeepSeek V3',
    },
  ],
  is_recording: true,
  is_paused: false,
  stt_loaded: true,
}

const PRACTICE_MESSAGES = [
  { type: 'stt_status', loaded: true, loading: false, delay: 20 },
  { type: 'practice_status', status: 'questioning', delay: 40 },
  {
    type: 'practice_questions',
    questions: [
      { id: 1, category: 'project', question: '说一个你负责过并且真正做过性能优化的项目。' },
      { id: 2, category: 'design', question: '设计一个高并发秒杀系统，重点讲防超卖和削峰。' },
      { id: 3, category: 'basic', question: 'MySQL 索引为什么会失效？举三个常见例子。' },
    ],
    delay: 60,
  },
  {
    type: 'practice_eval_done',
    question_id: 1,
    score: 8.4,
    feedback:
      '优点是项目背景和指标都比较具体，但建议再补充你本人主导的关键决策，例如缓存一致性、压测方法和线上验证过程。',
    delay: 80,
  },
  { type: 'practice_next', index: 1, delay: 100 },
]

const RESUME_MESSAGES = [
  { type: 'stt_status', loaded: true, loading: false, delay: 20 },
  { type: 'resume_opt_done', text: SAMPLE_RESUME_OPTIMIZATION, delay: 40 },
]

const COMMON_MESSAGES = [
  { type: 'stt_status', loaded: true, loading: false, delay: 20 },
  { type: 'model_health', index: 0, status: 'ok', delay: 30 },
  { type: 'model_health', index: 1, status: 'ok', delay: 35 },
  { type: 'model_health', index: 2, status: 'error', delay: 40 },
  {
    type: 'token_update',
    prompt: 4380,
    completion: 6210,
    total: 10590,
    by_model: {
      'GPT-4.1 Mini': { prompt: 2310, completion: 3340 },
      'DeepSeek V3': { prompt: 2070, completion: 2870 },
    },
    delay: 45,
  },
]

const SHOTS = [
  { name: 'assist-mode.png', scenario: 'assist', run: captureAssist },
  { name: 'practice-mode.png', scenario: 'practice', run: capturePractice },
  { name: 'knowledge-map.png', scenario: 'knowledge', run: captureKnowledge },
  { name: 'resume-optimizer.png', scenario: 'resume', run: captureResume },
]

function jsonResponse(route, data, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(data),
  })
}

function getUnknownApiPayload(method) {
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    return { ok: true }
  }
  return {}
}

function getApiPayload(url, method) {
  const pathname = url.pathname

  if (pathname === '/api/config' && method === 'GET') return SAMPLE_CONFIG
  if (pathname === '/api/config' && method === 'POST') return SAMPLE_CONFIG
  if (pathname === '/api/options') return SAMPLE_OPTIONS
  if (pathname === '/api/devices') return SAMPLE_DEVICES
  if (pathname === '/api/preflight/scenarios') {
    return {
      scenarios: [
        { id: 'self_intro', label: '自我介绍', question: '请做一个 1 分钟自我介绍。', recommended: true },
        { id: 'project', label: '项目追问', question: '说一个你最熟悉的项目。', recommended: false },
      ],
    }
  }
  if (pathname === '/api/preflight/run') return { ok: true }
  if (pathname === '/api/models/health' && method === 'POST') return { ok: true }
  if (pathname === '/api/models/health' && method === 'GET') {
    return { health: { 0: 'ok', 1: 'ok', 2: 'error' } }
  }

  if (pathname === '/api/resume/history') return SAMPLE_RESUME_HISTORY
  if (/^\/api\/resume\/history\/\d+$/.test(pathname) && method === 'GET') {
    const id = Number(pathname.split('/').pop())
    return SAMPLE_RESUME_DETAILS[id] ?? { detail: 'Not found' }
  }
  if (/^\/api\/resume\/history\/\d+$/.test(pathname) && method === 'DELETE') return { ok: true }
  if (/^\/api\/resume\/history\/\d+$/.test(pathname) && method === 'PUT') return { ok: true, length: 1200 }
  if (/^\/api\/resume\/history\/\d+\/apply$/.test(pathname)) return { ok: true, history_id: 3, length: 1500, preview: '已选用' }

  if (pathname === '/api/knowledge/summary') return SAMPLE_KNOWLEDGE_SUMMARY
  if (pathname === '/api/knowledge/history') return SAMPLE_KNOWLEDGE_HISTORY
  if (pathname === '/api/knowledge/reset') return { ok: true }

  if (pathname === '/api/practice/status') return { ok: true }
  if (pathname === '/api/token/stats') {
    return {
      prompt: 4380,
      completion: 6210,
      total: 10590,
      by_model: {
        'GPT-4.1 Mini': { prompt: 2310, completion: 3340 },
        'DeepSeek V3': { prompt: 2070, completion: 2870 },
      },
    }
  }

  return getUnknownApiPayload(method)
}

function buildInitScriptConfig(scenario) {
  const scenarioMessages = {
    assist: [{ ...ASSIST_INIT, delay: 20 }, ...COMMON_MESSAGES, { type: 'recording', value: true, delay: 60 }, { type: 'audio_level', value: 0.62, delay: 80 }],
    practice: [...COMMON_MESSAGES, ...PRACTICE_MESSAGES],
    knowledge: [...COMMON_MESSAGES],
    resume: [...COMMON_MESSAGES, ...RESUME_MESSAGES],
  }

  return {
    scenario,
    messages: scenarioMessages[scenario] ?? [],
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
    server.on('error', reject)
  })
}

async function waitForHttp(url, timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Ignore until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function runCommand(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  })

  await new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

function startPreview(port) {
  let previewLog = ''
  const child = spawn(NPM_CMD, ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: FRONTEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  child.stdout.on('data', (chunk) => {
    previewLog += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    previewLog += chunk.toString()
  })

  return { child, getLog: () => previewLog }
}

function stopProcess(child) {
  if (!child || child.killed) return
  child.kill('SIGTERM')
}

async function preparePage(browser, baseUrl, scenario) {
  const context = await browser.newContext({
    viewport: { width: 1720, height: 960 },
    deviceScaleFactor: 1,
  })

  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const payload = getApiPayload(url, method)
    const status = payload?.detail === 'Not found' ? 404 : 200
    await jsonResponse(route, payload, status)
  })

  const initScriptConfig = buildInitScriptConfig(scenario)
  await context.addInitScript(({ scenario: shotScenario, messages }) => {
    localStorage.setItem('ia-color-scheme', 'vscode-light-plus')
    localStorage.setItem('ia_answer_panel_layout', 'stream')

    const nativeWebSocket = window.WebSocket
    let socketCount = 0

    class MockWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3

      constructor(url) {
        this.url = url
        this.readyState = MockWebSocket.CONNECTING
        this.protocol = ''
        this.extensions = ''
        this.bufferedAmount = 0
        this.binaryType = 'blob'
        this.onopen = null
        this.onmessage = null
        this.onclose = null
        this.onerror = null
        this._id = ++socketCount

        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN
          if (typeof this.onopen === 'function') this.onopen(new Event('open'))

          if (this._id === 1 && this.url.includes('/ws')) {
            messages.forEach((message) => {
              const delay = typeof message.delay === 'number' ? message.delay : 0
              setTimeout(() => {
                if (this.readyState !== MockWebSocket.OPEN) return
                const event = new MessageEvent('message', {
                  data: JSON.stringify(message),
                })
                if (typeof this.onmessage === 'function') this.onmessage(event)
              }, delay)
            })
          }
        }, 0)
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED
        if (typeof this.onclose === 'function') this.onclose(new CloseEvent('close'))
      }

      addEventListener(type, listener) {
        if (type === 'open') this.onopen = listener
        if (type === 'message') this.onmessage = listener
        if (type === 'close') this.onclose = listener
        if (type === 'error') this.onerror = listener
      }

      removeEventListener(type, listener) {
        if (type === 'open' && this.onopen === listener) this.onopen = null
        if (type === 'message' && this.onmessage === listener) this.onmessage = null
        if (type === 'close' && this.onclose === listener) this.onclose = null
        if (type === 'error' && this.onerror === listener) this.onerror = null
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    })

    window.__IA_README_SHOT__ = shotScenario
    window.__IA_NATIVE_WS__ = nativeWebSocket
  }, initScriptConfig)

  const page = await context.newPage()
  await page.goto(`${baseUrl}/?shot=${scenario}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  return { context, page }
}

async function captureAssist(page, outputPath) {
  await page.getByRole('heading', { name: '学习助手' }).waitFor({ timeout: 5000 })
  await page.screenshot({ path: outputPath })
}

async function capturePractice(page, outputPath) {
  await page.getByRole('tab', { name: /模拟练习/i }).click()
  // 等 Practice 任一关键态可见：idle（"模拟面试练习"）或 questioning（"第 X 题"）
  await Promise.race([
    page.getByText('模拟面试练习').waitFor({ timeout: 6000 }).catch(() => null),
    page.getByText(/第\s*\d+\s*题/).first().waitFor({ timeout: 6000 }).catch(() => null),
  ])
  await page.waitForTimeout(200)
  await page.screenshot({ path: outputPath })
}

async function captureKnowledge(page, outputPath) {
  await page.getByRole('tab', { name: /能力分析/i }).click()
  await page.getByText('薄弱点排名').waitFor({ timeout: 5000 })
  await page.screenshot({ path: outputPath })
}

async function captureResume(page, outputPath) {
  await page.getByRole('tab', { name: /简历优化/i }).click()
  await page.getByText('粘贴目标岗位 JD').waitFor({ timeout: 5000 })
  await page.screenshot({ path: outputPath })
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })

  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  await runCommand(NPM_CMD, ['run', 'build'], FRONTEND_DIR)

  const { child: previewProcess, getLog } = startPreview(port)
  const cleanup = () => stopProcess(previewProcess)
  process.on('exit', cleanup)
  process.on('SIGINT', () => {
    cleanup()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(143)
  })

  try {
    await waitForHttp(baseUrl)
  } catch (error) {
    cleanup()
    throw new Error(`${error.message}\n\nPreview log:\n${getLog()}`)
  }

  const browser = await chromium.launch({ headless: true })

  try {
    for (const shot of SHOTS) {
      const outputPath = path.join(OUTPUT_DIR, shot.name)
      const { context, page } = await preparePage(browser, baseUrl, shot.scenario)
      try {
        await shot.run(page, outputPath)
      } finally {
        await context.close()
      }
      console.log(`saved ${outputPath}`)
    }
  } finally {
    await browser.close()
    cleanup()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
