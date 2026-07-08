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
})
