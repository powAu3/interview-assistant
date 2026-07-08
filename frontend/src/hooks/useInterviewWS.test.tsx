import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInterviewWS } from './useInterviewWS'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

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
      sttActiveProvider: '',
      sttFallbackLoaded: false,
      modelHealth: {},
      modelHealthDetail: {},
      modelHealthLatency: {},
      tokenUsage: { prompt: 0, completion: 0, total: 0, byModel: {} },
      resumeOptLoading: false,
      resumeOptStreaming: '',
      resumeOptResult: '',
      resumeOptJobId: null,
      toastMessage: null,
      toasts: [],
      lastWSError: null,
    } as any)
    useUiPrefsStore.setState({ appMode: 'assist' } as any)
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

  it('warns when candidate microphone degrades safely', () => {
    render(<Harness />)
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.emitOpen()
      ws.emitMessage({
        type: 'candidate_asr_status',
        loaded: false,
        loading: false,
        provider: 'off',
        error: 'mic unavailable',
        safe_degraded: true,
      })
    })

    const state = useInterviewStore.getState()
    expect(state.candidateSttLoaded).toBe(false)
    expect(state.toastMessage).toContain('候选人口述记录已关闭，不影响面试录音')
  })

  it('warns immediately when screenshot self-check fails', () => {
    render(<Harness />)
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.emitOpen()
      ws.emitMessage({
        type: 'answer_start',
        id: 'qa-screen',
        question: '多图截图代码题',
        source: 'server_screen_multi',
        model_name: 'Lite Ark',
      })
      ws.emitMessage({
        type: 'answer_done',
        id: 'qa-screen',
        question: '多图截图代码题',
        answer: '```python\nprint(0)\n```',
        think: '',
        model_name: 'Lite Ark',
      })
      ws.emitMessage({
        type: 'vision_verify',
        id: 'qa-screen',
        verdict: 'FAIL',
        reason: '截图里的第二个样例不通过',
      })
    })

    const state = useInterviewStore.getState()
    expect(state.qaPairs[0].visionVerify).toEqual({
      verdict: 'FAIL',
      reason: '截图里的第二个样例不通过',
    })
    expect(state.toasts[state.toasts.length - 1]).toMatchObject({
      level: 'warn',
      message: '截图自检不一致，请人工复核：截图里的第二个样例不通过',
      ttlMs: 6000,
    })
  })

  it('keeps successful screenshot self-check quiet', () => {
    render(<Harness />)
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.emitOpen()
      ws.emitMessage({
        type: 'answer_start',
        id: 'qa-screen',
        question: '截图代码题',
        source: 'server_screen_left',
        model_name: 'Lite Ark',
      })
      ws.emitMessage({
        type: 'vision_verify',
        id: 'qa-screen',
        verdict: 'PASS',
        reason: '样例与约束匹配',
      })
    })

    const state = useInterviewStore.getState()
    expect(state.qaPairs[0].visionVerify).toEqual({
      verdict: 'PASS',
      reason: '样例与约束匹配',
    })
    expect(state.toasts).toEqual([])
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

  it('keeps scoped module state updates when another app tab is active', () => {
    useUiPrefsStore.setState({ appMode: 'assist' } as any)
    render(<Harness />)
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.emitOpen()
      ws.emitMessage({ type: 'resume_opt_start', scope: 'resume-opt', job_id: 'job-bg' })
      ws.emitMessage({ type: 'resume_opt_chunk', scope: 'resume-opt', job_id: 'job-bg', chunk: '后台分析' })
      ws.emitMessage({ type: 'resume_opt_done', scope: 'resume-opt', job_id: 'job-bg', text: '后台分析完成' })
    })

    const state = useInterviewStore.getState()
    expect(state.resumeOptResult).toBe('后台分析完成')
    expect(state.resumeOptLoading).toBe(false)
  })
})
