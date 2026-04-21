import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Code2,
  Loader2,
  Mic,
  MicOff,
  RadioTower,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Upload,
  Volume2,
  Waves,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useShallow } from 'zustand/react/shallow'

import { api } from '@/lib/api'
import {
  normalizePracticeTtsText,
  pickPreferredVoice,
  playBase64Audio,
  speakWithBrowserTts,
  type PracticeVoiceGender,
} from '@/lib/practiceTts'
import { refreshConfig } from '@/lib/configSync'
import { useInterviewStore } from '@/stores/configStore'

const JD_STORAGE_KEY = 'ia-practice-jd-draft'
const VOICE_GENDER_STORAGE_KEY = 'ia-practice-voice-gender'
const VOICE_URI_STORAGE_KEY = 'ia-practice-voice-uri'
const INTERVIEWER_STYLE_STORAGE_KEY = 'ia-practice-interviewer-style'
const PRACTICE_TTS_TO_RECORDING_GAP_MS = 180

const INTERVIEWER_STYLE_OPTIONS = [
  { value: 'calm_pressing', label: '稳压型', hint: '礼貌但不放水，像常规技术一面。' },
  { value: 'supportive_senior', label: '带教型', hint: '更温和，会帮你起主线，但仍然追细节。' },
  { value: 'pressure_bigtech', label: '压力型', hint: '切题更快、追问更尖，偏大厂技术面。' },
] as const

type BrowserVoice = Pick<SpeechSynthesisVoice, 'voiceURI' | 'name' | 'lang'> & {
  source?: string
  genderHint?: string
}

