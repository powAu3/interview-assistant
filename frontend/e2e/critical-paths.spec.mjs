/**
 * Critical-path smoke tests with mocked backend and WebSocket.
 *
 * Goal: catch regressions that break the app's main navigation, settings
 * panel, and module switches without needing a live backend or any audio
 * device. Each test runs in <5s.
 */
import { test, expect } from '@playwright/test'
import { installMocks, COMMON_WS_BOOTSTRAP } from './fixtures/setup.mjs'
import {
  SAMPLE_PRACTICE_CODING_SESSION,
  SAMPLE_PRACTICE_SPEAKING_SESSION,
} from './fixtures/sample-data.mjs'

test.describe('app shell', () => {
  test.beforeEach(async ({ context }) => {
    await installMocks(context, {
      messages: COMMON_WS_BOOTSTRAP,
      localStorage: { 'ia-color-scheme': 'vscode-light-plus' },
    })
  })

  test('boots and shows the brand header + STT status pill', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '学习助手' })).toBeVisible()
    // App.tsx 状态 chip 文案为「STT 就绪」（中间有空格），且 md+ 才显示文字；viewport 默认 1440 可见
    await expect(page.getByText('STT 就绪')).toBeVisible({ timeout: 5000 })
  })

  test('module tabs switch between assist / practice / knowledge / resume / job-tracker', async ({ page }) => {
    await page.goto('/')

    const assistTab = page.getByRole('tab', { name: '实时辅助' })
    const practiceTab = page.getByRole('tab', { name: '模拟练习' })
    const knowledgeTab = page.getByRole('tab', { name: '能力分析' })
    const resumeTab = page.getByRole('tab', { name: '简历优化' })
    const jobTab = page.getByRole('tab', { name: /求职看板/ })

    await expect(assistTab).toHaveAttribute('aria-selected', 'true')

    await practiceTab.click()
    await expect(practiceTab).toHaveAttribute('aria-selected', 'true')

    await knowledgeTab.click()
    await expect(knowledgeTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('薄弱点排名')).toBeVisible({ timeout: 8000 })

    await resumeTab.click()
    await expect(resumeTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByPlaceholder('将招聘 JD 粘贴到这里...')).toBeVisible({ timeout: 8000 })

    await jobTab.click()
    await expect(jobTab).toHaveAttribute('aria-selected', 'true')
  })

  test('does not log uncaught errors during initial render', async ({ page }) => {
    /** @type {string[]} */
    const errors = []
    page.on('pageerror', (err) => errors.push(String(err)))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '学习助手' })).toBeVisible()
    await page.waitForTimeout(500)

    const significant = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('downloadable font') &&
        !e.toLowerCase().includes('manifest'),
    )
    expect(significant, `Console errors:\n${significant.join('\n')}`).toEqual([])
  })
})

test.describe('assist mode with WebSocket-driven Q/A', () => {
  test('renders streamed transcripts and answer payload from mock WS', async ({ context, page }) => {
    const now = Math.floor(Date.now() / 1000)

    await installMocks(context, {
      messages: [
        ...COMMON_WS_BOOTSTRAP,
        {
          type: 'init',
          delay: 50,
          transcriptions: ['请介绍一下你做过最有挑战的一个项目。'],
          qa_pairs: [
            {
              id: 'qa-mock-1',
              question: '请介绍一下你做过最有挑战的一个项目。',
              answer: '核心要点是先讲背景与目标、再讲关键决策、最后讲量化结果。',
              thinkContent: '',
              timestamp: now - 5,
              source: 'manual_text',
              model_name: 'GPT-4.1 Mini',
            },
          ],
          is_recording: false,
          is_paused: false,
          stt_loaded: true,
        },
      ],
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '学习助手' })).toBeVisible()
    await expect(page.getByText('请介绍一下你做过最有挑战的一个项目。').first()).toBeVisible({
      timeout: 5000,
    })
    await expect(
      page.getByText('核心要点是先讲背景与目标、再讲关键决策、最后讲量化结果。'),
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('practice mode booth', () => {
  test('shows the virtual interviewer during an active practice session', async ({ context, page }) => {
    await installMocks(context, {
      messages: [
        ...COMMON_WS_BOOTSTRAP,
        {
          type: 'init',
          delay: 50,
          stt_loaded: true,
          is_recording: false,
          is_paused: false,
          practice_session: SAMPLE_PRACTICE_SPEAKING_SESSION,
        },
      ],
      localStorage: {
        'ia-color-scheme': 'vscode-light-plus',
        'ia_app_mode': 'practice',
      },
    })

    await page.goto('/')
    await expect(page.getByTestId('practice-interviewer-preview')).toBeVisible()
    await expect(page.getByText(/状态 · (播报中|倾听中)/)).toBeVisible()
    await expect(page.getByText(/当前来源：/)).toBeVisible()
  })

  test('keeps coding prompt mode out of speaking animation', async ({ context, page }) => {
    await installMocks(context, {
      messages: [
        ...COMMON_WS_BOOTSTRAP,
        {
          type: 'init',
          delay: 50,
          stt_loaded: true,
          is_recording: false,
          is_paused: false,
          practice_session: SAMPLE_PRACTICE_CODING_SESSION,
        },
      ],
      localStorage: {
        'ia-color-scheme': 'vscode-light-plus',
        'ia_app_mode': 'practice',
      },
    })

    await page.goto('/')
    await expect(page.getByText('题面模式').first()).toBeVisible()
    await expect(page.getByTestId('practice-interviewer-preview')).toHaveAttribute('data-state', 'listening')
  })
})

test.describe('settings drawer', () => {
  test('opens and shows model list / position config', async ({ context, page }) => {
    await installMocks(context, { messages: COMMON_WS_BOOTSTRAP })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '学习助手' })).toBeVisible()

    await page.getByRole('button', { name: /设置|Settings/i }).first().click()

    await expect(page.getByText(/GPT-4\.1 Mini/).first()).toBeVisible({ timeout: 5000 })
  })
})
