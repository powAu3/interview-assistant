import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnswerPanel from './AnswerPanel'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

vi.mock('./SoundTest', () => ({ default: () => <div>sound-test-ready</div> }))
vi.mock('./WrittenExamTest', () => ({ default: () => <div>written-exam-test-ready</div> }))

function resetStores(writtenExamMode = false) {
  useInterviewStore.setState({
    isRecording: false,
    isPaused: false,
    qaPairs: [],
    streamingIds: [],
    currentStreamingId: null,
    config: {
      api_key_set: true,
      written_exam_mode: writtenExamMode,
      models: [{ name: 'Lite Ark', enabled: true, supports_vision: true, supports_think: true }],
      active_model: 0,
      answer_autoscroll_bottom_px: 40,
    },
    toggleSettings: vi.fn(),
  } as any)
  useUiPrefsStore.setState({
    answerPanelLayout: 'cards',
    colorScheme: 'aurora',
  } as any)
}

describe('AnswerPanel empty recording state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStores(false)
  })

  it('hides the sound preflight panel while interview recording is active', async () => {
    render(<AnswerPanel />)

    expect(await screen.findByText('sound-test-ready')).toBeInTheDocument()

    act(() => {
      useInterviewStore.getState().setRecording(true)
    })

    await waitFor(() => {
      expect(screen.queryByText('sound-test-ready')).not.toBeInTheDocument()
    })

    act(() => {
      useInterviewStore.getState().setRecording(false)
    })

    expect(await screen.findByText('sound-test-ready')).toBeInTheDocument()
  })

  it('hides the written exam preflight panel while exam recording is active', async () => {
    resetStores(true)
    render(<AnswerPanel />)

    expect(await screen.findByText('written-exam-test-ready')).toBeInTheDocument()

    act(() => {
      useInterviewStore.getState().setRecording(true)
    })

    await waitFor(() => {
      expect(screen.queryByText('written-exam-test-ready')).not.toBeInTheDocument()
    })
  })

  it('labels realtime and multi-screenshot answer sources', async () => {
    resetStores(false)
    useInterviewStore.setState({
      qaPairs: [
        {
          id: 'qa-asr',
          question: 'Redis 怎么持久化？',
          answer: 'AOF 和 RDB 组合。',
          thinkContent: '',
          isThinking: false,
          timestamp: 1710000000,
          questionSource: 'asr',
          modelLabel: 'Lite Ark',
          status: 'done',
        },
        {
          id: 'qa-screen',
          question: '两张截图里的代码题怎么修？',
          answer: '```python\nprint("ok")\n```',
          thinkContent: '',
          isThinking: false,
          timestamp: 1710000001,
          questionSource: 'server_screen_multi',
          modelLabel: 'Lite Ark',
          status: 'done',
        },
      ],
      streamingIds: [],
    } as any)

    render(<AnswerPanel />)

    expect(screen.getByText('实时转写')).toBeInTheDocument()
    expect(screen.getByText('连续截图审题')).toBeInTheDocument()
  })

  it('starts auto-follow when the first answer arrives after an empty state', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(280)

    try {
      render(<AnswerPanel />)

      act(() => {
        useInterviewStore.setState({
          qaPairs: [{
            id: 'qa-first',
            question: '第一道题',
            answer: '正在生成',
            thinkContent: '',
            isThinking: false,
            timestamp: Date.now(),
            status: 'streaming',
          }],
          streamingIds: ['qa-first'],
        } as any)
      })

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        })
      } else {
        delete (Element.prototype as any).scrollIntoView
      }
      scrollHeightSpy.mockRestore()
      clientHeightSpy.mockRestore()
    }
  })
})
