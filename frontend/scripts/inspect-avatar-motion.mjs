import fs from 'node:fs/promises'
import path from 'node:path'

import { chromium } from 'playwright'
import { PNG } from 'pngjs'

import { installMocks, COMMON_WS_BOOTSTRAP } from '../e2e/fixtures/setup.mjs'
import {
  SAMPLE_CONFIG,
  SAMPLE_DEVICES,
  SAMPLE_OPTIONS,
  createSamplePracticeSession,
} from '../e2e/fixtures/sample-data.mjs'

const baseURL = process.env.AVATAR_AUDIT_BASE_URL ?? 'http://127.0.0.1:5173'
const outputDir = path.resolve(
  process.cwd(),
  '..',
  'output',
  'playwright',
  `avatar-motion-live-${new Date().toISOString().replace(/[:.]/g, '-')}`,
)

const personaTones = {
  calm_pressing: 'calm-pressing',
  supportive_senior: 'supportive-senior',
  pressure_bigtech: 'pressure-bigtech',
}

const personaLabels = {
  calm_pressing: '稳压型',
  supportive_senior: '带教型',
  pressure_bigtech: '压力型',
}

const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  outputDir,
  results: [],
}

function makeSession(persona, overrides = {}) {
  const session = createSamplePracticeSession({
    ...overrides,
    context: {
      ...createSamplePracticeSession().context,
      interviewer_style: persona,
      ...(overrides.context ?? {}),
    },
    interviewer_persona: {
      tone: personaTones[persona],
      style: '像国内一线技术面试官，礼貌但不放水，会追问证据、取舍和复盘。',
      project_bias: '项目题优先追 why / how / validation，不让候选人停在结果层。',
      bar_raising_rule: '回答一旦缺少证据、边界或实现，就优先追问而不是轻易放过。',
      ...(overrides.interviewer_persona ?? {}),
    },
  })
  return session
}

function makeDebriefSession(persona) {
  const session = makeSession(persona, {
    status: 'finished',
    current_turn: null,
    finished_at: Date.now(),
    report_markdown: [
      '## 总体表现',
      '回答主线清楚，但需要补更多验证数据。',
      '',
      '## 可回填简历表达',
      '- 将高并发接口优化表达为“定位瓶颈 -> 验证假设 -> 上线灰度 -> 复盘收益”。',
    ].join('\n'),
  })
  return {
    ...session,
    turn_history: session.turn_history.map((turn) => ({
      ...turn,
      scorecard: { structure: 8, confidence: 7, evidence: 6 },
    })),
  }
}

async function waitForPreview(page) {
  const preview = page.getByTestId('practice-interviewer-preview').first()
  await preview.waitFor({ state: 'visible', timeout: 8000 })
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-testid="practice-interviewer-preview"]')
    const img = root?.querySelector('.virtual-interviewer__portrait-img')
    return Boolean(img && img.complete && img.naturalWidth > 0)
  }, { timeout: 8000 })
  return preview
}

async function seedStore(page, { persona = 'calm_pressing', status = 'idle', tts = false, recording = false }) {
  const session =
    status === 'idle'
      ? null
      : status === 'finished' || status === 'debriefing'
        ? makeDebriefSession(persona)
        : makeSession(persona, { status })

  await page.evaluate(
    async ({ sampleConfig, sampleDevices, sampleOptions, persona, session, status, tts, recording }) => {
      window.localStorage.setItem('ia_app_mode', 'practice')
      window.localStorage.setItem('ia-practice-interviewer-style', persona)
      window.localStorage.setItem('ia-practice-voice-gender', 'auto')
      const { useInterviewStore } = await import('/src/stores/configStore.ts')
      const store = useInterviewStore.getState()
      store.setConfig(sampleConfig)
      store.setDevices(sampleDevices.devices, sampleDevices.platform)
      store.setOptions(sampleOptions)
      store.setSttStatus(true, false, 'whisper')
      store.setPracticeRecording(recording)
      store.setPracticeTtsSpeaking(tts)
      store.setPracticeSession(session)
      store.setPracticeStatus(status)
      store.setPracticeTtsSpeaking(tts)
      store.setPracticeRecording(recording)
    },
    {
      sampleConfig: SAMPLE_CONFIG,
      sampleDevices: SAMPLE_DEVICES,
      sampleOptions: SAMPLE_OPTIONS,
      persona,
      session,
      status,
      tts,
      recording,
    },
  )
}

async function metrics(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="practice-interviewer-preview"]')
    if (!root) return null
    const read = (selector) => {
      const element = root.querySelector(selector)
      if (!element) return null
      const styles = getComputedStyle(element)
      return {
        animationName: styles.animationName,
        animationDuration: styles.animationDuration,
        transform: styles.transform,
        opacity: styles.opacity,
        width: styles.width,
        height: styles.height,
      }
    }
    const box = root.getBoundingClientRect()
    return {
      state: root.getAttribute('data-state'),
      renderer: root.getAttribute('data-renderer'),
      speechActive: root.getAttribute('data-speech-active'),
      attentionCue: root.getAttribute('data-attention-cue'),
      persona: root.getAttribute('data-persona'),
      box: {
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      humanLayer: read('.virtual-interviewer__human-layer'),
      portraitShell: read('.virtual-interviewer__portrait-shell'),
      portraitImg: read('.virtual-interviewer__portrait-img'),
      blink: read('.virtual-interviewer__blink'),
      eyeCatchlights: read('.virtual-interviewer__eye-catchlights'),
      gazeGlint: read('.virtual-interviewer__gaze-glint'),
      collarBreath: read('.virtual-interviewer__collar-breath'),
      mouthPlate: read('.virtual-interviewer__mouth-plate'),
      jawShadow: read('.virtual-interviewer__jaw-shadow'),
      mouthCue: read('.virtual-interviewer__mouth-cue'),
      pulse: read('.virtual-interviewer__pulse'),
      scan: read('.virtual-interviewer__scan'),
      firstWave: read('.virtual-interviewer__wave-bar'),
      subtitle: root.querySelector('.virtual-interviewer__subtitle')?.textContent ?? null,
    }
  })
}

