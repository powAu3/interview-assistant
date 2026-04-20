import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'
import type { ModelHealthStatus, TokenUsage } from './types'

export interface SttSliceState {
  sttLoaded: boolean
  sttLoading: boolean
  modelHealth: Record<number, ModelHealthStatus>
  tokenUsage: TokenUsage
}

export interface SttSliceActions {
  setSttStatus: (loaded: boolean, loading: boolean) => void
  setModelHealth: (index: number, status: ModelHealthStatus) => void
  setTokenUsage: (usage: TokenUsage) => void
}

export type SttSlice = SttSliceState & SttSliceActions

export const createSttSlice: StateCreator<RootState, [], [], SttSlice> = (set) => ({
  sttLoaded: false,
  sttLoading: true,
  modelHealth: {},
  tokenUsage: { prompt: 0, completion: 0, total: 0, byModel: {} },

  setSttStatus: (loaded, loading) => set({ sttLoaded: loaded, sttLoading: loading }),
  setModelHealth: (index, status) =>
    set((s) => ({ modelHealth: { ...s.modelHealth, [index]: status } })),
  setTokenUsage: (usage) =>
    set({
      tokenUsage: {
        prompt: usage.prompt,
        completion: usage.completion,
        total: usage.total,
        byModel: usage.byModel ?? {},
      },
    }),
})
