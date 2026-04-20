import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'

export interface ResumeOptSliceState {
  resumeOptStreaming: string
  resumeOptResult: string
  resumeOptLoading: boolean
}

export interface ResumeOptSliceActions {
  appendResumeOptChunk: (chunk: string) => void
  setResumeOptResult: (text: string) => void
  setResumeOptLoading: (v: boolean) => void
  resetResumeOpt: () => void
}

export type ResumeOptSlice = ResumeOptSliceState & ResumeOptSliceActions

export const createResumeOptSlice: StateCreator<RootState, [], [], ResumeOptSlice> = (set) => ({
  resumeOptStreaming: '',
  resumeOptResult: '',
  resumeOptLoading: false,

  appendResumeOptChunk: (chunk) =>
    set((s) => ({ resumeOptStreaming: s.resumeOptStreaming + chunk })),
  setResumeOptResult: (text) => set({ resumeOptResult: text, resumeOptStreaming: '' }),
  setResumeOptLoading: (v) => set({ resumeOptLoading: v }),
  resetResumeOpt: () =>
    set({ resumeOptStreaming: '', resumeOptResult: '', resumeOptLoading: false }),
})
