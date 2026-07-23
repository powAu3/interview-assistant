import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'
import type { ModelHealthStatus, TokenUsage } from './types'

export interface SttSliceState {
  sttLoaded: boolean
  sttLoading: boolean
  sttActiveProvider: string
  sttFallbackLoaded: boolean
  candidateSttLoaded: boolean
  candidateSttLoading: boolean
  candidateSttProvider: string
  modelHealth: Record<number, ModelHealthStatus>
  modelHealthDetail: Record<number, string>
  modelHealthLatency: Record<number, number>
  tokenUsage: TokenUsage
}

export interface SttSliceActions {
  setSttStatus: (loaded: boolean, loading: boolean, provider?: string) => void
  setCandidateSttStatus: (loaded: boolean, loading: boolean, provider?: string) => void
  setModelHealth: (
    index: number,
    status: ModelHealthStatus,
    detail?: string,
    latencyMs?: number,
    modelFingerprint?: string,
  ) => void
  setTokenUsage: (usage: TokenUsage) => void
}

export type SttSlice = SttSliceState & SttSliceActions

export const createSttSlice: StateCreator<RootState, [], [], SttSlice> = (set) => ({
  sttLoaded: true,
  sttLoading: false,
  sttActiveProvider: '',
  sttFallbackLoaded: false,
  candidateSttLoaded: false,
  candidateSttLoading: false,
  candidateSttProvider: '',
  modelHealth: {},
  modelHealthDetail: {},
  modelHealthLatency: {},
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
  setCandidateSttStatus: (loaded, loading, provider) => set((s) => ({
    candidateSttLoaded: loaded,
    candidateSttLoading: loading,
    ...(provider != null ? { candidateSttProvider: provider } : {}),
  })),
  setModelHealth: (index, status, detail, latencyMs, modelFingerprint) => set((s) => {
    const currentFingerprint = s.config?.models?.[index]?.health_fingerprint
    if (modelFingerprint && currentFingerprint && modelFingerprint !== currentFingerprint) return {}
    return {
      modelHealth: { ...s.modelHealth, [index]: status },
      ...(detail != null ? { modelHealthDetail: { ...s.modelHealthDetail, [index]: detail } } : {}),
      ...(latencyMs != null ? { modelHealthLatency: { ...s.modelHealthLatency, [index]: latencyMs } } : {}),
    }
  }),
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
