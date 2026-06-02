import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeMap from './KnowledgeMap'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  knowledgeSummary: vi.fn(),
  knowledgeHistory: vi.fn(),
  knowledgeReset: vi.fn(),
  ask: vi.fn(),
  audioInputMonitorStatus: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))

describe('KnowledgeMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useInterviewStore.setState({
      setToastMessage: vi.fn(),
      candidateTranscriptions: [
        '我刚才说的是先用监控定位慢查询，再用索引和缓存一起优化。',
      ],
      candidateSttLoaded: true,
      candidateSttLoading: false,
      candidateSttProvider: 'whisper',
      config: { candidate_asr_enabled: true },
    } as any)
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
    apiMock.audioInputMonitorStatus.mockResolvedValue({
      running: true,
      device_id: 1002,
      rms: 0.04,
      peak: 0.18,
      level_pct: 64,
      has_signal: true,
      error: null,
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

  it('links candidate mic input with ability analysis context', async () => {
    render(<KnowledgeMap />)
    await waitFor(() => expect(screen.getByText('口述输入联动')).toBeInTheDocument())
    expect(screen.getByText('64%')).toBeInTheDocument()
    expect(screen.getByText('whisper 已就绪')).toBeInTheDocument()
    expect(screen.getByText(/先用监控定位慢查询/)).toBeInTheDocument()
  })
})
