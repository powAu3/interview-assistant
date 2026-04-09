import { useEffect, useState, useRef } from 'react'
import { Settings, SlidersHorizontal, MonitorSmartphone } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { useShortcutsStore } from '@/stores/shortcutsStore'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { api } from '@/lib/api'
import TranscriptionPanel from '@/components/TranscriptionPanel'
import AnswerPanel from '@/components/AnswerPanel'
import ControlBar from '@/components/ControlBar'
import SettingsDrawer from '@/components/SettingsDrawer'
import PracticeMode from '@/components/PracticeMode'
import KnowledgeMap from '@/components/KnowledgeMap'
import ResumeOptimizer from '@/components/ResumeOptimizer'
import JobTracker from '@/components/JobTracker'

export default function App() {
  useInterviewWS()
  const {
    config,
    setConfig,
    setDevices,
    setOptions,
    toggleSettings,
    openConfigDrawer,
    openModelsDrawer,
    sttLoaded,
    sttLoading,
    isRecording,
    interviewOverlayEnabled,
    interviewOverlayMode,
    interviewOverlayOpacity,
    interviewOverlayLyricLines,
    interviewOverlayLyricFontSize,
    interviewOverlayLyricWidth,
    setInterviewOverlayEnabled,
    setInterviewOverlayMode,
    setInterviewOverlayOpacity,
    setInterviewOverlayLyricLines,
    setInterviewOverlayLyricFontSize,
    setInterviewOverlayLyricWidth,
  } =
    useInterviewStore()
  const [initError, setInitError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<'transcript' | 'answer'>('answer')
  const [appMode, setAppMode] = useState<
    'assist' | 'practice' | 'knowledge' | 'resume-opt' | 'job-tracker'
  >('assist')

  useEffect(() => {
    if (!window.electronAPI?.syncOverlayWindow) return
    window.electronAPI.syncOverlayWindow({
      enabled: interviewOverlayEnabled,
      visible: interviewOverlayEnabled && isRecording && appMode === 'assist',
      mode: interviewOverlayMode,
      opacity: interviewOverlayOpacity,
      lyricLines: interviewOverlayLyricLines,
      lyricFontSize: interviewOverlayLyricFontSize,
      lyricWidth: interviewOverlayLyricWidth,
    }).catch(() => {})
  }, [
    appMode,
    interviewOverlayEnabled,
    interviewOverlayLyricLines,
    interviewOverlayLyricFontSize,
    interviewOverlayLyricWidth,
    interviewOverlayMode,
    interviewOverlayOpacity,
    isRecording,
  ])

  useEffect(() => {
    if (!window.electronAPI?.onOverlayState) return
    window.electronAPI.onOverlayState((payload) => {
      setInterviewOverlayEnabled(payload.enabled)
      setInterviewOverlayMode(payload.mode)
      setInterviewOverlayOpacity(payload.opacity)
      setInterviewOverlayLyricLines(payload.lyricLines)
      setInterviewOverlayLyricFontSize(payload.lyricFontSize)
      setInterviewOverlayLyricWidth(payload.lyricWidth)
    })
    return () => window.electronAPI?.removeOverlayStateListener?.()
  }, [
    setInterviewOverlayEnabled,
    setInterviewOverlayLyricFontSize,
    setInterviewOverlayLyricLines,
    setInterviewOverlayLyricWidth,
    setInterviewOverlayMode,
    setInterviewOverlayOpacity,
  ])

  // job-tracker is now available on both web and Electron
  const [editingPos, setEditingPos] = useState(false)
  const [editingLang, setEditingLang] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [serverScreenLoading, setServerScreenLoading] = useState(false)

  /** md+ 实时辅助：左右分栏比例（%），持久化 localStorage */
  const ASSIST_SPLIT_KEY = 'ia_assist_split_pct'
  const assistSplitContainerRef = useRef<HTMLDivElement>(null)
  const assistSplitDragging = useRef(false)
  const assistSplitPctRef = useRef(32)
  const [assistSplitPct, setAssistSplitPct] = useState(32)
  const persistAssistSplit = (nextPct: number) => {
    try {
      localStorage.setItem(ASSIST_SPLIT_KEY, String(Math.round(nextPct * 10) / 10))
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    assistSplitPctRef.current = assistSplitPct
  }, [assistSplitPct])
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ASSIST_SPLIT_KEY)
      if (raw == null) return
      const v = parseFloat(raw)
      if (Number.isFinite(v)) {
        const c = Math.min(62, Math.max(24, v))
        assistSplitPctRef.current = c
        setAssistSplitPct(c)
      }
    } catch {
      /* ignore */
    }
  }, [])
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!assistSplitDragging.current || !assistSplitContainerRef.current) return
      const r = assistSplitContainerRef.current.getBoundingClientRect()
      if (r.width < 80) return
      const p = ((e.clientX - r.left) / r.width) * 100
      const c = Math.min(62, Math.max(24, p))
      assistSplitPctRef.current = c
      setAssistSplitPct(c)
    }
    const onUp = () => {
      if (!assistSplitDragging.current) return
      assistSplitDragging.current = false
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      persistAssistSplit(assistSplitPctRef.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [])


  useEffect(() => {
    Promise.all([
      api.getConfig().then(setConfig),
      api.getDevices().then((d) => setDevices(d.devices, d.platform)),
      api.getOptions().then(setOptions),
    ]).then(() => {
      api.checkModelsHealth().catch(() => {})
    }).catch((e) => setInitError(e.message))
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.getShortcuts) return
    window.electronAPI.getShortcuts()
      .then((shortcuts) => useShortcutsStore.getState().setShortcuts(shortcuts))
      .catch(() => {})
  }, [])

  const hasGuided = useRef(false)
  useEffect(() => {
    if (!config || hasGuided.current) return
    if (!config.api_key_set) {
      hasGuided.current = true
      openModelsDrawer()
    }
  }, [config, openModelsDrawer])

  const handlePositionChange = async (val: string) => {
    const v = val.trim()
    if (v && v !== config?.position) {
      await api.updateConfig({ position: v })
      setConfig(await api.getConfig())
    }
  }
  const handleLanguageChange = async (val: string) => {
    const v = val.trim()
    if (v && v !== config?.language) {
      await api.updateConfig({ language: v })
      setConfig(await api.getConfig())
    }
  }
  const handleModelChange = async (active_model: number) => {
    await api.updateConfig({ active_model })
    setConfig(await api.getConfig())
    useInterviewStore.getState().setToastMessage('已设为优先答题模型（实时辅助优先占用该路）')
  }
  const handleThinkToggle = async () => {
    await api.updateConfig({ think_mode: !config?.think_mode })
    setConfig(await api.getConfig())
  }

  const handleServerScreenAsk = async () => {
    setServerScreenLoading(true)
    try {
      await api.askFromServerScreen()
      useInterviewStore.getState().setToastMessage('已按当前截图区域配置提交服务端截图审题，请在答案区查看')
    } catch (e: unknown) {
      useInterviewStore.getState().setToastMessage(e instanceof Error ? e.message : '提交失败')
    } finally {
      setServerScreenLoading(false)
    }
  }

  if (initError) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-primary">
        <div className="text-center space-y-3 p-8">
          <p className="text-accent-red text-sm">连接后端失败</p>
          <p className="text-text-muted text-xs">{initError}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-accent-blue text-white text-xs rounded-lg">重试</button>
        </div>
      </div>
    )
  }

  const options = useInterviewStore((s) => s.options)
  const activeModel = config?.models?.[config.active_model]
  const modelHealth = useInterviewStore((s) => s.modelHealth)
  const tokenUsage = useInterviewStore((s) => s.tokenUsage)
  const fallbackToast = useInterviewStore((s) => s.fallbackToast)
  const toastMessage = useInterviewStore((s) => s.toastMessage)

  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  useEffect(() => {
    if (!fallbackToast) return
    const timer = setTimeout(() => useInterviewStore.getState().setFallbackToast(null), 4000)
    return () => clearTimeout(timer)
  }, [fallbackToast])
  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => useInterviewStore.getState().setToastMessage(null), 2000)
    return () => clearTimeout(timer)
  }, [toastMessage])
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const healthDot = (idx: number) => {
    const status = modelHealth[idx]
    if (status === 'ok') return 'bg-accent-green'
    if (status === 'checking') return 'bg-accent-amber animate-pulse'
    if (status === 'error') return 'bg-accent-red'
    return 'bg-text-muted/30'
  }

  const moduleTabs = [
    ['assist', '实时辅助', 'Console'],
    ['practice', '模拟练习', 'Practice'],
    ['knowledge', '能力分析', 'Insight'],
    ['resume-opt', '简历优化', 'Resume'],
    ['job-tracker', '求职看板', 'Tracker'],
  ] as const

  const sttLabel = sttLoaded ? 'STT 就绪' : sttLoading ? '语音模型加载中' : 'STT 未加载'
  const telemetryCards = [
    {
      key: 'stt',
      label: 'Speech',
      value: sttLoaded ? 'Ready' : sttLoading ? 'Loading' : 'Offline',
      detail: sttLabel,
      tone: sttLoaded
        ? 'text-accent-green border-accent-green/20 bg-accent-green/10'
        : sttLoading
          ? 'text-accent-amber border-accent-amber/20 bg-accent-amber/10'
          : 'text-accent-red border-accent-red/20 bg-accent-red/10',
    },
    tokenUsage.total > 0
      ? {
          key: 'token',
          label: 'Token',
          value: formatTokens(tokenUsage.total),
          detail: `Prompt ${formatTokens(tokenUsage.prompt)} · Completion ${formatTokens(tokenUsage.completion)}`,
          tone: 'text-accent-blue border-accent-blue/20 bg-accent-blue/10',
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string
    label: string
    value: string
    detail: string
    tone: string
  }>

  return (
    <div className="h-screen flex flex-col bg-bg-primary overflow-hidden noise-bg">
      {/* Header */}
      <header className="ia-header-shell flex flex-col gap-3 px-3 py-3 md:px-5 md:py-4 flex-shrink-0">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-accent-blue/15 bg-gradient-to-br from-accent-blue/20 via-accent-blue/10 to-transparent shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                  <span className="text-xl">🎙️</span>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-base font-bold tracking-tight text-text-primary md:text-lg">学习助手</h1>
                    <span className="rounded-full border border-bg-hover/60 bg-bg-tertiary/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">
                      Assist Console
                    </span>
                  </div>
                  <p className="max-w-2xl text-xs leading-relaxed text-text-secondary md:text-[13px]">
                    把实时辅助、模型调度与关键设置聚合到一处，让主控制动作更靠前，遥测信息退居辅助位。
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 lg:justify-end">
                {telemetryCards.map((card) => (
                  <div
                    key={card.key}
                    className={`min-w-[124px] rounded-2xl border px-3 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.08)] ${card.tone}`}
                    title={
                      card.key === 'token'
                        ? [
                            `总计 ${tokenUsage.total}（Prompt ${tokenUsage.prompt} + Completion ${tokenUsage.completion}）`,
                            ...Object.entries(tokenUsage.byModel || {}).map(
                              ([name, v]) => `${name}: P ${v.prompt} · C ${v.completion}`,
                            ),
                          ].join('\n')
                        : card.detail
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                        {card.label}
                      </span>
                      <span className="text-xs font-semibold text-text-primary">{card.value}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-secondary">{card.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="ia-console-panel rounded-[24px] p-1.5">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="px-2.5 pt-1.5 lg:hidden">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Modules</p>
                </div>
                <div
                  className="flex overflow-x-auto rounded-[20px] border border-bg-hover/30 bg-bg-tertiary/20 p-1 scrollbar-none"
                  role="tablist"
                  aria-label="功能模块"
                >
                  {moduleTabs.map(([key, label, hint]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={appMode === key}
                      onClick={() => setAppMode(key)}
                      className={`group flex min-w-[110px] flex-col items-start rounded-2xl px-3 py-2 text-left transition-all duration-200 whitespace-nowrap flex-shrink-0 ${
                        appMode === key
                          ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/20'
                          : 'text-text-muted hover:bg-bg-hover/40 hover:text-text-primary'
                      }`}
                    >
                      <span className="text-[11px] font-semibold tracking-tight">{label}</span>
                      <span className={`text-[10px] ${appMode === key ? 'text-white/75' : 'text-text-muted/70 group-hover:text-text-secondary'}`}>
                        {hint}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="hidden lg:block pr-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Mode switcher</p>
                </div>
              </div>
            </div>
          </div>

          <div className="ia-console-panel flex w-full max-w-full flex-col gap-2 rounded-[24px] p-3 xl:w-[520px] xl:flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Active controls</p>
                <p className="text-xs text-text-secondary">模型、上下文与系统入口</p>
              </div>
              <div className="flex items-center gap-1 rounded-full border border-bg-hover/50 bg-bg-tertiary/25 px-2 py-1">
                <div className={`h-1.5 w-1.5 rounded-full ${sttLoaded ? 'bg-accent-green' : sttLoading ? 'bg-accent-amber animate-pulse' : 'bg-accent-red'}`} />
                <span className="text-[10px] font-medium text-text-muted">{sttLabel}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleThinkToggle}
                className={`flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl border transition-all duration-200 cursor-pointer select-none flex-shrink-0
                  ${config?.think_mode
                    ? 'border-accent-green/40 bg-accent-green/10 text-accent-green shadow-sm shadow-accent-green/10'
                    : 'border-bg-hover/60 bg-bg-tertiary/50 text-text-secondary hover:border-text-muted/30 hover:text-text-primary'}`}
                title="Think·全局：开启后请求模型思考能力（与配置页同步）"
                aria-label={`Think 全局 ${config?.think_mode ? '开启' : '关闭'}`}
              >
                <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap leading-none">
                  Think
                </span>
                <span
                  className={`relative inline-flex w-8 h-[18px] rounded-full transition-colors duration-200 flex-shrink-0 ${config?.think_mode ? 'bg-accent-green' : 'bg-bg-hover/80'}`}
                  aria-hidden
                >
                  <span
                    className={`absolute top-[2px] left-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${config?.think_mode ? 'translate-x-[14px]' : ''}`}
                  />
                </span>
              </button>
              {config?.models && config.models.length > 0 && (
                <div className="relative" ref={modelDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                    title="优先答题模型"
                    className="flex items-center gap-1.5 bg-bg-tertiary/50 text-text-primary text-xs rounded-xl px-2.5 py-1.5 border border-bg-hover/50 hover:border-accent-blue/40 transition-all duration-200 max-w-[130px] md:max-w-[160px]"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthDot(config.active_model)}`} />
                    <span className="truncate min-w-0 font-medium">{activeModel?.name}{activeModel?.supports_vision ? ' 👁' : ''}</span>
                    <svg className={`w-3 h-3 flex-shrink-0 text-text-muted transition-transform duration-200 ${modelDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {modelDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1.5 glass border border-bg-hover/50 rounded-xl shadow-xl shadow-black/20 z-50 min-w-[200px] py-1.5 animate-fade-up">
                      {config.models.map((m, i) => (
                        <button key={i}
                          onClick={async () => { setModelDropdownOpen(false); await handleModelChange(i) }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-bg-tertiary/50 transition-all duration-150 ${i === config.active_model ? 'text-accent-blue bg-accent-blue/5' : 'text-text-primary'}`}>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${healthDot(i)}`} />
                          <span className="truncate font-medium">{m.name}{m.supports_vision ? ' 👁' : ''}</span>
                          {i === config.active_model && <span className="ml-auto text-accent-blue text-[10px] font-semibold">优先</span>}
                        </button>
                      ))}
                      <div className="border-t border-bg-hover/40 mt-1 pt-1 px-3 py-1.5">
                        <button onClick={() => { api.checkModelsHealth().catch(() => {}); }}
                          className="text-[10px] text-text-muted hover:text-accent-blue transition-colors font-medium">
                          重新检查连接
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Position</p>
                {editingPos ? (
                  <input value={customInput} onChange={(e) => setCustomInput(e.target.value)} autoFocus
                    onBlur={() => { if (customInput.trim()) handlePositionChange(customInput.trim()); setEditingPos(false) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingPos(false) }}
                    placeholder="输入岗位" className="w-full bg-bg-tertiary text-text-primary text-xs rounded-xl px-3 py-2 border border-accent-blue focus:outline-none" />
                ) : (
                  <select value={config?.position ?? ''} onChange={(e) => {
                    if (e.target.value === '__custom__') { setCustomInput(''); setEditingPos(true) }
                    else handlePositionChange(e.target.value)
                  }} className="w-full bg-bg-tertiary text-text-primary text-xs rounded-xl px-3 py-2 border border-bg-hover focus:outline-none focus:border-accent-blue">
                    {(options?.positions ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                    {config?.position && !(options?.positions ?? []).includes(config.position) && (
                      <option value={config.position}>{config.position}</option>
                    )}
                    <option value="__custom__">自定义...</option>
                  </select>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Language</p>
                {editingLang ? (
                  <input value={customInput} onChange={(e) => setCustomInput(e.target.value)} autoFocus
                    onBlur={() => { if (customInput.trim()) handleLanguageChange(customInput.trim()); setEditingLang(false) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingLang(false) }}
                    placeholder="输入语言" className="w-full bg-bg-tertiary text-text-primary text-xs rounded-xl px-3 py-2 border border-accent-blue focus:outline-none" />
                ) : (
                  <select value={config?.language ?? ''} onChange={(e) => {
                    if (e.target.value === '__custom__') { setCustomInput(''); setEditingLang(true) }
                    else handleLanguageChange(e.target.value)
                  }} className="w-full bg-bg-tertiary text-text-primary text-xs rounded-xl px-3 py-2 border border-bg-hover focus:outline-none focus:border-accent-blue">
                    {(options?.languages ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
                    {config?.language && !(options?.languages ?? []).includes(config.language) && (
                      <option value={config.language}>{config.language}</option>
                    )}
                    <option value="__custom__">自定义...</option>
                  </select>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl border border-bg-hover/50 bg-bg-tertiary/20 px-3 py-2.5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">System</p>
                <p className="text-xs text-text-secondary">设置、并行/VAD/悬浮提示窗入口</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={toggleSettings}
                  className="p-1.5 rounded-xl hover:bg-bg-tertiary/60 text-text-muted hover:text-text-primary transition-all duration-200 border border-transparent hover:border-bg-hover/40"
                  title="设置"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={openConfigDrawer}
                    className="p-1.5 rounded-xl hover:bg-bg-tertiary/60 text-text-muted hover:text-accent-blue transition-all duration-200 border border-transparent hover:border-accent-blue/20 flex-shrink-0"
                    title="配置：模型并行、VAD、LLM、悬浮提示窗（Beta）"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </button>
                  <span className="px-1.5 py-0.5 rounded-full border border-accent-amber/30 bg-accent-amber/10 text-[9px] font-semibold tracking-[0.12em] uppercase text-accent-amber">
                    Beta
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Assist Mode ── */}
      {appMode === 'assist' && (
        <>
          {/* Mobile tab switcher */}
          <div className="flex-shrink-0 px-3 pt-2 md:hidden">
            <div className="ia-console-panel flex rounded-[20px] p-1">
              <button onClick={() => setMobileTab('transcript')}
                className={`flex-1 rounded-2xl py-2 text-xs font-medium text-center transition-all ${mobileTab === 'transcript' ? 'bg-accent-blue text-white shadow-sm shadow-accent-blue/20' : 'text-text-muted'}`}>
                实时转录
              </button>
              <button onClick={() => setMobileTab('answer')}
                className={`flex-1 rounded-2xl py-2 text-xs font-medium text-center transition-all ${mobileTab === 'answer' ? 'bg-accent-blue text-white shadow-sm shadow-accent-blue/20' : 'text-text-muted'}`}>
                AI 答案
              </button>
            </div>
          </div>

          <div
            ref={assistSplitContainerRef}
            className="flex-1 hidden md:flex overflow-hidden min-h-0 px-3 pb-3 pt-2 md:px-4 md:pb-4 gap-0"
          >
            <div
              className="flex flex-col min-w-0 flex-shrink-0 pr-2"
              style={{
                width: `${assistSplitPct}%`,
                minWidth: '220px',
                maxWidth: '70%',
              }}
            >
              <TranscriptionPanel />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调节转录区与答案区宽度"
              aria-valuemin={24}
              aria-valuemax={62}
              aria-valuenow={Math.round(assistSplitPct)}
              tabIndex={0}
              className="w-2 flex-shrink-0 cursor-col-resize group relative z-10 outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50 focus-visible:ring-inset bg-transparent transition-all duration-150"
              title="拖动调节左右宽度；双击恢复默认比例"
              onMouseDown={(e) => {
                e.preventDefault()
                assistSplitDragging.current = true
                document.body.style.cursor = 'col-resize'
                document.body.style.userSelect = 'none'
              }}
              onDoubleClick={(e) => {
                e.preventDefault()
                const c = 32
                assistSplitPctRef.current = c
                setAssistSplitPct(c)
                persistAssistSplit(c)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  const delta = e.key === 'ArrowLeft' ? -2 : 2
                  const c = Math.min(62, Math.max(24, assistSplitPctRef.current + delta))
                  assistSplitPctRef.current = c
                  setAssistSplitPct(c)
                  persistAssistSplit(c)
                }
                if (e.key === 'Home' || e.key === 'End') {
                  e.preventDefault()
                  const c = e.key === 'Home' ? 24 : 62
                  assistSplitPctRef.current = c
                  setAssistSplitPct(c)
                  persistAssistSplit(c)
                }
              }}
            >
              <span
                className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full bg-bg-hover/70 group-hover:bg-accent-blue/60 pointer-events-none"
                aria-hidden
              />
            </div>
            <div className="flex-1 flex flex-col min-w-0 min-h-0 pl-2">
              <AnswerPanel />
            </div>
          </div>

          <div className="flex-1 flex md:hidden overflow-hidden min-h-0 px-3 pb-3 pt-2">
            {mobileTab === 'transcript' ? <TranscriptionPanel /> : <AnswerPanel />}
          </div>

          {/* 仅手机端：由服务端截本机主屏左半幅送 VL，手机不调用系统截图 */}
          {mobileTab === 'answer' && (
            <div className="md:hidden flex-shrink-0 px-3 py-3 border-t border-bg-tertiary bg-bg-secondary/95 backdrop-blur-sm">
              <button
                type="button"
                disabled={serverScreenLoading}
                onClick={handleServerScreenAsk}
                className="w-full flex items-center justify-center gap-3 min-h-[52px] py-3.5 rounded-xl bg-accent-blue text-white text-base font-semibold shadow-sm disabled:opacity-60 active:scale-[0.99] transition-transform"
              >
                <MonitorSmartphone className="w-5 h-5 flex-shrink-0" />
                {serverScreenLoading ? '截图审题提交中…' : '服务端截图审题'}
              </button>
              <p className="text-[10px] text-text-muted text-center mt-1.5 leading-snug px-0.5">
                在后台子进程截主屏左半幅，该请求不写访问日志以减少终端抢焦点。若仍被终端打断，可用 <code className="text-[9px] bg-bg-tertiary px-0.5 rounded">IA_ACCESS_LOG=0</code> 启动后端关闭全部 HTTP 访问日志。须配置识图模型与屏幕录制权限。
              </p>
            </div>
          )}

          <ControlBar />
        </>
      )}

      {/* ── Practice Mode ── */}
      {appMode === 'practice' && <PracticeMode />}

      {/* ── Knowledge Map ── */}
      {appMode === 'knowledge' && <KnowledgeMap />}

      {/* ── Resume Optimizer ── */}
      {appMode === 'resume-opt' && <ResumeOptimizer />}

      {/* ── Job tracker ── */}
      {appMode === 'job-tracker' && <JobTracker />}

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col-reverse gap-2 items-center" aria-live="polite">
        {fallbackToast && (
          <div className="animate-fade-up">
            <div className="glass border border-accent-amber/30 text-text-primary text-xs px-4 py-2.5 rounded-xl shadow-xl shadow-black/20">
              <span className="text-accent-amber font-semibold">⚠</span>&nbsp; {fallbackToast.from} 不可用，切换到 {fallbackToast.to}
            </div>
          </div>
        )}
        {toastMessage && (
          <div className="animate-fade-up">
            <div className="glass border border-bg-hover/50 text-text-primary text-xs px-4 py-2.5 rounded-xl shadow-xl shadow-black/20 font-medium">
              {toastMessage}
            </div>
          </div>
        )}
      </div>

      <SettingsDrawer />
    </div>
  )
}
