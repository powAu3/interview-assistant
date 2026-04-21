import { expect, test } from '@playwright/test'

import { COMMON_WS_BOOTSTRAP, installMocks } from './fixtures/setup.mjs'

const PRACTICE_FLOW_MESSAGES = [
  ...COMMON_WS_BOOTSTRAP,
  {
    type: 'practice_status',
    status: 'interviewer_speaking',
    scope: 'practice',
    delay: 8000,
  },
  {
    type: 'practice_session',
    scope: 'practice',
    delay: 8200,
    session: {
      status: 'awaiting_answer',
      context: {
        position: '后端开发工程师',
        language: '中文',
        audience: 'social',
        audience_label: '社招',
        resume_text: '3 年后端经验，负责交易链路、高并发接口优化与缓存治理。',
        jd_text: '熟悉 Redis、MySQL、消息队列和系统设计。',
      },
      blueprint: {
        opening_script: '开始吧。',
        phases: [
          {
            phase_id: 'opening',
            label: '开场与岗位匹配',
            category: 'behavioral',
            focus: ['岗位动机'],
            follow_up_budget: 0,
            answer_mode: 'voice',
            question: '先做一个自我介绍。',
          },
          {
            phase_id: 'coding',
            label: '代码与 SQL',
            category: 'coding',
            focus: ['SQL'],
            follow_up_budget: 1,
            answer_mode: 'voice+code',
            question: '写一段 SQL，统计最近 7 天每个用户的订单数。',
          },
        ],
      },
      current_phase_index: 1,
      current_turn: {
        turn_id: 'turn-2',
        phase_id: 'coding',
        phase_label: '代码与 SQL',
        category: 'coding',
        answer_mode: 'voice+code',
        question: '写一段 SQL，统计最近 7 天每个用户的订单数。',
        prompt_script: '写一段 SQL，统计最近 7 天每个用户的订单数。',
        asked_at: 1710000000,
        follow_up_of: null,
        transcript: '',
        code_text: '',
        duration_ms: 0,
      },
      turn_history: [
        {
          turn_id: 'turn-1',
          phase_id: 'opening',
          phase_label: '开场与岗位匹配',
          category: 'behavioral',
          answer_mode: 'voice',
          question: '先做一个自我介绍。',
          prompt_script: '先做一个自我介绍。',
          asked_at: 1710000000,
          follow_up_of: null,
          transcript: '我做后端三年，主要负责交易链路和缓存治理。',
          code_text: '',
          duration_ms: 42000,
        },
      ],
      report_markdown: '',
      created_at: 1710000000,
      finished_at: null,
    },
  },
  {
    type: 'practice_status',
    status: 'awaiting_answer',
    scope: 'practice',
    delay: 8240,
  },
  {
    type: 'practice_status',
    status: 'thinking_next_turn',
    scope: 'practice',
    delay: 21000,
  },
  {
    type: 'practice_session',
    scope: 'practice',
    delay: 22000,
    session: {
      status: 'finished',
      context: {
        position: '后端开发工程师',
        language: '中文',
        audience: 'social',
        audience_label: '社招',
        resume_text: '3 年后端经验，负责交易链路、高并发接口优化与缓存治理。',
        jd_text: '熟悉 Redis、MySQL、消息队列和系统设计。',
      },
      blueprint: {
        opening_script: '开始吧。',
        phases: [
          {
            phase_id: 'opening',
            label: '开场与岗位匹配',
            category: 'behavioral',
            focus: ['岗位动机'],
            follow_up_budget: 0,
            answer_mode: 'voice',
            question: '先做一个自我介绍。',
          },
          {
            phase_id: 'coding',
            label: '代码与 SQL',
            category: 'coding',
            focus: ['SQL'],
            follow_up_budget: 1,
            answer_mode: 'voice+code',
            question: '写一段 SQL，统计最近 7 天每个用户的订单数。',
          },
        ],
      },
      current_phase_index: 1,
      current_turn: null,
      turn_history: [
        {
          turn_id: 'turn-1',
          phase_id: 'opening',
          phase_label: '开场与岗位匹配',
          category: 'behavioral',
          answer_mode: 'voice',
          question: '先做一个自我介绍。',
          prompt_script: '先做一个自我介绍。',
          asked_at: 1710000000,
          follow_up_of: null,
          transcript: '我做后端三年，主要负责交易链路和缓存治理。',
          code_text: '',
          duration_ms: 42000,
          decision: 'advance',
          decision_reason: '开场已覆盖。',
          evidence: ['简要说明了背景和动机。'],
          strengths: ['切题快'],
          risks: ['细节略少'],
          scorecard: { technical_depth: 7, communication: 7, job_fit: 8, confidence: 7 },
        },
        {
          turn_id: 'turn-2',
          phase_id: 'coding',
          phase_label: '代码与 SQL',
          category: 'coding',
          answer_mode: 'voice+code',
          question: '写一段 SQL，统计最近 7 天每个用户的订单数。',
          prompt_script: '写一段 SQL，统计最近 7 天每个用户的订单数。',
          asked_at: 1710000000,
          follow_up_of: null,
          transcript: '我会先过滤最近 7 天，再按用户聚合。',
          code_text: 'select user_id, count(*) from orders group by user_id;',
          duration_ms: 51000,
          decision: 'finish',
          decision_reason: '最后一轮已完成。',
          evidence: ['SQL 思路正确。'],
          strengths: ['表达清楚'],
          risks: ['索引策略还能补充'],
          scorecard: { technical_depth: 8, communication: 7, job_fit: 8, confidence: 7 },
        },
      ],
      report_markdown: '### 综合 verdict\n- 结论：可进入下一轮，但建议加强系统设计与复盘表达。\n',
      created_at: 1710000000,
      finished_at: 1710001000,
    },
  },
  {
    type: 'practice_status',
    status: 'finished',
    scope: 'practice',
    delay: 22400,
  },
]

test.describe('practice flow', () => {
  test('restores JD draft and reaches final debrief from a structured practice session', async ({ context, page }) => {
    await installMocks(context, {
      messages: PRACTICE_FLOW_MESSAGES,
      localStorage: {
        'ia-color-scheme': 'vscode-light-plus',
        'ia_app_mode': 'practice',
        'ia-practice-jd-draft': '熟悉 Redis、MySQL、消息队列和系统设计。',
      },
    })

    await page.goto('/')

    const jdField = page.getByPlaceholder('粘贴目标岗位 JD，让问题更贴近真实岗位')
    await expect(jdField).toBeVisible({ timeout: 3000 })
    await expect(jdField).toHaveValue('熟悉 Redis、MySQL、消息队列和系统设计。')

    await page.getByRole('button', { name: '开始真实模拟面试' }).click()
    await expect(page.getByPlaceholder('在这里补充 SQL / 伪代码 / 接口结构...')).toBeVisible({
      timeout: 8000,
    })

    await page.getByPlaceholder('语音转写会持续写到这里，你也可以手动修句子，让它更像真正对面试官说出口的话。').fill(
      '我会先过滤最近 7 天的数据，再按用户维度做 group by。',
    )
    await page.getByPlaceholder('在这里补充 SQL / 伪代码 / 接口结构...').fill(
      'select user_id, count(*) from orders group by user_id;',
    )
    await page.getByRole('button', { name: '提交本轮回答' }).click()

    await expect(page.getByText('这场模拟面试已经结束，现在看整场复盘。')).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText('综合 verdict')).toBeVisible()
  })
})
