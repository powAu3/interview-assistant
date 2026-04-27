import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { PracticeActiveSessionView } from '@/components/practice/PracticeActiveSessionView'
import { PracticeDebriefView } from '@/components/practice/PracticeDebriefView'
import { PracticeSetupScreen } from '@/components/practice/PracticeSetupScreen'
import {
  getVirtualInterviewerStateLabel,
  isPracticeWrittenPromptMode,
  resolveVirtualInterviewerState,
} from '@/components/practice/virtualInterviewerState'
import { api } from '@/lib/api'
import { usePracticePersistentState } from '@/hooks/usePracticePersistentState'
import { usePracticeSessionActions } from '@/hooks/usePracticeSessionActions'
import { usePracticeTurnPlayback } from '@/hooks/usePracticeTurnPlayback'
import { usePracticeVoiceCatalog } from '@/hooks/usePracticeVoiceCatalog'
import { isLightColorScheme } from '@/lib/colorScheme'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

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

function getInterviewerSignalLabel(signal?: string | null) {
  switch (signal) {
    case 'probe':
      return '追问'
    case 'pressure-check':
      return '校验'
    case 'stress-test':
      return '压问'
    case 'implementation-check':
      return '实现校验'
    case 'wrap-up':
      return '收束'
    default:
      return '引导'
  }
}