function changedPixelRatio(bufferA, bufferB) {
  const a = PNG.sync.read(bufferA)
  const b = PNG.sync.read(bufferB)
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  let changed = 0
  let total = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ia = (y * a.width + x) * 4
      const ib = (y * b.width + x) * 4
      const delta =
        Math.abs(a.data[ia] - b.data[ib])
        + Math.abs(a.data[ia + 1] - b.data[ib + 1])
        + Math.abs(a.data[ia + 2] - b.data[ib + 2])
        + Math.abs(a.data[ia + 3] - b.data[ib + 3])
      if (delta > 22) changed += 1
      total += 1
    }
  }
  return Number((changed / Math.max(1, total)).toFixed(4))
}

async function captureCase(page, name, {
  persona = 'calm_pressing',
  status,
  tts = false,
  recording = false,
  viewport,
  waitForCue = false,
}) {
  if (viewport) await page.setViewportSize(viewport)
  if (status === 'idle') {
    await seedStore(page, { persona, status, tts, recording })
    const label = personaLabels[persona]
    if (label) {
      await page.getByRole('button', { name: new RegExp(label) }).first().click()
    }
    await page.evaluate(() => {
      document.querySelector('.practice-page')?.scrollTo(0, 0)
      window.scrollTo(0, 0)
    })
  } else {
    await seedStore(page, { persona, status, tts, recording })
  }
  const preview = await waitForPreview(page)
  const expectedState =
    status === 'idle'
      ? 'idle'
      : status === 'finished' || status === 'debriefing'
        ? 'debrief'
        : status === 'thinking_next_turn'
          ? 'thinking'
          : tts
            ? 'speaking'
            : 'listening'
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="practice-interviewer-preview"]')?.getAttribute('data-state') === expected,
    expectedState,
    { timeout: 4000 },
  ).catch(() => undefined)
  if (waitForCue) {
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-testid="practice-interviewer-preview"]')
      return root && root.getAttribute('data-attention-cue') !== 'none'
    }, { timeout: 8000 }).catch(() => undefined)
  }
  const waitedCue = await preview.getAttribute('data-attention-cue')
  await page.waitForTimeout(waitForCue ? 80 : 220)

  const pagePath = path.join(outputDir, `${name}-page.png`)
  const t0Path = path.join(outputDir, `${name}-avatar-t0.png`)
  const t700Path = path.join(outputDir, `${name}-avatar-t700.png`)
  const metricsAtT0 = await metrics(page)
  const t0 = await preview.screenshot({ path: t0Path })
  await page.screenshot({ path: pagePath, fullPage: true })
  await page.waitForTimeout(700)
  const metricsAtT700 = await metrics(page)
  const t700 = await preview.screenshot({ path: t700Path })

  const result = {
    name,
    expectedState,
    changedPixelRatio: changedPixelRatio(t0, t700),
    files: { pagePath, t0Path, t700Path },
    attentionCueObserved: {
      waitedCue,
      t0: metricsAtT0?.attentionCue ?? null,
      t700: metricsAtT700?.attentionCue ?? null,
      captured: [waitedCue, metricsAtT0?.attentionCue, metricsAtT700?.attentionCue].some(
        (cue) => cue && cue !== 'none',
      ),
    },
    metricsAtT0,
    metricsAtT700,
    metrics: metricsAtT700,
  }
  report.results.push(result)
  return result
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
  await installMocks(context, {
    messages: COMMON_WS_BOOTSTRAP,
    localStorage: {
      'ia_app_mode': 'practice',
      'ia-color-scheme': 'vscode-light-plus',
      'ia-practice-voice-gender': 'auto',
      'ia-practice-interviewer-style': 'calm_pressing',
    },
  })
  const page = await context.newPage()
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  for (const persona of ['calm_pressing', 'supportive_senior', 'pressure_bigtech']) {
    await captureCase(page, `setup-${persona}-desktop`, { persona, status: 'idle' })
  }

  await captureCase(page, 'active-speaking-desktop', {
    persona: 'calm_pressing',
    status: 'awaiting_answer',
    tts: true,
  })
  await captureCase(page, 'active-listening-desktop', {
    persona: 'calm_pressing',
    status: 'awaiting_answer',
  })
  await captureCase(page, 'active-listening-attention-cue-desktop', {
    persona: 'calm_pressing',
    status: 'awaiting_answer',
    waitForCue: true,
  })
  await captureCase(page, 'active-thinking-desktop', {
    persona: 'calm_pressing',
    status: 'thinking_next_turn',
  })
  await captureCase(page, 'debrief-desktop', {
    persona: 'calm_pressing',
    status: 'finished',
  })
  await captureCase(page, 'active-listening-mobile', {
    persona: 'calm_pressing',
    status: 'awaiting_answer',
    viewport: { width: 390, height: 844 },
  })

  await fs.writeFile(path.join(outputDir, 'motion-report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
