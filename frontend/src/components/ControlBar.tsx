import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Play,
  Square,
  Trash2,
  Upload,
  Send,
  FileText,
  X,
  AlertTriangle,
  Image as ImageIcon,
  Pause,
  PlayCircle,
  Zap,
  Loader2,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { api } from '@/lib/api'
import { ResumeMountInline } from '@/components/resume/ResumeMount'

const DEFAULT_QUICK_PROMPTS = [
  '写代码实现',
  '给SQL',
  '时间复杂度',
  '举个例子',
  '更详细',
  '对比区别',
  '优缺点',
  '应用场景',
  '简短回答',
]

const STORAGE_KEY = 'quick_prompts'

function getQuickPrompts(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  return DEFAULT_QUICK_PROMPTS
}

export function saveQuickPrompts(prompts: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts))
}

/**
 * Quick Prompts 最近使用：按时间戳记录最近点过的快捷词，限制最多 16 条。
 * 仅用于 UI 排序（recent-first）和顶部「最近用过」视觉标记，不持久化到后端。
 */
const RECENT_KEY = 'quick_prompts_recent_v1'
const RECENT_MAX = 16

export function readQuickPromptRecent(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    if (parsed && typeof parsed === 'object') return parsed
  } catch {}
  return {}
}

export function bumpQuickPromptRecent(prompt: string): Record<string, number> {
  const now = Date.now()
  const current = readQuickPromptRecent()
  current[prompt] = now
  const entries = Object.entries(current)
  if (entries.length > RECENT_MAX) {
    entries.sort((a, b) => b[1] - a[1])
    const kept = Object.fromEntries(entries.slice(0, RECENT_MAX))
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(kept))
    } catch {}
    return kept
  }
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(current))
  } catch {}
  return current
}

/**
 * 把 quickPrompts 按「最近使用时间」降序排序；未在 recent 中的保持原顺序追加。
 */
export function orderByRecent(
  prompts: string[],
  recent: Record<string, number>,
): string[] {
  const seen = new Set<string>()
  const withTs = prompts
    .filter((p) => recent[p] != null)
    .sort((a, b) => (recent[b] ?? 0) - (recent[a] ?? 0))
  const result: string[] = []
  for (const p of withTs) {
    if (seen.has(p)) continue
    seen.add(p)
    result.push(p)
  }
  for (const p of prompts) {
    if (seen.has(p)) continue
    seen.add(p)
    result.push(p)
  }
  return result
}

export { DEFAULT_QUICK_PROMPTS, STORAGE_KEY, RECENT_KEY, getQuickPrompts }

/**
 * WebSocket 断线后的轻量重连横幅:
 * - 不挤占焦点,仅视觉提示
 * - 显示断开时长 + 旋转指示器 (表示自动重连中)
 * - 仅在断开 10s+ 才提供 "手动刷新" 逃生通道, 且二次确认避免误触丢失对话
 */
function WsReconnectingBanner() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])
  const allowReload = elapsed >= 10
  const handleReload = () => {
    if (window.confirm('刷新页面将丢失当前转录与未保存的对话,确定继续?')) {
      window.location.reload()
    }
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-xs text-accent-amber bg-accent-amber/10 px-3 py-1.5 rounded-lg"
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
      <span>
        连接已断开 ({elapsed}s), 正在自动重连…
      </span>
      {allowReload && (
        <button
          type="button"
          onClick={handleReload}
          className="ml-auto text-accent-blue hover:underline font-medium"
          title="长时间未恢复时,手动刷新页面 (会丢失当前对话)"
        >
          手动刷新
        </button>
      )}
    </div>
  )
}

/**
 * 快捷词滚动行: 仅在内容真的溢出时才渲染左右渐变遮罩.
 * 小屏/少量快捷词时 (scrollWidth <= clientWidth) 不显示多余 fade.
 */
