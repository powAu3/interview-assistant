import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'

export interface ResumeOptSliceState {
  resumeOptStreaming: string
  resumeOptResult: string
  resumeOptLoading: boolean
  resumeOptJobId: string | null
}

export interface ResumeOptSliceActions {
  appendResumeOptChunk: (chunk: string, jobId?: string | null) => void
  setResumeOptResult: (text: string, jobId?: string | null) => void
  setResumeOptLoading: (v: boolean) => void
  resetResumeOpt: (jobId?: string | null) => void
}

export type ResumeOptSlice = ResumeOptSliceState & ResumeOptSliceActions

export const createResumeOptSlice: StateCreator<RootState, [], [], ResumeOptSlice> = (set) => ({
  resumeOptStreaming: '',
  resumeOptResult: '',
  resumeOptLoading: false,
  resumeOptJobId: null,

  appendResumeOptChunk: (chunk, jobId) =>
    set((s) => {
      if (jobId && s.resumeOptJobId && jobId !== s.resumeOptJobId) return {}
      return { resumeOptStreaming: s.resumeOptStreaming + chunk }
    }),
  setResumeOptResult: (text, jobId) =>
    set((s) => {
      if (jobId && s.resumeOptJobId && jobId !== s.resumeOptJobId) return {}
      return { resumeOptResult: text, resumeOptStreaming: '', resumeOptLoading: false }
    }),
  setResumeOptLoading: (v) => set({ resumeOptLoading: v }),
  resetResumeOpt: (jobId = null) =>
    set({ resumeOptStreaming: '', resumeOptResult: '', resumeOptLoading: false, resumeOptJobId: jobId }),
})