function readStorage(key: string, fallback = ''): string {
  try {
    return window.localStorage?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage?.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function stageLabel(index: number, total: number) {
  return `${Math.min(index + 1, total)}/${total}`
}

function averageTurnScore(turns: Array<{ scorecard?: Record<string, number> }>) {
  const values = turns.flatMap((turn) => Object.values(turn.scorecard ?? {}))
  if (!values.length) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

function getPhaseGuidance(category?: string) {
  switch (category) {
    case 'behavioral':
    case 'opening':
      return {
        title: '开场别铺太满',
        body: '先给身份定位，再给岗位动机，最后补 1 个能立住你的代表项目。控制在 60-90 秒。',
      }
    case 'project':
      return {
        title: '项目题先讲 why',
        body: '不要直接堆细节。先交代业务背景和目标，再讲你的决策、验证方式，以及重做时会怎么改。',
      }
    case 'fundamentals':
      return {
        title: '八股要带边界',
        body: '答原理时尽量加一条线上边界或排障经验，避免听起来只是背定义。',
      }
    case 'design':
      return {
        title: '设计题先主流程',
        body: '先把核心链路讲清，再补容量、稳定性和取舍，不要一上来就铺大而全架构。',
      }
    case 'coding':
      return {
        title: '边写边解释',
        body: '先给主干实现，再补边界条件和索引/复杂度思路。面试官更在意你的取舍，不只是代码结果。',
      }
    default:
      return {
        title: '像真实面试一样说',
        body: '尽量用“结论 -> 过程 -> 验证 -> 结果”的节奏，把回答讲成真正能出口的版本。',
      }
  }
}

function InterviewerAvatar({
  speaking,
  listening,
}: {
  speaking: boolean
  listening: boolean
}) {
  return (
    <div className="relative h-44 w-44 shrink-0">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,245,232,0.95),rgba(221,227,238,0.55)_42%,rgba(18,33,55,0)_74%)]" />
      <div
        className={`absolute inset-4 rounded-full border transition-all duration-300 ${
          speaking
            ? 'border-[#c74f2e]/60 shadow-[0_0_40px_rgba(199,79,46,0.25)]'
            : listening
              ? 'border-[#335d88]/50 shadow-[0_0_30px_rgba(51,93,136,0.18)]'
              : 'border-[#64748b]/30'
        }`}
      />
      <div
        className={`absolute inset-10 rounded-full border transition-all duration-300 ${
          speaking ? 'border-[#16324f] bg-[#f3ede1]/90' : 'border-[#16324f]/40 bg-[#f7f4ec]/85'
        }`}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-[#10233a] text-[#f6efe4] shadow-[0_12px_40px_rgba(10,20,35,0.22)]">
          <Bot className="h-9 w-9" strokeWidth={1.7} />
          <span
            className={`absolute -bottom-2 h-3 w-12 rounded-full transition-all ${
              speaking
                ? 'animate-pulse bg-[#c74f2e]'
                : listening
                  ? 'bg-[#335d88]'
                  : 'bg-[#64748b]/60'
            }`}
          />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5">
        {[0.45, 0.72, 1, 0.72, 0.45].map((scale, index) => (
          <span
            key={index}
            className={`w-2 rounded-full transition-all duration-150 ${
              speaking ? 'bg-[#c74f2e]' : listening ? 'bg-[#335d88]' : 'bg-[#94a3b8]/70'
            }`}
            style={{
              height: `${speaking ? 16 + scale * 18 : listening ? 10 + scale * 8 : 8}px`,
              opacity: speaking ? 0.75 + scale * 0.2 : 0.55 + scale * 0.1,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default function PracticeMode() {
  const {
    config,
    devices,
    practiceStatus,
    practiceSession,
    practiceRecording,
    practiceAnswerDraft,
    practiceCodeDraft,
    practiceTtsSpeaking,
    practiceElapsedMs,
    sttLoaded,
    setPracticeAnswerDraft,
    setPracticeCodeDraft,
    setPracticeTtsSpeaking,
    setPracticeElapsedMs,
    resetPractice,
  } = useInterviewStore(
    useShallow((state) => ({
      config: state.config,
      devices: state.devices,
      practiceStatus: state.practiceStatus,
      practiceSession: state.practiceSession,
      practiceRecording: state.practiceRecording,
      practiceAnswerDraft: state.practiceAnswerDraft,
      practiceCodeDraft: state.practiceCodeDraft,
      practiceTtsSpeaking: state.practiceTtsSpeaking,
      practiceElapsedMs: state.practiceElapsedMs,
      sttLoaded: state.sttLoaded,
      setPracticeAnswerDraft: state.setPracticeAnswerDraft,
      setPracticeCodeDraft: state.setPracticeCodeDraft,
      setPracticeTtsSpeaking: state.setPracticeTtsSpeaking,
      setPracticeElapsedMs: state.setPracticeElapsedMs,
      resetPractice: state.resetPractice,
    })),
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMic, setSelectedMic] = useState<number | null>(null)
  const [jdDraft, setJdDraft] = useState(() => readStorage(JD_STORAGE_KEY))
  const [voiceGender, setVoiceGender] = useState<PracticeVoiceGender>(
    () => (readStorage(VOICE_GENDER_STORAGE_KEY, 'auto') as PracticeVoiceGender) || 'auto',
  )
  const [interviewerStyle, setInterviewerStyle] = useState(
    () => readStorage(INTERVIEWER_STYLE_STORAGE_KEY, 'calm_pressing'),
  )
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => readStorage(VOICE_URI_STORAGE_KEY))
  const [voices, setVoices] = useState<BrowserVoice[]>([])
  const [ttsPlaybackSource, setTtsPlaybackSource] = useState<'idle' | 'volcengine' | 'melo_local' | 'system' | 'browser'>('idle')
  const turnStartRef = useRef<number | null>(null)
  const spokenTurnRef = useRef<string | null>(null)

  const mics = useMemo(() => devices.filter((device) => !device.is_loopback), [devices])
  const currentTurn = practiceSession?.current_turn ?? null
  const phases = practiceSession?.blueprint?.phases ?? []
  const completedTurns = practiceSession?.turn_history ?? []
  const currentPhaseLabel = currentTurn?.phase_label ?? '模拟面试'
  const isFinished = practiceStatus === 'finished'
  const isIdle = practiceStatus === 'idle'
  const useEdgeTts = (config?.practice_tts_provider ?? 'edge_tts') === 'edge_tts'
  const selectedDesktopVoice = selectedVoiceURI.startsWith('say:')
    ? selectedVoiceURI.replace(/^say:/, '')
    : ''
  const autoPreferredLocalVoice = useMemo(
    () => pickPreferredVoice(voices, { preferredGender: voiceGender, selectedVoiceURI }) ?? null,
    [voices, voiceGender, selectedVoiceURI],
  )
  const resolvedDesktopVoiceName =
    selectedDesktopVoice
    || (autoPreferredLocalVoice?.voiceURI.startsWith('say:')
      ? autoPreferredLocalVoice.voiceURI.replace(/^say:/, '')
      : '')
  const isWrittenPromptMode = Boolean(
    currentTurn && (currentTurn.category === 'coding' || currentTurn.answer_mode === 'code' || currentTurn.answer_mode === 'voice+code'),
  )
  const canSpeakAnswer = Boolean(
    currentTurn && (currentTurn.answer_mode === 'voice' || currentTurn.answer_mode === 'voice+code'),
  )
  const phaseGuidance = getPhaseGuidance(currentTurn?.category)

  useEffect(() => {
    if (mics.length === 0) {
      setSelectedMic(null)
      return
    }
    if (selectedMic != null && mics.some((device) => device.id === selectedMic)) return
    setSelectedMic(mics[0].id)
  }, [mics, selectedMic])

  useEffect(() => {
    writeStorage(JD_STORAGE_KEY, jdDraft)
  }, [jdDraft])

  useEffect(() => {
    writeStorage(VOICE_GENDER_STORAGE_KEY, voiceGender)
  }, [voiceGender])

  useEffect(() => {
    writeStorage(INTERVIEWER_STYLE_STORAGE_KEY, interviewerStyle)
  }, [interviewerStyle])

  useEffect(() => {
    writeStorage(VOICE_URI_STORAGE_KEY, selectedVoiceURI)
  }, [selectedVoiceURI])

  useEffect(() => {
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    const loadDesktopVoices = async () => {
      try {
        const systemVoices = await window.electronAPI?.listSystemTtsVoices?.()
        if (systemVoices && systemVoices.length > 0) {
          setVoices(systemVoices)
          return true
        }
      } catch {
        /* ignore */
      }
      return false
    }

    void loadDesktopVoices().then((usedDesktop) => {
      if (usedDesktop || !synthesis) return
      const syncVoices = () => {
        const next = synthesis.getVoices().map((voice) => ({
          voiceURI: voice.voiceURI,
          name: voice.name,
          lang: voice.lang,
        }))
        setVoices(next)
      }

      syncVoices()
      synthesis.addEventListener?.('voiceschanged', syncVoices)
    })
    if (!synthesis) return
    const syncVoices = () => {
      const next = synthesis.getVoices().map((voice) => ({
        voiceURI: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
      }))
      setVoices((current) => (current.length > 0 ? current : next))
    }
    return () => synthesis.removeEventListener?.('voiceschanged', syncVoices)
  }, [])

  useEffect(() => {
    if (!currentTurn) {
      turnStartRef.current = null
      setPracticeElapsedMs(0)
      setTtsPlaybackSource('idle')
      return
    }
    turnStartRef.current = Date.now()
    setPracticeElapsedMs(0)
  }, [currentTurn?.turn_id, setPracticeElapsedMs])

  useEffect(() => {
    if (!turnStartRef.current || !currentTurn || isFinished) return
    const timer = window.setInterval(() => {
      if (!turnStartRef.current) return
      setPracticeElapsedMs(Date.now() - turnStartRef.current)
    }, 200)
    return () => window.clearInterval(timer)
  }, [currentTurn?.turn_id, isFinished, setPracticeElapsedMs])

  const startRecording = async () => {
    if (!sttLoaded) return
    if (!selectedMic && selectedMic !== 0) {
      setError('请选择麦克风设备')
      return
    }
    try {
      await api.practiceRecord('start', selectedMic)
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动录音失败')
    }
  }

  useEffect(() => {
    if (!currentTurn || spokenTurnRef.current === currentTurn.turn_id) return
    spokenTurnRef.current = currentTurn.turn_id
    if (isWrittenPromptMode) {
      setPracticeTtsSpeaking(false)
      setTtsPlaybackSource('idle')
      return
    }
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    const preferredSpeaker =
      voiceGender === 'male'
        ? config?.practice_tts_speaker_male
        : voiceGender === 'female'
          ? config?.practice_tts_speaker_female
          : undefined

    const maybeArmVoiceAnswer = async () => {
      if (!canSpeakAnswer || practiceRecording) return
      await new Promise((resolve) => window.setTimeout(resolve, PRACTICE_TTS_TO_RECORDING_GAP_MS))
      await startRecording()
    }

    const run = async () => {
      const provider = config?.practice_tts_provider ?? 'edge_tts'
      let ok = false
      if (provider === 'volcengine' || provider === 'melo_local') {
        try {
          const cloud = await api.practiceTts({
            text: currentTurn.prompt_script || currentTurn.question,
            preferred_gender: voiceGender,
            speaker: preferredSpeaker,
          })
          ok = await playBase64Audio({
            audioBase64: cloud.audio_base64,
            contentType: cloud.content_type,
            onStart: () => {
              setPracticeTtsSpeaking(true)
              setTtsPlaybackSource(provider === 'melo_local' ? 'melo_local' : 'volcengine')
            },
            onEnd: () => {
              setPracticeTtsSpeaking(false)
              setTtsPlaybackSource('idle')
            },
            onError: () => setPracticeTtsSpeaking(false),
          })
        } catch {
          ok = false
        }
      }
      if (!ok && provider === 'local' && window.electronAPI?.synthesizeSystemTts) {
        try {
          const system = await window.electronAPI.synthesizeSystemTts({
            text: normalizePracticeTtsText(currentTurn.prompt_script || currentTurn.question),
            voiceName: resolvedDesktopVoiceName,
            rate: 185,
          })
          ok = await playBase64Audio({
            audioBase64: system.audio_base64,
            contentType: system.content_type,
            onStart: () => {
              setPracticeTtsSpeaking(true)
              setTtsPlaybackSource('system')
            },
            onEnd: () => {
              setPracticeTtsSpeaking(false)
              setTtsPlaybackSource('idle')
            },
            onError: () => setPracticeTtsSpeaking(false),
          })
        } catch {
          ok = false
        }
      }
      if (!ok && provider === 'local') {
        ok = await speakWithBrowserTts({
          text: currentTurn.prompt_script || currentTurn.question,
          synthesis,
          preferredGender: voiceGender,
          selectedVoiceURI,
          onStart: () => {
            setPracticeTtsSpeaking(true)
            setTtsPlaybackSource('browser')
          },
          onEnd: () => {
            setPracticeTtsSpeaking(false)
            setTtsPlaybackSource('idle')
          },
          onError: () => setPracticeTtsSpeaking(false),
        })
      }
      if (!ok) {
        setPracticeTtsSpeaking(false)
        setTtsPlaybackSource('idle')
      }
      await maybeArmVoiceAnswer()
    }

    void run()
  }, [
    canSpeakAnswer,
    currentTurn,
    config?.practice_tts_provider,
    config?.practice_tts_speaker_female,
    config?.practice_tts_speaker_male,
    practiceRecording,
    selectedMic,
    selectedVoiceURI,
    resolvedDesktopVoiceName,
    isWrittenPromptMode,
    setPracticeTtsSpeaking,
    sttLoaded,
    voiceGender,
  ])

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.practiceGenerate({ jd_text: jdDraft.trim(), interviewer_style: interviewerStyle })
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!currentTurn) return
    if (!practiceAnswerDraft.trim() && !practiceCodeDraft.trim()) return
    setLoading(true)
    setError(null)
    try {
      await api.practiceSubmit({
        transcript: practiceAnswerDraft.trim(),
        code_text: practiceCodeDraft.trim(),
        answer_mode: currentTurn.answer_mode,
        duration_ms: practiceElapsedMs,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  const handleFinish = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.practiceFinish()
    } catch (err) {
      setError(err instanceof Error ? err.message : '结束失败')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    setError(null)
    spokenTurnRef.current = null
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
    }
    resetPractice()
    try {
      await api.practiceReset()
    } catch {
      /* ignore */
    }
  }

  const handleRecordToggle = async () => {
    if (practiceRecording) {
      try {
        await api.practiceRecord('stop')
      } catch {
        /* ignore */
      }
      return
    }
    await startRecording()
  }

  const averageScore = averageTurnScore(completedTurns)

  if (isIdle || practiceStatus === 'preparing') {
    return (
      <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#fbf8f0_0%,#f4efe3_46%,#efe6d6_100%)] text-[#122137]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 xl:grid xl:grid-cols-[1.05fr_0.95fr]">
          <section className="overflow-hidden rounded-[28px] border border-[#10233a]/10 bg-[linear-gradient(140deg,#fffaf1_0%,#f3ebdd_62%,#efe5d3_100%)] p-6 shadow-[0_24px_70px_rgba(16,35,58,0.10)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#10233a]/10 bg-white/65 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-[#335d88]">
                  <RadioTower className="h-3.5 w-3.5" />
                  Editorial Interview Booth
                </div>
                <h2
                  className="max-w-2xl text-[2.1rem] font-semibold leading-[1.05] tracking-[-0.04em] text-[#10233a] md:text-[3rem]"
                  style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' }}
                >
                  把“刷题器”换成一场真正会追问、会压场的模拟面试。
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[#42556c] md:text-[15px]">
                  题目不再是一列静态清单。面试官会根据你的简历、岗位 JD、当前回答和阶段目标动态推进，
                  结束后再统一复盘，不在中途打断你。
                </p>
              </div>
              <InterviewerAvatar speaking={practiceStatus === 'preparing'} listening={false} />
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                ['简历 + JD', '先看你投什么岗位，再决定切哪种题和追问。'],
                ['语音主链', '题目先播报，再自动轮到你回答，尽量保持现场感。'],
                ['整场复盘', '不再每题打断式点评，结束后给完整 debrief。'],
              ].map(([title, body]) => (
                <div key={title} className="rounded-2xl border border-[#10233a]/8 bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c74f2e]">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-[#42556c]">{body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-[#10233a]/10 bg-[#10233a] p-5 text-[#f5efe3] shadow-[0_24px_70px_rgba(16,35,58,0.16)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f3ede1]/12">
                <Sparkles className="h-5 w-5 text-[#f4b88a]" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[#8bb0d6]">Scene Setup</p>
                <p className="mt-1 text-sm text-[#e7dcc7]/90">先把这场面试的上下文和播报风格定下来。</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">
                  <span>目标岗位 JD</span>
                  <span>{jdDraft.length} chars</span>
                </div>
                <textarea
                  value={jdDraft}
                  onChange={(event) => setJdDraft(event.target.value)}
                  placeholder="粘贴目标岗位 JD，让问题更贴近真实岗位"
                  rows={7}
                  className="w-full resize-none rounded-2xl border border-white/10 bg-[#0d1d31] px-4 py-3 text-sm leading-6 text-[#f8f1e4] outline-none transition placeholder:text-[#8ca0b8] focus:border-[#f4b88a]/60"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">播报音色偏好</p>
                  {useEdgeTts ? (
                    <>
                      <div className="mt-3 rounded-2xl border border-[#f4b88a]/25 bg-[#f4b88a]/10 px-3 py-3 text-sm leading-6 text-[#f8f1e4]">
                        当前主方案是 EdgeTTS。它更轻，不需要本地大模型环境；英文专有词和男/女声音色也更容易调。
                      </div>
                      <p className="mt-3 text-xs leading-6 text-[#c5b79f]">
                        它是在线神经语音，适合先把体验和音色调顺；火山引擎仍然保留为云端备选。
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {([
                          ['auto', '自动'],
                          ['female', '女声'],
                          ['male', '男声'],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setVoiceGender(value)}
                            className={`rounded-full px-3 py-1.5 text-xs transition ${
                              voiceGender === value
                                ? 'bg-[#f4b88a] text-[#10233a]'
                                : 'border border-white/10 bg-transparent text-[#d9ccb6]'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-3 text-xs leading-6 text-[#c5b79f]">
                        云端方案后续只保留火山引擎 TTS；当前系统/browser 只做兜底。
                      </p>
                    </>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">面试官风格</p>
                  <div className="mt-3 grid gap-2">
                    {INTERVIEWER_STYLE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setInterviewerStyle(option.value)}
                        className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                          interviewerStyle === option.value
                            ? 'border-[#f4b88a]/50 bg-[#f4b88a]/10 text-[#f8f1e4]'
                            : 'border-white/10 bg-transparent text-[#d9ccb6]'
                        }`}
                      >
                        <div className="text-xs font-semibold uppercase tracking-[0.14em]">{option.label}</div>
                        <div className="mt-1 text-[11px] leading-5 text-[#c5b79f]">{option.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {!useEdgeTts && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">本机可用 voice</p>
                  <select
                    value={selectedVoiceURI}
                    onChange={(event) => setSelectedVoiceURI(event.target.value)}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0d1d31] px-3 py-3 text-sm text-[#f8f1e4] outline-none"
                    disabled={useEdgeTts}
                  >
                    <option value="">自动选择最合适的中文语音</option>
                    {voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} · {voice.lang}{voice.source === 'macos-say' ? ' · Desktop' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-3 text-xs leading-6 text-[#c5b79f]">
                    {useEdgeTts
                      ? 'EdgeTTS 作为主方案时，这里只保留兜底用的系统 voice。'
                      : '桌面端会优先枚举 macOS 系统 `say` 语音；没有时再退回浏览器 voice 列表。'}
                  </p>
                  {autoPreferredLocalVoice && (
                    <p className="mt-2 text-[11px] leading-5 text-[#9fb1c7]">
                      当前自动推荐：{autoPreferredLocalVoice.name}
                    </p>
                  )}
                </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-[#d9ccb6]">
                <div className="flex flex-wrap gap-4">
                  <span>岗位：{config?.position ?? '后端开发'}</span>
                  <span>语言：{config?.language ?? 'Python'}</span>
                  <span>候选人维度：{config?.practice_audience === 'social' ? '社招' : '校招/实习'}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-full bg-[#f4b88a] px-5 py-2.5 text-sm font-semibold text-[#10233a] transition hover:translate-y-[-1px] hover:bg-[#f6c298] disabled:opacity-50"
              >
                {practiceStatus === 'preparing' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在搭建面试现场...
                  </>
                ) : (
                  <>
                    <Waves className="h-4 w-4" />
                    开始真实模拟面试
                  </>
                )}
              </button>
              {!config?.has_resume && (
                <div className="rounded-full border border-[#f4b88a]/25 bg-[#f4b88a]/10 px-3 py-2 text-xs text-[#f6dcc0]">
                  建议先上传简历，这样项目深挖会更像真正的一面。
                </div>
              )}
            </div>
            {error && <p className="mt-4 text-sm text-[#ffcabd]">{error}</p>}
            {!config?.has_resume && <UploadResumeButton />}
          </section>
        </div>
      </div>
    )
  }

  if (isFinished) {
    return (
      <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f7f3ea_0%,#efe5d5_100%)] px-4 py-6 text-[#10233a] md:px-6">
        <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[0.72fr_1.28fr]">
          <aside className="rounded-[28px] border border-[#10233a]/10 bg-[#10233a] p-5 text-[#f6efe4] shadow-[0_22px_60px_rgba(16,35,58,0.16)]">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#8bb0d6]">Debrief</p>
            <h2
              className="mt-3 text-[2rem] leading-[1.05] tracking-[-0.04em]"
              style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' }}
            >
              这场模拟面试已经结束，现在看整场复盘。
            </h2>
            <div className="mt-6 grid gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[#8bb0d6]">总轮次</p>
                <p className="mt-2 text-2xl font-semibold text-[#f4b88a]">{completedTurns.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[#8bb0d6]">平均隐式评分</p>
                <p className="mt-2 text-2xl font-semibold text-[#f4b88a]">
                  {averageScore == null ? '—' : `${averageScore}/10`}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[#8bb0d6]">JD 命中背景</p>
                <p className="mt-2 text-sm leading-6 text-[#dbcdb8]">
                  {practiceSession?.context?.jd_text || '本轮未填写 JD，主要按岗位与简历推进。'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-[#f6efe4] transition hover:bg-white/8"
            >
              <RotateCcw className="h-4 w-4" />
              再来一场
            </button>
          </aside>

          <section className="rounded-[28px] border border-[#10233a]/10 bg-[linear-gradient(140deg,#fffaf1_0%,#f3ebdd_64%,#eee1ce_100%)] p-5 shadow-[0_22px_60px_rgba(16,35,58,0.10)]">
            <div className="flex flex-wrap gap-2">
              {completedTurns.map((turn) => (
                <span
                  key={turn.turn_id}
                  className="rounded-full border border-[#10233a]/10 bg-white/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#335d88]"
                >
                  {turn.phase_label}
                </span>
              ))}
            </div>
            {completedTurns.length > 0 && (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {completedTurns.map((turn, index) => (
                  <div key={turn.turn_id} className="rounded-2xl border border-[#10233a]/10 bg-white/65 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] uppercase tracking-[0.16em] text-[#335d88]">
                        Round {index + 1} · {turn.phase_label}
                      </span>
                      <span className="text-xs text-[#6a7c91]">{turn.decision || 'advance'}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#23384f]">{turn.question}</p>
                    {turn.transition_line && (
                      <p className="mt-2 text-[11px] leading-5 text-[#7c6b54]">{turn.transition_line}</p>
                    )}
                    {turn.scorecard && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Object.entries(turn.scorecard).map(([key, value]) => (
                          <span
                            key={key}
                            className="rounded-full border border-[#10233a]/8 bg-[#fffdf8] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#42556c]"
                          >
                            {key}: {value}/10
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="prose prose-sm mt-5 max-w-none text-[#23384f] prose-headings:text-[#10233a] prose-strong:text-[#10233a]">
              <ReactMarkdown>{practiceSession?.report_markdown || '暂无复盘输出。'}</ReactMarkdown>
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f7f3ea_0%,#efe4d1_100%)] px-4 py-5 text-[#10233a] md:px-6">
      <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <aside className="rounded-[28px] border border-[#10233a]/10 bg-[#10233a] p-5 text-[#f5efe2] shadow-[0_24px_70px_rgba(16,35,58,0.18)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#8bb0d6]">Interviewer Booth</p>
              <h2
                className="mt-3 text-[2rem] leading-[1.05] tracking-[-0.04em]"
                style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' }}
              >
                {currentPhaseLabel}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[#d9ccb6]">
                现在不是逐题打分训练，而是一场会自动推进的面试现场。
              </p>
              {currentTurn?.transition_line && (
                <p className="mt-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-xs leading-6 text-[#f2dfc3]">
                  {currentTurn.transition_line}
                </p>
              )}
            </div>
            <InterviewerAvatar
              speaking={practiceTtsSpeaking || practiceStatus === 'interviewer_speaking'}
              listening={practiceRecording || practiceStatus === 'awaiting_answer'}
            />
          </div>

          <div className="mt-6 rounded-[26px] border border-white/10 bg-white/6 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-[#f4b88a]/25 bg-[#f4b88a]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#f4c69e]">
                {currentTurn?.category ?? 'stage'}
              </span>
              <span className="text-xs text-[#8bb0d6]">
                {stageLabel(practiceSession?.current_phase_index ?? 0, phases.length || 1)}
              </span>
            </div>
            <p className="mt-4 text-[1.02rem] leading-8 text-[#f7f1e6]">{currentTurn?.question}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {phases.map((phase, index) => {
                const active = index === (practiceSession?.current_phase_index ?? 0)
                const done = index < (practiceSession?.current_phase_index ?? 0)
                return (
                  <span
                    key={`${phase.phase_id}-${index}`}
                    className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                      active
                        ? 'bg-[#f4b88a] text-[#10233a]'
                        : done
                          ? 'bg-white/14 text-[#f5efe2]'
                          : 'border border-white/10 text-[#8ea5bf]'
                    }`}
                  >
                    {phase.label}
                  </span>
                )
              })}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">播报状态</p>
              <div className="mt-3 flex items-center gap-3 text-sm text-[#f7f1e6]">
                <Volume2 className="h-4 w-4 text-[#f4b88a]" />
                {practiceTtsSpeaking ? '面试官正在播报问题' : '播报完成，等待你的回答'}
              </div>
              <div className="mt-2 text-xs text-[#cdbda5]">
                当前来源：
                {ttsPlaybackSource === 'volcengine'
                  ? ' 火山引擎 TTS'
                  : ttsPlaybackSource === 'melo_local'
                    ? ' MeloTTS 本地神经语音'
                  : ttsPlaybackSource === 'system'
                    ? ' 桌面系统语音'
                    : ttsPlaybackSource === 'browser'
                      ? ' 浏览器本地语音'
                      : config?.practice_tts_provider === 'volcengine'
                        ? ' 预设火山引擎，失败时静默展示题目'
                        : config?.practice_tts_provider === 'melo_local'
                          ? ' 实验态 MeloTTS，未就绪时静默展示题目'
                          : ' 无播报'}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">当前答题策略</p>
              <p className="mt-3 text-sm font-medium text-[#f7f1e6]">{phaseGuidance.title}</p>
              <p className="mt-2 text-xs leading-6 text-[#cdbda5]">{phaseGuidance.body}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">作答时长</p>
              <div className="mt-3 text-2xl font-semibold text-[#f4b88a]">
                {(practiceElapsedMs / 1000).toFixed(1)}s
              </div>
            </div>
          </div>
        </aside>

        <section className="rounded-[28px] border border-[#10233a]/10 bg-[linear-gradient(135deg,#fffaf1_0%,#f6efe3_58%,#efe5d3_100%)] p-5 shadow-[0_24px_70px_rgba(16,35,58,0.10)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#10233a]/8 pb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#335d88]">Candidate Workspace</p>
              <h3 className="mt-2 text-lg font-semibold text-[#10233a]">边说边写，把回答组织成真正能出口的结构。</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sttLoaded && (
                <>
                  <select
                    value={selectedMic ?? ''}
                    onChange={(event) => setSelectedMic(Number(event.target.value))}
                    className="rounded-full border border-[#10233a]/10 bg-white/80 px-3 py-2 text-xs text-[#10233a] outline-none"
                  >
                    {mics.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleRecordToggle}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition ${
                      practiceRecording
                        ? 'bg-[#c74f2e] text-white'
                        : 'border border-[#10233a]/10 bg-white/80 text-[#10233a]'
                    }`}
                  >
                    {practiceRecording ? (
                      <>
                        <Square className="h-3.5 w-3.5" />
                        停止录音
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5" />
                        开始语音回答
                      </>
                    )}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-2 rounded-full border border-[#10233a]/10 px-4 py-2 text-xs text-[#42556c] transition hover:bg-white/70"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                退出
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[#10233a]/8 bg-[#f3ede1]/65 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#10233a]/10 bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#335d88]">
                    answer mode · {currentTurn?.answer_mode ?? 'voice'}
                  </span>
                  {isWrittenPromptMode && (
                    <span className="rounded-full border border-[#c74f2e]/20 bg-[#c74f2e]/8 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#a94c35]">
                      题面模式
                    </span>
                  )}
                  {currentTurn?.follow_up_of && (
                    <span className="rounded-full border border-[#c74f2e]/20 bg-[#c74f2e]/8 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#a94c35]">
                      follow-up
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-6 text-[#42556c]">
                  {phaseGuidance.body}
                </p>
              </div>
              {(currentTurn?.written_prompt || currentTurn?.artifact_notes?.length) && (
                <div className="rounded-[24px] border border-[#10233a]/8 bg-[#f8f3ea] p-4">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#335d88]">
                    <span>题面与元数据</span>
                    <span>{isWrittenPromptMode ? 'read-first' : 'reference'}</span>
                  </div>
                  {currentTurn?.written_prompt && (
                    <div className="mt-3 rounded-[22px] border border-[#10233a]/8 bg-white/75 px-4 py-3 text-sm leading-7 text-[#23384f]">
                      {currentTurn.written_prompt}
                    </div>
                  )}
                  {currentTurn?.artifact_notes?.length ? (
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-[#42556c]">
                      {currentTurn.artifact_notes.map((note, index) => (
                        <li key={`${note}-${index}`} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#c74f2e]" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
              <div className="rounded-[24px] border border-[#10233a]/8 bg-white/78 p-4">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#335d88]">
                  <span>实时回答草稿</span>
                  <span>{practiceAnswerDraft.length} chars</span>
                </div>
                <textarea
                  value={practiceAnswerDraft}
                  onChange={(event) => setPracticeAnswerDraft(event.target.value)}
                  rows={10}
                  placeholder="语音转写会持续写到这里，你也可以手动修句子，让它更像真正对面试官说出口的话。"
                  className="mt-3 w-full resize-none rounded-[22px] border border-[#10233a]/8 bg-[#fffdf8] px-4 py-3 text-sm leading-7 text-[#10233a] outline-none transition placeholder:text-[#7c8a9b] focus:border-[#335d88]/40"
                />
              </div>

              {(currentTurn?.answer_mode === 'voice+code' || currentTurn?.answer_mode === 'code') && (
                <div className="rounded-[24px] border border-[#10233a]/8 bg-[#10233a] p-4 text-[#f5efe3]">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#8bb0d6]">
                    <span className="inline-flex items-center gap-2">
                      <Code2 className="h-3.5 w-3.5" />
                      代码与结构区
                    </span>
                    <span>{practiceCodeDraft.length} chars</span>
                  </div>
                  <textarea
                    value={practiceCodeDraft}
                    onChange={(event) => setPracticeCodeDraft(event.target.value)}
                    rows={10}
                    placeholder="在这里补充 SQL / 伪代码 / 接口结构..."
                    className="mt-3 w-full resize-none rounded-[22px] border border-white/10 bg-[#0a1728] px-4 py-3 font-mono text-[13px] leading-6 text-[#f4ede1] outline-none transition placeholder:text-[#7f8ea3] focus:border-[#f4b88a]/40"
                  />
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-[24px] border border-[#10233a]/8 bg-white/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#335d88]">当前状态</p>
                <div className="mt-3 flex items-center gap-2 text-sm text-[#10233a]">
                  {practiceRecording ? <Mic className="h-4 w-4 text-[#c74f2e]" /> : <MicOff className="h-4 w-4 text-[#64748b]" />}
                  {practiceRecording ? '麦克风正在采集你的回答' : '当前未录音，可以先整理措辞后再提交'}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm text-[#42556c]">
                  <Volume2 className="h-4 w-4 text-[#335d88]" />
                  {isWrittenPromptMode
                    ? '当前题型直接展示题面，不再默认口播'
                    : practiceTtsSpeaking
                      ? '面试官还在说话'
                      : '播报结束后会自动轮到你'}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#10233a]/8 bg-white/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#335d88]">已完成回合</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {completedTurns.length === 0 ? (
                    <span className="text-sm text-[#64748b]">这还是开场阶段，先把第一轮回答稳住。</span>
                  ) : (
                    completedTurns.map((turn) => (
                      <span
                        key={turn.turn_id}
                        className="rounded-full border border-[#10233a]/8 bg-[#fffdf8] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#42556c]"
                      >
                        {turn.phase_label}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#10233a]/8 bg-white/70 p-4">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading || (!practiceAnswerDraft.trim() && !practiceCodeDraft.trim())}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#10233a] px-5 py-3 text-sm font-semibold text-[#f6efe4] transition hover:bg-[#173252] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  提交本轮回答
                </button>
                <button
                  type="button"
                  onClick={handleFinish}
                  disabled={loading || completedTurns.length === 0}
                  className="mt-3 w-full rounded-full border border-[#10233a]/10 px-5 py-3 text-sm text-[#42556c] transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  提前结束并生成整场复盘
                </button>
              </div>
            </div>
          </div>

          {error && <p className="mt-4 text-sm text-[#c74f2e]">{error}</p>}
        </section>
      </div>
    </div>
  )
}

function UploadResumeButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await api.uploadResume(file)
      await refreshConfig()
      if (result.parsed) {
        useInterviewStore.getState().setToastMessage('简历已解析并选用')
      } else {
        useInterviewStore.getState().setToastMessage(
          `已保存到历史，解析未成功：${result.parse_error || '可在底栏「历史」中重试'}`,
        )
      }
    } catch (err) {
      useInterviewStore.getState().setToastMessage(err instanceof Error ? err.message : '上传失败')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,.md,.doc,.docx"
        onChange={handleUpload}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#f4b88a]/25 bg-[#f4b88a]/10 px-4 py-2 text-sm text-[#f4d1ad] transition hover:bg-[#f4b88a]/14"
      >
        <Upload className="h-4 w-4" />
        {uploading ? '上传中...' : '上传简历'}
      </button>
    </>
  )
}
