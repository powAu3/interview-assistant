import { useEffect, useRef, useState } from 'react'

import {
  IDLE_VIRTUAL_INTERVIEWER_SPEECH_SIGNAL,
  type VirtualInterviewerSpeechSignal,
} from '@/components/practice/virtualInterviewerState'
import {
  normalizePracticeTtsText,
  playBase64Audio,
  speakWithBrowserTts,
  type PracticeVoiceGender,
} from '@/lib/practiceTts'
import type { PracticeTurn } from '@/stores/slices/types'

const PRACTICE_TTS_TO_RECORDING_GAP_MS = 180
const ZERO_SPEECH_SIGNAL = IDLE_VIRTUAL_INTERVIEWER_SPEECH_SIGNAL

interface UsePracticeTurnPlaybackArgs {
  canSpeakAnswer: boolean
  config?: {
    practice_tts_provider?: string
    edge_tts_voice_female?: string
    edge_tts_voice_male?: string
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
  const [speechSignal, setSpeechSignal] = useState<VirtualInterviewerSpeechSignal>(ZERO_SPEECH_SIGNAL)
  const turnStartRef = useRef<number | null>(null)
  const spokenTurnRef = useRef<string | null>(null)
  const playbackAbortRef = useRef<AbortController | null>(null)
  const speechDriverStopRef = useRef<(() => void) | null>(null)
  const playbackRunRef = useRef(0)
  const argsRef = useRef(args)
  argsRef.current = args

  const stopSpeechDriver = () => {
    speechDriverStopRef.current?.()
    speechDriverStopRef.current = null
    setSpeechSignal(ZERO_SPEECH_SIGNAL)
  }

  const cancelActivePlayback = () => {
    playbackRunRef.current += 1
    playbackAbortRef.current?.abort()
    playbackAbortRef.current = null
    stopSpeechDriver()
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
      stopSpeechDriver()
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
    const beginSyntheticSpeechSignal = (text: string) => {
      stopSpeechDriver()
      speechDriverStopRef.current = createSyntheticSpeechDriver(text, (next) => {
        if (!isCurrentRun()) return
        setSpeechSignal(next)
      })
    }
    const beginAudioSpeechSignal = (audio: HTMLAudioElement) => {
      stopSpeechDriver()
      speechDriverStopRef.current = createAudioSpeechDriver(audio, (next) => {
        if (!isCurrentRun()) return
        setSpeechSignal(next)
      })
    }
    const resetVisualSpeech = () => {
      stopSpeechDriver()
    }

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
      const maleSpeaker = provider === 'edge_tts'
        ? runArgs.config?.edge_tts_voice_male
        : runArgs.config?.practice_tts_speaker_male
      const femaleSpeaker = provider === 'edge_tts'
        ? runArgs.config?.edge_tts_voice_female
        : runArgs.config?.practice_tts_speaker_female
      const preferredSpeaker =
        runArgs.voiceGender === 'male'
          ? maleSpeaker
          : runArgs.voiceGender === 'female'
            ? femaleSpeaker
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
              setSpeechSignal({
                active: true,
                energy: 0.32,
                mouthOpen: 0.24,
                speakingElapsedMs: 0,
              })
              latestArgs().setPracticeTtsSpeaking(true)
              setTtsPlaybackSource(provider === 'edge_tts' ? 'edge_tts' : 'volcengine')
            },
            onEnd: () => {
              if (!isCurrentRun()) return
              resetVisualSpeech()
              latestArgs().setPracticeTtsSpeaking(false)
              setTtsPlaybackSource('idle')
            },
            onError: () => {
              if (!isCurrentRun()) return
              resetVisualSpeech()
              latestArgs().setPracticeTtsSpeaking(false)
            },
            onAudio: beginAudioSpeechSignal,
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
              setSpeechSignal({
                active: true,
                energy: 0.32,
                mouthOpen: 0.24,
                speakingElapsedMs: 0,
              })
              latestArgs().setPracticeTtsSpeaking(true)
              setTtsPlaybackSource('system')
            },
            onEnd: () => {
              if (!isCurrentRun()) return
              resetVisualSpeech()
              latestArgs().setPracticeTtsSpeaking(false)
              setTtsPlaybackSource('idle')
            },
            onError: () => {
              if (!isCurrentRun()) return
              resetVisualSpeech()
              latestArgs().setPracticeTtsSpeaking(false)
            },
            onAudio: beginAudioSpeechSignal,
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
            beginSyntheticSpeechSignal(promptText)
            latestArgs().setPracticeTtsSpeaking(true)
            setTtsPlaybackSource('browser')
          },
          onEnd: () => {
            if (!isCurrentRun()) return
            resetVisualSpeech()
            latestArgs().setPracticeTtsSpeaking(false)
            setTtsPlaybackSource('idle')
          },
          onError: () => {
            if (!isCurrentRun()) return
            resetVisualSpeech()
            latestArgs().setPracticeTtsSpeaking(false)
          },
        })
      }
      if (!ok && isCurrentRun()) {
        resetVisualSpeech()
        latestArgs().setPracticeTtsSpeaking(false)
        setTtsPlaybackSource('idle')
      }
      await maybeArmVoiceAnswer()
    }

    void run()
    return () => {
      abortController.abort()
      stopSpeechDriver()
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
    speechSignal,
    resetPlaybackState,
  }
}

