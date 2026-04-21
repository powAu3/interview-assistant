import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PracticeMode from './PracticeMode'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  practiceGenerate: vi.fn(),
  practiceSubmit: vi.fn(),
  practiceFinish: vi.fn(),
  practiceReset: vi.fn(),
  practiceRecord: vi.fn(),
  uploadResume: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('@/lib/configSync', () => ({
  refreshConfig: vi.fn(),
  updateConfigAndRefresh: vi.fn(),
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}))

const JD_STORAGE_KEY = 'ia-practice-jd-draft'

describe('PracticeMode', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    })
    window.localStorage.clear()
    vi.clearAllMocks()
    useInterviewStore.setState({
      config: {
        position: '后端开发',
        language: 'Python',
        practice_audience: 'social',
        has_resume: true,
        think_mode: false,
      },
      devices: [{ id: 1, name: 'MacBook Mic', channels: 1, is_loopback: false, host_api: 'coreaudio' }],
      sttLoaded: true,
      practiceStatus: 'idle',
      practiceRecording: false,
      practiceAnswerDraft: '',
      practiceCodeDraft: '',
      practiceSession: null,
      practiceTtsSpeaking: false,
      practiceElapsedMs: 0,
      setPracticeAnswerDraft: useInterviewStore.getState().setPracticeAnswerDraft,
      setPracticeCodeDraft: useInterviewStore.getState().setPracticeCodeDraft,
    } as any)
  })

  it('restores the JD draft from localStorage on the start screen', async () => {
    window.localStorage.setItem(JD_STORAGE_KEY, '熟悉 Redis、MySQL、交易链路。')

    render(<PracticeMode />)

    expect(await screen.findByPlaceholderText('粘贴目标岗位 JD，让问题更贴近真实岗位')).toHaveValue(
      '熟悉 Redis、MySQL、交易链路。',
    )
  })

  it('shows a code editor when the current turn expects voice+code answers', () => {
    useInterviewStore.setState({
      practiceStatus: 'awaiting_answer',
      practiceSession: {
        status: 'awaiting_answer',
        context: {
          position: '后端开发',
          language: 'Python',
          audience: 'social',
          audience_label: '社招',
          resume_text: '做过交易系统',
          jd_text: '熟悉 SQL',
        },
        blueprint: { opening_script: '开始吧。', phases: [] },
        current_phase_index: 4,
        current_turn: {
          turn_id: 'turn-1',
          phase_id: 'coding',
          phase_label: '代码与 SQL',
          category: 'coding',
          answer_mode: 'voice+code',
          question: '写一段 SQL，统计每个用户最近 7 天的订单数。',
          prompt_script: '写一段 SQL，统计每个用户最近 7 天的订单数。',
          written_prompt: '给定 orders 表，请统计最近 7 天每个用户的订单数。',
          artifact_notes: ['orders(user_id, created_at, amount)', '只统计最近 7 天', '返回 user_id 和订单数'],
          asked_at: Date.now(),
          follow_up_of: null,
          transcript: '',
          code_text: '',
          duration_ms: 0,
        },
        turn_history: [],
        report_markdown: '',
      },
    } as any)

    render(<PracticeMode />)

    expect(screen.getByText('代码与 SQL')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('在这里补充 SQL / 伪代码 / 接口结构...')).toBeInTheDocument()
    expect(screen.getByText('给定 orders 表，请统计最近 7 天每个用户的订单数。')).toBeInTheDocument()
    expect(screen.getByText('orders(user_id, created_at, amount)')).toBeInTheDocument()
  })

  it('sends interviewer style when starting a practice session', async () => {
    apiMock.practiceGenerate.mockResolvedValue({ ok: true })

    render(<PracticeMode />)
    fireEvent.click(screen.getByRole('button', { name: /^带教型/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始真实模拟面试' }))

    await waitFor(() => {
      expect(apiMock.practiceGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          interviewer_style: 'supportive_senior',
        }),
      )
    })
  })

  it('submits structured practice payload instead of legacy answer-only text', async () => {
    apiMock.practiceSubmit.mockResolvedValue({ ok: true })
    useInterviewStore.setState({
      practiceStatus: 'awaiting_answer',
      practiceAnswerDraft: '我会先过滤最近 7 天的数据。',
      practiceCodeDraft: 'select user_id, count(*) from orders group by user_id;',
      practiceSession: {
        status: 'awaiting_answer',
        context: {
          position: '后端开发',
          language: 'Python',
          audience: 'social',
          audience_label: '社招',
          resume_text: '做过交易系统',
          jd_text: '熟悉 SQL',
        },
        blueprint: { opening_script: '开始吧。', phases: [] },
        current_phase_index: 4,
        current_turn: {
          turn_id: 'turn-1',
          phase_id: 'coding',
          phase_label: '代码与 SQL',
          category: 'coding',
          answer_mode: 'voice+code',
          question: '写一段 SQL，统计每个用户最近 7 天的订单数。',
          prompt_script: '写一段 SQL，统计每个用户最近 7 天的订单数。',
          asked_at: Date.now(),
          follow_up_of: null,
          transcript: '',
          code_text: '',
          duration_ms: 0,
        },
        turn_history: [],
        report_markdown: '',
      },
    } as any)

    render(<PracticeMode />)
    fireEvent.click(screen.getByRole('button', { name: '提交本轮回答' }))

    await waitFor(() => {
      expect(apiMock.practiceSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: '我会先过滤最近 7 天的数据。',
          code_text: 'select user_id, count(*) from orders group by user_id;',
          answer_mode: 'voice+code',
          duration_ms: expect.any(Number),
        }),
      )
    })
  })
})
