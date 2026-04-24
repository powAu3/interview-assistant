import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePracticeTurnPlayback } from './usePracticeTurnPlayback'
import type { PracticeTurn } from '@/stores/slices/types'

const baseTurn: PracticeTurn = {
  turn_id: 'turn-1',
  phase_id: 'project',
  phase_label: '项目深挖',
  category: 'project',
  answer_mode: 'voice',
  question: '讲讲你做过的高并发接口优化。',
  prompt_script: '讲讲你做过的高并发接口优化。',
  asked_at: Date.now(),
  follow_up_of: null,
  transcript: '',
  code_text: '',
  duration_ms: 0,
}

interface HarnessProps {
  api: {
    practiceTts: (payload: { text: string; preferred_gender?: 'auto' | 'female' | 'male'; speaker?: string }) => Promise<{
      audio_base64: string
      content_type: string
    }>
  }
  canSpeakAnswer?: boolean
  currentTurn?: PracticeTurn | null
  onReady?: (playback: ReturnType<typeof usePracticeTurnPlayback>) => void
  startRecording?: () => Promise<void>
}

function Harness(props: HarnessProps) {
  const playback = usePracticeTurnPlayback({
    api: props.api,
    canSpeakAnswer: props.canSpeakAnswer ?? true,
    config: { practice_tts_provider: 'edge_tts' },
    currentTurn: props.currentTurn ?? baseTurn,
    isReportStage: false,
    isWrittenPromptMode: false,
    practiceRecording: false,
    resolvedDesktopVoiceName: '',
    selectedVoiceURI: '',
    setPracticeElapsedMs: vi.fn(),
    setPracticeTtsSpeaking: vi.fn(),
    startRecording: props.startRecording ?? vi.fn(),
    sttLoaded: true,
    voiceGender: 'female',
  })
  props.onReady?.(playback)
  return null
}

function installBrowserSpeechMock() {
  const speak = vi.fn((utterance: SpeechSynthesisUtterance) => {
    window.setTimeout(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent), 0)
  })
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      cancel: vi.fn(),
      getVoices: () => [
        {
          default: false,
          lang: 'zh-CN',
          localService: true,
          name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)',
          voiceURI: 'female',
        },
      ],
      speak,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = ''
      onend: ((event: SpeechSynthesisEvent) => void) | null = null
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null
      onstart: ((event: SpeechSynthesisEvent) => void) | null = null
      pitch = 1
      rate = 1
      text: string
      voice: SpeechSynthesisVoice | null = null

      constructor(text: string) {
        this.text = text
      }
    },
  )
  return { speak }
}

describe('usePracticeTurnPlayback', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('falls back to browser speech when cloud TTS fails', async () => {
    const { speak } = installBrowserSpeechMock()
    const api = {
      practiceTts: vi.fn().mockRejectedValueOnce(new Error('edge unavailable')),
    }

    render(<Harness api={api} />)

    await waitFor(() => expect(api.practiceTts).toHaveBeenCalled())
    await waitFor(() => expect(speak).toHaveBeenCalled())
  })

  it('does not auto-start recording after reset cancels an in-flight TTS turn', async () => {
    vi.useFakeTimers()
    type FakeAudioHandle = {
      onended: (() => void) | null
      onerror: (() => void) | null
      onplay: (() => void) | null
      pause: ReturnType<typeof vi.fn>
      play: ReturnType<typeof vi.fn>
      removeAttribute: ReturnType<typeof vi.fn>
      src: string
    }
    let createdAudio: FakeAudioHandle | null = null
    vi.stubGlobal(
      'Audio',
      class {
        onended: (() => void) | null = null
        onerror: (() => void) | null = null
        onplay: (() => void) | null = null
        pause = vi.fn()
        play = vi.fn(() => {
          this.onplay?.()
          return Promise.resolve()
        })
        removeAttribute = vi.fn()
        src = ''

        constructor(src: string) {
          this.src = src
          createdAudio = this
        }
      },
    )
    const api = {
      practiceTts: vi.fn().mockResolvedValue({
        audio_base64: 'ZmFrZQ==',
        content_type: 'audio/mpeg',
      }),
    }
    const startRecording = vi.fn().mockResolvedValue(undefined)
    let playback: ReturnType<typeof usePracticeTurnPlayback> | null = null

    render(<Harness api={api} startRecording={startRecording} onReady={(next) => { playback = next }} />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(createdAudio).not.toBeNull()

    act(() => {
      playback?.resetPlaybackState()
      createdAudio!.onended?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(startRecording).not.toHaveBeenCalled()
  })

  it('keeps in-flight cloud TTS alive across unrelated rerenders', async () => {
    type FakeAudioHandle = {
      onended: (() => void) | null
      onerror: (() => void) | null
      onplay: (() => void) | null
      pause: ReturnType<typeof vi.fn>
      play: ReturnType<typeof vi.fn>
      removeAttribute: ReturnType<typeof vi.fn>
      src: string
    }
    let createdAudio: FakeAudioHandle | null = null
    vi.stubGlobal(
      'Audio',
      class {
        onended: (() => void) | null = null
        onerror: (() => void) | null = null
        onplay: (() => void) | null = null
        pause = vi.fn()
        play = vi.fn(() => {
          this.onplay?.()
          return Promise.resolve()
        })
        removeAttribute = vi.fn()
        src = ''

        constructor(src: string) {
          this.src = src
          createdAudio = this
        }
      },
    )
    const api = {
      practiceTts: vi.fn().mockResolvedValue({
        audio_base64: 'ZmFrZQ==',
        content_type: 'audio/mpeg',
      }),
    }

    const { rerender } = render(<Harness api={api} canSpeakAnswer={false} startRecording={vi.fn()} />)

    await waitFor(() => expect(createdAudio).not.toBeNull())
    expect(createdAudio!.pause).not.toHaveBeenCalled()

    rerender(<Harness api={api} canSpeakAnswer={false} startRecording={vi.fn()} />)

    expect(createdAudio!.pause).not.toHaveBeenCalled()
    act(() => {
      createdAudio!.onended?.()
    })
  })
})
