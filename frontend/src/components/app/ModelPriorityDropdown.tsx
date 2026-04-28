import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { api } from '@/lib/api'
import type { AppConfig, ModelHealthStatus } from '@/stores/configStore'

interface ModelPriorityDropdownProps {
  config: AppConfig
  modelHealth: Record<number, ModelHealthStatus>
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
  index: number,
): string {
  if (config.models[index]?.enabled === false) return '已停用，请先在模型设置中启用'
  const status = modelHealth[index]
  if (status === 'ok') return '连接正常'
  if (status === 'checking') return '正在检测连接…'
  if (status === 'error') return '连接失败，点击下拉菜单「重新检查连接」重试'
  return '未检测，点击下拉菜单「重新检查连接」'
}

export function ModelPriorityDropdown({
  config,
  modelHealth,
  onModelChange,
}: ModelPriorityDropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const activeModel = config.models[config.active_model]
  const activeLabel = healthLabel(config, modelHealth, config.active_model)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

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
                title={`${model.name} · ${healthLabel(config, modelHealth, index)}`}
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
                {statusLabel && (
                  <span className={`ml-auto text-[10px] font-semibold ${disabled ? 'text-text-muted' : 'text-accent-blue'}`}>
                    {statusLabel}
                  </span>
                )}
              </button>
            )
          })}
          <div className="border-t border-bg-hover/40 mt-1 pt-1 px-3 py-1.5">
            <button
              onClick={() => {
                api.checkModelsHealth().catch(() => {})
              }}
              className="text-[10px] text-text-muted hover:text-accent-blue transition-colors font-medium"
            >
              重新检查连接
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
