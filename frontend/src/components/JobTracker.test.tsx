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
  jobTrackerReorderStage: vi.fn(),
  jobTrackerCompare: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
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
      }],
    })
    apiMock.jobTrackerListOffers.mockResolvedValue({ items: [] })
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
})