function QuickPromptsRow({
  prompts,
  onPick,
  recentSet,
}: {
  prompts: string[]
  onPick: (p: string) => void
  recentSet?: Set<string>
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [fadeLeft, setFadeLeft] = useState(false)
  const [fadeRight, setFadeRight] = useState(false)

  const recalc = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    const overflowing = el.scrollWidth - el.clientWidth > 1
    setFadeLeft(overflowing && el.scrollLeft > 2)
    setFadeRight(overflowing && el.scrollLeft < el.scrollWidth - el.clientWidth - 2)
  }, [])

  useEffect(() => {
    recalc()
    const el = rowRef.current
    if (!el) return
    el.addEventListener('scroll', recalc, { passive: true })
    const ro = new ResizeObserver(recalc)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', recalc)
      ro.disconnect()
    }
  }, [recalc, prompts.length])

  return (
    <div className="relative">
      <div
        ref={rowRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5"
        title="快捷提示词 · 点击填入下方输入框 (可在 设置 → 偏好 → 快捷提示词 中编辑)"
      >
        <Zap
          className="w-3 h-3 text-accent-amber flex-shrink-0"
          aria-label="快捷提示词"
        />
        {prompts.map((prompt, i) => {
          const isRecent = recentSet?.has(prompt) ?? false
          return (
            <button
              key={`${i}-${prompt}`}
              onClick={() => onPick(prompt)}
              title={isRecent ? `最近使用过 · 填入「${prompt}」到输入框` : `填入「${prompt}」到输入框`}
              className={`prompt-pill inline-flex items-center gap-1 min-h-[28px] px-2.5 py-1 text-[11px] rounded-lg font-medium whitespace-nowrap flex-shrink-0${
                isRecent ? ' ring-1 ring-accent-blue/40 text-accent-blue' : ''
              }`}
            >
              {isRecent && (
                <span
                  className="inline-flex w-1 h-1 rounded-full bg-accent-blue/80"
                  aria-hidden
                />
              )}
              {prompt}
            </button>
          )
        })}
      </div>
      {fadeLeft && (
        <div
          className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-bg-primary to-transparent"
          aria-hidden
        />
      )}
      {fadeRight && (
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-bg-primary to-transparent"
          aria-hidden
        />
      )}
    </div>
  )
}

