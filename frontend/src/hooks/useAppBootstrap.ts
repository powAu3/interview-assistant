import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useInterviewStore } from '@/stores/configStore'

export function useAppBootstrap() {
  const setConfig = useInterviewStore((s) => s.setConfig)
  const setDevices = useInterviewStore((s) => s.setDevices)
  const setOptions = useInterviewStore((s) => s.setOptions)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        const nextConfig = await api.getConfig()
        if (cancelled) return
        setConfig(nextConfig)
      } catch (e) {
        if (!cancelled) setInitError(e instanceof Error ? e.message : '连接后端失败')
        return
      }

      void api.getDevices()
        .then((d) => {
          if (!cancelled) setDevices(d.devices, d.platform)
        })
        .catch(() => {})

      void api.getOptions()
        .then((nextOptions) => {
          if (!cancelled) setOptions(nextOptions)
        })
        .catch(() => {})

      void api.checkModelsHealth().catch(() => {})
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [setConfig, setDevices, setOptions])

  return { initError }
}
