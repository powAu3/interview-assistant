import { spawn } from 'node:child_process'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import gifencPkg from 'gifenc'
import pngjsPkg from 'pngjs'

const { GIFEncoder, applyPalette, quantize } = gifencPkg
const { PNG } = pngjsPkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIR = path.resolve(__dirname, '..')
const REPO_DIR = path.resolve(FRONTEND_DIR, '..')
const OUTPUT_DIR = path.resolve(REPO_DIR, 'docs', 'screenshots')
const OUTPUT_GIF = path.join(OUTPUT_DIR, 'assist-demo.gif')
const OUTPUT_POSTER = path.join(OUTPUT_DIR, 'assist-demo-poster.png')
const OUTPUT_VIDEO = path.join(OUTPUT_DIR, 'assist-demo.webm')
const VIDEO_TEMP_DIR = path.join(OUTPUT_DIR, '.video-tmp')
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm'

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
  generic_stt_api_base_url: '',
  generic_stt_api_key: '',
  generic_stt_model: '',
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
  positions: ['后端开发工程师', '前端开发工程师', '全栈开发工程师'],
  languages: ['中文', 'English'],
  practice_audiences: ['social', 'campus_intern'],
  stt_providers: ['whisper', 'doubao', 'generic'],
  whisper_models: ['large-v3-turbo', 'medium', 'small'],
  screen_capture_regions: ['full', 'left_half', 'right_half', 'top_half', 'bottom_half'],
}

const SAMPLE_DEVICES = {
  devices: [
    { id: 1001, name: 'BlackHole 2ch', channels: 2, is_loopback: true, host_api: 'Core Audio' },
    { id: 1002, name: 'MacBook Pro 麦克风', channels: 1, is_loopback: false, host_api: 'Core Audio' },
  ],
  platform: {
    platform: 'darwin',
    needs_virtual_device: true,
    instructions: '建议安装虚拟声卡采集系统音频',
  },
}

const now = Math.floor(Date.now() / 1000)
const SAMPLE_RESUME_HISTORY = {
  items: [
    {
      id: 3,
      original_filename: '张三_后端开发.pdf',
      file_size: 224512,
      created_at: now - 3600,
      last_used_at: now - 300,
      parsed_ok: true,
      preview: '3 年后端经验，负责高并发接口优化、缓存设计与监控治理。',
      parse_error: null,
      is_active: true,
    },
  ],
  max: 10,
}

const SAMPLE_KB_STATUS = {
  enabled: true,
  trigger_modes: ['asr_realtime', 'manual_text', 'written_exam'],
  top_k: 4,
  deadline_ms: 150,
  asr_deadline_ms: 80,
  total_docs: 3,
  total_chunks: 42,
  last_mtime: now - 120,
  deps: { docx: true, pdf: true, ocr: false, vision: true },
}

const SAMPLE_KB_DOCS = {
  items: [
    {
      id: 1,
      path: 'redis/持久化与主从切换.md',
      mtime: now - 200,
      size: 12480,
      loader: 'markdown',
      title: 'Redis 持久化与主从切换',
      status: 'ok',
      error: null,
      chunk_count: 12,
    },
    {
      id: 2,
      path: 'system-design/缓存穿透治理.pdf',
      mtime: now - 420,
      size: 328000,
      loader: 'pdf',
      title: '缓存穿透治理',
      status: 'ok',
      error: null,
      chunk_count: 16,
    },
    {
      id: 3,
      path: 'resume/项目复盘.docx',
      mtime: now - 660,
      size: 84560,
      loader: 'docx',
      title: '项目复盘',
      status: 'ok',
      error: null,
      chunk_count: 14,
    },
  ],
}

const SAMPLE_KB_RECENT_HITS = {
  items: [
    {
      ts: now - 65,
      query: 'Redis 持久化机制，以及 AOF 和 RDB 的取舍',
      mode: 'asr_realtime',
      hit_count: 2,
      latency_ms: 46,
      timed_out: false,
      error: null,
      top_section_paths: ['Redis/持久化', 'Redis/主从切换'],
    },
    {
      ts: now - 18,
      query: 'Redis 缓存穿透防护的 Java 示例',
      mode: 'manual_text',
      hit_count: 3,
      latency_ms: 52,
      timed_out: false,
      error: null,
      top_section_paths: ['缓存/穿透治理', 'Java/缓存模式'],
    },
  ],
}

