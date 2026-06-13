import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const realSmokeEnabled = process.env.REAL_CHAIN_SMOKE === '1'
const repoRoot = path.resolve(process.cwd(), '..')
const preflightAudioPath = path.join(repoRoot, 'backend', 'assets', 'preflight_phrase.wav')
const candidateConfigKeys = [
  'candidate_asr_enabled',
  'candidate_stt_provider',
  'candidate_whisper_model',
  'candidate_whisper_language',
  'candidate_remote_stt_enabled',
  'candidate_context_enabled',
  'candidate_context_wait_ms',
  'candidate_context_max_chars',
  'candidate_context_min_chars',
  'candidate_streaming_asr_enabled',
  'candidate_streaming_asr_interval_ms',
]

test.describe('real interview chain smoke', () => {
  test.skip(!realSmokeEnabled, 'Set REAL_CHAIN_SMOKE=1 to run live audio/STT/LLM smoke tests.')
  test.setTimeout(130_000)

  async function api(page, path, options = {}) {
    return await page.evaluate(async ({ path, options }) => {
      const res = await fetch(path, {
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        ...options,
      })
      const text = await res.text()
      let body = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }
      return { ok: res.ok, status: res.status, body }
    }, { path, options })
  }

  async function postJson(page, path, body = {}) {
    const res = await api(page, path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    expect(res.ok, `${path} failed: ${JSON.stringify(res.body)}`).toBe(true)
    return res.body
  }

  async function patchConfig(page, patch) {
    return await postJson(page, '/api/config', patch)
  }

  function pickCandidateConfig(config) {
    return Object.fromEntries(candidateConfigKeys.map((key) => [key, config[key]]))
  }

  async function pickMainLoopbackDevice(page) {
    const devices = await api(page, '/api/devices')
    expect(devices.ok, JSON.stringify(devices.body)).toBe(true)
    const main = devices.body.devices.find((device) => device.is_loopback)
    expect(main, 'A real system-audio loopback device is required').toBeTruthy()
    return main
  }

  async function pickCandidateMicDevice(page, mainDeviceId) {
    const devices = await api(page, '/api/devices')
    expect(devices.ok, JSON.stringify(devices.body)).toBe(true)
    const mic = devices.body.devices.find((device) => !device.is_loopback && device.id !== mainDeviceId)
    expect(mic, 'A real microphone device is required for candidate ASR smoke').toBeTruthy()
    return mic
  }

  async function waitForRecording(page, expected) {
    await expect.poll(async () => {
      const session = await api(page, '/api/session')
      return session.body.is_recording
    }, { timeout: 15_000, intervals: [250, 500, 1000] }).toBe(expected)
  }

  async function waitForPaused(page, expected) {
    await expect.poll(async () => {
      const session = await api(page, '/api/session')
      return session.body.is_paused
    }, { timeout: 10_000, intervals: [250, 500, 1000] }).toBe(expected)
  }

  function playPreflightAudio() {
    const code = [
      'import sys',
      `sys.path.insert(0, ${JSON.stringify(path.join(repoRoot, 'backend'))})`,
      'from services.audio import play_audio_file',
      `play_audio_file(${JSON.stringify(preflightAudioPath)})`,
    ].join('; ')
    execFileSync('python', ['-c', code], { cwd: repoRoot, stdio: 'pipe' })
  }

  test.afterEach(async ({ page }) => {
    if (page.isClosed()) return
    await api(page, '/api/stop', { method: 'POST', body: '{}' }).catch(() => null)
    await api(page, '/api/clear', { method: 'POST', body: '{}' }).catch(() => null)
  })

  test('real preflight sends playback/capture/STT/LLM events over WebSocket', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /开始面试/ })).toBeVisible({ timeout: 20_000 })
    const main = await pickMainLoopbackDevice(page)

    await page.evaluate(() => {
      window.__realSmokeEvents = []
      const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`)
      window.__realSmokeWs = ws
      ws.onmessage = (event) => {
        let msg
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
          return
        }
        if (msg.type === 'preflight_step') {
          window.__realSmokeEvents.push({
            step: msg.step,
            status: msg.status,
            detail: msg.detail,
            transcript: msg.transcript,
            model_name: msg.model_name,
            first_token_ms: msg.first_token_ms,
            total_ms: msg.total_ms,
            answer_len: typeof msg.answer === 'string' ? msg.answer.length : 0,
          })
        }
      }
    })
    await page.waitForFunction(() => window.__realSmokeWs?.readyState === WebSocket.OPEN, null, { timeout: 10_000 })

    await postJson(page, '/api/preflight/run', { scenario_id: 'self_intro', device_id: main.id })

    await expect.poll(
      () => page.evaluate(() => window.__realSmokeEvents?.some((event) => event.step === 'done' && event.status === 'done')),
      { timeout: 100_000, intervals: [500, 1000, 2000] },
    ).toBe(true)

    const status = await api(page, '/api/preflight/status')
    expect(status.body.error).toBeFalsy()
    expect(status.body.match_ok).toBe(true)
    expect(status.body.steps.capture.status).toBe('pass')
    expect(status.body.steps.stt.status).toBe('pass')
    expect(status.body.steps.llm.status).toBe('pass')
    expect(status.body.steps.ws.status).toBe('pass')

    const events = await page.evaluate(() => window.__realSmokeEvents)
    expect(events.some((event) => event.step === 'capture' && event.status === 'pass')).toBe(true)
    expect(events.some((event) => event.step === 'stt' && event.status === 'pass')).toBe(true)
    expect(events.some((event) => event.step === 'llm' && event.status === 'pass' && event.answer_len > 0)).toBe(true)
  })

  test('bad candidate microphone does not block real main interview answer generation', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /开始面试/ })).toBeVisible({ timeout: 20_000 })
    const main = await pickMainLoopbackDevice(page)

    await postJson(page, '/api/stop')
    await postJson(page, '/api/clear')

    const start = await postJson(page, '/api/start', {
      device_id: main.id,
      candidate_mic_device_id: -9999,
    })
    expect(start.ok).toBe(true)

    await page.waitForTimeout(600)
    playPreflightAudio()

    await expect.poll(async () => {
      const session = await api(page, '/api/session')
      const pairs = session.body.qa_pairs || []
      return pairs.length > 0 && Boolean(pairs[pairs.length - 1].answer)
    }, { timeout: 100_000, intervals: [1000, 2000] }).toBe(true)

    const session = await api(page, '/api/session')
    const last = session.body.qa_pairs[session.body.qa_pairs.length - 1]
    expect(session.body.is_recording).toBe(true)
    expect(session.body.transcriptions.join('\n')).toContain('请介绍')
    expect(last.question).toContain('请介绍')
    expect(last.answer.length).toBeGreaterThan(80)
    expect(session.body.candidate_transcriptions).toEqual([])

    await postJson(page, '/api/stop')
  })

  test('candidate ASR config matrix preserves start, pause, resume, and stop', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /开始面试/ })).toBeVisible({ timeout: 20_000 })
    const main = await pickMainLoopbackDevice(page)
    const mic = await pickCandidateMicDevice(page, main.id)
    const original = (await api(page, '/api/config')).body
    const restorePatch = pickCandidateConfig(original)
    const startRequests = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/start')) {
        startRequests.push(request.postData())
      }
    })

    try {
      await patchConfig(page, { candidate_asr_enabled: false })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: /开始面试/ })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(/我的麦克风未开启/)).toBeVisible({ timeout: 10_000 })
      await page.getByRole('button', { name: /开始面试/ }).click()
      await waitForRecording(page, true)
      expect(startRequests.at(-1)).not.toContain('candidate_mic_device_id')
      await postJson(page, '/api/stop')
      await waitForRecording(page, false)

      await patchConfig(page, {
        candidate_asr_enabled: true,
        candidate_stt_provider: 'whisper',
        candidate_remote_stt_enabled: false,
        candidate_context_enabled: true,
        candidate_streaming_asr_enabled: true,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(/我的麦克风 · 记录我的回答/)).toBeVisible({ timeout: 20_000 })
      await page.getByRole('button', { name: /开始面试/ }).click()
      await waitForRecording(page, true)
      expect(startRequests.at(-1)).toContain('candidate_mic_device_id')
      await page.getByRole('button', { name: /暂停/ }).click()
      await waitForPaused(page, true)
      await page.getByRole('button', { name: /继续/ }).click()
      await waitForPaused(page, false)
      await postJson(page, '/api/stop')
      await waitForRecording(page, false)

      const sameProvider = original.stt_provider || 'whisper'
      await patchConfig(page, {
        candidate_asr_enabled: true,
        candidate_stt_provider: sameProvider,
        candidate_remote_stt_enabled: sameProvider !== 'whisper',
        candidate_context_enabled: true,
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: /开始面试/ })).toBeVisible({ timeout: 20_000 })
      const directStart = await postJson(page, '/api/start', {
        device_id: main.id,
        candidate_mic_device_id: mic.id,
      })
      expect(directStart.ok).toBe(true)
      await waitForRecording(page, true)
      await postJson(page, '/api/stop')
      await waitForRecording(page, false)
    } finally {
      await patchConfig(page, restorePatch).catch(() => null)
    }
  })
})
