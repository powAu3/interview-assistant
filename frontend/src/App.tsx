import { useEffect, useState, useCallback } from 'react'
import { Settings } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { api } from '@/lib/api'
import TranscriptionPanel from '@/components/TranscriptionPanel'
import AnswerPanel from '@/components/AnswerPanel'
import ControlBar from '@/components/ControlBar'
import SettingsDrawer from '@/components/SettingsDrawer'
import PracticeMode from '@/components/PracticeMode'

declare global {
  interface Window {
    pywebview?: { api: { hide_window: () => void; show_window: () => void } }
  }
}

export default function App() {
  useInterviewWS()
  const { config, setConfig, setDevices, setOptions, toggleSettings, sttLoaded, sttLoading } = useInterviewStore()
  const [initError, setInitError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<'transcript' | 'answer'>('answer')
  const [appMode, setAppMode] = useState<'assist' | 'practice'>('assist')

  const handleBossKey = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      if (window.pywebview?.api) {
        window.pywebview.api.hide_window()
      }
    }
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleBossKey)
    return () => document.removeEventListener('keydown', handleBossKey)
  }, [handleBossKey])

  useEffect(() => {
    Promise.all([
      api.getConfig().then(setConfig),
      api.getDevices().then((d) => setDevices(d.devices, d.platform)),
      api.getOptions().then(setOptions),
    ]).catch((e) => setInitError(e.message))
  }, [])

  const handlePositionChange = async (position: string) => {
    await api.updateConfig({ position })
    setConfig(await api.getConfig())
  }
  const handleLanguageChange = async (language: string) => {
    await api.updateConfig({ language })
    setConfig(await api.getConfig())
  }
  const handleModelChange = async (active_model: number) => {
    await api.updateConfig({ active_model })
    setConfig(await api.getConfig())
  }
  const handleThinkToggle = async () => {
    await api.updateConfig({ think_mode: !config?.think_mode })
    setConfig(await api.getConfig())
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

  return (
    <div className="h-screen flex flex-col bg-bg-primary overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-bg-tertiary bg-bg-secondary flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-base">🎙️</span>
          <h1 className="text-sm font-semibold hidden sm:block">学习助手</h1>

          {/* Mode tabs */}
          <div className="flex bg-bg-tertiary rounded-lg p-0.5 ml-1">
            <button onClick={() => setAppMode('assist')}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${appMode === 'assist' ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'}`}>
              实时辅助
            </button>
            <button onClick={() => setAppMode('practice')}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${appMode === 'practice' ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'}`}>
              模拟练习
            </button>
          </div>

          <div className="flex items-center gap-1 ml-1">
            <div className={`w-1.5 h-1.5 rounded-full ${sttLoaded ? 'bg-accent-green' : sttLoading ? 'bg-accent-amber animate-pulse' : 'bg-accent-red'}`} />
            <span className="text-[10px] text-text-muted hidden sm:inline">
              {sttLoaded ? 'STT就绪' : sttLoading ? 'STT加载中' : 'STT未加载'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {config?.models && config.models.length > 1 && (
            <select value={config.active_model}
              onChange={(e) => handleModelChange(Number(e.target.value))}
              className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-bg-hover focus:outline-none focus:border-accent-blue max-w-[120px]">
              {config.models.map((m, i) => (
                <option key={i} value={i}>{m.name}{m.supports_vision ? ' 👁' : ''}</option>
              ))}
            </select>
          )}
          {activeModel?.supports_think && (
            <button onClick={handleThinkToggle}
              className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${config?.think_mode ? 'bg-accent-blue/20 border-accent-blue text-accent-blue' : 'bg-bg-tertiary border-bg-hover text-text-muted'}`}>
              Think {config?.think_mode ? 'ON' : 'OFF'}
            </button>
          )}
          <select value={config?.position ?? ''} onChange={(e) => handlePositionChange(e.target.value)}
            className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-bg-hover focus:outline-none focus:border-accent-blue max-w-[100px]">
            {(options?.positions ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={config?.language ?? ''} onChange={(e) => handleLanguageChange(e.target.value)}
            className="bg-bg-tertiary text-text-primary text-xs rounded-lg px-2 py-1.5 border border-bg-hover focus:outline-none focus:border-accent-blue max-w-[90px]">
            {(options?.languages ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button onClick={toggleSettings} className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors">
            <Settings className="w-4 h-4" />
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

          <ControlBar />
        </>
      )}

      {/* ── Practice Mode ── */}
      {appMode === 'practice' && <PracticeMode />}

      <SettingsDrawer />
    </div>
  )
}
