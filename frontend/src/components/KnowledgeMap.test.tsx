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
        {
          id: 1,
          qa_id: 'qa-1',
          session_type: 'assist',
          question: 'Q1',
          answer: 'A1',
          candidate_answer: '候选人实际回答 A1',
          score: 5,
          tags: ['React'],
          created_at: 100,
        },
        {
          id: 2,
          qa_id: 'qa-2',
          session_type: 'assist',
          question: 'Q2',
          answer: 'A2',
          candidate_answer: '',
          score: 5,
          tags: ['TS'],
          created_at: 120,
        },
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
    await waitFor(() => expect(apiMock.ask).toHaveBeenCalledWith('请针对以下薄弱知识点出 3 道面试题：React、TS、CSS'))
  })

  it('falls back to frequent unscored tags for review questions', async () => {
    apiMock.knowledgeSummary.mockResolvedValueOnce({
      tags: [
        { tag: 'Redis', count: 4, avg_score: null, trend: 'stable' },
        { tag: 'MySQL', count: 2, avg_score: null, trend: 'stable' },
      ],
    })
    apiMock.knowledgeHistory.mockResolvedValueOnce({
      total: 1,
      records: [
        {
          id: 4,
          session_type: 'assist',
          question: 'Redis 怎么治理热 key？',
          answer: '可以用拆分、缓存预热和限流。',
          score: null,
          tags: ['Redis'],
          created_at: 400,
        },
      ],
    })

    render(<KnowledgeMap />)
    await waitFor(() => expect(screen.getByText('还没有评分样本')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '生成针对性复习题' }))

    await waitFor(() => expect(apiMock.ask).toHaveBeenCalledWith(
      '请针对以下高频但尚未评分的知识点出 3 道面试题，并给出评分要点：Redis、MySQL',
    ))
  })

  it('links candidate mic input with ability analysis context', async () => {
    render(<KnowledgeMap />)
    await waitFor(() => expect(screen.getByText('口述输入联动')).toBeInTheDocument())
    expect(screen.getByText('64%')).toBeInTheDocument()
    expect(screen.getByText('whisper 已就绪')).toBeInTheDocument()
    expect(screen.getByText(/先用监控定位慢查询/)).toBeInTheDocument()
  })

  it('shows candidate spoken answer in expanded ability history when present', async () => {
    render(<KnowledgeMap />)
    await waitFor(() => expect(screen.getByText(/历史记录/)).toBeInTheDocument())

    expect(screen.getByText('含口述')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Q1 Q2'))

    expect(screen.getByText('候选人实际回答（多段按顺序拼接）')).toBeInTheDocument()
    expect(screen.getByText('候选人实际回答 A1')).toBeInTheDocument()
    expect(screen.getByText('助手参考答案（多段按顺序拼接）')).toBeInTheDocument()
  })

  it('keeps old history records compatible when candidate spoken answer is absent', async () => {
    apiMock.knowledgeHistory.mockResolvedValueOnce({
      total: 1,
      records: [
        {
          id: 3,
          session_type: 'assist',
          question: '旧问题',
          answer: '旧助手答案',
          score: 5,
          tags: ['Legacy'],
          created_at: 300,
        },
      ],
    })

    render(<KnowledgeMap />)
    await waitFor(() => expect(screen.getByText(/历史记录/)).toBeInTheDocument())
    fireEvent.click(screen.getByText('旧问题'))

    expect(screen.queryByText('候选人实际回答')).not.toBeInTheDocument()
    expect(screen.getByText('旧助手答案')).toBeInTheDocument()
  })

  it('shows a retryable error state when ability data fails to load', async () => {
    const toast = vi.fn()
    useInterviewStore.setState({ setToastMessage: toast } as any)
    apiMock.knowledgeSummary.mockRejectedValueOnce(new Error('DB locked'))

    render(<KnowledgeMap />)

    await waitFor(() => expect(screen.getByText('能力数据暂时读不到')).toBeInTheDocument())
    expect(screen.getByText(/能力分析数据读取失败：DB locked/)).toBeInTheDocument()
    expect(screen.queryByText('还没有能力画像')).not.toBeInTheDocument()
    expect(toast).toHaveBeenCalledWith('DB locked')
  })
})
