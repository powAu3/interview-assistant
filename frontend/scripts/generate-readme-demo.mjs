import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
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
  stt_providers: ['whisper', 'doubao'],
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

function getApiPayload(url, method) {
  const pathname = url.pathname
  if (pathname === '/api/config' && method === 'GET') return SAMPLE_CONFIG
  if (pathname === '/api/config' && method === 'POST') return SAMPLE_CONFIG
  if (pathname === '/api/options') return SAMPLE_OPTIONS
  if (pathname === '/api/devices') return SAMPLE_DEVICES
  if (pathname === '/api/models/health' && method === 'POST') return { ok: true }
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
    localStorage.setItem('ia-color-scheme', 'vscode-dark-plus')
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
  })

  const page = await context.newPage()
  await page.goto(`${baseUrl}/?demo=assist`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '开始' }).waitFor({ timeout: 5000 })
  return { context, page }
}

async function emit(page, message) {
  await page.evaluate((msg) => {
    window.__IA_MOCK_WS__.emit(msg)
  }, message)
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

  await captureFrame(page, frames, { waitMs: 300, displayMs: 780 })
  await captureFrame(page, frames, { waitMs: 220, displayMs: 720 })

  await page.getByRole('button', { name: '开始' }).click()
  await emit(page, { type: 'recording', value: true })
  await emit(page, { type: 'audio_level', value: 0.18 })
  await captureFrame(page, frames, { waitMs: 220, displayMs: 620 })

  await emit(page, { type: 'transcribing', value: true })
  await emit(page, { type: 'audio_level', value: 0.46 })
  await captureFrame(page, frames, { waitMs: 220, displayMs: 620 })

  const firstQuestion = '请你讲一下 Redis 持久化机制，以及 AOF 和 RDB 的取舍。'
  await emit(page, { type: 'transcription', text: firstQuestion })
  await emit(page, { type: 'transcribing', value: false })
  await captureFrame(page, frames, { waitMs: 260, displayMs: 820 })

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
    chunk: '按正式面试长答来讲：先结论，再讲机制、取舍、线上做法和追问点。',
  })
  await captureFrame(page, frames, { waitMs: 240, displayMs: 720 })

  await emit(page, {
    type: 'answer_chunk',
    id: 'demo-1',
    chunk: `如果我是候选人，我不会把这个问题回答成“RDB 和 AOF 二选一”，而是先给结论：线上通常会同时开启两者，因为 RDB 解决的是“恢复速度”，AOF 解决的是“数据完整性”，真正要比较的是业务更怕恢复慢还是更怕丢数据。\n\n`,
  })
  await captureFrame(page, frames, { waitMs: 240, displayMs: 760 })

  await emit(page, {
    type: 'answer_chunk',
    id: 'demo-1',
    chunk: `正式展开我会分五层来答：\n1. RDB 是周期性快照，优点是文件紧凑、恢复快，适合冷启动和全量恢复；缺点是两次快照之间如果实例宕机，会丢最后一段数据。\n2. AOF 是把写命令按策略追加到日志里，数据完整性更高，但文件更大、恢复更慢，而且 fsync 配置不当会把磁盘压力传导到延迟。\n3. 生产上通常会同时开启：恢复时优先用 AOF，没有 AOF 再回退到 RDB，这样能兼顾恢复能力和重启速度。\n4. 真正线上要继续看 AOF 重写时机、主从复制延迟、哨兵切换窗口、磁盘 IO 峰值，以及高峰流量下是否会放大抖动。\n5. 如果面试官继续追问，我会补一句：持久化只能解决“重启后怎么恢复”，不能单独解决“故障期间是否丢数据”，还要结合主从、故障转移和客户端重试一起看。\n`,
  })
  await captureFrame(page, frames, { waitMs: 260, displayMs: 920 })

  const firstAnswer = `如果我是候选人，我不会把这个问题回答成“RDB 和 AOF 二选一”，而是先给结论：线上通常会同时开启两者，因为 RDB 解决的是“恢复速度”，AOF 解决的是“数据完整性”，真正要比较的是业务更怕恢复慢还是更怕丢数据。

正式展开我会分五层来答：
1. RDB 是周期性快照，优点是文件紧凑、恢复快，适合冷启动和全量恢复；缺点是两次快照之间如果实例宕机，会丢最后一段数据。
2. AOF 是把写命令按策略追加到日志里，数据完整性更高，但文件更大、恢复更慢，而且 fsync 配置不当会把磁盘压力传导到延迟。
3. 生产上通常会同时开启：恢复时优先用 AOF，没有 AOF 再回退到 RDB，这样能兼顾恢复能力和重启速度。
4. 真正线上要继续看 AOF 重写时机、主从复制延迟、哨兵切换窗口、磁盘 IO 峰值，以及高峰流量下是否会放大抖动。
5. 如果面试官继续追问，我会补一句：持久化只能解决“重启后怎么恢复”，不能单独解决“故障期间是否丢数据”，还要结合主从、故障转移和客户端重试一起看。`

  await emit(page, {
    type: 'answer_done',
    id: 'demo-1',
    question: 'Redis 持久化机制，以及 AOF 和 RDB 的取舍。',
    answer: firstAnswer,
    think: '按正式面试长答来讲：先结论，再讲机制、取舍、线上做法和追问点。',
    model_name: 'GPT-4.1 Mini',
  })
  await captureFrame(page, frames, { waitMs: 300, displayMs: 1400 })

  const input = page.getByPlaceholder('输入问题，Enter 发送')
  await input.click()
  await input.type('写代码实现：给一个 Redis 缓存穿透防护的 Java 示例', { delay: 28 })
  await captureFrame(page, frames, { waitMs: 260, displayMs: 700 })
  await input.press('Enter')
  await emit(page, {
    type: 'answer_start',
    id: 'demo-2',
    question: '写代码实现：给一个 Redis 缓存穿透防护的 Java 示例',
    source: 'manual_text',
    model_name: 'DeepSeek V3',
  })
  await captureFrame(page, frames, { waitMs: 200, displayMs: 620 })

  await emit(page, {
    type: 'answer_chunk',
    id: 'demo-2',
    chunk: `这个题如果面试里让我写代码，我会先给一个“布隆过滤器 + 缓存空值”的可落地版本，因为它同时覆盖了非法 key 和热点空值两类缓存穿透。\n\n\`\`\`java\npublic String queryUser(String userId) {\n`,
  })
  await captureFrame(page, frames, { waitMs: 220, displayMs: 720 })

  await emit(page, {
    type: 'answer_chunk',
    id: 'demo-2',
    chunk: `    if (!bloomFilter.mightContain(userId)) return null;\n    String key = "user:" + userId;\n    String cached = redis.get(key);\n`,
  })
  await captureFrame(page, frames, { waitMs: 220, displayMs: 820 })

  const secondAnswer = `这个题如果面试里让我写代码，我会先给一个“布隆过滤器 + 缓存空值”的可落地版本，因为它同时覆盖了非法 key 和热点空值两类缓存穿透。

\`\`\`java
public String queryUser(String userId) {
    if (!bloomFilter.mightContain(userId)) return null;
    String key = "user:" + userId;
    String cached = redis.get(key);
    if (cached != null) return cached;

    User user = userRepository.findById(userId);
    if (user == null) {
        redis.setex(key, 60, "__NULL__");
        return null;
    }

    redis.setex(key, 600, toJson(user));
    return toJson(user);
}
\`\`\`

面试里我还会再补三句：
1. 布隆过滤器负责挡掉明显不存在的 key，避免请求直接打到数据库。
2. 缓存空值负责挡短时间内对同一个不存在数据的重复穿透，但 TTL 要比正常缓存更短。
3. 如果这是高并发热点场景，还要继续补限流、互斥锁和监控命中率，否则只靠一段代码还不够。`

  await emit(page, {
    type: 'answer_done',
    id: 'demo-2',
    question: '写代码实现：给一个 Redis 缓存穿透防护的 Java 示例',
    answer: secondAnswer,
    think: '',
    model_name: 'DeepSeek V3',
  })

  await captureFrame(page, frames, { waitMs: 280, displayMs: 1400 })
  await captureFrame(page, frames, { waitMs: 300, displayMs: 1600 })
  return frames
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
    const { context, page } = await preparePage(browser, baseUrl)
    try {
      const frames = await runDemo(page)
      const gif = encodeGif(frames)
      await writeFile(OUTPUT_GIF, gif)
      await writeFile(OUTPUT_POSTER, frames[frames.length - 1].png)
      console.log(`saved ${OUTPUT_GIF}`)
      console.log(`saved ${OUTPUT_POSTER}`)
    } finally {
      await context.close()
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
