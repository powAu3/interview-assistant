import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInterviewStore } from './configStore'


describe('configStore answer streaming', () => {
  beforeEach(() => {
    useInterviewStore.setState({
      qaPairs: [],
      streamingIds: [],
      currentStreamingId: null,
      transcriptions: [],
      isPaused: false,
    } as any)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('does not append buffered chunks after finalizeAnswer', async () => {
    const store = useInterviewStore.getState()

    store.startAnswer('qa-1', 'Redis 持久化讲一下')
    store.appendAnswerChunk('qa-1', '旧的流式片段')
    store.finalizeAnswer('qa-1', 'Redis 持久化讲一下', '最终答案')

    await vi.advanceTimersByTimeAsync(80)

    const qa = useInterviewStore.getState().qaPairs[0]
    expect(qa.answer).toBe('最终答案')
  })

  it('ignores late chunks after an answer reaches a terminal state', async () => {
    const store = useInterviewStore.getState()

    store.startAnswer('qa-done', '介绍 Redis')
    store.finalizeAnswer('qa-done', '介绍 Redis', '最终答案', '最终思考')
    store.appendThinkChunk('qa-done', '迟到思考')
    store.appendAnswerChunk('qa-done', '迟到答案')

    store.startAnswer('qa-cancelled', '介绍索引')
    store.cancelAnswer('qa-cancelled')
    store.appendThinkChunk('qa-cancelled', '迟到思考')
    store.appendAnswerChunk('qa-cancelled', '迟到答案')

    store.startAnswer('qa-error', '介绍事务')
    store.errorAnswer('qa-error', '生成失败')
    store.appendThinkChunk('qa-error', '迟到思考')
    store.appendAnswerChunk('qa-error', '迟到答案')

    await vi.advanceTimersByTimeAsync(80)

    const state = useInterviewStore.getState()
    expect(state.streamingIds).toEqual([])
    expect(state.qaPairs).toMatchObject([
      {
        id: 'qa-done',
        answer: '最终答案',
        thinkContent: '最终思考',
        isThinking: false,
        status: 'done',
      },
      {
        id: 'qa-cancelled',
        answer: '',
        thinkContent: '',
        isThinking: false,
        status: 'cancelled',
      },
      {
        id: 'qa-error',
        answer: '',
        thinkContent: '',
        isThinking: false,
        status: 'error',
        errorMessage: '生成失败',
      },
    ])
  })
})

describe('configStore toast queue', () => {
  beforeEach(() => {
    useInterviewStore.setState({ toastMessage: null, toasts: [] } as any)
  })

  it('clearing the legacy toast message does not clear stacked toasts', () => {
    const store = useInterviewStore.getState()

    store.setToastMessage('旧提示')
    store.pushToast('新提示', 'success')
    store.setToastMessage(null)

    const state = useInterviewStore.getState()
    expect(state.toastMessage).toBeNull()
    expect(state.toasts.map((toast) => toast.message)).toEqual(['旧提示', '新提示'])
  })
})

describe('configStore transcription windows', () => {
  beforeEach(() => {
    useInterviewStore.setState({
      transcriptions: [],
      candidateTranscriptions: [],
    } as any)
  })

  it('keeps interviewer transcriptions bounded for long sessions', () => {
    const store = useInterviewStore.getState()

    for (let i = 0; i < 205; i += 1) {
      store.addTranscription(`question ${i}`)
    }

    const state = useInterviewStore.getState()
    expect(state.transcriptions).toHaveLength(200)
    expect(state.transcriptions[0]).toBe('question 5')
    expect(state.transcriptions[199]).toBe('question 204')
  })

  it('keeps candidate transcriptions bounded while preserving segment replacement', () => {
    const store = useInterviewStore.getState()

    for (let i = 0; i < 205; i += 1) {
      store.addCandidateTranscription(`candidate ${i}`, { segmentId: `seg-${i}` })
    }

    let state = useInterviewStore.getState()
    expect(state.candidateTranscriptions).toHaveLength(200)
    expect(state.candidateTranscriptions[0]).toBe('candidate 5')

    store.addCandidateTranscription('candidate 5 revised', { segmentId: 'seg-5' })

    state = useInterviewStore.getState()
    expect(state.candidateTranscriptions).toHaveLength(200)
    expect(state.candidateTranscriptions[0]).toBe('candidate 5 revised')
    expect(state.candidateTranscriptions[199]).toBe('candidate 204')
  })

  it('caps restored session transcriptions on init', () => {
    const store = useInterviewStore.getState()

    store.setInitData({
      transcriptions: Array.from({ length: 205 }, (_, i) => `question ${i}`),
      candidate_answer_segments: Array.from({ length: 205 }, (_, i) => ({
        text: `candidate ${i}`,
        segment_id: `seg-${i}`,
      })),
      qa_pairs: [],
    })

    const state = useInterviewStore.getState()
    expect(state.transcriptions).toHaveLength(200)
    expect(state.transcriptions[0]).toBe('question 5')
    expect(state.candidateTranscriptions).toHaveLength(200)
    expect(state.candidateTranscriptions[0]).toBe('candidate 5')
  })

  it('restores screenshot self-check results from session init data', () => {
    const store = useInterviewStore.getState()

    store.setInitData({
      transcriptions: [],
      candidate_answer_segments: [],
      qa_pairs: [{
        id: 'qa-screen',
        question: '截图题',
        answer: '答案',
        timestamp: 1710000000,
        source: 'server_screen_multi',
        model_name: 'Lite Ark',
        vision_verify: {
          verdict: 'FAIL',
          reason: '第二张截图里的样例不通过',
        },
      }],
    })

    const qa = useInterviewStore.getState().qaPairs[0]
    expect(qa.questionSource).toBe('server_screen_multi')
    expect(qa.modelLabel).toBe('Lite Ark')
    expect(qa.visionVerify).toEqual({
      verdict: 'FAIL',
      reason: '第二张截图里的样例不通过',
    })
  })
})