function getPracticeSourceLabel(
  source: 'idle' | 'volcengine' | 'edge_tts' | 'system' | 'browser',
  provider?: string,
) {
  if (source === 'volcengine') return 'Volcengine'
  if (source === 'edge_tts') return 'EdgeTTS'
  if (source === 'system' || source === 'browser') return 'local'
  if (provider === 'volcengine') return 'Volcengine'
  if (provider === 'edge_tts') return 'EdgeTTS'
  if (provider === 'local') return 'local'
  return 'local'
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
    setPracticeElapsedMs,
    setPracticeSession,
    setPracticeTtsSpeaking,
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
      setPracticeElapsedMs: state.setPracticeElapsedMs,
      setPracticeSession: state.setPracticeSession,
      setPracticeTtsSpeaking: state.setPracticeTtsSpeaking,
      resetPractice: state.resetPractice,
    })),
  )

  const [selectedMic, setSelectedMic] = useState<number | null>(null)
  const persistentState = usePracticePersistentState()
  const voiceCatalog = usePracticeVoiceCatalog({
    config,
    interviewerStyle: persistentState.interviewerStyle,
    selectedVoiceURI: persistentState.selectedVoiceURI,
    voiceGender: persistentState.voiceGender,
    practiceSession,
  })

  const mics = useMemo(() => devices.filter((device) => !device.is_loopback), [devices])
  const currentTurn = practiceSession?.current_turn ?? null
  const phases = practiceSession?.blueprint?.phases ?? []
  const completedTurns = practiceSession?.turn_history ?? []
  const currentPhaseLabel = currentTurn?.phase_label ?? '模拟面试'
  const isReportStage = practiceStatus === 'debriefing' || practiceStatus === 'finished'
  const isIdle = practiceStatus === 'idle'
  const isWrittenPromptMode = isPracticeWrittenPromptMode(currentTurn)
  const canSpeakAnswer = Boolean(
    currentTurn && (currentTurn.answer_mode === 'voice' || currentTurn.answer_mode === 'voice+code'),
  )
  const phaseGuidance = getPhaseGuidance(currentTurn?.category)

  const sessionActions = usePracticeSessionActions({
    api,
    currentTurn,
    interviewerStyle: persistentState.interviewerStyle,
    jdDraft: persistentState.jdDraft,
    practiceAnswerDraft,
    practiceCodeDraft,
    practiceElapsedMs,
    setPracticeSession,
  })

  useEffect(() => {
    if (!sessionActions.startingPractice) return
    if (practiceSession?.current_turn || practiceStatus !== 'idle') {
      sessionActions.setStartingPractice(false)
    }
  }, [practiceSession?.current_turn, practiceStatus, sessionActions])

  useEffect(() => {
    if (mics.length === 0) {
      setSelectedMic(null)
      return
    }
    if (selectedMic != null && mics.some((device) => device.id === selectedMic)) return
    setSelectedMic(mics[0].id)
  }, [mics, selectedMic])

  const startRecording = async () => {
    if (!sttLoaded) return
    if (selectedMic == null) {
      sessionActions.setError('请选择麦克风设备')
      return
    }
    try {
      await api.practiceRecord('start', selectedMic)
    } catch (err) {
      sessionActions.setError(err instanceof Error ? err.message : '启动录音失败')
    }
  }

  const playback = usePracticeTurnPlayback({
    api,
    canSpeakAnswer,
    config,
    currentTurn,
    isReportStage,
    isWrittenPromptMode,
    practiceRecording,
    resolvedDesktopVoiceName: voiceCatalog.resolvedDesktopVoiceName,
    selectedVoiceURI: persistentState.selectedVoiceURI,
    setPracticeElapsedMs,
    setPracticeTtsSpeaking,
    startRecording,
    sttLoaded,
    voiceGender: persistentState.voiceGender,
  })

  const handleReset = async () => {
    sessionActions.setError(null)
    playback.resetPlaybackState()
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

  const isPreparingView = sessionActions.startingPractice || practiceStatus === 'preparing'
  const interviewerState = resolveVirtualInterviewerState({
    practiceStatus,
    practiceTtsSpeaking,
    practiceRecording,
    turn: currentTurn,
  })
  const interviewerStateLabel = getVirtualInterviewerStateLabel(interviewerState, {
    writtenPromptMode: isWrittenPromptMode,
  })
  const interviewerSignalLabel = getInterviewerSignalLabel(currentTurn?.interviewer_signal)
  const resolvedTtsSourceLabel = getPracticeSourceLabel(playback.ttsPlaybackSource, config?.practice_tts_provider)
  const averageScore = averageTurnScore(completedTurns)
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const practiceTheme = isLightColorScheme(colorScheme) ? 'light' : 'dark'

  if (isIdle || isPreparingView) {
    return (
      <PracticeSetupScreen
        autoPreferredLocalVoice={voiceCatalog.autoPreferredLocalVoice}
        config={config}
        error={sessionActions.error}
        handleGenerate={sessionActions.handleGenerate}
        interviewerStyle={persistentState.interviewerStyle}
        isPreparingView={isPreparingView}
        jdDraft={persistentState.jdDraft}
        loading={sessionActions.loading}
        selectedPersona={voiceCatalog.selectedPersona}
        selectedVoiceURI={persistentState.selectedVoiceURI}
        setInterviewerStyle={persistentState.setInterviewerStyle}
        setJdDraft={persistentState.setJdDraft}
        setSelectedVoiceURI={persistentState.setSelectedVoiceURI}
        setVoiceGender={persistentState.setVoiceGender}
        useEdgeTts={voiceCatalog.useEdgeTts}
        voiceGender={persistentState.voiceGender}
        voices={voiceCatalog.voices}
        practiceTheme={practiceTheme}
      />
    )
  }

  if (isReportStage) {
    return (
      <PracticeDebriefView
        activePersona={voiceCatalog.activePersona}
        averageScore={averageScore}
        completedTurns={completedTurns}
        handleReset={handleReset}
        practiceSession={practiceSession}
        practiceStatus={practiceStatus}
        practiceTheme={practiceTheme}
      />
    )
  }

  return (
    <PracticeActiveSessionView
      activePersona={voiceCatalog.activePersona}
      completedTurns={completedTurns}
      currentPhaseLabel={currentPhaseLabel}
      currentTurn={currentTurn}
      error={sessionActions.error}
      handleFinish={sessionActions.handleFinish}
      handleRecordToggle={handleRecordToggle}
      handleReset={handleReset}
      handleSubmit={sessionActions.handleSubmit}
      interviewerSignalLabel={interviewerSignalLabel}
      interviewerState={interviewerState}
      interviewerStateLabel={interviewerStateLabel}
      isWrittenPromptMode={isWrittenPromptMode}
      loading={sessionActions.loading}
      mics={mics}
      phaseGuidance={phaseGuidance}
      phases={phases}
      practiceAnswerDraft={practiceAnswerDraft}
      practiceCodeDraft={practiceCodeDraft}
      practiceElapsedMs={practiceElapsedMs}
      practiceRecording={practiceRecording}
      practiceSession={practiceSession}
      practiceTtsSpeaking={practiceTtsSpeaking}
      selectedMic={selectedMic}
      setPracticeAnswerDraft={setPracticeAnswerDraft}
      setPracticeCodeDraft={setPracticeCodeDraft}
      setSelectedMic={setSelectedMic}
      sttLoaded={sttLoaded}
      ttsSourceLabel={resolvedTtsSourceLabel}
      practiceTheme={practiceTheme}
    />
  )
}
