import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JobTracker from './JobTracker'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  jobTrackerApplications: vi.fn(),
  jobTrackerListOffers: vi.fn(),
  jobTrackerCreateApplication: vi.fn(),
  jobTrackerPatchApplication: vi.fn(),
  jobTrackerDeleteApplication: vi.fn(),
  jobTrackerApplicationReviews: vi.fn(),
  jobTrackerReorderStage: vi.fn(),
  jobTrackerCompare: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('./job-tracker/KanbanBoard', () => ({
  default: ({ applications, search }: any) => {
    const q = search.trim().toLowerCase()
    const visible = applications.filter((app: any) => {
      if (!q) return true
      return [app.company, app.position, app.city, app.notes]
        .some((value) => String(value).toLowerCase().includes(q))
    })
    return (
      <div>
        {visible.map((app: any) => (
          <div key={app.id}>{app.company}</div>
        ))}
      </div>
    )
  },
}))
vi.mock('./job-tracker/OfferCompareModal', () => ({ default: () => null }))
vi.mock('./job-tracker/OfferEditModal', () => ({ default: () => null }))

describe('JobTracker', () => {
  beforeEach(() => {
    useInterviewStore.setState({ toastMessage: null, setToastMessage: vi.fn() } as any)
    apiMock.jobTrackerApplications.mockResolvedValue({
      items: [{
        id: 1,
        company: 'Acme',
        position: 'Frontend',
        city: 'Shanghai',
        notes: 'react focus',
        stage: 'applied',
        updated_at: 1710000000,
        created_at: 1710000000,
        applied_at: null,
        next_followup_at: null,
        interviewer_info: '',
        feedback: '',
        todos: [],
        sort_order: 0,
        review_summary: {
          review_count: 2,
          latest_review_id: 11,
          latest_avg_score: 7.1,
          latest_review_at: 1710003600,
          latest_status: 'completed',
        },
      }],
    })
    apiMock.jobTrackerListOffers.mockResolvedValue({ items: [] })
    apiMock.jobTrackerApplicationReviews.mockResolvedValue({
      items: [{
        id: 11,
        status: 'completed',
        started_at: 1710000000,
        ended_at: 1710003600,
        title: '系统设计复盘',
        company: 'Acme',
        role: 'Frontend',
        turn_count: 4,
        avg_score: 7.1,
        summary_preview: '缓存与限流回答不错，容量估算需要补强。',
        updated_at: 1710003600,
      }],
    })
  })

  it('loads and renders application rows', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getByDisplayValue('Acme')).toBeInTheDocument())
  })

  it('keeps search consistent when switching to kanban', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getByDisplayValue('Acme')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('搜索公司、岗位、城市…'), { target: { value: 'react' } })
    fireEvent.click(screen.getByRole('button', { name: '看板' }))

    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument())
  })

  it('shows review summary and opens linked reviews', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getByDisplayValue('Acme')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /复盘 2/ }))

    await waitFor(() => expect(apiMock.jobTrackerApplicationReviews).toHaveBeenCalledWith(1))
    expect(await screen.findByText('系统设计复盘')).toBeInTheDocument()
    expect(screen.getByText(/缓存与限流回答不错/)).toBeInTheDocument()
  })
})
