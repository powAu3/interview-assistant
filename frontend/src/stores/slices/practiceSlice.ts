import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'
import type { PracticeEvaluation, PracticeQuestion, PracticeStatus } from './types'

export interface PracticeSliceState {
  practiceStatus: PracticeStatus
  practiceQuestions: PracticeQuestion[]
  practiceIndex: number
  practiceEvals: PracticeEvaluation[]
  practiceEvalStreaming: string
  practiceReport: string
  practiceReportStreaming: string
  practiceRecording: boolean
  practiceAnswerDraft: string
}

export interface PracticeSliceActions {
  setPracticeStatus: (s: PracticeStatus) => void
  setPracticeQuestions: (qs: PracticeQuestion[]) => void
  setPracticeIndex: (i: number) => void
  appendPracticeEvalChunk: (chunk: string) => void
  finalizePracticeEval: (ev: PracticeEvaluation) => void
  appendPracticeReportChunk: (chunk: string) => void
  finalizePracticeReport: (report: string) => void
  setPracticeRecording: (v: boolean) => void
  setPracticeAnswerDraft: (text: string) => void
  appendPracticeAnswerDraft: (text: string) => void
  resetPractice: () => void
}

export type PracticeSlice = PracticeSliceState & PracticeSliceActions

export const createPracticeSlice: StateCreator<RootState, [], [], PracticeSlice> = (set) => ({
  practiceStatus: 'idle',
  practiceQuestions: [],
  practiceIndex: 0,
  practiceEvals: [],
  practiceEvalStreaming: '',
  practiceReport: '',
  practiceReportStreaming: '',
  practiceRecording: false,
  practiceAnswerDraft: '',

  setPracticeStatus: (status) =>
    set(() =>
      status === 'idle' || status === 'generating'
        ? { practiceStatus: status, practiceAnswerDraft: '' }
        : { practiceStatus: status },
    ),
  setPracticeQuestions: (qs) =>
    set({ practiceQuestions: qs, practiceIndex: 0, practiceAnswerDraft: '' }),
  setPracticeIndex: (i) => set({ practiceIndex: i, practiceAnswerDraft: '' }),
  appendPracticeEvalChunk: (chunk) =>
    set((s) => ({ practiceEvalStreaming: s.practiceEvalStreaming + chunk })),
  finalizePracticeEval: (ev) =>
    set((s) => ({
      practiceEvals: [...s.practiceEvals, ev],
      practiceEvalStreaming: '',
    })),
  appendPracticeReportChunk: (chunk) =>
    set((s) => ({ practiceReportStreaming: s.practiceReportStreaming + chunk })),
  finalizePracticeReport: (report) =>
    set({ practiceReport: report, practiceReportStreaming: '' }),
  setPracticeRecording: (v) => set({ practiceRecording: v }),
  setPracticeAnswerDraft: (text) => set({ practiceAnswerDraft: text }),
  appendPracticeAnswerDraft: (text) =>
    set((s) => ({
      practiceAnswerDraft: s.practiceAnswerDraft ? `${s.practiceAnswerDraft} ${text}` : text,
    })),
  resetPractice: () =>
    set({
      practiceStatus: 'idle',
      practiceQuestions: [],
      practiceIndex: 0,
      practiceEvals: [],
      practiceEvalStreaming: '',
      practiceReport: '',
      practiceReportStreaming: '',
      practiceRecording: false,
      practiceAnswerDraft: '',
    }),
})
