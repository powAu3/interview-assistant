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

export const createConfigSlice: StateCreator<RootState, [], [], ConfigSlice> = (set) => ({
  config: null,
  devices: [],
  platformInfo: null,
  options: null,

  setConfig: (config) => set({ config }),
  setDevices: (devices, platformInfo) => set({ devices, platformInfo }),
  setOptions: (options) => set({ options }),
})
