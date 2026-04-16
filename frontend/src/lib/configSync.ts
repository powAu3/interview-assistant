import { api } from './api'
import { useInterviewStore, type AppConfig } from '@/stores/configStore'

export async function refreshConfig(): Promise<AppConfig> {
  const nextConfig = await api.getConfig()
  useInterviewStore.getState().setConfig(nextConfig)
  return nextConfig
}

export async function updateConfigAndRefresh(data: Record<string, unknown>): Promise<AppConfig> {
  await api.updateConfig(data)
  return refreshConfig()
}
