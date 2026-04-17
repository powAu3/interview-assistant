import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useInterviewStore } from '@/stores/configStore'
import { useKbStore } from '@/stores/kbStore'

export function useAppBootstrap() {
  const setConfig = useInterviewStore((s) => s.setConfig)
  const setDevices = useInterviewStore((s) => s.setDevices)
  const setOptions = useInterviewStore((s) => s.setOptions)
  const setKbStatus = useKbStore((s) => s.setStatus)
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

      // KB status: 让 KnowledgeButton 能根据 enabled+0docs 显示提醒红点
      void api
        .kbStatus()
        .then((s) => {
          if (!cancelled) setKbStatus(s)
        })
        .catch(() => {})
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [setConfig, setDevices, setOptions, setKbStatus])

  return { initError }
}