export default function ControlBar() {
  // 精确订阅 14 个字段, 避免 store 任意字段(LLM token / audioLevel 等)变化触发 ControlBar 重渲染
  const {
    isRecording,
    isPaused,
    devices,
    config,
    platformInfo,
    clearSession,
    streamingIds,
    qaPairs,
    transcriptions,
    setToastMessage,
    lastWSError,
    setLastWSError,
    wsConnected,
    modelHealth,
  } = useInterviewStore(
    useShallow((s) => ({
      isRecording: s.isRecording,
      isPaused: s.isPaused,
      devices: s.devices,
      config: s.config,
      platformInfo: s.platformInfo,
      clearSession: s.clearSession,
      streamingIds: s.streamingIds,
      qaPairs: s.qaPairs,
      transcriptions: s.transcriptions,
      setToastMessage: s.setToastMessage,
      lastWSError: s.lastWSError,
      setLastWSError: s.setLastWSError,
      wsConnected: s.wsConnected,
      modelHealth: s.modelHealth,
    })),
  )
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null)
  const [manualQuestion, setManualQuestion] = useState('')
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cancellingAsk, setCancellingAsk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allModelsUnavailable = config?.models && config.models.length > 0 &&
    config.models.every((_, i) => modelHealth[i] === 'error')
  const showColdStartHint =
    !isRecording &&
    transcriptions.length === 0 &&
    qaPairs.length === 0 &&
    (devices.length === 0 || selectedDevice === null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)
  const [quickPrompts, setQuickPrompts] = useState<string[]>(getQuickPrompts)
  const [quickPromptRecent, setQuickPromptRecent] = useState<Record<string, number>>(readQuickPromptRecent)
  const orderedQuickPrompts = useMemo(
    () => orderByRecent(quickPrompts, quickPromptRecent),
    [quickPrompts, quickPromptRecent],
  )
  const recentSet = useMemo(() => {
    // 只把排序后靠前且真被标记的前 3 项视为「最近使用」
    const s = new Set<string>()
    const withTs = quickPrompts
      .filter((p) => quickPromptRecent[p] != null)
      .sort((a, b) => (quickPromptRecent[b] ?? 0) - (quickPromptRecent[a] ?? 0))
      .slice(0, 3)
    for (const p of withTs) s.add(p)
    return s
  }, [quickPrompts, quickPromptRecent])

  // WebSocket 从断开恢复时 toast 通知,避免用户误以为系统没反应
  const prevWsConnectedRef = useRef(wsConnected)
  useEffect(() => {
    if (!prevWsConnectedRef.current && wsConnected) {
      setToastMessage('连接已恢复')
    }
    prevWsConnectedRef.current = wsConnected
  }, [wsConnected, setToastMessage])

  useEffect(() => {
    const onStorage = () => setQuickPrompts(getQuickPrompts())
    window.addEventListener('storage', onStorage)
    window.addEventListener('quick-prompts-updated', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('quick-prompts-updated', onStorage)
    }
  }, [])

  const selectedIsLoopback = devices.find((d) => d.id === selectedDevice)?.is_loopback ?? false
  const hasLoopback = devices.some((d) => d.is_loopback)
  const activeModel = config?.models?.[config.active_model]
  const activeModelSupportsVision = activeModel?.supports_vision ?? false

  useEffect(() => {
    if (devices.length === 0) {
      if (selectedDevice !== null) setSelectedDevice(null)
      return
    }
    if (selectedDevice !== null && devices.some((d) => d.id === selectedDevice)) return
    const loopback = devices.find((d) => d.is_loopback)
    setSelectedDevice(loopback?.id ?? devices[0].id)
  }, [devices, selectedDevice])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault()
        const file = items[i].getAsFile()
        if (!file) continue
        const store = useInterviewStore.getState()
        const activeModel = store.config?.models?.[store.config?.active_model ?? 0]
        if (activeModel && !activeModel.supports_vision) {
          setError(`当前模型「${activeModel.name}」不支持图片识别，请先切换到带 👁 标记的模型再粘贴截图`)
          return
        }
        const reader = new FileReader()
        reader.onload = (ev) => {
          const result = ev.target?.result as string
          if (result) setPastedImage(result)
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }, [])

  const handleStart = useCallback(async () => {
    if (selectedDevice === null) { setError('请先选择音频设备'); return }
    setLoading(true); setError(null)
    try {
      await api.start(selectedDevice)
      const s = useUiPrefsStore.getState()
      if (s.interviewOverlayEnabled && window.electronAPI?.syncOverlayWindow) {
        window.electronAPI.syncOverlayWindow({
          enabled: true,
          visible: true,
          opacity: s.interviewOverlayOpacity,
          fontSize: s.interviewOverlayFontSize,
          fontColor: s.interviewOverlayFontColor,
          showBg: s.interviewOverlayShowBg,
          maxLines: s.interviewOverlayMaxLines,
        }).catch(() => {})
      }
    }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [selectedDevice])
  const handleStop = useCallback(async () => {
    if (isRecording && !window.confirm('结束本次面试？将停止录音，当前转录与答案会保留在页面上。')) return
    setLoading(true)
    try {
      await api.stop()
      window.electronAPI?.syncOverlayWindow?.({ visible: false }).catch(() => {})
    } catch {} finally { setLoading(false) }
  }, [isRecording])
  const handlePause = useCallback(async () => {
    setLoading(true)
    try { await api.pause() } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])
  const handleResume = useCallback(async () => {
    setLoading(true)
    try { await api.resume(selectedDevice ?? undefined) } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [selectedDevice])
  const handleClear = useCallback(async () => {
    if (qaPairs.length > 0 || transcriptions.length > 0) {
      if (!window.confirm('确定要清空当前页的转录与答案吗？清空后不可恢复。')) return
    }
    setClearing(true)
    try {
      await api.clear()
      clearSession()
      setToastMessage('已清空')
    } catch (e: any) { setError(e.message) }
    finally { setClearing(false) }
  }, [qaPairs.length, transcriptions.length, clearSession, setToastMessage])

  const handleCancelAsk = useCallback(async () => {
    setCancellingAsk(true)
    try {
      await api.cancelAsk()
      setToastMessage('已发送取消')
    } catch {}
    setTimeout(() => setCancellingAsk(false), 500)
  }, [setToastMessage])

  const handleAsk = useCallback(async () => {
    if (!manualQuestion.trim() && !pastedImage) return
    if (pastedImage && !activeModelSupportsVision) {
      setError(`当前模型「${activeModel?.name ?? '未命名模型'}」不支持图片识别，请切换到带 👁 标记的模型后再发送截图`)
      return
    }
    try {
      await api.ask(manualQuestion.trim(), pastedImage || undefined)
      setManualQuestion('')
      setPastedImage(null)
    } catch (e: any) { setError(e.message) }
  }, [manualQuestion, pastedImage, activeModelSupportsVision, activeModel?.name])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isComposingRef.current) return
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() }
  }, [handleAsk])

  const handleQuickPromptPick = useCallback((prompt: string) => {
    setManualQuestion((prev) => (prev ? `${prev} ${prompt}` : prompt))
    inputRef.current?.focus()
    setQuickPromptRecent(bumpQuickPromptRecent(prompt))
  }, [])

  return (
    <div className="control-bar px-3 md:px-5 py-2.5 flex-shrink-0 space-y-1.5">
      {showColdStartHint && (
        <div className="flex items-center gap-2 text-xs text-accent-amber bg-accent-amber/10 px-3 py-1.5 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            {devices.length === 0
              ? '正在检测音频设备…如长时间未出现，请检查麦克风/系统音频权限'
              : '请先选择音频设备，再点击「开始」开始面试。'}
          </span>
        </div>
      )}
      {!wsConnected && <WsReconnectingBanner />}
      {allModelsUnavailable && (
        <div className="flex items-center gap-2 text-xs text-accent-red bg-accent-red/10 px-3 py-1.5 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>所有模型不可用，请检查 API 与网络。</span>
        </div>
      )}
      {!hasLoopback && platformInfo?.needs_virtual_device && (
        <div className="flex items-start gap-2 text-xs text-accent-amber bg-accent-amber/10 px-3 py-2 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">未检测到系统音频设备。</span>
            <span className="text-text-muted"> 当前只有麦克风，无法录制面试官的声音。</span>
            <span className="text-accent-blue cursor-pointer" onClick={() => useInterviewStore.getState().toggleSettings()}> 查看配置说明</span>
          </div>
        </div>
      )}
      {selectedDevice !== null && !selectedIsLoopback && hasLoopback && (
        <div className="flex items-center gap-2 text-xs text-accent-amber bg-accent-amber/10 px-3 py-1.5 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>你选择的是麦克风，建议选择带 ⟳ 标记的系统音频设备</span>
        </div>
      )}
      {lastWSError && (
        <div className="flex items-center gap-2 text-xs text-accent-red bg-accent-red/10 px-3 py-1.5 rounded-lg">
          <span>{lastWSError}</span>
          <button onClick={() => setLastWSError(null)} className="ml-auto" aria-label="关闭"><X className="w-3 h-3" /></button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-xs text-accent-red bg-accent-red/10 px-3 py-1.5 rounded-lg">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto" aria-label="关闭错误"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Image preview */}
      {pastedImage && (() => {
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary/50 rounded-lg">
            <img src={pastedImage} alt="screenshot" className="h-12 max-w-[200px] rounded object-contain border border-bg-hover" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-text-muted">已粘贴截图</span>
              {!activeModelSupportsVision && (
                <span className="text-[10px] text-accent-amber">当前模型不支持图片，请切换到带 👁 标记的模型后再发送</span>
              )}
            </div>
            <button onClick={() => setPastedImage(null)} className="text-text-muted hover:text-accent-red ml-auto">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })()}

      {/* 移动端：录制中时显示状态指示条 */}
      {isRecording && (
        <div className={`flex md:hidden items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium ${isPaused ? 'bg-accent-amber/15 text-accent-amber' : 'bg-accent-green/15 text-accent-green'}`}>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-accent-amber' : 'bg-accent-green animate-pulse'}`} />
            <span>{isPaused ? '已暂停' : '录制中'}</span>
          </div>
        </div>
      )}

      {/* 主控制行 */}
      <div className="flex items-center gap-2">
        <select
          value={selectedDevice ?? ''}
          onChange={async (e) => {
            const newId = Number(e.target.value)
            setSelectedDevice(newId)
            // 暂停中切换设备：只更新选中的设备，不自动恢复，让用户手动点"继续"
          }}
          className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-2 border border-bg-hover focus:outline-none focus:border-accent-blue flex-1 min-w-0 max-w-[180px] md:max-w-[200px]"
          disabled={isRecording && !isPaused}
          title={isRecording && !isPaused ? '录音中不可切换设备，请先暂停' : '选择音频输入设备'}
        >
          {devices.some((d) => d.is_loopback) && (
            <optgroup label="🔊 系统音频 (推荐)">
              {devices.filter((d) => d.is_loopback).map((d) => (
                <option key={d.id} value={d.id}>{d.name} ⟳</option>
              ))}
            </optgroup>
          )}
          <optgroup label="🎤 麦克风">
            {devices.filter((d) => !d.is_loopback).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </optgroup>
        </select>

        {isRecording ? (
          <>
            {isPaused ? (
              <button onClick={handleResume} disabled={loading}
                className="flex items-center gap-1.5 px-3.5 py-2 btn-primary text-xs font-semibold rounded-xl disabled:opacity-50 flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent-green)), rgb(var(--c-accent-green) / 0.85))' }}>
                <PlayCircle className="w-3.5 h-3.5" />
                <span>继续</span>
              </button>
            ) : (
              <button onClick={handlePause} disabled={loading}
                className="flex items-center gap-1.5 px-3.5 py-2 text-white text-xs font-semibold rounded-xl transition-all duration-150 disabled:opacity-50 flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent-amber)), rgb(var(--c-accent-amber) / 0.85))' }}>
                <Pause className="w-3.5 h-3.5" />
                <span>暂停</span>
              </button>
            )}
            <button onClick={handleStop} disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 btn-danger text-xs font-semibold rounded-xl disabled:opacity-50 flex-shrink-0">
              <Square className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">结束面试</span>
            </button>
          </>
        ) : (
          <button onClick={handleStart} disabled={loading || selectedDevice === null}
            className="flex items-center gap-1.5 px-4 py-2 btn-primary text-xs font-semibold rounded-xl disabled:opacity-50 flex-shrink-0">
            <Play className="w-3.5 h-3.5" />
            <span>开始面试</span>
          </button>
        )}

        <ResumeMountInline />

        {streamingIds.length > 0 && (
          <button onClick={handleCancelAsk} disabled={cancellingAsk}
            className="flex items-center gap-1 min-h-[36px] min-w-[36px] justify-center px-2 py-2 bg-accent-amber/20 hover:bg-accent-amber/30 text-accent-amber text-xs rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
            aria-label={cancellingAsk ? '正在取消生成' : '取消正在生成的回答'}
            title="取消全部正在生成的回答">
            {cancellingAsk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">
              {cancellingAsk ? '取消中' : streamingIds.length > 1 ? `取消生成 (${streamingIds.length})` : '取消生成'}
            </span>
          </button>
        )}
        <button
          onClick={handleClear}
          disabled={clearing}
          title={qaPairs.length > 30 ? `当前会话较长 (${qaPairs.length} 条), 建议清空以保持流畅` : '清空当前页的实时转录与 AI 答案 (不影响历史)'}
          aria-label={qaPairs.length > 30 ? `清空当前 ${qaPairs.length} 条转录与答案` : '清空当前转录与答案'}
          className={`relative flex items-center gap-1 min-h-[36px] min-w-[36px] justify-center px-2 py-2 text-xs rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 ${
            qaPairs.length > 30
              ? 'bg-accent-amber/20 hover:bg-accent-amber/30 text-accent-amber'
              : 'bg-bg-tertiary hover:bg-bg-hover hover:text-accent-red text-text-secondary'
          }`}
        >
          {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{clearing ? '清空中' : '清空内容'}</span>
          {qaPairs.length > 30 && !clearing && (
            <span className="ml-0.5 text-[10px] tabular-nums hidden md:inline">({qaPairs.length})</span>
          )}
        </button>
      </div>

      {/* 快捷提示词 */}
      {quickPrompts.length > 0 && (
        <QuickPromptsRow
          prompts={orderedQuickPrompts}
          recentSet={recentSet}
          onPick={handleQuickPromptPick}
        />
      )}

      {/* 手动提问输入行 */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <input ref={inputRef} type="text" value={manualQuestion}
            onChange={(e) => setManualQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { isComposingRef.current = true }}
            onCompositionEnd={() => { setTimeout(() => { isComposingRef.current = false }, 0) }}
            onPaste={handlePaste}
            placeholder={pastedImage ? "可添加文字说明（可选），Enter 发送" : "输入问题，Enter 发送…"}
            className="w-full bg-bg-tertiary/60 text-text-primary text-xs rounded-xl px-3.5 py-2.5 border border-bg-hover/50 focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/20 placeholder:text-text-muted/60 pr-8 transition-all duration-200" />
          {pastedImage && (
            <ImageIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-accent-green" />
          )}
        </div>
        <button
          onClick={handleAsk}
          disabled={!manualQuestion.trim() && !pastedImage}
          title={manualQuestion.trim() || pastedImage ? '发送问题 (Enter)' : '请先输入问题或粘贴截图'}
          aria-label="发送问题"
          className="px-3 py-2.5 btn-primary text-xs rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
