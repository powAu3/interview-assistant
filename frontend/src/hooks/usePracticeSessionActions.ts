import { useState } from 'react'

import { useInterviewStore } from '@/stores/configStore'

import type { PracticeAnswerMode, PracticeSessionSnapshot, PracticeStatus } from '@/stores/configStore'

const PRACTICE_SESSION_WATCHDOG_MS = 1500

interface UsePracticeSessionActionsArgs {
  api: {
    practiceFinish: () => Promise<unknown>
    practiceGenerate: (payload: { jd_text?: string; interviewer_style?: string }) => Promise<unknown>
    practiceStatus: () => Promise<PracticeSessionSnapshot>
    practiceSubmit: (payload: {
      transcript: string
      code_text?: string
      answer_mode: PracticeAnswerMode
      duration_ms: number
    }) => Promise<unknown>
  }
  currentTurn: PracticeSessionSnapshot['current_turn']
  interviewerStyle: string
  jdDraft: string
  practiceAnswerDraft: string
  practiceCodeDraft: string
  practiceElapsedMs: number
  setPracticeSession: (session: PracticeSessionSnapshot | null) => void
}

export function usePracticeSessionActions(args: UsePracticeSessionActionsArgs) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startingPractice, setStartingPractice] = useState(false)

  const triggerPracticeWatchdog = (
    shouldStop: (
      session: PracticeSessionSnapshot | null,
      status: PracticeStatus,
    ) => boolean,
    options?: { delayMs?: number },
  ) => {
    const run = async () => {
      const state = useInterviewStore.getState()
      if (shouldStop(state.practiceSession, state.practiceStatus)) return

      await new Promise((resolve) => {
        window.setTimeout(resolve, options?.delayMs ?? PRACTICE_SESSION_WATCHDOG_MS)
      })

      const beforeHydrate = useInterviewStore.getState()
      if (shouldStop(beforeHydrate.practiceSession, beforeHydrate.practiceStatus)) return

      try {
        const session = await args.api.practiceStatus()
        args.setPracticeSession(session)
      } catch {
        /* ignore */
      }
    }

    void run()
  }

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    setStartingPractice(true)
    try {
      await args.api.practiceGenerate({
        jd_text: args.jdDraft.trim(),
        interviewer_style: args.interviewerStyle,
      })
      triggerPracticeWatchdog((session, status) => (
        Boolean(session?.current_turn)
        || (status !== 'idle' && status !== 'preparing')
      ))
    } catch (err) {
      setStartingPractice(false)
      setError(err instanceof Error ? err.message : '启动失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!args.currentTurn) return
    if (!args.practiceAnswerDraft.trim() && !args.practiceCodeDraft.trim()) return
    const submittedTurnId = args.currentTurn.turn_id
    setLoading(true)
    setError(null)
    try {
      await args.api.practiceSubmit({
        transcript: args.practiceAnswerDraft.trim(),
        code_text: args.practiceCodeDraft.trim(),
        answer_mode: args.currentTurn.answer_mode,
        duration_ms: args.practiceElapsedMs,
      })
      triggerPracticeWatchdog((session) => (
        Boolean(session?.current_turn?.turn_id && session.current_turn.turn_id !== submittedTurnId)
        || session?.status === 'debriefing'
        || session?.status === 'finished'
      ))
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
      await args.api.practiceFinish()
      triggerPracticeWatchdog((session) => (
        session?.status === 'debriefing'
        || session?.status === 'finished'
        || Boolean(session?.report_markdown)
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : '结束失败')
    } finally {
      setLoading(false)
    }
  }

  return {
    error,
    handleFinish,
    handleGenerate,
    handleSubmit,
    loading,
    setError,
    setStartingPractice,
    startingPractice,
  }
}
