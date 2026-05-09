import { useCallback, useEffect, useState, useRef, lazy, Suspense } from 'react'
import { Settings, SlidersHorizontal, MonitorSmartphone, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { useShortcutsStore } from '@/stores/shortcutsStore'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { useAppBootstrap } from '@/hooks/useAppBootstrap'
import { useOverlayWindowSync } from '@/hooks/useOverlayWindowSync'
import { useAssistSplit } from '@/hooks/useAssistSplit'
import { api } from '@/lib/api'
import { updateConfigAndRefresh } from '@/lib/configSync'
import TranscriptionPanel from '@/components/TranscriptionPanel'
import AnswerPanel from '@/components/AnswerPanel'
import ControlBar from '@/components/ControlBar'
import SettingsDrawer from '@/components/SettingsDrawer'
import SessionSettingsPopover from '@/components/SessionSettingsPopover'
import KnowledgeButton from '@/components/kb/KnowledgeButton'
import KnowledgeDrawer from '@/components/kb/KnowledgeDrawer'
import { AppToastStack } from '@/components/app/AppToastStack'
import { InitErrorScreen } from '@/components/app/InitErrorScreen'
import { ModelPriorityDropdown } from '@/components/app/ModelPriorityDropdown'
const PracticeMode = lazy(() => import('@/components/PracticeMode'))
const KnowledgeMap = lazy(() => import('@/components/KnowledgeMap'))
const ResumeOptimizer = lazy(() => import('@/components/ResumeOptimizer'))
const JobTracker = lazy(() => import('@/components/JobTracker'))

export default function App() {
  useInterviewWS()
  // 精确订阅, 避免 store 任意字段变化(LLM token 流式 / toast 等)触发 App 重渲染
  const { config, toggleSettings, openModelsDrawer } = useInterviewStore(
    useShallow((s) => ({
      config: s.config,
      toggleSettings: s.toggleSettings,
      openModelsDrawer: s.openModelsDrawer,
    })),
  )
  const sttLoaded = useInterviewStore((s) => s.sttLoaded)
  const sttLoading = useInterviewStore((s) => s.sttLoading)
  const isRecording = useInterviewStore((s) => s.isRecording)
  const isPaused = useInterviewStore((s) => s.isPaused)
  const [mobileTab, setMobileTab] = useState<'transcript' | 'answer'>('transcript')
  const appMode = useUiPrefsStore((s) => s.appMode)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)
  const assistTranscriptCollapsed = useUiPrefsStore((s) => s.assistTranscriptCollapsed)
  const toggleAssistTranscriptCollapsed = useUiPrefsStore((s) => s.toggleAssistTranscriptCollapsed)
  useOverlayWindowSync(isRecording, appMode)

  const [serverScreenLoading, setServerScreenLoading] = useState(false)
  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false)
  const sessionAnchorRef = useRef<HTMLButtonElement | null>(null)

  const {
    assistSplitContainerRef,
    assistSplitDragging,
    assistSplitPct,
    assistSplitPctRef,
    persistAssistSplitPct,
  } = useAssistSplit()

  const { initError } = useAppBootstrap()

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

  // Cmd+Shift+J / Ctrl+Shift+J: 切换实时转录面板显隐
  // 注: Chrome 等浏览器把 Cmd+J / Ctrl+J 保留给「下载」, 故叠加 Shift 降低冲突.
  // 仅桌面端 assist 模式下生效; 输入框/contenteditable 内按键忽略.
  useEffect(() => {
    if (appMode !== 'assist') return
    const onKeyDown = (e: KeyboardEvent) => {
      const isToggle =
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        (e.key === 'j' || e.key === 'J')
      if (!isToggle) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      e.preventDefault()
      toggleAssistTranscriptCollapsed()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [appMode, toggleAssistTranscriptCollapsed])

  const handleModelChange = useCallback(async (active_model: number) => {
    const targetModel = useInterviewStore.getState().config?.models?.[active_model]
    if (targetModel?.enabled === false) {
      useInterviewStore.getState().setToastMessage('该模型已停用，请先在设置中启用后再设为优先')
      return
    }
    await updateConfigAndRefresh({ active_model })
    useInterviewStore.getState().setToastMessage('已设为优先答题模型（实时辅助优先占用该路）')
  }, [])

  const handleServerScreenAsk = useCallback(async () => {
    setServerScreenLoading(true)
    try {
      await api.askFromServerScreen()
      useInterviewStore.getState().setToastMessage('已按当前截图区域配置提交服务端截图审题，请在答案区查看')
    } catch (e: unknown) {
      useInterviewStore.getState().setToastMessage(e instanceof Error ? e.message : '提交失败')
    } finally {
      setServerScreenLoading(false)
    }
  }, [])

  const modelHealth = useInterviewStore((s) => s.modelHealth)
  const fallbackToast = useInterviewStore((s) => s.fallbackToast)
  const toastMessage = useInterviewStore((s) => s.toastMessage)
  const toasts = useInterviewStore((s) => s.toasts)
  const dismissToast = useInterviewStore((s) => s.dismissToast)
  const wsIsLeader = useInterviewStore((s) => s.wsIsLeader)

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

  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    const timers = toastTimersRef.current
    const currentIds = new Set(toasts.map((t) => t.id))
    for (const [id, timer] of timers) {
      if (!currentIds.has(id)) { clearTimeout(timer); timers.delete(id) }
    }
    for (const t of toasts) {
      if (!timers.has(t.id)) {
        const timer = setTimeout(() => useInterviewStore.getState().dismissToast(t.id), t.ttlMs)
        timers.set(t.id, timer)
      }
    }
  }, [toasts])
  useEffect(() => () => {
    for (const timer of toastTimersRef.current.values()) clearTimeout(timer)
    toastTimersRef.current.clear()
  }, [])
  if (initError) {
    return <InitErrorScreen initError={initError} />
  }

  return (
    <div className="h-screen flex flex-col bg-bg-primary overflow-hidden noise-bg">
      {/* Header — 强制单行不换行, 各按钮文字按宽度阶梯隐藏, 实在不够再让左区横向滚动 */}
      <header className="app-drag-region header-gradient flex flex-row items-center justify-between gap-2 px-3 md:px-5 py-2.5 flex-shrink-0 min-w-0">
        <div className="flex items-center gap-2 md:gap-2.5 flex-shrink min-w-0 overflow-hidden">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-blue/20 to-accent-blue/5 flex items-center justify-center border border-accent-blue/10">
              <span className="text-sm">🎙️</span>
            </div>
            <h1 className="text-sm font-bold hidden lg:block flex-shrink-0 tracking-tight">学习助手</h1>
          </div>

          <div className="flex overflow-x-auto bg-bg-tertiary/60 rounded-xl p-0.5 ml-1 border border-bg-hover/30 scrollbar-none" role="tablist" aria-label="功能模块">
            {(
              [
                ['assist', '实时辅助'],
                ['practice', '模拟练习'],
                ['knowledge', '能力分析'],
                ['resume-opt', '简历优化'],
                ['job-tracker', '\u6C42\u804C\u770B\u677F'] as const,
              ] as const
            ).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={appMode === key} onClick={() => setAppMode(key)}
                className={`px-2.5 md:px-3 py-1.5 text-xs rounded-[10px] transition-all duration-200 whitespace-nowrap flex-shrink-0 font-medium ${appMode === key ? 'bg-accent-blue text-white shadow-sm shadow-accent-blue/20' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover/50'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* 状态 chip:合并 STT + REC,录音中优先显示 REC,平时显示 STT 状态 */}
          {isRecording ? (
            <div
              className={`flex items-center gap-1.5 ml-1.5 flex-shrink-0 rounded-lg px-2 py-1 border animate-fade-up ${
                isPaused
                  ? 'bg-accent-amber/10 border-accent-amber/30'
                  : 'bg-accent-red/10 border-accent-red/30'
              }`}
              role="status"
              aria-live="polite"
              title={
                isPaused
                  ? `录音已暂停 · STT ${sttLoaded ? '就绪' : sttLoading ? '加载中' : '未加载'}`
                  : `正在录音中 · STT ${sttLoaded ? '就绪' : sttLoading ? '加载中' : '未加载'}`
              }
            >
              <span className="relative inline-flex w-1.5 h-1.5 flex-shrink-0">
                {!isPaused && (
                  <span className="absolute inset-0 rounded-full bg-accent-red opacity-75 motion-safe:animate-ping" aria-hidden />
                )}
                <span
                  className={`relative inline-flex w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-accent-amber' : 'bg-accent-red'}`}
                  aria-hidden
                />
              </span>
              <span
                className={`text-[10px] font-semibold leading-none hidden sm:inline ${isPaused ? 'text-accent-amber' : 'text-accent-red'}`}
              >
                {isPaused ? 'PAUSED' : 'REC'}
              </span>
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 ml-1.5 flex-shrink-0 bg-bg-tertiary/30 rounded-lg px-2 py-1 border border-bg-hover/20"
              title={
                sttLoaded
                  ? 'STT 模型已加载 · 等待录音'
                  : sttLoading
                  ? 'STT 模型加载中…'
                  : 'STT 模型尚未加载,首次录音时会自动加载'
              }
            >
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sttLoaded ? 'bg-accent-green' : sttLoading ? 'bg-accent-amber animate-pulse' : 'bg-accent-red'}`} />
              <span className="text-[10px] text-text-muted hidden md:inline font-medium">
                {sttLoaded ? 'STT 就绪' : sttLoading ? '加载中' : '未加载'}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0 flex-nowrap justify-end">
          {config?.models && config.models.length > 0 && (
            <ModelPriorityDropdown
              config={config}
              modelHealth={modelHealth}
              onModelChange={handleModelChange}
            />
          )}

          {/* 会场设置:聚合 Think + 岗位 + 语言 + Token */}
          <div className="relative">
            <button
              ref={sessionAnchorRef}
              type="button"
              onClick={() => setSessionPopoverOpen((v) => !v)}
              title="会场设置:Think 思考模式 / 岗位 / 语言 / Token 用量"
              aria-haspopup="dialog"
              aria-expanded={sessionPopoverOpen}
              aria-label="打开会场设置"
              className={`relative inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs border transition-all duration-200 flex-shrink-0
                ${sessionPopoverOpen
                  ? 'border-accent-blue/50 bg-accent-blue/10 text-accent-blue shadow-sm shadow-accent-blue/10'
                  : 'border-bg-hover/50 bg-bg-tertiary/50 text-text-secondary hover:border-accent-blue/40 hover:text-text-primary'}`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="font-medium hidden sm:inline">会场</span>
              {config?.think_mode && (
                <span
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-green ring-2 ring-bg-primary shadow-[0_0_6px] shadow-accent-green/60"
                  aria-hidden
                  title="Think 已开启"
                />
              )}
            </button>
            <SessionSettingsPopover
              open={sessionPopoverOpen}
              onClose={() => setSessionPopoverOpen(false)}
              anchorRef={sessionAnchorRef}
            />
          </div>

          {appMode === 'assist' && (
            <button
              type="button"
              onClick={toggleAssistTranscriptCollapsed}
              className="hidden md:inline-flex items-center justify-center min-h-[32px] min-w-[32px] p-1.5 rounded-xl hover:bg-bg-tertiary/60 text-text-muted hover:text-accent-blue transition-all duration-200 border border-transparent hover:border-accent-blue/20 flex-shrink-0"
              title={assistTranscriptCollapsed ? '显示实时转录面板 (⌘⇧J / Ctrl+⇧+J)' : '隐藏实时转录面板 (⌘⇧J / Ctrl+⇧+J)'}
              aria-label={assistTranscriptCollapsed ? '显示实时转录面板' : '隐藏实时转录面板'}
              aria-expanded={!assistTranscriptCollapsed}
            >
              {assistTranscriptCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          )}
          <KnowledgeButton />
          <button
            type="button"
            onClick={toggleSettings}
            className="inline-flex items-center justify-center min-h-[32px] min-w-[32px] p-1.5 rounded-xl hover:bg-bg-tertiary/60 text-text-muted hover:text-text-primary transition-all duration-200 border border-transparent hover:border-bg-hover/40"
            title="设置中心 (外观 / 偏好 / 模型 / 隐私 / 快捷键)"
            aria-label="打开设置"
          >
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

          <div
            ref={assistSplitContainerRef}
            className="flex-1 hidden md:flex overflow-hidden min-h-0"
          >
            {!assistTranscriptCollapsed && (
              <>
            <div
              className="flex flex-col min-w-0 flex-shrink-0 border-r border-bg-tertiary"
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
              className="w-1 flex-shrink-0 cursor-col-resize group relative z-10 outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50 focus-visible:ring-inset bg-bg-hover/30 hover:bg-accent-blue/20 active:bg-accent-blue/40 transition-all duration-150"
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
                persistAssistSplitPct(c)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  const delta = e.key === 'ArrowLeft' ? -2 : 2
                  const c = Math.min(62, Math.max(24, assistSplitPctRef.current + delta))
                  assistSplitPctRef.current = c
                  persistAssistSplitPct(c)
                }
                if (e.key === 'Home' || e.key === 'End') {
                  e.preventDefault()
                  const c = e.key === 'Home' ? 24 : 62
                  assistSplitPctRef.current = c
                  persistAssistSplitPct(c)
                }
              }}
            >
              <span
                className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-bg-hover group-hover:bg-accent-blue/50 pointer-events-none"
                aria-hidden
              />
            </div>
              </>
            )}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              <AnswerPanel />
            </div>
          </div>

          <div className="flex-1 flex md:hidden overflow-hidden min-h-0">
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
      {appMode === 'practice' && (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-text-muted">加载模拟练习中…</div>}>
          <PracticeMode />
        </Suspense>
      )}

      {/* ── Knowledge Map ── */}
      {appMode === 'knowledge' && (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-text-muted">加载能力分析中…</div>}>
          <KnowledgeMap />
        </Suspense>
      )}

      {/* ── Resume Optimizer ── */}
      {appMode === 'resume-opt' && (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-text-muted">加载简历优化中…</div>}>
          <ResumeOptimizer />
        </Suspense>
      )}

      {/* ── Job tracker ── */}
      {appMode === 'job-tracker' && (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-text-muted">加载求职看板中…</div>}>
          <JobTracker />
        </Suspense>
      )}

      <AppToastStack
        wsIsLeader={wsIsLeader}
        fallbackToast={fallbackToast}
        toasts={toasts}
        dismissToast={dismissToast}
      />

      <SettingsDrawer />
      <KnowledgeDrawer />
    </div>
  )
}
