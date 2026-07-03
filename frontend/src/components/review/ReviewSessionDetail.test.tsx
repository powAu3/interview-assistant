import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewSessionDetail from './ReviewSessionDetail'

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
  beforeEach(() => {
    apiMock.reviewSessionDetail.mockReset()
    apiMock.reviewUpdateSession.mockReset()
    apiMock.jobTrackerApplications.mockReset()
    apiMock.reviewTriggerAnalysis.mockReset()
    vi.spyOn(window, 'alert').mockImplementation(() => undefined)
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
    expect(window.alert).toHaveBeenCalledWith('已关联求职记录，并同步复盘待办')
  })
})
