import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewSessionList from './ReviewSessionList'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

const apiMock = vi.hoisted(() => ({
  reviewSessions: vi.fn(),
  updateConfig: vi.fn(),
  reviewTriggerAnalysis: vi.fn(),
  reviewCreateManual: vi.fn(),
  reviewAsrCorrectionTest: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
  getErrorMessage: (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback,
}))

describe('ReviewSessionList', () => {
  beforeEach(() => {
    useInterviewStore.setState({
      config: {
        review_enabled: false,
        review_model_index: 0,
        models: [{ name: 'lite-ark', enabled: true }],
      },
      setConfig: vi.fn(),
    } as any)
    useUiPrefsStore.setState({
      appMode: 'review',
      jobTrackerDeepLink: null,
      reviewDeepLinkSessionId: null,
    } as any)

    apiMock.reviewSessions.mockResolvedValue({
      total: 3,
      page: 1,
      page_size: 20,
      items: [
        {
          id: 41,
          status: 'analysis_failed',
          started_at: 1710200000,
          ended_at: 1710202100,
          source: 'assist',
          title: 'OpenAI 一面',
          company: 'OpenAI',
          role: 'Research Engineer',
          turn_count: 7,
          avg_score: null,
          application_id: 9,
          application: { id: 9, company: 'OpenAI', position: 'Research Engineer', city: 'Remote', stage: 'interview1_rejected' },
        },
        {
          id: 40,
          status: 'analyzing',
          started_at: 1710110000,
          ended_at: 1710112100,
          source: 'assist',
          title: '字节一面',
          company: '字节跳动',
          role: '后端开发',
          turn_count: 8,
          avg_score: null,
          application_id: 9,
          application: { id: 9, company: 'OpenAI', position: 'Research Engineer', city: 'Remote', stage: 'interview1_rejected' },
        },
        {
          id: 39,
          status: 'completed',
          started_at: 1710020000,
          ended_at: 1710020900,
          source: 'manual',
          title: '米哈游二面',
          company: '米哈游',
          role: '客户端工程师',
          turn_count: 6,
          avg_score: 7.8,
          summary_markdown: '表现稳定，项目细节比较扎实。',
          application_id: null,
          application: null,
        },
      ],
    })
    apiMock.updateConfig.mockResolvedValue({ review_enabled: true, review_model_index: 0, models: [{ name: 'lite-ark', enabled: true }] })
    apiMock.reviewTriggerAnalysis.mockResolvedValue({ status: 'started' })
    apiMock.reviewCreateManual.mockResolvedValue({ session_id: 100 })
    apiMock.reviewAsrCorrectionTest.mockResolvedValue({ ok: true })
  })

  it('groups sessions into priority buckets', async () => {
    render(<ReviewSessionList onViewDetail={vi.fn()} />)

    await screen.findByRole('heading', { name: '先处理' })
    expect(screen.getByRole('heading', { name: '进行中' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeInTheDocument()
    expect(screen.getByText('OpenAI 一面')).toBeInTheDocument()
    expect(screen.getByText('米哈游二面')).toBeInTheDocument()
  })

  it('can jump from a review card back to the linked application timeline', async () => {
    render(<ReviewSessionList onViewDetail={vi.fn()} />)

    await screen.findByText('OpenAI 一面')
    fireEvent.click(screen.getAllByRole('button', { name: '岗位时间线' })[0])

    await waitFor(() => {
      expect(useUiPrefsStore.getState().appMode).toBe('job-tracker')
    })
    expect(useUiPrefsStore.getState().jobTrackerDeepLink).toEqual({
      applicationId: 9,
      openReviews: true,
      highlightReviewId: 41,
    })
  })

  it('shows linked application stages and supports focus filtering', async () => {
    render(<ReviewSessionList onViewDetail={vi.fn()} />)

    await screen.findByText('OpenAI 一面')
    expect(screen.getAllByText('一面挂').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/这条岗位已一面挂/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('同岗位 2 场复盘').length).toBeGreaterThan(0)
    expect(screen.getByText('当前这场是最近一场')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /已完成/ }))

    expect(screen.queryByRole('heading', { name: '先处理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '进行中' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeInTheDocument()
    expect(screen.queryByText('OpenAI 一面')).not.toBeInTheDocument()
    expect(screen.getByText('米哈游二面')).toBeInTheDocument()
  })
})
