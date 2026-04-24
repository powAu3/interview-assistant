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
  const playbackAbortRef = useRef<AbortController | null>(null)
  const playbackRunRef = useRef(0)
  const argsRef = useRef(args)
  argsRef.current = args

  const cancelActivePlayback = () => {
    playbackRunRef.current += 1
    playbackAbortRef.current?.abort()
    playbackAbortRef.current = null
    argsRef.current.setPracticeTtsSpeaking(false)
    setTtsPlaybackSource('idle')
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    if (!args.currentTurn) {
      cancelActivePlayback()
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
    const currentTurn = args.currentTurn
    if (!currentTurn) return
    if (args.isWrittenPromptMode) {
      playbackAbortRef.current?.abort()
      playbackAbortRef.current = null
      spokenTurnRef.current = currentTurn.turn_id
      argsRef.current.setPracticeTtsSpeaking(false)
      setTtsPlaybackSource('idle')
      return
    }
    if (spokenTurnRef.current === currentTurn.turn_id) return
    playbackAbortRef.current?.abort()
    const abortController = new AbortController()
    playbackAbortRef.current = abortController
    const runId = playbackRunRef.current + 1
    playbackRunRef.current = runId
    const isCurrentRun = () => playbackRunRef.current === runId && !abortController.signal.aborted
    const latestArgs = () => argsRef.current
    spokenTurnRef.current = currentTurn.turn_id
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined

    const maybeArmVoiceAnswer = async () => {
      const beforeDelayArgs = latestArgs()
      if (
        !isCurrentRun()
        || !beforeDelayArgs.canSpeakAnswer
        || beforeDelayArgs.practiceRecording
        || !beforeDelayArgs.sttLoaded
      ) return
      await new Promise((resolve) => window.setTimeout(resolve, PRACTICE_TTS_TO_RECORDING_GAP_MS))
      const afterDelayArgs = latestArgs()
      if (
        !isCurrentRun()
        || !afterDelayArgs.canSpeakAnswer
        || afterDelayArgs.practiceRecording
        || !afterDelayArgs.sttLoaded
      ) return
      await afterDelayArgs.startRecording()
    }

    const run = async () => {
      const runArgs = latestArgs()
      const provider = runArgs.config?.practice_tts_provider ?? 'edge_tts'
      const preferredSpeaker =
        runArgs.voiceGender === 'male'
          ? runArgs.config?.practice_tts_speaker_male
          : runArgs.voiceGender === 'female'
            ? runArgs.config?.practice_tts_speaker_female
            : undefined
      const promptText = currentTurn.prompt_script || currentTurn.question || ''
      let ok = false
      if (provider === 'volcengine' || provider === 'edge_tts') {
        try {
          const cloud = await runArgs.api.practiceTts({
            text: promptText,
            preferred_gender: runArgs.voiceGender,
            speaker: preferredSpeaker,
          })
          ok = await playBase64Audio({
            audioBase64: cloud.audio_base64,
            contentType: cloud.content_type,
            onStart: () => {
              if (!isCurrentRun()) return
              latestArgs().setPracticeTtsSpeaking(true)
              setTtsPlaybackSource(provider === 'edge_tts' ? 'edge_tts' : 'volcengine')
            },
            onEnd: () => {
              if (!isCurrentRun()) return
              latestArgs().setPracticeTtsSpeaking(false)
              setTtsPlaybackSource('idle')
            },
            onError: () => {
              if (!isCurrentRun()) return
              latestArgs().setPracticeTtsSpeaking(false)
            },
            signal: abortController.signal,
          })
        } catch {
          ok = false
        }
      }
      if (!ok && isCurrentRun() && window.electronAPI?.synthesizeSystemTts) {
        try {
          const system = await window.electronAPI.synthesizeSystemTts({
            text: normalizePracticeTtsText(promptText),
            voiceName: latestArgs().resolvedDesktopVoiceName,
            rate: 185,
          })
          ok = await playBase64Audio({
            audioBase64: system.audio_base64,
            contentType: system.content_type,
            onStart: () => {
              if (!isCurrentRun()) return
              latestArgs().setPracticeTtsSpeaking(true)
              setTtsPlaybackSource('system')
            },
            onEnd: () => {
              if (!isCurrentRun()) return
              latestArgs().setPracticeTtsSpeaking(false)
              setTtsPlaybackSource('idle')
            },
            onError: () => {
              if (!isCurrentRun()) return
              latestArgs().setPracticeTtsSpeaking(false)
            },
            signal: abortController.signal,
          })
        } catch {
          ok = false
        }
      }
      if (!ok && isCurrentRun()) {
        const browserArgs = latestArgs()
        ok = await speakWithBrowserTts({
          text: promptText,
          synthesis,
          preferredGender: browserArgs.voiceGender,
          selectedVoiceURI: browserArgs.selectedVoiceURI,
          onStart: () => {
            if (!isCurrentRun()) return
            latestArgs().setPracticeTtsSpeaking(true)
            setTtsPlaybackSource('browser')
          },
          onEnd: () => {
            if (!isCurrentRun()) return
            latestArgs().setPracticeTtsSpeaking(false)
            setTtsPlaybackSource('idle')
          },
          onError: () => {
            if (!isCurrentRun()) return
            latestArgs().setPracticeTtsSpeaking(false)
          },
        })
      }
      if (!ok && isCurrentRun()) {
        latestArgs().setPracticeTtsSpeaking(false)
        setTtsPlaybackSource('idle')
      }
      await maybeArmVoiceAnswer()
    }

    void run()
    return () => {
      abortController.abort()
      if (playbackAbortRef.current === abortController) {
        playbackAbortRef.current = null
      }
    }
  }, [args.currentTurn?.turn_id, args.isWrittenPromptMode])

  const resetPlaybackState = () => {
    spokenTurnRef.current = null
    cancelActivePlayback()
  }

  return {
    ttsPlaybackSource,
    resetPlaybackState,
  }
}