const SAMPLE_KB_SEARCH = {
  hits: [
    {
      path: 'redis/持久化与主从切换.md',
      section_path: 'Redis/持久化/AOF 与 RDB',
      page: null,
      origin: 'text',
      score: 0.93,
      excerpt: '线上常见做法是同时开启 AOF 与 RDB，前者偏数据完整性，后者偏恢复速度。',
    },
    {
      path: 'system-design/缓存穿透治理.pdf',
      section_path: '缓存/穿透治理/布隆过滤器',
      page: 3,
      origin: 'vision',
      score: 0.87,
      excerpt: '布隆过滤器负责快速挡掉明显不存在的 key，再配合缓存空值控制热点空穿透。',
    },
  ],
}

function getApiPayload(url, method) {
  const pathname = url.pathname
  if (pathname === '/api/config' && method === 'GET') return SAMPLE_CONFIG
  if (pathname === '/api/config' && method === 'POST') return SAMPLE_CONFIG
  if (pathname === '/api/options') return SAMPLE_OPTIONS
  if (pathname === '/api/devices') return SAMPLE_DEVICES
  if (pathname === '/api/models/health' && method === 'POST') return { ok: true }
  if (pathname === '/api/models/health' && method === 'GET') return { health: { 0: 'ok', 1: 'ok', 2: 'error' } }
  if (pathname === '/api/preflight/scenarios') return { scenarios: [] }
  if (pathname === '/api/preflight/run') return { ok: true }
  if (pathname === '/api/kb/status') return SAMPLE_KB_STATUS
  if (pathname === '/api/kb/docs') return SAMPLE_KB_DOCS
  if (pathname === '/api/kb/hits/recent') return SAMPLE_KB_RECENT_HITS
  if (pathname === '/api/kb/search' && method === 'POST') return SAMPLE_KB_SEARCH
  if (pathname === '/api/kb/reindex' && method === 'POST') return { ok: true, docs: 3, chunks: 42 }
  if (pathname === '/api/knowledge/summary') return { tags: [] }
  if (pathname === '/api/knowledge/history') return { records: [], total: 0 }
  if (pathname === '/api/resume/history') return SAMPLE_RESUME_HISTORY
  if (pathname === '/api/ask') return { ok: true }
  if (pathname === '/api/start') return { ok: true }
  if (pathname === '/api/pause') return { ok: true }
  if (pathname === '/api/unpause') return { ok: true }
  if (pathname === '/api/stop') return { ok: true }
  if (pathname === '/api/clear') return { ok: true }
  if (pathname === '/api/ask/cancel') return { ok: true }
  if (pathname === '/api/token/stats') {
    return {
      prompt: 3860,
      completion: 5020,
      total: 8880,
      by_model: {
        'GPT-4.1 Mini': { prompt: 2560, completion: 3320 },
        'DeepSeek V3': { prompt: 1300, completion: 1700 },
      },
    }
  }
  return method === 'GET' ? {} : { ok: true }
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
  const child = spawn(
    NPM_CMD,
    ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: FRONTEND_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    },
  )

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