function createAudioSpeechDriver(
  audio: HTMLAudioElement,
  onSignal: (signal: VirtualInterviewerSpeechSignal) => void,
) {
  if (typeof window === 'undefined' || !(audio instanceof HTMLAudioElement)) {
    return createSyntheticSpeechDriver('', onSignal)
  }

  const AudioContextCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) {
    return createSyntheticSpeechDriver('', onSignal)
  }

  const audioContext = new AudioContextCtor()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.62

  let source: MediaElementAudioSourceNode | null = null
  try {
    source = audioContext.createMediaElementSource(audio)
    source.connect(analyser)
    analyser.connect(audioContext.destination)
  } catch {
    void audioContext.close().catch(() => undefined)
    return createSyntheticSpeechDriver('', onSignal)
  }

  const samples = new Uint8Array(analyser.fftSize)
  const startedAt = performance.now()
  let frame = 0
  let smoothedEnergy = 0
  let smoothedMouth = 0
  let lastEmit = 0
  let stopped = false

  const tick = (now: number) => {
    if (stopped) return
    analyser.getByteTimeDomainData(samples)
    let sum = 0
    let peak = 0
    for (const sample of samples) {
      const normalized = (sample - 128) / 128
      const abs = Math.abs(normalized)
      sum += normalized * normalized
      if (abs > peak) peak = abs
    }
    const rms = Math.sqrt(sum / samples.length)
    const rawEnergy = clamp01((rms - 0.018) * 7.4)
    const rawMouth = clamp01(rawEnergy * 1.22 + Math.max(0, peak - 0.09) * 1.1)
    smoothedEnergy = smoothedEnergy * 0.68 + rawEnergy * 0.32
    smoothedMouth = smoothedMouth * 0.54 + rawMouth * 0.46
    if (now - lastEmit > 32) {
      lastEmit = now
      onSignal({
        active: true,
        energy: smoothedEnergy,
        mouthOpen: smoothedMouth,
        speakingElapsedMs: now - startedAt,
      })
    }
    frame = window.requestAnimationFrame(tick)
  }

  void audioContext.resume().catch(() => undefined)
  frame = window.requestAnimationFrame(tick)

  return () => {
    stopped = true
    if (frame) window.cancelAnimationFrame(frame)
    try {
      source?.disconnect()
      analyser.disconnect()
    } catch {
      /* ignore */
    }
    void audioContext.close().catch(() => undefined)
  }
}

function createSyntheticSpeechDriver(
  text: string,
  onSignal: (signal: VirtualInterviewerSpeechSignal) => void,
) {
  if (typeof window === 'undefined') return () => undefined

  const startedAt = performance.now()
  const lengthBias = Math.min(1, Math.max(0.35, text.trim().length / 72))
  let frame = 0
  let stopped = false

  const tick = () => {
    if (stopped) return
    const elapsed = performance.now() - startedAt
    const time = elapsed / 1000
    const phrase = Math.max(0, Math.sin(time * 7.4) * 0.5 + Math.sin(time * 12.8 + 1.2) * 0.26 + 0.42)
    const consonant = Math.max(0, Math.sin(time * 23.7 + 0.8)) * 0.18
    const energy = clamp01((phrase + consonant) * (0.42 + lengthBias * 0.36))
    onSignal({
      active: true,
      energy,
      mouthOpen: clamp01(energy * 1.08 + consonant),
      speakingElapsedMs: elapsed,
    })
    frame = window.setTimeout(tick, 55)
  }

  tick()

  return () => {
    stopped = true
    if (frame) window.clearTimeout(frame)
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
