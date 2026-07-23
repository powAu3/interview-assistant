import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { api } from '@/lib/api'
import { useInterviewStore, type AppConfig, type ModelHealthStatus } from '@/stores/configStore'

interface ModelPriorityDropdownProps {
  config: AppConfig
  modelHealth: Record<number, ModelHealthStatus>
  modelHealthDetail: Record<number, string>
  modelHealthLatency: Record<number, number>
  onModelChange: (activeModel: number) => Promise<void> | void
}

function healthDot(
  config: AppConfig,
  modelHealth: Record<number, ModelHealthStatus>,
  index: number,
) {
  if (config.models[index]?.enabled === false) return 'bg-text-muted/40'
  const status = modelHealth[index]
  if (status === 'ok') return 'bg-accent-green'
  if (status === 'checking') return 'bg-accent-amber animate-pulse'
  if (status === 'error') return 'bg-accent-red'
  return 'bg-text-muted/30'
}

function healthLabel(
  config: AppConfig,
  modelHealth: Record<number, ModelHealthStatus>,
  modelHealthDetail: Record<number, string>,
  modelHealthLatency: Record<number, number>,
  index: number,
): string {
  if (config.models[index]?.enabled === false) return '已停用，请先在模型设置中启用'
  const status = modelHealth[index]
  const detail = modelHealthDetail[index]?.trim()
  const lat = modelHealthLatency[index]
  if (status === 'ok') return lat ? `连接正常 · ${lat}ms` : '连接正常'
  if (status === 'checking') return '正在检测连接…'
  if (status === 'error') return detail ? `连接失败：${detail}` : '连接失败，点击下拉菜单「重新检查连接」重试'
  return '未检测，点击下拉菜单「重新检查连接」'
}

function normalizeHealthStatus(status: unknown): ModelHealthStatus | null {
  return status === 'checking' || status === 'ok' || status === 'error' ? status : null
}

function enabledModelIndexes(config: AppConfig) {
  return config.models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => model.enabled !== false)
    .map(({ index }) => index)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '健康检查失败'
}

export function ModelPriorityDropdown({
  config,
  modelHealth,
  modelHealthDetail,
  modelHealthLatency,
  onModelChange,
}: ModelPriorityDropdownProps) {
  const [open, setOpen] = useState(false)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const checkingHealthRef = useRef(false)
  const activeModel = config.models[config.active_model]
  const activeLabel = healthLabel(config, modelHealth, modelHealthDetail, modelHealthLatency, config.active_model)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const runHealthCheck = async () => {
    if (checkingHealthRef.current) return
    checkingHealthRef.current = true
    setCheckingHealth(true)
    const indexes = enabledModelIndexes(config)
    const store = useInterviewStore.getState()
    indexes.forEach((index) => store.setModelHealth(index, 'checking', '', 0))
    try {
      await api.checkModelsHealth()
      const snapshot = await api.getModelsHealth().catch(() => null)
      if (snapshot?.health) {
        const latest = useInterviewStore.getState()
        Object.entries(snapshot.health).forEach(([rawIndex, rawStatus]) => {
          const index = Number(rawIndex)
          const status = normalizeHealthStatus(rawStatus)
          if (!Number.isInteger(index) || !status) return
          latest.setModelHealth(
            index,
            status,
            snapshot.detail?.[rawIndex],
            snapshot.latency?.[rawIndex],
            snapshot.fingerprint?.[rawIndex],
          )
        })
      }
    } catch (error) {
      const detail = getErrorMessage(error)
      const latest = useInterviewStore.getState()
      indexes.forEach((index) => latest.setModelHealth(index, 'error', detail, 0))
      latest.pushToast(`模型健康检查失败：${detail}`, 'error')
    } finally {
      checkingHealthRef.current = false
      setCheckingHealth(false)
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={`优先答题模型 · ${activeModel?.name ?? ''}\n状态:${activeLabel}`}
        aria-label={`优先答题模型 ${activeModel?.name ?? ''},${activeLabel}`}
        className="flex items-center gap-1.5 bg-bg-tertiary/50 text-text-primary text-xs rounded-xl px-2 py-1.5 sm:px-2.5 border border-bg-hover/50 hover:border-accent-blue/40 transition-all duration-200 max-w-[110px] md:max-w-[160px]"
      >
        <div
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthDot(config, modelHealth, config.active_model)}`}
          aria-hidden
        />
        <span className="truncate min-w-0 font-medium hidden sm:inline">
          {activeModel?.name}
          {activeModel?.supports_vision ? ' 👁' : ''}
        </span>
        <ChevronDown className={`w-3 h-3 flex-shrink-0 text-text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 glass border border-bg-hover/50 rounded-xl shadow-xl shadow-black/20 z-50 min-w-[200px] py-1.5 animate-fade-up">
          {config.models.map((model, index) => {
            const disabled = model.enabled === false
            const statusLabel = disabled ? '停用' : index === config.active_model ? '优先' : null
            return (
              <button
                key={index}
                disabled={disabled}
                onClick={async () => {
                  setOpen(false)
                  await onModelChange(index)
                }}
                title={`${model.name} · ${healthLabel(config, modelHealth, modelHealthDetail, modelHealthLatency, index)}`}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-55 ${
                  index === config.active_model
                    ? 'text-accent-blue bg-accent-blue/5'
                    : 'text-text-primary hover:bg-bg-tertiary/50'
                }`}
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${healthDot(config, modelHealth, index)}`} aria-hidden />
                <span className="truncate font-medium">
                  {model.name}
                  {model.supports_vision ? ' 👁' : ''}
                </span>
                {modelHealth[index] === 'ok' && modelHealthLatency[index] ? (
                  <span className="ml-auto text-[10px] font-mono text-text-muted tabular-nums">
                    {modelHealthLatency[index]}ms
                  </span>
                ) : statusLabel ? (
                  <span className={`ml-auto text-[10px] font-semibold ${disabled ? 'text-text-muted' : 'text-accent-blue'}`}>
                    {statusLabel}
                  </span>
                ) : null}
              </button>
            )
          })}
          <div className="border-t border-bg-hover/40 mt-1 pt-1 px-3 py-1.5">
            <button
              type="button"
              onClick={runHealthCheck}
              disabled={checkingHealth}
              className="text-[10px] text-text-muted hover:text-accent-blue transition-colors font-medium disabled:cursor-wait disabled:opacity-60"
            >
              {checkingHealth ? '检测中…' : '重新检查连接'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
