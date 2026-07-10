import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewSessionDetail from './ReviewSessionDetail'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

const apiMock = vi.hoisted(() => ({
  reviewSessionDetail: vi.fn(),
  reviewUpdateSession: vi.fn(),
  jobTrackerApplications: vi.fn(),
  reviewTriggerAnalysis: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
  getErrorMessage: (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback,
}))

const baseDetail = {
  id: 7,
  status: 'completed',
  started_at: 1710000000,
  ended_at: 1710003600,
  source: 'manual',
  title: '一面复盘',
  company: 'Acme',
  role: 'Frontend',
  application_id: null,
  application: null,
  interviewer_capture_enabled: true,
  candidate_capture_enabled: true,
  turn_count: 0,
  avg_score: 7,
  summary_markdown: '整体表现稳定。',
  strong_points: ['表达清晰'],
  weak_points: ['系统设计容量估算'],
  behavior_traits: [],
  domain_summary: {},
  created_at: 1710000000,
  updated_at: 1710003600,
  turns: [],
}

const application = {
  id: 2,
  company: 'ByteDance',
  position: 'AI Engineer',
  city: 'Shanghai',
  stage: 'interview1',
  applied_at: null,
  next_followup_at: null,
  interviewer_info: '',
  feedback: '',
  todos: [],
  notes: '',
  created_at: 1710000000,
  updated_at: 1710000000,
  sort_order: 0,
  review_summary: {
    review_count: 0,
    latest_review_id: null,
    latest_avg_score: null,
    latest_review_at: null,
    latest_status: null,
  },
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('ReviewSessionDetail', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  beforeEach(() => {
    apiMock.reviewSessionDetail.mockReset()
    apiMock.reviewUpdateSession.mockReset()
    apiMock.jobTrackerApplications.mockReset()
    apiMock.reviewTriggerAnalysis.mockReset()
    useUiPrefsStore.setState({
      appMode: 'review',
      jobTrackerDeepLink: null,
      reviewDeepLinkSessionId: null,
    } as any)
    apiMock.jobTrackerApplications.mockResolvedValue({ items: [application] })
    apiMock.reviewUpdateSession.mockResolvedValue({ success: true, synced_todos: true })
  })

  it('binds a review session to a job tracker application', async () => {
    apiMock.reviewSessionDetail
      .mockResolvedValueOnce(baseDetail)
      .mockResolvedValueOnce({
        ...baseDetail,
        application_id: application.id,
        application: {
          id: application.id,
          company: application.company,
          position: application.position,
          city: application.city,
          stage: application.stage,
        },
      })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('关联求职记录')
    fireEvent.click(screen.getByRole('button', { name: /ByteDance/ }))

    await waitFor(() => {
      expect(apiMock.reviewUpdateSession).toHaveBeenCalledWith(7, { application_id: 2 })
    })
    expect(await screen.findByText(/ByteDance · AI Engineer/)).toBeInTheDocument()
    expect(await screen.findByText('已关联求职记录，并同步复盘待办')).toBeInTheDocument()
  })

  it('prevents duplicate bind requests while syncing a job tracker application', async () => {
    const bindUpdate = createDeferred<{ success: boolean; synced_todos: boolean }>()
    apiMock.reviewUpdateSession.mockReturnValueOnce(bindUpdate.promise)
    apiMock.reviewSessionDetail
      .mockResolvedValueOnce(baseDetail)
      .mockResolvedValueOnce({
        ...baseDetail,
        application_id: application.id,
        application: {
          id: application.id,
          company: application.company,
          position: application.position,
          city: application.city,
          stage: application.stage,
        },
      })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    const bindButton = await screen.findByRole('button', { name: /ByteDance/ })
    fireEvent.click(bindButton)
    fireEvent.click(bindButton)

    await waitFor(() => {
      expect(apiMock.reviewUpdateSession).toHaveBeenCalledWith(7, { application_id: 2 })
    })
    expect(apiMock.reviewUpdateSession).toHaveBeenCalledTimes(1)
    expect(bindButton).toBeDisabled()

    await act(async () => {
      bindUpdate.resolve({ success: true, synced_todos: true })
      await bindUpdate.promise
    })

    expect(await screen.findByText(/ByteDance · AI Engineer/)).toBeInTheDocument()
    expect(await screen.findByText('已关联求职记录，并同步复盘待办')).toBeInTheDocument()
  })

  it('shows closed-stage copy for rejected linked applications', async () => {
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      application_id: application.id,
      application: {
        id: application.id,
        company: application.company,
        position: application.position,
        city: application.city,
        stage: 'interview3_rejected',
        applied_at: null,
        next_followup_at: null,
      },
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('关联求职记录')
    expect(screen.getByText('三面挂')).toBeInTheDocument()
    expect(screen.getByText('已结束')).toBeInTheDocument()
  })

  it('can jump back to the linked application timeline', async () => {
    apiMock.jobTrackerApplications.mockResolvedValueOnce({
      items: [{
        ...application,
        review_summary: {
          review_count: 3,
          latest_review_id: 9,
          latest_avg_score: 7.6,
          latest_review_at: 1710003600,
          latest_status: 'completed',
        },
      }],
    })
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      application_id: application.id,
      application: {
        id: application.id,
        company: application.company,
        position: application.position,
        city: application.city,
        stage: application.stage,
        applied_at: null,
        next_followup_at: null,
      },
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('更早一场')
    fireEvent.click(screen.getByRole('button', { name: '全部复盘' }))

    expect(useUiPrefsStore.getState().appMode).toBe('job-tracker')
    expect(useUiPrefsStore.getState().jobTrackerDeepLink).toEqual({
      applicationId: 2,
      openReviews: true,
      highlightReviewId: 7,
    })
  })

  it('can jump to the linked application detail without forcing the review timeline open', async () => {
    apiMock.jobTrackerApplications.mockResolvedValueOnce({
      items: [{
        ...application,
        review_summary: {
          review_count: 2,
          latest_review_id: 7,
          latest_avg_score: 7.4,
          latest_review_at: 1710003600,
          latest_status: 'completed',
        },
      }],
    })
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      application_id: application.id,
      application: {
        id: application.id,
        company: application.company,
        position: application.position,
        city: application.city,
        stage: application.stage,
        applied_at: null,
        next_followup_at: null,
      },
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByRole('button', { name: '去求职看板' })
    expect(screen.getByText('最近一场')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '去求职看板' }))

    expect(useUiPrefsStore.getState().appMode).toBe('job-tracker')
    expect(useUiPrefsStore.getState().jobTrackerDeepLink).toEqual({
      applicationId: 2,
      openReviews: false,
    })
  })

  it('prevents duplicate detail info saves while one is pending', async () => {
    const save = createDeferred<{ success: boolean }>()
    apiMock.reviewSessionDetail.mockResolvedValueOnce(baseDetail)
    apiMock.reviewUpdateSession.mockReturnValueOnce(save.promise)

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('一面复盘')
    fireEvent.click(screen.getByTitle('编辑信息'))
    fireEvent.change(screen.getByPlaceholderText('面试标题（可选）'), {
      target: { value: '更新后复盘' },
    })

    const saveButton = screen.getByRole('button', { name: '保存信息' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    expect(apiMock.reviewUpdateSession).toHaveBeenCalledTimes(1)
    expect(apiMock.reviewUpdateSession).toHaveBeenCalledWith(7, expect.objectContaining({
      title: '更新后复盘',
    }))
    expect(screen.getByRole('button', { name: '保存中' })).toBeDisabled()
    expect(screen.getByPlaceholderText('面试标题（可选）')).toBeDisabled()

    await act(async () => {
      save.resolve({ success: true })
      await save.promise
    })

    expect(await screen.findByText('更新后复盘')).toBeInTheDocument()
    expect(screen.getByText('已保存复盘标题与岗位信息')).toBeInTheDocument()
  })

  it('ignores stale bind refreshes after switching review sessions', async () => {
    const bindUpdate = createDeferred<{ success: boolean; synced_todos: boolean }>()
    apiMock.reviewUpdateSession.mockReturnValueOnce(bindUpdate.promise)
    apiMock.reviewSessionDetail
      .mockResolvedValueOnce(baseDetail)
      .mockResolvedValueOnce({
        ...baseDetail,
        id: 8,
        title: '二面复盘',
        company: 'Nova',
        role: 'Backend',
        application_id: null,
        application: null,
      })
      .mockResolvedValueOnce({
        ...baseDetail,
        application_id: application.id,
        application: {
          id: application.id,
          company: application.company,
          position: application.position,
          city: application.city,
          stage: application.stage,
        },
      })

    const { rerender } = render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('关联求职记录')
    fireEvent.click(screen.getByRole('button', { name: /ByteDance/ }))
    await waitFor(() => {
      expect(apiMock.reviewUpdateSession).toHaveBeenCalledWith(7, { application_id: 2 })
    })

    rerender(<ReviewSessionDetail sessionId={8} onBack={vi.fn()} />)
    expect(await screen.findByText('二面复盘')).toBeInTheDocument()

    await act(async () => {
      bindUpdate.resolve({ success: true, synced_todos: true })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(apiMock.reviewSessionDetail).toHaveBeenCalledTimes(3)
    })

    expect(screen.getByText('二面复盘')).toBeInTheDocument()
    expect(screen.queryByText('已绑定求职记录')).not.toBeInTheDocument()
    expect(screen.queryByText('已关联求职记录，并同步复盘待办')).not.toBeInTheDocument()
  })

  it('shows a guided desktop workspace for sparse test-fragment reviews and auto-expands short turn records', async () => {
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      status: 'recorded',
      title: '临时 mock 复盘',
      company: '手动测试',
      role: '后端开发工程师',
      turn_count: 3,
      avg_score: null,
      summary_markdown: null,
      strong_points: [],
      weak_points: [],
      auto_sync_eligible: false,
      turns: [
        {
          id: 71,
          session_id: 7,
          qa_id: 'qa-1',
          seq: 1,
          question_text: '请讲讲你最熟悉的项目。',
          candidate_answer_text: '我先介绍了项目背景、目标和我负责的核心链路。',
          original_candidate_answer_text: null,
          reference_answer_text: '按背景、挑战、决策、结果展开。',
          code_text: null,
          duration_ms: 30000,
          is_partial: false,
          analysis_status: 'pending',
          strengths: [],
          risks: [],
          evidence: null,
          scorecard: {},
          created_at: 1710000000,
          updated_at: 1710000000,
        },
        {
          id: 72,
          session_id: 7,
          qa_id: 'qa-2',
          seq: 2,
          question_text: '如果再追问一轮，你最想补哪块？',
          candidate_answer_text: '我会补 trade-off 和容量估算。',
          original_candidate_answer_text: null,
          reference_answer_text: '明确最弱环节和补强计划。',
          code_text: null,
          duration_ms: 24000,
          is_partial: false,
          analysis_status: 'pending',
          strengths: [],
          risks: [],
          evidence: null,
          scorecard: {},
          created_at: 1710000000,
          updated_at: 1710000000,
        },
      ],
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('当前状态')
    expect(screen.getAllByText(/短样本/)).not.toHaveLength(0)
    expect(screen.getAllByText(/不回写看板/)).not.toHaveLength(0)
    expect(screen.queryByText('未绑定')).not.toBeInTheDocument()
    expect(screen.getByText('请讲讲你最熟悉的项目。')).toBeInTheDocument()
    expect(screen.getByText('短记录，已展开。')).toBeInTheDocument()
  })

  it('shows corrected candidate answers while keeping original ASR text expandable', async () => {
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      turn_count: 1,
      turns: [
        {
          id: 81,
          session_id: 7,
          qa_id: 'qa-1',
          seq: 1,
          question_text: 'Redis 缓存穿透怎么处理？',
          candidate_answer_text: '我会用 Redis 布隆过滤器和空值缓存。',
          original_candidate_answer_text: '我会用 red 地址布隆过绿器和空值缓存。',
          reference_answer_text: '可讲布隆过滤器、空值缓存和参数校验。',
          code_text: null,
          duration_ms: 32000,
          is_partial: false,
          analysis_status: 'completed',
          strengths: ['能说出常见方案'],
          risks: [],
          evidence: null,
          scorecard: { 准确性: 8, 深度: 6, 表达: 7 },
          created_at: 1710000000,
          updated_at: 1710000000,
        },
      ],
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('逐题分析 · 1 题')
    fireEvent.click(screen.getByRole('button', { name: /逐题分析 · 1 题/ }))
    await screen.findByText('Redis 缓存穿透怎么处理？')

    expect(await screen.findByText('ASR 已纠错，当前显示纠错后回答')).toBeInTheDocument()
    expect(screen.getByText('我会用 Redis 布隆过滤器和空值缓存。')).toBeInTheDocument()
    expect(screen.getByText(/原始转写：我会用 red 地址布隆过绿器和空值缓存。/)).toBeInTheDocument()
  })

  it('tolerates string scorecard values in turn details', async () => {
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      turn_count: 1,
      turns: [
        {
          id: 82,
          session_id: 7,
          qa_id: 'qa-score',
          seq: 1,
          question_text: '讲讲 Redis 缓存击穿。',
          candidate_answer_text: '我会用互斥锁。',
          original_candidate_answer_text: null,
          reference_answer_text: '可补充逻辑过期和热点保护。',
          code_text: null,
          duration_ms: 30000,
          is_partial: false,
          analysis_status: 'completed',
          strengths: [],
          risks: [],
          evidence: null,
          scorecard: { 准确性: '8', 深度: '7.5分', 表达: '无法评分' },
          created_at: 1710000000,
          updated_at: 1710000000,
        },
      ],
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('逐题分析 · 1 题')
    fireEvent.click(screen.getByRole('button', { name: /逐题分析 · 1 题/ }))
    await screen.findByText('讲讲 Redis 缓存击穿。')

    expect(screen.getByText('7.8')).toBeInTheDocument()
    expect(screen.getByText('8.0')).toBeInTheDocument()
    expect(screen.getByText('7.5')).toBeInTheDocument()
    expect(screen.getByText('无法评分')).toBeInTheDocument()
  })

  it('normalizes string session scores in the detail header', async () => {
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      avg_score: '8.4分',
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('一面复盘')
    expect(screen.getByText('8.4')).toBeInTheDocument()
    expect(screen.queryByText('NaN')).not.toBeInTheDocument()
  })

  it('shows screenshot self-check evidence in turn details', async () => {
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      turn_count: 1,
      turns: [
        {
          id: 91,
          session_id: 7,
          qa_id: 'qa-screen',
          seq: 1,
          question_text: '两张截图里的代码题怎么修？',
          candidate_answer_text: '我按第一张截图写了代码。',
          original_candidate_answer_text: null,
          reference_answer_text: '需要结合第二张截图里的失败样例修正。',
          code_text: null,
          duration_ms: 30000,
          is_partial: false,
          analysis_status: 'pending',
          strengths: [],
          risks: [],
          evidence: {
            vision_verify: {
              verdict: 'FAIL',
              reason: '第二张截图里的样例不通过',
            },
          },
          scorecard: {},
          created_at: 1710000000,
          updated_at: 1710000000,
        },
      ],
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('逐题分析 · 1 题')
    fireEvent.click(screen.getByRole('button', { name: /逐题分析 · 1 题/ }))
    await screen.findByText('两张截图里的代码题怎么修？')

    expect(screen.getByText('截图自检风险')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('截图自检不一致，请人工复核')
    expect(screen.getByText('第二张截图里的样例不通过')).toBeInTheDocument()
  })

  it('shows per-turn practice evidence in turn details', async () => {
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      turn_count: 1,
      turns: [
        {
          id: 92,
          session_id: 7,
          qa_id: 'qa-review',
          seq: 1,
          question_text: 'Redis 缓存击穿怎么处理？',
          candidate_answer_text: '我会加互斥锁。',
          original_candidate_answer_text: null,
          reference_answer_text: '可讲互斥锁、逻辑过期和热点保护。',
          code_text: null,
          duration_ms: 30000,
          is_partial: false,
          analysis_status: 'completed',
          strengths: [],
          risks: [],
          evidence: {
            improvement_advice: '补充逻辑过期和热点 key 保护策略。',
            follow_up_questions: ['热点 key 同时过期时怎么保护数据库？'],
            tags: ['Redis', '缓存击穿'],
          },
          scorecard: {},
          created_at: 1710000000,
          updated_at: 1710000000,
        },
      ],
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('逐题分析 · 1 题')
    fireEvent.click(screen.getByRole('button', { name: /逐题分析 · 1 题/ }))
    await screen.findByText('Redis 缓存击穿怎么处理？')

    expect(screen.getByText('复练建议')).toBeInTheDocument()
    expect(screen.getByText('补充逻辑过期和热点 key 保护策略。')).toBeInTheDocument()
    expect(screen.getByText('热点 key 同时过期时怎么保护数据库？')).toBeInTheDocument()
    expect(screen.getByText('Redis')).toBeInTheDocument()
    expect(screen.getByText('缓存击穿')).toBeInTheDocument()
  })

  it('shows generated answers for written-exam review turns', async () => {
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      source: 'written_exam',
      title: null,
      company: null,
      role: null,
      summary_markdown: null,
      avg_score: 7.7,
      turn_count: 1,
      strong_points: [],
      weak_points: [],
      turns: [
        {
          id: 101,
          session_id: 7,
          qa_id: 'qa-screen-1',
          seq: 1,
          question_text: '截图题：两数之和怎么写？',
          candidate_answer_text: '',
          original_candidate_answer_text: null,
          reference_answer_text: '用哈希表一次遍历，返回目标差值命中的下标。',
          code_text: null,
          duration_ms: 30000,
          is_partial: false,
          analysis_status: 'completed',
          strengths: ['复杂度清晰'],
          risks: ['缺少空数组用例'],
          evidence: { review_mode: 'written_exam' },
          scorecard: { 正确性: 8, 完整性: 7, 可提交性: 8 },
          created_at: 1710000000,
          updated_at: 1710000000,
        },
      ],
    })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await screen.findByText('截图笔试复盘')
    expect(screen.getByText('笔试练习')).toBeInTheDocument()
    expect(screen.getAllByText('1 题').length).toBeGreaterThan(0)
    expect(screen.getByText('1 题已评分')).toBeInTheDocument()
    expect(screen.getByText('模式')).toBeInTheDocument()
    expect(screen.getByText('笔试')).toBeInTheDocument()
    expect(screen.getByText('生成答案')).toBeInTheDocument()
    expect(screen.getByText('用哈希表一次遍历，返回目标差值命中的下标。')).toBeInTheDocument()
    expect(screen.queryByText('候选人回答')).not.toBeInTheDocument()
    expect(screen.queryByText('(未录制到回答)')).not.toBeInTheDocument()
  })

  it('prevents duplicate analysis trigger requests while one is in flight', async () => {
    const trigger = createDeferred<{ status: string }>()
    apiMock.reviewSessionDetail.mockResolvedValueOnce({
      ...baseDetail,
      status: 'recorded',
      avg_score: null,
      summary_markdown: null,
      strong_points: [],
      weak_points: [],
    })
    apiMock.reviewTriggerAnalysis.mockReturnValueOnce(trigger.promise)

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    const action = await screen.findByRole('button', { name: /生成复盘/ })
    fireEvent.click(action)
    fireEvent.click(action)

    await waitFor(() => {
      expect(apiMock.reviewTriggerAnalysis).toHaveBeenCalledWith(7)
    })
    expect(apiMock.reviewTriggerAnalysis).toHaveBeenCalledTimes(1)
    expect(action).toBeDisabled()

    await act(async () => {
      trigger.resolve({ status: 'pending' })
      await trigger.promise
    })

    expect(await screen.findByText('复盘分析已开始，请稍后刷新查看结果')).toBeInTheDocument()
  })

  it('refreshes the detail immediately when analysis is already done', async () => {
    apiMock.reviewSessionDetail
      .mockResolvedValueOnce({
        ...baseDetail,
        status: 'completed',
        avg_score: null,
        summary_markdown: null,
        strong_points: [],
        weak_points: [],
      })
      .mockResolvedValueOnce({
        ...baseDetail,
        status: 'completed',
        avg_score: 8.4,
        summary_markdown: '已有复盘内容已同步。',
        strong_points: ['结构清楚'],
      })
    apiMock.reviewTriggerAnalysis.mockResolvedValueOnce({ status: 'done' })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    const action = await screen.findByRole('button', { name: /生成复盘/ })
    fireEvent.click(action)

    expect(await screen.findByText('复盘已完成')).toBeInTheDocument()
    expect(screen.getByText('已有复盘内容已同步。')).toBeInTheDocument()
    expect(screen.getByText('8.4')).toBeInTheDocument()
    expect(apiMock.reviewSessionDetail).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: /生成复盘/ })).not.toBeInTheDocument()
  })

  it('refreshes an analyzing review detail until the generated analysis is ready', async () => {
    vi.useFakeTimers()
    apiMock.reviewSessionDetail
      .mockResolvedValueOnce({
        ...baseDetail,
        status: 'analyzing',
        avg_score: null,
        summary_markdown: null,
        strong_points: [],
        weak_points: [],
      })
      .mockResolvedValueOnce({
        ...baseDetail,
        status: 'completed',
        avg_score: 8.2,
        summary_markdown: '自动生成的复盘已经完成。',
      })

    render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getAllByText('分析中').length).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(apiMock.reviewSessionDetail).toHaveBeenCalledTimes(2)
    expect(screen.getByText('复盘分析已完成')).toBeInTheDocument()
    expect(screen.getByText('自动生成的复盘已经完成。')).toBeInTheDocument()
  })

  it('ignores stale analysis polling responses after switching review sessions', async () => {
    vi.useFakeTimers()
    const stalePoll = createDeferred<typeof baseDetail>()
    apiMock.reviewSessionDetail
      .mockResolvedValueOnce({
        ...baseDetail,
        status: 'analyzing',
        avg_score: null,
        summary_markdown: null,
      })
      .mockReturnValueOnce(stalePoll.promise)
      .mockResolvedValueOnce({
        ...baseDetail,
        id: 8,
        title: '二面复盘',
        company: 'Nova',
        role: 'Backend',
        status: 'completed',
      })

    const { rerender } = render(<ReviewSessionDetail sessionId={7} onBack={vi.fn()} />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getAllByText('分析中').length).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(apiMock.reviewSessionDetail).toHaveBeenCalledTimes(2)

    rerender(<ReviewSessionDetail sessionId={8} onBack={vi.fn()} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('二面复盘')).toBeInTheDocument()

    await act(async () => {
      stalePoll.resolve({
        ...baseDetail,
        status: 'completed',
        title: '旧复盘已完成',
        summary_markdown: '旧轮询结果',
      })
      await stalePoll.promise
    })

    expect(screen.getByText('二面复盘')).toBeInTheDocument()
    expect(screen.queryByText('旧复盘已完成')).not.toBeInTheDocument()
    expect(screen.queryByText('旧轮询结果')).not.toBeInTheDocument()
  })
})
