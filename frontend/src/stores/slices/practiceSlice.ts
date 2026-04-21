import type { StateCreator } from 'zustand'

import type { RootState } from './rootState'
import type { PracticeSessionSnapshot, PracticeStatus } from './types'

export interface PracticeSliceState {
  practiceStatus: PracticeStatus
  practiceSession: PracticeSessionSnapshot | null
  practiceRecording: boolean
  practiceAnswerDraft: string
  practiceCodeDraft: string
  practiceTtsSpeaking: boolean
  practiceElapsedMs: number
}

export interface PracticeSliceActions {
  setPracticeStatus: (s: PracticeStatus) => void
  setPracticeSession: (session: PracticeSessionSnapshot | null) => void
  setPracticeRecording: (v: boolean) => void
  setPracticeAnswerDraft: (text: string) => void
  appendPracticeAnswerDraft: (text: string) => void
  setPracticeCodeDraft: (text: string) => void
  setPracticeTtsSpeaking: (value: boolean) => void
  setPracticeElapsedMs: (value: number) => void
  resetPractice: () => void
}

export type PracticeSlice = PracticeSliceState & PracticeSliceActions

function shouldResetDrafts(
  previous: PracticeSessionSnapshot | null,
  next: PracticeSessionSnapshot | null,
): boolean {
  const prevTurnId = previous?.current_turn?.turn_id ?? null
  const nextTurnId = next?.current_turn?.turn_id ?? null
  return prevTurnId !== nextTurnId
}

export const createPracticeSlice: StateCreator<RootState, [], [], PracticeSlice> = (set) => ({
  practiceStatus: 'idle',
  practiceSession: null,
  practiceRecording: false,
  practiceAnswerDraft: '',
  practiceCodeDraft: '',
  practiceTtsSpeaking: false,
  practiceElapsedMs: 0,

  setPracticeStatus: (status) =>
    set((state) =>
      status === 'idle'
        ? {
            ...state,
            practiceStatus: status,
            practiceRecording: false,
            practiceTtsSpeaking: false,
            practiceElapsedMs: 0,
          }
        : { practiceStatus: status },
    ),
  setPracticeSession: (session) =>
    set((state) => {
      const resetDrafts = shouldResetDrafts(state.practiceSession, session)
      return {
        practiceSession: session,
        practiceStatus: session?.status ?? state.practiceStatus,
        practiceAnswerDraft: resetDrafts ? '' : state.practiceAnswerDraft,
        practiceCodeDraft: resetDrafts ? '' : state.practiceCodeDraft,
        practiceElapsedMs: resetDrafts ? 0 : state.practiceElapsedMs,
      }
    }),
  setPracticeRecording: (value) => set({ practiceRecording: value }),
  setPracticeAnswerDraft: (text) => set({ practiceAnswerDraft: text }),
  appendPracticeAnswerDraft: (text) =>
    set((state) => ({
      practiceAnswerDraft: state.practiceAnswerDraft
        ? `${state.practiceAnswerDraft} ${text}`
        : text,
    })),
  setPracticeCodeDraft: (text) => set({ practiceCodeDraft: text }),
  setPracticeTtsSpeaking: (value) => set({ practiceTtsSpeaking: value }),
  setPracticeElapsedMs: (value) => set({ practiceElapsedMs: Math.max(0, value) }),
  resetPractice: () =>
    set({
      practiceStatus: 'idle',
      practiceSession: null,
      practiceRecording: false,
      practiceAnswerDraft: '',
      practiceCodeDraft: '',
      practiceTtsSpeaking: false,
      practiceElapsedMs: 0,
    }),
})
