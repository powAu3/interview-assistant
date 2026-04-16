import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeMap from './KnowledgeMap'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  knowledgeSummary: vi.fn(),
  knowledgeHistory: vi.fn(),
  knowledgeReset: vi.fn(),
  ask: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))

describe('KnowledgeMap', () => {
  beforeEach(() => {
    useInterviewStore.setState({ setToastMessage: vi.fn() } as any)
    apiMock.knowledgeSummary.mockResolvedValue({
      tags: [
        { tag: 'React', count: 2, avg_score: 3, trend: 'down' },
        { tag: 'TS', count: 2, avg_score: 6, trend: 'stable' },
        { tag: 'CSS', count: 2, avg_score: 8, trend: 'up' },
      ],
    })
    apiMock.knowledgeHistory.mockResolvedValue({
      total: 2,
      records: [
        { id: 1, session_type: 'assist', question: 'Q1', answer: 'A1', score: 5, tags: ['React'], created_at: 100 },
        { id: 2, session_type: 'assist', question: 'Q2', answer: 'A2', score: 5, tags: ['TS'], created_at: 120 },
      ],
    })
  })

  it('renders merged history summary', async () => {
    render(<KnowledgeMap />)
    await waitFor(() => expect(screen.getByText(/历史记录/)).toBeInTheDocument())
    expect(screen.getByText(/×2/)).toBeInTheDocument()
  })

  it('requests targeted review questions', async () => {
    render(<KnowledgeMap />)
    await waitFor(() => expect(screen.getByRole('button', { name: '生成针对性复习题' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '生成针对性复习题' }))
    await waitFor(() => expect(apiMock.ask).toHaveBeenCalled())
  })
})
