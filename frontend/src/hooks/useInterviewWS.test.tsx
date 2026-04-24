import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInterviewWS } from './useInterviewWS'
import { useInterviewStore } from '@/stores/configStore'

vi.mock('@/lib/backendUrl', () => ({
  buildWsUrl: vi.fn(() => 'ws://example.test/ws'),
}))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0

  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  emitClose() {
    this.readyState = FakeWebSocket.CONNECTING
    this.onclose?.()
  }

  send(payload: string) {
    this.sent.push(payload)
  }

  close() {
    this.onclose?.()
  }
}

function Harness() {
  useInterviewWS()
  return null
}

describe('useInterviewWS', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    useInterviewStore.setState({
      qaPairs: [],
      streamingIds: [],
      currentStreamingId: null,
      transcriptions: [],
      isPaused: false,
      wsConnected: false,
      isRecording: false,
      sttLoaded: false,
      sttLoading: true,
      modelHealth: {},
      tokenUsage: { prompt: 0, completion: 0, total: 0, byModel: {} },
      resumeOptLoading: false,
      resumeOptStreaming: '',
      resumeOptResult: '',
      resumeOptJobId: null,
      lastWSError: null,
    } as any)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('maps init and answer messages into store state', () => {
    render(<Harness />)
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.emitOpen()
      ws.emitMessage({
        type: 'init',
        is_recording: true,
        is_paused: false,
        stt_loaded: true,
        transcriptions: ['hello'],
        qa_pairs: [{ id: 'q1', question: 'Q', answer: 'A', timestamp: 1 }],
      })
      ws.emitMessage({ type: 'answer_start', id: 'q2', question: 'Next', model_name: 'demo' })
      ws.emitMessage({ type: 'answer_chunk', id: 'q2', chunk: 'part' })
    })

    act(() => {
      vi.advanceTimersByTime(80)
    })

    const state = useInterviewStore.getState()
    expect(state.wsConnected).toBe(true)
    expect(state.isRecording).toBe(true)
    expect(state.transcriptions).toEqual(['hello'])
    expect(state.qaPairs[0].question).toBe('Q')
    expect(state.qaPairs[1].answer).toContain('part')
  })

  it('reconnects after close', () => {
    render(<Harness />)
    const first = FakeWebSocket.instances[0]

    act(() => {
      first.emitOpen()
      first.emitClose()
      vi.advanceTimersByTime(2000)
    })

    expect(FakeWebSocket.instances.length).toBe(2)
  })

  it('ignores stale resume optimization chunks from older jobs', () => {
    render(<Harness />)
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.emitOpen()
      ws.emitMessage({ type: 'resume_opt_start', job_id: 'job-old' })
      ws.emitMessage({ type: 'resume_opt_chunk', job_id: 'job-old', chunk: 'old-1' })
      ws.emitMessage({ type: 'resume_opt_start', job_id: 'job-new' })
      ws.emitMessage({ type: 'resume_opt_chunk', job_id: 'job-old', chunk: 'stale-old' })
      ws.emitMessage({ type: 'resume_opt_chunk', job_id: 'job-new', chunk: 'new-1' })
      ws.emitMessage({ type: 'resume_opt_done', job_id: 'job-new', text: 'new-final' })
      ws.emitMessage({ type: 'resume_opt_done', job_id: 'job-old', text: 'old-final' })
    })

    const state = useInterviewStore.getState()
    expect(state.resumeOptResult).toBe('new-final')
    expect(state.resumeOptStreaming).toBe('')
    expect(state.resumeOptLoading).toBe(false)
  })
})