async function preparePage(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: VIDEO_TEMP_DIR,
      size: { width: 1280, height: 820 },
    },
  })

  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(getApiPayload(url, method)),
    })
  })

  await context.addInitScript(() => {
    localStorage.setItem('ia-color-scheme', 'editorial-glass')
    localStorage.setItem('ia_answer_panel_layout', 'stream')
    window.confirm = () => true

    const sockets = []
    let socketId = 0

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
        this._id = ++socketId
        sockets.push(this)

        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN
          if (typeof this.onopen === 'function') this.onopen(new Event('open'))
        }, 0)
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED
        const index = sockets.indexOf(this)
        if (index >= 0) sockets.splice(index, 1)
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

    window.__IA_MOCK_WS__ = {
      emit(message) {
        const payload = JSON.stringify(message)
        for (const socket of sockets) {
          if (socket.readyState !== MockWebSocket.OPEN) continue
          if (typeof socket.onmessage === 'function') {
            socket.onmessage(new MessageEvent('message', { data: payload }))
          }
        }
      },
    }

    window.__IA_CAPTION__ = {
      ensure() {
        let root = document.getElementById('ia-demo-caption')
        if (root) return root

        root = document.createElement('div')
        root.id = 'ia-demo-caption'
        root.setAttribute(
          'style',
          [
            'position:fixed',
            'left:32px',
            'right:32px',
            'bottom:28px',
            'z-index:9999',
            'pointer-events:none',
            'display:flex',
            'justify-content:center',
          ].join(';'),
        )

        const pill = document.createElement('div')
        pill.setAttribute(
          'style',
          [
            'max-width:920px',
            'padding:14px 18px',
            'border-radius:20px',
            'background:rgba(15,23,42,0.78)',
            'color:#f8fafc',
            'font:600 18px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif',
            'letter-spacing:0.01em',
            'box-shadow:0 24px 60px rgba(15,23,42,0.28)',
            'backdrop-filter:blur(14px)',
            'border:1px solid rgba(255,255,255,0.12)',
            'text-align:center',
          ].join(';'),
        )

        const tag = document.createElement('div')
        tag.id = 'ia-demo-caption-tag'
        tag.setAttribute(
          'style',
          [
            'display:inline-flex',
            'align-items:center',
            'gap:8px',
            'margin-bottom:8px',
            'padding:4px 10px',
            'border-radius:999px',
            'background:rgba(250,204,21,0.16)',
            'color:#fde68a',
            'font-size:11px',
            'font-weight:700',
            'letter-spacing:0.12em',
            'text-transform:uppercase',
          ].join(';'),
        )
        tag.textContent = 'INTERVIEW FLOW'

        const text = document.createElement('div')
        text.id = 'ia-demo-caption-text'
        text.textContent = ''

        pill.append(tag, text)
        root.append(pill)
        document.documentElement.append(root)
        return root
      },
      set(text, tagText = 'INTERVIEW FLOW') {
        const root = this.ensure()
        root.style.opacity = '1'
        const tag = document.getElementById('ia-demo-caption-tag')
        const el = document.getElementById('ia-demo-caption-text')
        if (tag) tag.textContent = tagText
        if (el) el.textContent = text
      },
      clear() {
        const root = this.ensure()
        root.style.opacity = '0'
      },
    }
  })

  const page = await context.newPage()
  await page.goto(`${baseUrl}/?demo=assist`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.locator('button:has-text("开始面试"), button:has-text("开始")').first().waitFor({ timeout: 15000 })
  return { context, page }
}

async function emit(page, message) {
  await page.evaluate((msg) => {
    window.__IA_MOCK_WS__.emit(msg)
  }, message)
}

async function setCaption(page, text, tag = 'INTERVIEW FLOW') {
  await page.evaluate(
    ({ value, label }) => {
      window.__IA_CAPTION__.set(value, label)
    },
    { value: text, label: tag },
  )
}

async function clearCaption(page) {
  await page.evaluate(() => {
    window.__IA_CAPTION__.clear()
  })
}

async function captureFrame(
  page,
  frames,
  { waitMs = 240, displayMs = 560 } = {},
) {
  if (waitMs > 0) await page.waitForTimeout(waitMs)
  frames.push({
    png: await page.screenshot({ type: 'png' }),
    displayMs,
  })
}

function encodeGif(frames) {
  const gif = GIFEncoder()

  frames.forEach((frame, index) => {
    const png = PNG.sync.read(frame.png)
    const palette = quantize(png.data, 192, { format: 'rgb444' })
    const indexed = applyPalette(png.data, palette, 'rgb444')
    gif.writeFrame(indexed, png.width, png.height, {
      palette,
      delay: frame.displayMs,
      repeat: index === 0 ? 0 : undefined,
    })
  })

  gif.finish()
  return Buffer.from(gif.bytesView())
}

