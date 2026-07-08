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
})
