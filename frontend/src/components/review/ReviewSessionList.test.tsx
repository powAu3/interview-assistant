import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  beforeEach(() => {
    apiMock.reviewSessions.mockReset()
    apiMock.updateConfig.mockReset()
    apiMock.reviewTriggerAnalysis.mockReset()
    apiMock.reviewCreateManual.mockReset()
    apiMock.reviewAsrCorrectionTest.mockReset()

    useInterviewStore.setState({
      config: {
        review_enabled: false,
        review_model_index: 0,
        models: [{ name: 'lite-ark', enabled: true }],
      },
      toastMessage: null,
      toasts: [],
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
          avg_score: '7.8分',
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
    expect(screen.getByText('生成失败')).toBeInTheDocument()
    expect(screen.queryByText('打开详情查看逐题记录和岗位联动。')).not.toBeInTheDocument()
    expect(screen.getByText('米哈游二面')).toBeInTheDocument()
    expect(screen.getByText('7.8分')).toBeInTheDocument()
    expect(screen.queryByText('NaN分')).not.toBeInTheDocument()
  })

  it('labels written-exam review sessions with exam-specific metadata', async () => {
    apiMock.reviewSessions.mockResolvedValueOnce({
      total: 1,
      page: 1,
      page_size: 20,
      items: [
        {
          id: 52,
          status: 'recorded',
          started_at: 1710300000,
          ended_at: 1710300900,
          source: 'written_exam',
          title: '截图笔试练习',
          company: null,
          role: null,
          turn_count: 2,
          avg_score: null,
          summary_markdown: null,
          auto_sync_eligible: true,
          application_id: null,
          application: null,
        },
      ],
    })

    render(<ReviewSessionList onViewDetail={vi.fn()} />)

    await screen.findByText('截图笔试练习')
    expect(screen.getByText('笔试练习')).toBeInTheDocument()
    expect(screen.getByText('截图题')).toBeInTheDocument()
    expect(screen.getByText('2题')).toBeInTheDocument()
    expect(screen.getByText('待生成笔试报告')).toBeInTheDocument()
  })

  it('can jump from a review card back to the linked application timeline', async () => {
    const onViewDetail = vi.fn()
    render(<ReviewSessionList onViewDetail={onViewDetail} />)

    await screen.findByText('OpenAI 一面')
    fireEvent.click(screen.getAllByRole('button', { name: /查看 .*岗位/ })[0])
    expect(onViewDetail).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(useUiPrefsStore.getState().appMode).toBe('job-tracker')
    })
    expect(useUiPrefsStore.getState().jobTrackerDeepLink).toEqual({
      applicationId: 9,
      openReviews: true,
      highlightReviewId: 41,
    })
  })

  it('opens detail from the review row body by click or keyboard', async () => {
    const onViewDetail = vi.fn()
    render(<ReviewSessionList onViewDetail={onViewDetail} />)

    const title = await screen.findByText('米哈游二面')
    const row = title.closest('article')
    expect(row).not.toBeNull()

    fireEvent.click(row as HTMLElement)

    expect(onViewDetail).toHaveBeenCalledWith(39)

    onViewDetail.mockClear()
    fireEvent.keyDown(row as HTMLElement, { key: 'Enter' })

    expect(onViewDetail).toHaveBeenCalledWith(39)
  })

  it('shows linked application stages and supports focus filtering', async () => {
    render(<ReviewSessionList onViewDetail={vi.fn()} />)

    await screen.findByText('OpenAI 一面')
    expect(screen.getAllByText('一面挂').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2 场').length).toBeGreaterThan(0)
    expect(screen.getByText('最近一场')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /已完成/ }))

    expect(screen.queryByRole('heading', { name: '先处理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '进行中' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeInTheDocument()
    expect(screen.queryByText('OpenAI 一面')).not.toBeInTheDocument()
    expect(screen.getByText('米哈游二面')).toBeInTheDocument()
  })

  it('makes manual import and settings panels visibly collapsible', async () => {
    render(<ReviewSessionList onViewDetail={vi.fn()} />)

    await screen.findByText('OpenAI 一面')

    const manualButton = screen.getByRole('button', { name: '手动复盘' })
    expect(manualButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(manualButton)

    expect(screen.getByRole('button', { name: '收起导入' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('手动复盘导入')).toBeInTheDocument()

    const settingsButton = screen.getByRole('button', { name: '配置' })
    expect(settingsButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(settingsButton)

    expect(screen.getByRole('button', { name: '收起配置' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('复盘配置')).toBeInTheDocument()
    expect(screen.queryByText('手动复盘导入')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动复盘' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: '收起配置' }))
    expect(screen.getByRole('button', { name: '配置' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('复盘配置')).not.toBeInTheDocument()
  })

  it('describes the review toggle as automatic analysis generation', async () => {
    render(<ReviewSessionList onViewDetail={vi.fn()} />)

    await screen.findByText('自动生成未启用')
    fireEvent.click(screen.getByRole('button', { name: '配置' }))

    expect(screen.getByText('只保存记录，手动生成分析')).toBeInTheDocument()
    expect(screen.queryByText(/自动记录/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalledWith({ review_enabled: true })
    })
    expect(useInterviewStore.getState().toastMessage).toBe('已开启自动生成复盘')
  })

  it('quietly refreshes analyzing sessions so completed analysis appears without manual refresh', async () => {
    vi.useFakeTimers()
    apiMock.reviewSessions
      .mockResolvedValueOnce({
        total: 1,
        page: 1,
        page_size: 20,
        items: [
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
            application_id: null,
            application: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 1,
        page: 1,
        page_size: 20,
        items: [
          {
            id: 40,
            status: 'completed',
            started_at: 1710110000,
            ended_at: 1710112100,
            source: 'assist',
            title: '字节一面',
            company: '字节跳动',
            role: '后端开发',
            turn_count: 8,
            avg_score: 8.1,
            summary_markdown: '复盘已生成，项目回答更聚焦。',
            application_id: null,
            application: null,
          },
        ],
      })

    render(<ReviewSessionList onViewDetail={vi.fn()} />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('字节一面')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000)
    })

    expect(apiMock.reviewSessions).toHaveBeenCalledTimes(2)
    expect(screen.getByText('复盘已生成，项目回答更聚焦。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeInTheDocument()
  })
})