async function runDemo(page) {
  const frames = []
  const BEAT = { waitMs: 900, displayMs: 1300 }

  await emit(page, { type: 'init', transcriptions: [], qa_pairs: [], is_recording: false, is_paused: false, stt_loaded: true })
  await emit(page, { type: 'stt_status', loaded: true, loading: false })
  await emit(page, { type: 'model_health', index: 0, status: 'ok' })
  await emit(page, { type: 'model_health', index: 1, status: 'ok' })
  await emit(page, { type: 'model_health', index: 2, status: 'error' })
  await emit(page, {
    type: 'token_update',
    prompt: 3860,
    completion: 5020,
    total: 8880,
    by_model: {
      'GPT-4.1 Mini': { prompt: 2560, completion: 3320 },
      'DeepSeek V3': { prompt: 1300, completion: 1700 },
    },
  })

  await setCaption(page, '打开应用后，直接进入实时辅助主流程。', '00 / START')
  await captureFrame(page, frames, { waitMs: 500, displayMs: 1250 })

  const startBtn = page.locator('button:has-text("开始面试"), button:has-text("开始")').first()
  for (let i = 0; i < 30; i += 1) {
    const disabled = await startBtn.getAttribute('disabled').catch(() => null)
    if (disabled === null) break
    const deviceSelect = page.locator('select').filter({ hasText: /BlackHole|麦克风|Mic|System/i }).first()
    if (await deviceSelect.count().catch(() => 0)) {
      await deviceSelect.selectOption({ index: 1 }).catch(() => {})
    }
    await page.waitForTimeout(200)
  }

  await setCaption(page, '选择系统音频或麦克风后，一键开始实时听题。', '01 / LISTEN')
  await captureFrame(page, frames, BEAT)
  await startBtn.click({ force: true })
  await emit(page, { type: 'recording', value: true })
  await emit(page, { type: 'audio_level', value: 0.2 })
  await emit(page, { type: 'transcribing', value: true })
  await captureFrame(page, frames, BEAT)

  await setCaption(page, '左侧实时转录会跟着面试进度持续落字。', '02 / TRANSCRIPT')
  await emit(page, { type: 'transcription', text: '请你讲一下 Redis 持久化机制。' })
  await emit(page, { type: 'audio_level', value: 0.46 })
  await captureFrame(page, frames, BEAT)
  await emit(page, { type: 'transcription', text: '再补一下 AOF 和 RDB 的取舍。' })
  await emit(page, { type: 'audio_level', value: 0.54 })
  await captureFrame(page, frames, BEAT)
  await emit(page, { type: 'transcribing', value: false })

  await emit(page, {
    type: 'answer_start',
    id: 'demo-1',
    question: 'Redis 持久化机制，以及 AOF 和 RDB 的取舍。',
    source: 'conversation_loopback',
    model_name: 'GPT-4.1 Mini',
  })
  await emit(page, {
    type: 'answer_think_chunk',
    id: 'demo-1',
    chunk: '先给结论，再讲机制、取舍和线上实践边界。',
  })
  await setCaption(page, '右侧答案区会先组织思路，再流式生成正式回答。', '03 / ANSWER')
  await captureFrame(page, frames, BEAT)

  await emit(page, {
    type: 'answer_chunk',
    id: 'demo-1',
    chunk: `这个问题我会先给结论：线上通常不会把 RDB 和 AOF 当成二选一，而是一起看。RDB 更偏恢复速度，AOF 更偏数据完整性，真正要比较的是业务更怕恢复慢还是更怕丢数据。\n\n`,
  })
  await captureFrame(page, frames, BEAT)

  await emit(page, {
    type: 'answer_chunk',
    id: 'demo-1',
    chunk: `正式展开我会分三层来答：\n1. RDB 是周期性快照，恢复快，但会丢最后一段数据。\n2. AOF 数据更完整，但文件更大、恢复更慢，而且要关注 fsync 对延迟的影响。\n3. 线上通常会同时开启，再结合主从和故障转移一起看，才更接近真实生产结论。\n`,
  })
  await captureFrame(page, frames, BEAT)

  const firstAnswer = `这个问题我会先给结论：线上通常不会把 RDB 和 AOF 当成二选一，而是一起看。RDB 更偏恢复速度，AOF 更偏数据完整性，真正要比较的是业务更怕恢复慢还是更怕丢数据。

正式展开我会分三层来答：
1. RDB 是周期性快照，恢复快，但会丢最后一段数据。
2. AOF 数据更完整，但文件更大、恢复更慢，而且要关注 fsync 对延迟的影响。
3. 线上通常会同时开启，再结合主从和故障转移一起看，才更接近真实生产结论。`

  await emit(page, {
    type: 'answer_done',
    id: 'demo-1',
    question: 'Redis 持久化机制，以及 AOF 和 RDB 的取舍。',
    answer: firstAnswer,
    think: '先给结论，再讲机制、取舍和线上实践边界。',
    model_name: 'GPT-4.1 Mini',
  })
  await emit(page, {
    type: 'kb_hits',
    qa_id: 'demo-1',
    latency_ms: 52,
    degraded: false,
    hit_count: 2,
    hits: SAMPLE_KB_SEARCH.hits,
  })
  await setCaption(page, '回答还能挂上本地知识库引用，方便补全你自己的材料。', '04 / KB')
  await captureFrame(page, frames, BEAT)

  const togglePanelBtn = page.getByRole('button', { name: /隐藏实时转录面板|显示实时转录面板/ })
  if (await togglePanelBtn.count().catch(() => 0)) {
    await setCaption(page, '空间不够时，支持一键收起实时转录面板，把焦点留给答案。', '05 / FOCUS')
    await togglePanelBtn.first().click().catch(() => {})
    await captureFrame(page, frames, BEAT)
    await togglePanelBtn.first().click().catch(() => {})
    await captureFrame(page, frames, BEAT)
  }

  const settingsButton = page.getByRole('button', { name: /打开设置/ })
  if (await settingsButton.count().catch(() => 0)) {
    await setCaption(page, '桌面端的重点不是花哨，而是屏幕共享隐身能力；Boss Key 和悬浮提示窗是配套能力。', '06 / DESKTOP')
    await settingsButton.first().click().catch(() => {})
    await captureFrame(page, frames, BEAT)

    const searchInput = page.getByLabel('搜索设置项')
    if (await searchInput.count().catch(() => 0)) {
      await searchInput.fill('overlay').catch(() => {})
      await page.getByText('反截图检测为 Beta 能力').waitFor({ timeout: 4000 }).catch(() => {})
      await captureFrame(page, frames, BEAT)
      await setCaption(page, '它的强项是桌面端在大多数常见屏幕共享场景下更稳，但不同软件、系统和权限策略差异很大，必须由你自己探索、验证并按环境调整。', '07 / STEALTH')
      await captureFrame(page, frames, { waitMs: 920, displayMs: 1450 })
    }

    const modelsTab = page.getByRole('button', { name: /^模型$/ })
    if (await modelsTab.count().catch(() => 0)) {
      await modelsTab.first().click().catch(() => {})
      await page.getByText('LLM 模型管理').waitFor({ timeout: 4000 }).catch(() => {})
      await setCaption(page, '模型配置也能细调：支持自定义 temperature、max tokens 和并行路数。', '08 / LLM')
      await captureFrame(page, frames, BEAT)
    }

    const closeSettings = page.getByRole('button', { name: /关闭/ }).last()
    if (await closeSettings.count().catch(() => 0)) {
      await closeSettings.click().catch(() => {})
      await captureFrame(page, frames, { waitMs: 350, displayMs: 500 })
    }
  }

  await setCaption(page, '实时转录、自动回答、桌面端屏幕共享隐身，再加上可定制化的 LLM 参数，这些才是它最核心的主流程；隐身效果也一定要自己探索和验证。', 'END / SUMMARY')
  await captureFrame(page, frames, { waitMs: 820, displayMs: 1320 })
  await clearCaption(page)
  await captureFrame(page, frames, { waitMs: 260, displayMs: 450 })
  return frames
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  await rm(VIDEO_TEMP_DIR, { recursive: true, force: true })
  await mkdir(VIDEO_TEMP_DIR, { recursive: true })

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
    const { context, page } = await preparePage(browser, baseUrl)
    const recordedVideo = page.video()
    try {
      const frames = await runDemo(page)
      const gif = encodeGif(frames)
      await writeFile(OUTPUT_GIF, gif)
      await writeFile(OUTPUT_POSTER, frames[frames.length - 1].png)
      console.log(`saved ${OUTPUT_GIF}`)
      console.log(`saved ${OUTPUT_POSTER}`)
    } finally {
      await context.close()
      if (recordedVideo) {
        const source = await recordedVideo.path()
        await copyFile(source, OUTPUT_VIDEO)
        console.log(`saved ${OUTPUT_VIDEO}`)
      }
      await rm(VIDEO_TEMP_DIR, { recursive: true, force: true })
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
