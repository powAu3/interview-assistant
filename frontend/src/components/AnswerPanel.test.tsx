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
})
