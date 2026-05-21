import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'
import type { ModelHealthStatus, TokenUsage } from './types'

export interface SttSliceState {
  sttLoaded: boolean
  sttLoading: boolean
  sttActiveProvider: string
  sttFallbackLoaded: boolean
  modelHealth: Record<number, ModelHealthStatus>
  tokenUsage: TokenUsage
}

export interface SttSliceActions {
  setSttStatus: (loaded: boolean, loading: boolean, provider?: string) => void
  setModelHealth: (index: number, status: ModelHealthStatus) => void
  setTokenUsage: (usage: TokenUsage) => void
}

export type SttSlice = SttSliceState & SttSliceActions

export const createSttSlice: StateCreator<RootState, [], [], SttSlice> = (set) => ({
  sttLoaded: true,
  sttLoading: false,
  sttActiveProvider: '',
  sttFallbackLoaded: false,
  modelHealth: {},
  tokenUsage: { prompt: 0, completion: 0, total: 0, byModel: {} },

  setSttStatus: (loaded, loading, provider) => set((s) => {
    if (provider === 'whisper-preload') {
      return { sttFallbackLoaded: loaded }
    }
    return {
      sttLoaded: loaded,
      sttLoading: loading,
      ...(provider != null ? { sttActiveProvider: provider } : {}),
    }
  }),
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
