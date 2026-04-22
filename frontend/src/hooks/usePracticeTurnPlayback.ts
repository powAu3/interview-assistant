import { useEffect, useRef, useState } from 'react'

import {
  normalizePracticeTtsText,
  playBase64Audio,
  speakWithBrowserTts,
  type PracticeVoiceGender,
} from '@/lib/practiceTts'
import type { PracticeTurn } from '@/stores/slices/types'

const PRACTICE_TTS_TO_RECORDING_GAP_MS = 180

interface UsePracticeTurnPlaybackArgs {
  canSpeakAnswer: boolean
  config?: {
    practice_tts_provider?: string
    practice_tts_speaker_female?: string
    practice_tts_speaker_male?: string
  } | null
  currentTurn: PracticeTurn | null
  isReportStage: boolean
  isWrittenPromptMode: boolean
  practiceRecording: boolean
  setPracticeElapsedMs: (value: number) => void
  setPracticeTtsSpeaking: (value: boolean) => void
  startRecording: () => Promise<void>
  voiceGender: PracticeVoiceGender
  selectedVoiceURI: string
  resolvedDesktopVoiceName: string
  sttLoaded: boolean
  api: {
    practiceTts: (payload: { text: string; preferred_gender?: 'auto' | 'female' | 'male'; speaker?: string }) => Promise<{
      audio_base64: string
      content_type: string
    }>
  }
}

export function usePracticeTurnPlayback(args: UsePracticeTurnPlaybackArgs) {
  const [ttsPlaybackSource, setTtsPlaybackSource] = useState<'idle' | 'volcengine' | 'edge_tts' | 'system' | 'browser'>('idle')
  const turnStartRef = useRef<number | null>(null)
  const spokenTurnRef = useRef<string | null>(null)

  useEffect(() => {
    if (!args.currentTurn) {
      turnStartRef.current = null
      args.setPracticeElapsedMs(0)
      setTtsPlaybackSource('idle')
      return
    }
    turnStartRef.current = Date.now()
    args.setPracticeElapsedMs(0)
  }, [args.currentTurn?.turn_id, args.setPracticeElapsedMs])

  useEffect(() => {
    if (!turnStartRef.current || !args.currentTurn || args.isReportStage) return
    const timer = window.setInterval(() => {
      if (!turnStartRef.current) return
      args.setPracticeElapsedMs(Date.now() - turnStartRef.current)
    }, 200)
    return () => window.clearInterval(timer)
  }, [args.currentTurn?.turn_id, args.isReportStage, args.setPracticeElapsedMs])

  useEffect(() => {
    if (!args.currentTurn || spokenTurnRef.current === args.currentTurn.turn_id) return
    spokenTurnRef.current = args.currentTurn.turn_id
    if (args.isWrittenPromptMode) {
      args.setPracticeTtsSpeaking(false)
      setTtsPlaybackSource('idle')
      return
    }
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    const preferredSpeaker =
      args.voiceGender === 'male'
        ? args.config?.practice_tts_speaker_male
        : args.voiceGender === 'female'
          ? args.config?.practice_tts_speaker_female
          : undefined

    const maybeArmVoiceAnswer = async () => {
      if (!args.canSpeakAnswer || args.practiceRecording || !args.sttLoaded) return
      await new Promise((resolve) => window.setTimeout(resolve, PRACTICE_TTS_TO_RECORDING_GAP_MS))
      await args.startRecording()
    }

    const run = async () => {
      const provider = args.config?.practice_tts_provider ?? 'edge_tts'
      let ok = false
      if (provider === 'volcengine' || provider === 'edge_tts') {
        try {
          const cloud = await args.api.practiceTts({
            text: args.currentTurn?.prompt_script || args.currentTurn?.question || '',
            preferred_gender: args.voiceGender,
            speaker: preferredSpeaker,
          })
          ok = await playBase64Audio({
            audioBase64: cloud.audio_base64,
            contentType: cloud.content_type,
            onStart: () => {
              args.setPracticeTtsSpeaking(true)
              setTtsPlaybackSource(provider === 'edge_tts' ? 'edge_tts' : 'volcengine')
            },
            onEnd: () => {
              args.setPracticeTtsSpeaking(false)
              setTtsPlaybackSource('idle')
            },
            onError: () => args.setPracticeTtsSpeaking(false),
          })
        } catch {
          ok = false
        }
      }
      if (!ok && provider === 'local' && window.electronAPI?.synthesizeSystemTts) {
        try {
          const system = await window.electronAPI.synthesizeSystemTts({
            text: normalizePracticeTtsText(args.currentTurn?.prompt_script || args.currentTurn?.question || ''),
            voiceName: args.resolvedDesktopVoiceName,
            rate: 185,
          })
          ok = await playBase64Audio({
            audioBase64: system.audio_base64,
            contentType: system.content_type,
            onStart: () => {
              args.setPracticeTtsSpeaking(true)
              setTtsPlaybackSource('system')
            },
            onEnd: () => {
              args.setPracticeTtsSpeaking(false)
              setTtsPlaybackSource('idle')
            },
            onError: () => args.setPracticeTtsSpeaking(false),
          })
        } catch {
          ok = false
        }
      }
      if (!ok && provider === 'local') {
        ok = await speakWithBrowserTts({
          text: args.currentTurn?.prompt_script || args.currentTurn?.question || '',
          synthesis,
          preferredGender: args.voiceGender,
          selectedVoiceURI: args.selectedVoiceURI,
          onStart: () => {
            args.setPracticeTtsSpeaking(true)
            setTtsPlaybackSource('browser')
          },
          onEnd: () => {
            args.setPracticeTtsSpeaking(false)
            setTtsPlaybackSource('idle')
          },
          onError: () => args.setPracticeTtsSpeaking(false),
        })
      }
      if (!ok) {
        args.setPracticeTtsSpeaking(false)
        setTtsPlaybackSource('idle')
      }
      await maybeArmVoiceAnswer()
    }

    void run()
  }, [
    args.api,
    args.canSpeakAnswer,
    args.config?.practice_tts_provider,
    args.config?.practice_tts_speaker_female,
    args.config?.practice_tts_speaker_male,
    args.currentTurn,
    args.isWrittenPromptMode,
    args.practiceRecording,
    args.resolvedDesktopVoiceName,
    args.selectedVoiceURI,
    args.setPracticeTtsSpeaking,
    args.startRecording,
    args.sttLoaded,
    args.voiceGender,
  ])

  const resetPlaybackState = () => {
    spokenTurnRef.current = null
    setTtsPlaybackSource('idle')
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
    }
  }

  return {
    ttsPlaybackSource,
    resetPlaybackState,
  }
}
