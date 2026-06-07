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
