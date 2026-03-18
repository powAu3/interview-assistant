import { useEffect, useState, useCallback, useRef } from 'react'
import { Settings, SlidersHorizontal, MonitorSmartphone } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { api } from '@/lib/api'
import TranscriptionPanel from '@/components/TranscriptionPanel'
import AnswerPanel from '@/components/AnswerPanel'
import ControlBar from '@/components/ControlBar'
import SettingsDrawer from '@/components/SettingsDrawer'
import PracticeMode from '@/components/PracticeMode'
import KnowledgeMap from '@/components/KnowledgeMap'
import ResumeOptimizer from '@/components/ResumeOptimizer'

declare global {
  interface Window {
    electronAPI?: {
      hideWindow: () => Promise<void>
      showWindow: () => Promise<void>
      toggleAlwaysOnTop: () => Promise<boolean>
      toggleContentProtection: () => Promise<boolean>
      getWindowState: () => Promise<{ alwaysOnTop: boolean; contentProtection: boolean; visible: boolean }>
    }
  }
}

export default function App() {
  useInterviewWS()
  const { config, setConfig, setDevices, setOptions, toggleSettings, openConfigDrawer, sttLoaded, sttLoading } =
    useInterviewStore()
  const [initError, setInitError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<'transcript' | 'answer'>('answer')
  const [appMode, setAppMode] = useState<'assist' | 'practice' | 'knowledge' | 'resume-opt'>('assist')
  const [editingPos, setEditingPos] = useState(false)
  const [editingLang, setEditingLang] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [serverScreenLoading, setServerScreenLoading] = useState(false)

  const handleBossKey = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      window.electronAPI?.hideWindow()
    }
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return
    document.addEventListener('keydown', handleBossKey)
    return () => document.removeEventListener('keydown', handleBossKey)
  }, [handleBossKey])

  useEffect(() => {
    Promise.all([
      api.getConfig().then(setConfig),
      api.getDevices().then((d) => setDevices(d.devices, d.platform)),
      api.getOptions().then(setOptions),
    ]).then(() => {
      api.checkModelsHealth().catch(() => {})
    }).catch((e) => setInitError(e.message))
  }, [])

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
  }
  const handleThinkToggle = async () => {
    await api.updateConfig({ think_mode: !config?.think_mode })
    setConfig(await api.getConfig())
  }

  const handleServerScreenAsk = async () => {
    setServerScreenLoading(true)
    try {
      await api.askFromServerScreen()
      useInterviewStore.getState().setToastMessage('已截取电脑左半屏并提交识图模型，请在答案区查看')
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

  return (
    <div className="h-screen flex flex-col bg-bg-primary overflow-hidden">
      {/* Header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 md:px-4 py-2 border-b border-bg-tertiary bg-bg-secondary flex-shrink-0 gap-y-2">
        <div className="flex items-center gap-2 flex-shrink-0 min-w-0 flex-wrap">
          <span className="text-base flex-shrink-0">🎙️</span>
          <h1 className="text-sm font-semibold hidden sm:block flex-shrink-0">学习助手</h1>

          {/* Mode tabs — 移动端仅显示实时辅助，其余模式在 sm: 以上才显示 */}
          <div className="flex bg-bg-tertiary rounded-lg p-0.5 ml-1">
            {([
              ['assist', '实时辅助'],
              ['practice', '模拟练习'],
              ['knowledge', '能力分析'],
              ['resume-opt', '简历优化'],
            ] as const).map(([key, label]) => (
              <button key={key} onClick={() => setAppMode(key)}
                className={`px-2 md:px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap flex-shrink-0
                  ${key !== 'assist' ? 'hidden sm:block' : ''}
                  ${appMode === key ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 ml-1 flex-shrink-0">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sttLoaded ? 'bg-accent-green' : sttLoading ? 'bg-accent-amber animate-pulse' : 'bg-accent-red'}`} />
            <span className="text-[10px] text-text-muted hidden sm:inline">
              {sttLoaded ? 'STT就绪' : sttLoading ? 'STT加载中' : 'STT未加载'}
            </span>
          </div>

          {tokenUsage.total > 0 && (
            <div
              className="hidden sm:flex items-center gap-1 ml-1 cursor-help"
              title={[
                `总计 ${tokenUsage.total}（Prompt ${tokenUsage.prompt} + Completion ${tokenUsage.completion}）`,
                ...Object.entries(tokenUsage.byModel || {}).map(
                  ([name, v]) => `${name}: P ${v.prompt} · C ${v.completion}`,
                ),
              ].join('\n')}
            >
              <span className="text-[10px] text-text-muted">Token:</span>
              <span className="text-[10px] text-accent-blue font-mono">{formatTokens(tokenUsage.total)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0 flex-wrap w-full sm:w-auto justify-end sm:justify-start border-t border-bg-tertiary/60 pt-2 sm:border-t-0 sm:pt-0">
          <div className="flex items-center gap-2 mr-auto sm:mr-0 order-first sm:order-none w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-[10px] font-semibold text-accent-blue/90 tracking-wide whitespace-nowrap">Think · 全局</span>
            <button
              type="button"
              onClick={handleThinkToggle}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-colors cursor-pointer select-none flex-shrink-0
                ${config?.think_mode
                  ? 'border-accent-green bg-accent-green/15 text-accent-green shadow-sm shadow-accent-green/10'
                  : 'border-bg-hover bg-bg-tertiary text-text-muted hover:border-text-muted/40 hover:text-text-primary'}`}
              title="全局：切换后影响当前及后续所有答题请求（与配置页同步）"
              aria-label={`Think 全局 ${config?.think_mode ? '开启' : '关闭'}`}
            >
              <span className="text-xs font-bold">{config?.think_mode ? '开' : '关'}</span>
              <span className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${config?.think_mode ? 'bg-accent-green' : 'bg-bg-hover'}`}>
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${config?.think_mode ? 'translate-x-4' : ''}`} />
              </span>
            </button>
          </div>
          {config?.models && config.models.length > 0 && (
            <div className="relative" ref={modelDropdownRef}>
              <button onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="flex items-center gap-1.5 bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-bg-hover hover:border-accent-blue transition-colors max-w-[130px] md:max-w-[160px]">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthDot(config.active_model)}`} />
                <span className="truncate">{activeModel?.name}{activeModel?.supports_vision ? ' 👁' : ''}</span>
                <svg className="w-3 h-3 flex-shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {modelDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 bg-bg-secondary border border-bg-hover rounded-lg shadow-lg z-50 min-w-[180px] py-1">
                  {config.models.map((m, i) => (
                    <button key={i}
                      onClick={async () => { setModelDropdownOpen(false); await handleModelChange(i) }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-bg-tertiary transition-colors ${i === config.active_model ? 'text-accent-blue' : 'text-text-primary'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthDot(i)}`} />
                      <span className="truncate">{m.name}{m.supports_vision ? ' 👁' : ''}</span>
                      {i === config.active_model && <span className="ml-auto text-accent-blue">✓</span>}
                    </button>
                  ))}
                  <div className="border-t border-bg-hover mt-1 pt-1 px-3 py-1">
                    <button onClick={() => { api.checkModelsHealth().catch(() => {}); }}
                      className="text-[10px] text-text-muted hover:text-accent-blue transition-colors">
                      🔄 重新检查
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {editingPos ? (
            <input value={customInput} onChange={(e) => setCustomInput(e.target.value)} autoFocus
              onBlur={() => { if (customInput.trim()) handlePositionChange(customInput.trim()); setEditingPos(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingPos(false) }}
              placeholder="输入岗位" className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-accent-blue focus:outline-none w-[100px] hidden sm:block" />
          ) : (
            <select value={config?.position ?? ''} onChange={(e) => {
              if (e.target.value === '__custom__') { setCustomInput(''); setEditingPos(true) }
              else handlePositionChange(e.target.value)
            }} className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-bg-hover focus:outline-none focus:border-accent-blue max-w-[90px] md:max-w-[120px] hidden sm:block">
              {(options?.positions ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              {config?.position && !(options?.positions ?? []).includes(config.position) && (
                <option value={config.position}>{config.position}</option>
              )}
              <option value="__custom__">自定义...</option>
            </select>
          )}
          {editingLang ? (
            <input value={customInput} onChange={(e) => setCustomInput(e.target.value)} autoFocus
              onBlur={() => { if (customInput.trim()) handleLanguageChange(customInput.trim()); setEditingLang(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingLang(false) }}
              placeholder="输入语言" className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-accent-blue focus:outline-none w-[90px] hidden sm:block" />
          ) : (
            <select value={config?.language ?? ''} onChange={(e) => {
              if (e.target.value === '__custom__') { setCustomInput(''); setEditingLang(true) }
              else handleLanguageChange(e.target.value)
            }} className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-bg-hover focus:outline-none focus:border-accent-blue max-w-[80px] md:max-w-[100px] hidden sm:block">
              {(options?.languages ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
              {config?.language && !(options?.languages ?? []).includes(config.language) && (
                <option value={config.language}>{config.language}</option>
              )}
              <option value="__custom__">自定义...</option>
            </select>
          )}
          <button
            type="button"
            onClick={toggleSettings}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={openConfigDrawer}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted hover:text-accent-blue transition-colors flex-shrink-0"
            title="配置：模型并行、VAD、LLM"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Assist Mode ── */}
      {appMode === 'assist' && (
        <>
          {/* Mobile tab switcher */}
          <div className="flex md:hidden border-b border-bg-tertiary flex-shrink-0">
            <button onClick={() => setMobileTab('transcript')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${mobileTab === 'transcript' ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-text-muted'}`}>
              实时转录
            </button>
            <button onClick={() => setMobileTab('answer')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${mobileTab === 'answer' ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-text-muted'}`}>
              AI 答案
            </button>
          </div>

          <div className="flex-1 hidden md:flex overflow-hidden min-h-0">
            <div className="w-[30%] min-w-[250px] border-r border-bg-tertiary flex flex-col">
              <TranscriptionPanel />
            </div>
            <div className="flex-1 flex flex-col">
              <AnswerPanel />
            </div>
          </div>

          <div className="flex-1 flex md:hidden overflow-hidden min-h-0">
            {mobileTab === 'transcript' ? <TranscriptionPanel /> : <AnswerPanel />}
          </div>

          {/* 仅手机端：由服务端截本机主屏左半幅送 VL，手机不调用系统截图 */}
          {mobileTab === 'answer' && (
            <div className="md:hidden flex-shrink-0 px-3 py-2 border-t border-bg-tertiary bg-bg-secondary/95 backdrop-blur-sm">
              <button
                type="button"
                disabled={serverScreenLoading}
                onClick={handleServerScreenAsk}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-medium shadow-sm disabled:opacity-60 active:scale-[0.99] transition-transform"
              >
                <MonitorSmartphone className="w-4 h-4 flex-shrink-0" />
                {serverScreenLoading ? '截取左屏并提交中…' : '左屏审题写码'}
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

      {/* Fallback toast */}
      {fallbackToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-accent-amber/90 text-black text-xs px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm">
            ⚠️ {fallbackToast.from} 不可用，已自动切换到 {fallbackToast.to}
          </div>
        </div>
      )}
      {/* Generic toast (e.g. 已清空, 已发送取消) */}
      {toastMessage && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-bg-tertiary border border-bg-hover text-text-primary text-xs px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm">
            {toastMessage}
          </div>
        </div>
      )}

      <SettingsDrawer />
    </div>
  )
}
