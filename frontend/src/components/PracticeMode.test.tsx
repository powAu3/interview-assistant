import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PracticeMode from './PracticeMode'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

const apiMock = vi.hoisted(() => ({
  practiceGenerate: vi.fn(),
  practiceStatus: vi.fn(),
  practiceSubmit: vi.fn(),
  practiceFinish: vi.fn(),
  practiceReset: vi.fn(),
  practiceRecord: vi.fn(),
  practiceTts: vi.fn(),
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

function createPracticeSession(overrides: Record<string, unknown> = {}) {
  return {
    status: 'awaiting_answer',
    context: {
      position: '后端开发',
      language: 'Python',
      audience: 'social',
      audience_label: '社招',
      resume_text: '做过交易系统',
      jd_text: '熟悉 SQL',
      interviewer_style: 'calm_pressing',
    },
    blueprint: { opening_script: '开始吧。', phases: [] },
    current_phase_index: 0,
    current_turn: {
      turn_id: 'turn-1',
      phase_id: 'project',
      phase_label: '项目深挖',
      category: 'project',
      answer_mode: 'voice',
      question: '讲讲你做过的高并发接口优化。',
      prompt_script: '讲讲你做过的高并发接口优化。',
      stage_prompt: '项目深挖：本轮重点盯判断、验证和取舍。',
      interviewer_signal: 'probe',
      transition_line: '现在我想往项目里压一层，重点听你的判断和验证。',
      asked_at: Date.now(),
      follow_up_of: null,
      transcript: '',
      code_text: '',
      duration_ms: 0,
    },
    turn_history: [],
    interviewer_persona: {
      tone: 'calm-pressing',
      style: '像国内一线技术面试官，礼貌但不放水，会追问证据、取舍和复盘。',
      project_bias: '项目题优先追 why / how / validation，不让候选人停在结果层。',
      bar_raising_rule: '回答一旦缺少证据、边界或实现，就优先追问而不是轻易放过。',
    },
    report_markdown: '',
    created_at: Date.now(),
    ...overrides,
  }
}

describe('PracticeMode', () => {
  beforeEach(() => {
    vi.useRealTimers()
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: vi.fn(),
    })
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
    apiMock.practiceTts.mockResolvedValue({
      ok: true,
      provider: 'edge_tts',
      speaker: 'zh-CN-XiaoxiaoNeural',
      audio_base64: 'ZmFrZQ==',
      content_type: 'audio/mpeg',
      duration: 1.2,
    })
    apiMock.practiceStatus.mockResolvedValue({ status: 'idle', current_turn: null })
    useInterviewStore.setState({
      config: {
        position: '后端开发',
        language: 'Python',
        practice_audience: 'social',
        has_resume: true,
        think_mode: false,
        think_effort: 'off',
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
    useUiPrefsStore.setState({ colorScheme: 'vscode-light-plus' } as any)
  })

  it('restores the JD draft from localStorage on the start screen', async () => {
    window.localStorage.setItem(JD_STORAGE_KEY, '熟悉 Redis、MySQL、交易链路。')

    render(<PracticeMode />)

    expect(await screen.findByPlaceholderText('粘贴目标岗位 JD，让问题更贴近真实岗位')).toHaveValue(
      '熟悉 Redis、MySQL、交易链路。',
    )
  })

  it('uses dark practice surfaces when the app color scheme is dark', async () => {
    useUiPrefsStore.setState({ colorScheme: 'vscode-dark-plus' } as any)

    render(<PracticeMode />)

    const setup = await screen.findByTestId('practice-setup-screen')
    expect(setup).toHaveAttribute('data-practice-theme', 'dark')
    expect(setup.className).toContain('practice-page')
    expect(setup.className).not.toContain('#fbf8f0')
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

  it('shows preparing feedback immediately after starting a practice session', async () => {
    let releaseGenerate: (() => void) | null = null
    apiMock.practiceGenerate.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseGenerate = () => resolve({ ok: true })
        }),
    )

    render(<PracticeMode />)
    fireEvent.click(screen.getByRole('button', { name: '开始真实模拟面试' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /正在搭建面试现场/ })).toBeDisabled()
    })

    expect(releaseGenerate).not.toBeNull()
    if (releaseGenerate === null) throw new Error('generate promise was not captured')
    const completeGenerate: () => void = releaseGenerate
    completeGenerate()
    await waitFor(() => {
      expect(apiMock.practiceGenerate).toHaveBeenCalled()
    })
  })

  it('hydrates the first practice turn from the status endpoint when websocket updates lag', async () => {
    apiMock.practiceGenerate.mockResolvedValue({ ok: true })
    apiMock.practiceStatus.mockResolvedValue(
      createPracticeSession({
        status: 'awaiting_answer',
      }),
    )

    render(<PracticeMode />)
    fireEvent.click(screen.getByRole('button', { name: '开始真实模拟面试' }))

    await waitFor(() => {
      expect(apiMock.practiceStatus).toHaveBeenCalled()
    }, { timeout: 2500 })
    await waitFor(() => {
      expect(apiMock.practiceStatus).toHaveBeenCalledTimes(1)
    }, { timeout: 2500 })
    await waitFor(() => {
      expect(screen.getByText('项目深挖')).toBeInTheDocument()
      expect(screen.getByText('讲讲你做过的高并发接口优化。')).toBeInTheDocument()
    })
  })

  it('uses a one-shot watchdog refresh when websocket hydration does not arrive', async () => {
    apiMock.practiceGenerate.mockResolvedValue({ ok: true })
    apiMock.practiceStatus.mockResolvedValue(
      createPracticeSession({
        status: 'awaiting_answer',
      }),
    )

    render(<PracticeMode />)
    fireEvent.click(screen.getByRole('button', { name: '开始真实模拟面试' }))

    expect(apiMock.practiceStatus).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(apiMock.practiceStatus).toHaveBeenCalledTimes(1)
      expect(screen.getByText('项目深挖')).toBeInTheDocument()
    }, { timeout: 2500 })
  })

  it('updates the start-screen interviewer preview when the style changes', () => {
    render(<PracticeMode />)

    const preview = screen.getByTestId('practice-interviewer-preview')
    expect(preview).toHaveAttribute('data-persona', 'calm_pressing')

    fireEvent.click(screen.getByRole('button', { name: /^带教型/ }))
    expect(preview).toHaveAttribute('data-persona', 'supportive_senior')

    fireEvent.click(screen.getByRole('button', { name: /^压力型/ }))
    expect(preview).toHaveAttribute('data-persona', 'pressure_bigtech')
  }, 10000)

  it('shows the shared mounted resume state on the start screen', () => {
    useInterviewStore.setState({
      config: {
        position: '后端开发',
        language: 'Python',
        practice_audience: 'social',
        has_resume: true,
        resume_active_filename: '张三_后端开发.pdf',
        resume_active_history_id: 3,
      },
    } as any)

    render(<PracticeMode />)

    expect(screen.getAllByText('张三_后端开发.pdf').length).toBeGreaterThan(0)
    expect(screen.getByText('这里和主流程、简历优化共用同一份简历历史与当前挂载记录。')).toBeInTheDocument()
  })

  it('previews the interview stages and current material context on the start screen', () => {
    window.localStorage.setItem(JD_STORAGE_KEY, '负责交易链路稳定性和 Redis 缓存治理。')
    useInterviewStore.setState({
      config: {
        position: '后端开发',
        language: 'Python',
        practice_audience: 'social',
        has_resume: true,
        resume_active_filename: '张三_后端开发.pdf',
        resume_active_history_id: 3,
        think_mode: false,
        think_effort: 'off',
      },
    } as any)

    render(<PracticeMode />)

    expect(screen.getByText('本场材料')).toBeInTheDocument()
    expect(screen.getAllByText('张三_后端开发.pdf').length).toBeGreaterThan(0)
    expect(screen.getByText(/JD 已填写/)).toBeInTheDocument()
    expect(screen.getByText('六段流程')).toBeInTheDocument()
    expect(screen.getByText(/开场与岗位匹配/)).toBeInTheDocument()
    expect(screen.getByText(/代码与 SQL/)).toBeInTheDocument()
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

  it('uses a one-shot watchdog refresh when submit websocket hydration does not arrive', async () => {
    apiMock.practiceSubmit.mockResolvedValue({ ok: true })
    apiMock.practiceStatus.mockResolvedValue(
      createPracticeSession({
        status: 'awaiting_answer',
        current_phase_index: 1,
        current_turn: {
          turn_id: 'turn-2',
          phase_id: 'project',
          phase_label: '项目深挖',
          category: 'project',
          answer_mode: 'voice',
          question: '讲一个你真正主导过、并且最能代表你能力边界的项目。',
          prompt_script: '讲一个你真正主导过、并且最能代表你能力边界的项目。',
          stage_prompt: '项目深挖：本轮重点盯判断、验证和取舍。',
          interviewer_signal: 'probe',
          transition_line: '现在我想往项目里压一层，重点听你的判断和验证。',
          asked_at: Date.now(),
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
            asked_at: Date.now(),
            follow_up_of: null,
            transcript: '我是计算机专业背景。',
            code_text: '',
            duration_ms: 42000,
          },
        ],
      }),
    )

    useInterviewStore.setState({
      practiceStatus: 'awaiting_answer',
      practiceAnswerDraft: '我是计算机专业背景。',
      practiceCodeDraft: '',
      practiceSession: createPracticeSession({
        current_phase_index: 0,
        current_turn: {
          turn_id: 'turn-1',
          phase_id: 'opening',
          phase_label: '开场与岗位匹配',
          category: 'behavioral',
          answer_mode: 'voice',
          question: '先做一个自我介绍。',
          prompt_script: '先做一个自我介绍。',
          asked_at: Date.now(),
          follow_up_of: null,
          transcript: '',
          code_text: '',
          duration_ms: 0,
        },
      }),
    } as any)

    render(<PracticeMode />)
    fireEvent.click(screen.getByRole('button', { name: '提交本轮回答' }))

    expect(apiMock.practiceStatus).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(apiMock.practiceStatus).toHaveBeenCalledTimes(1)
      expect(screen.getByText('项目深挖')).toBeInTheDocument()
      expect(screen.getByText('讲一个你真正主导过、并且最能代表你能力边界的项目。')).toBeInTheDocument()
    }, { timeout: 2500 })
  })

  it('keeps the interviewer in prompt mode for coding turns', () => {
    useInterviewStore.setState({
      practiceStatus: 'interviewer_speaking',
      practiceTtsSpeaking: true,
      practiceSession: createPracticeSession({
        current_phase_index: 4,
        current_turn: {
          turn_id: 'turn-1',
          phase_id: 'coding',
          phase_label: '代码与 SQL',
          category: 'coding',
          answer_mode: 'voice+code',
          question: '写一段 SQL，统计每个用户最近 7 天的订单数。',
          prompt_script: '写一段 SQL，统计每个用户最近 7 天的订单数。',
          stage_prompt: '代码 / SQL 与实现解释：本轮重点盯正确性、边界和说明。',
          interviewer_signal: 'implementation-check',
          transition_line: '最后来一道实现题，边写边解释你的边界处理。',
          written_prompt: '给定 orders 表，请统计最近 7 天每个用户的订单数。',
          artifact_notes: ['orders(user_id, created_at, amount)', '只统计最近 7 天', '返回 user_id 和订单数'],
          asked_at: Date.now(),
          follow_up_of: null,
          transcript: '',
          code_text: '',
          duration_ms: 0,
        },
      }),
    } as any)

    render(<PracticeMode />)

    expect(screen.getAllByText('题面模式')).toHaveLength(2)
    expect(screen.getByText('最后来一道实现题，边写边解释你的边界处理。')).toBeInTheDocument()
    expect(screen.getByTestId('practice-interviewer-preview')).not.toHaveAttribute('data-state', 'speaking')
  })

  it('renders the persona summary card on the finished screen', () => {
    useInterviewStore.setState({
      practiceStatus: 'finished',
      practiceSession: createPracticeSession({
        status: 'finished',
        report_markdown: '### 综合评价\n这场表现稳健。',
        current_turn: null,
        turn_history: [
          {
            turn_id: 'turn-1',
            phase_id: 'project',
            phase_label: '项目深挖',
            category: 'project',
            answer_mode: 'voice',
            question: '讲讲你做过的高并发接口优化。',
            prompt_script: '讲讲你做过的高并发接口优化。',
            transition_line: '现在我想往项目里压一层，重点听你的判断和验证。',
            asked_at: Date.now(),
            transcript: '我会先说明目标和瓶颈。',
            code_text: '',
            duration_ms: 120000,
            scorecard: { accuracy: 8, structure: 7 },
          },
        ],
      }),
    } as any)

    render(<PracticeMode />)

    expect(screen.getByText('面试官画像')).toBeInTheDocument()
    expect(screen.getByText('稳压型')).toBeInTheDocument()
    expect(screen.getByText(/礼貌但不放水/)).toBeInTheDocument()
  })

  it('offers debrief next actions and copies resume-ready feedback', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    useInterviewStore.setState({
      practiceStatus: 'finished',
      practiceSession: createPracticeSession({
        status: 'finished',
        current_turn: null,
        report_markdown: [
          '### 下一步练习',
          '- 项目题先补充指标。',
          '',
          '### 可回填简历表达',
          '- 将“负责接口优化”改成“主导接口优化，将 p95 延迟降低 35%”。',
        ].join('\n'),
        turn_history: [
          {
            turn_id: 'turn-1',
            phase_id: 'project',
            phase_label: '项目深挖',
            category: 'project',
            answer_mode: 'voice',
            question: '讲讲项目。',
            prompt_script: '讲讲项目。',
            asked_at: Date.now(),
            transcript: '回答',
            code_text: '',
            duration_ms: 1000,
            decision: 'advance',
            scorecard: { evidence: 7 },
          },
        ],
      }),
    } as any)

    render(<PracticeMode />)

    expect(screen.getByText('下一步动作')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制可回填简历表达' }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('p95 延迟降低 35%'))
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.not.stringContaining('下一步练习'))
    })
  })

  it('switches to the debrief view while the final report is generating', () => {
    useInterviewStore.setState({
      practiceStatus: 'debriefing',
      practiceSession: createPracticeSession({
        status: 'debriefing',
        current_turn: null,
        report_markdown: '',
      }),
    } as any)

    render(<PracticeMode />)

    expect(screen.getByText('Debrief')).toBeInTheDocument()
    expect(screen.getByText(/正在生成整场复盘/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交本轮回答' })).not.toBeInTheDocument()
  })
})
