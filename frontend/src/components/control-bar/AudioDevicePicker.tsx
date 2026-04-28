import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Mic,
  RefreshCw,
  Volume2,
} from 'lucide-react'

import type { DeviceItem } from '@/stores/configStore'
import { splitAudioDevices } from './audioDevices'

interface DeviceGroupProps {
  title: string
  devices: Array<DeviceItem | { device: DeviceItem; reason: string }>
  selectedDevice: number | null
  selectionDisabled: boolean
  hidden?: boolean
  onSelect: (deviceId: number) => void
}

function DeviceGroup({
  title,
  devices,
  selectedDevice,
  selectionDisabled,
  hidden,
  onSelect,
}: DeviceGroupProps) {
  if (devices.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {title}
      </div>
      <div className="space-y-1">
        {devices.map((entry) => {
          const device = 'device' in entry ? entry.device : entry
          const reason = 'reason' in entry ? entry.reason : null
          const selected = device.id === selectedDevice
          const Icon = device.is_loopback ? Volume2 : Mic
          return (
            <button
              key={device.id}
              type="button"
              onClick={() => onSelect(device.id)}
              disabled={selectionDisabled}
              aria-current={selected ? 'true' : undefined}
              title={selectionDisabled ? '录音中不可切换设备，请先暂停' : device.name}
              className={`w-full min-h-[38px] px-2.5 py-2 rounded-lg text-left flex items-center gap-2 border transition-colors ${
                selected
                  ? 'border-accent-blue/70 bg-accent-blue/10 text-text-primary'
                  : 'border-transparent hover:border-bg-hover hover:bg-bg-hover/60 text-text-secondary'
              } ${selectionDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${device.is_loopback ? 'text-accent-blue' : 'text-text-muted'}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-text-primary">
                  {device.name}
                  {device.is_loopback ? ' ⟳' : ''}
                </span>
                <span className="block truncate text-[10px] text-text-muted">
                  {hidden && reason ? `${reason} · ` : ''}
                  {device.host_api}
                  {device.channels ? ` · ${device.channels}ch` : ''}
                </span>
              </span>
              {selected && <Check className="w-3.5 h-3.5 text-accent-blue flex-shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface AudioDevicePickerProps {
  devices: DeviceItem[]
  selectedDevice: number | null
  onSelect: (deviceId: number) => void
  onRefresh: () => Promise<void>
  refreshing: boolean
  selectionDisabled: boolean
}

export function AudioDevicePicker({
  devices,
  selectedDevice,
  onSelect,
  onRefresh,
  refreshing,
  selectionDisabled,
}: AudioDevicePickerProps) {
  const [open, setOpen] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { visible, hidden } = useMemo(() => splitAudioDevices(devices), [devices])
  const selected = devices.find((d) => d.id === selectedDevice) ?? null
  const visibleLoopbacks = visible.filter((d) => d.is_loopback)
  const visibleMics = visible.filter((d) => !d.is_loopback)
  const hiddenLoopbacks = hidden.filter(({ device }) => device.is_loopback)
  const hiddenMics = hidden.filter(({ device }) => !device.is_loopback)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelect = (deviceId: number) => {
    onSelect(deviceId)
    setOpen(false)
  }

  const handleRefresh = async () => {
    await onRefresh()
    setOpen(true)
  }

  return (
    <div ref={rootRef} className="relative flex-1 min-w-0 max-w-[190px] md:max-w-[230px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={selectionDisabled}
        aria-label="选择音频输入设备"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={selectionDisabled ? '录音中不可切换设备，请先暂停' : '选择音频输入设备'}
        className="w-full min-h-[36px] bg-bg-tertiary text-text-primary text-xs rounded-lg pl-2.5 pr-2 py-2 border border-bg-hover hover:bg-bg-hover/70 focus:outline-none focus:border-accent-blue flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {selected?.is_loopback ? (
          <Volume2 className="w-3.5 h-3.5 text-accent-blue flex-shrink-0" />
        ) : (
          <Mic className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
        <span className="min-w-0 flex-1 text-left truncate">
          {selected ? `当前: ${selected.name}${selected.is_loopback ? ' ⟳' : ''}` : '选择音频输入'}
        </span>
        {hidden.length > 0 && (
          <span
            className="hidden md:inline-flex rounded-md bg-accent-amber/15 px-1.5 py-0.5 text-[10px] text-accent-amber"
            title={`已自动隐藏 ${hidden.length} 个疑似无用设备`}
          >
            -{hidden.length}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-text-muted flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="音频输入设备列表"
          className="absolute left-0 bottom-full mb-2 z-50 w-[min(360px,calc(100vw-1.5rem))] rounded-xl border border-bg-hover bg-bg-primary shadow-2xl shadow-black/20 p-2"
        >
          <div className="flex items-center gap-2 px-1 pb-2 border-b border-bg-hover/60">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-text-primary">音频输入</div>
              <div className="text-[10px] text-text-muted">
                {hidden.length > 0 ? `已自动隐藏 ${hidden.length} 个疑似无用设备` : '未隐藏设备'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="刷新设备列表"
              title="刷新设备列表"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-secondary disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="max-h-[280px] overflow-y-auto py-2 space-y-3">
            {visible.length === 0 && (
              <div className="rounded-lg bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
                当前列表被自动过滤为空，可以显示全部设备后手动选择。
              </div>
            )}
            <DeviceGroup
              title="系统音频 (推荐)"
              devices={visibleLoopbacks}
              selectedDevice={selectedDevice}
              selectionDisabled={selectionDisabled}
              onSelect={handleSelect}
            />
            <DeviceGroup
              title="麦克风"
              devices={visibleMics}
              selectedDevice={selectedDevice}
              selectionDisabled={selectionDisabled}
              onSelect={handleSelect}
            />
            {showHidden && (
              <>
                <DeviceGroup
                  title="已隐藏的系统音频"
                  devices={hiddenLoopbacks}
                  selectedDevice={selectedDevice}
                  selectionDisabled={selectionDisabled}
                  hidden
                  onSelect={handleSelect}
                />
                <DeviceGroup
                  title="已隐藏设备"
                  devices={hiddenMics}
                  selectedDevice={selectedDevice}
                  selectionDisabled={selectionDisabled}
                  hidden
                  onSelect={handleSelect}
                />
              </>
            )}
          </div>

          {hidden.length > 0 && (
            <div className="pt-2 border-t border-bg-hover/60">
              <button
                type="button"
                onClick={() => setShowHidden((value) => !value)}
                aria-label={showHidden ? '隐藏无用设备' : '显示全部设备'}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-text-secondary hover:bg-bg-hover"
              >
                {showHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showHidden ? '隐藏无用设备' : `显示全部设备 (${hidden.length})`}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
