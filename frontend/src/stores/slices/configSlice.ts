import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'
import type { AppConfig, DeviceItem, PlatformInfo, OptionsInfo } from './types'

export interface ConfigSliceState {
  config: AppConfig | null
  devices: DeviceItem[]
  platformInfo: PlatformInfo | null
  options: OptionsInfo | null
}

export interface ConfigSliceActions {
  setConfig: (config: AppConfig) => void
  setDevices: (devices: DeviceItem[], platformInfo: PlatformInfo | null) => void
  setOptions: (options: OptionsInfo) => void
}

export type ConfigSlice = ConfigSliceState & ConfigSliceActions

function modelHealthIdentity(config: AppConfig | null): string[] {
  if (!config) return []
  return config.models.map((model) => (
    model.health_fingerprint
    || `${model.name}\u001f${model.enabled !== false ? '1' : '0'}`
  ))
}

function sameModelHealthIdentity(previous: AppConfig | null, next: AppConfig): boolean {
  if (!previous) return true
  const before = modelHealthIdentity(previous)
  const after = modelHealthIdentity(next)
  return before.length === after.length && before.every((value, index) => value === after[index])
}

export const createConfigSlice: StateCreator<RootState, [], [], ConfigSlice> = (set) => ({
  config: null,
  devices: [],
  platformInfo: null,
  options: null,

  setConfig: (config) => set((state) => {
    if (sameModelHealthIdentity(state.config, config)) return { config }
    return {
      config,
      modelHealth: {},
      modelHealthDetail: {},
      modelHealthLatency: {},
    }
  }),
  setDevices: (devices, platformInfo) => set({ devices, platformInfo }),
  setOptions: (options) => set({ options }),
})
