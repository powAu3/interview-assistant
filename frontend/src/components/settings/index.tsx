import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
import {
  X,
  LayoutGrid,
  Mic,
  Palette,
  Monitor,
  BookOpen,
  Timer,
  AudioWaveform,
  BrainCircuit,
  Settings2,
  Search,
  Smartphone,
} from 'lucide-react'
import { useUiSettings } from '@/stores/hooks'
import { INPUT_FIELD_STYLE, SettingsSearchContext } from './shared'
import PreferencesTab from './PreferencesTab'

const SpeechTab = lazy(() => import('./SpeechTab'))
const TimingTab = lazy(() => import('./SpeechTab'))
const HotwordsTab = lazy(() => import('./HotwordsTab'))
const ModelsTab = lazy(() => import('./ModelsTab'))
const NetworkQRCode = lazy(() => import('./NetworkQRCode'))

export default function SettingsDrawer() {
  const { settingsOpen, toggleSettings, settingsDrawerTab, setSettingsDrawerTab } = useUiSettings()

  const drawerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousActiveRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const dirtyExplicitCountRef = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [noResults, setNoResults] = useState(false)
  const [dirtyExplicitSections, setDirtyExplicitSections] = useState<Record<string, boolean>>({})
  const dirtyExplicitCount = Object.values(dirtyExplicitSections).filter(Boolean).length
  const dirtyExplicitLabels = [
    dirtyExplicitSections.speech ? '语音配置' : null,
    dirtyExplicitSections.models ? '模型配置' : null,
  ].filter(Boolean)

  useEffect(() => {
    const handleDirtyChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; dirty?: boolean }>).detail
      if (!detail?.key) return
      setDirtyExplicitSections((prev) => ({ ...prev, [detail.key as string]: !!detail.dirty }))
    }
    window.addEventListener('settings-dirty-change', handleDirtyChange)
    return () => window.removeEventListener('settings-dirty-change', handleDirtyChange)
  }, [])

  useEffect(() => {
    dirtyExplicitCountRef.current = dirtyExplicitCount
  }, [dirtyExplicitCount])

  const closeSettings = useCallback(() => {
    if (dirtyExplicitCountRef.current > 0 && !window.confirm('有未保存更改，关闭后会丢失。')) {
      return false
    }
    toggleSettings()
    return true
  }, [toggleSettings])

  const changeTab = useCallback((tab: typeof settingsDrawerTab) => {
    if (tab === settingsDrawerTab) return
    if (dirtyExplicitCountRef.current > 0 && !window.confirm('有未保存更改，切换后会丢失。')) {
      return
    }
    setSettingsDrawerTab(tab)
  }, [setSettingsDrawerTab, settingsDrawerTab])

  // 检查搜索是否有命中 (仅 general/config tab 判断, 兼容 lazy tab 的挂载时序)
  useEffect(() => {
    if (!settingsOpen) return
    if (!searchQuery.trim() || settingsDrawerTab === 'models' || settingsDrawerTab === 'phone') {
      setNoResults(false)
      return
    }
    let cancelled = false
    const checkHits = () => {
      if (cancelled) return
      const hits = contentRef.current?.querySelectorAll('[data-search-title]')
      setNoResults(!hits || hits.length === 0)
    }
    // 多次检查覆盖 lazy load / React batch 时序
    const timers = [
      setTimeout(checkHits, 0),
      setTimeout(checkHits, 60),
      setTimeout(checkHits, 200),
    ]
    const observer = contentRef.current ? new MutationObserver(checkHits) : null
    if (contentRef.current && observer) {
      observer.observe(contentRef.current, { childList: true, subtree: true })
    }
    return () => {
      cancelled = true
      timers.forEach((t) => clearTimeout(t))
      observer?.disconnect()
    }
  }, [searchQuery, settingsDrawerTab, settingsOpen])

  useEffect(() => {
    if (!settingsOpen) {
      if (wasOpenRef.current) {
        previousActiveRef.current?.focus()
        wasOpenRef.current = false
      }
      return
    }
    if (!wasOpenRef.current) {
      previousActiveRef.current = document.activeElement as HTMLElement | null
      wasOpenRef.current = true
    }
  }, [settingsOpen])

  useEffect(() => {
    if (!settingsOpen || !drawerRef.current) return
    const root = drawerRef.current

    // 涵盖原生表单元素 + 可编辑元素 + ARIA 自定义控件 + 显式 tabindex 节点
    const FOCUSABLE_SELECTOR = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[contenteditable]:not([contenteditable="false"])',
      '[role="checkbox"]:not([aria-disabled="true"])',
      '[role="switch"]:not([aria-disabled="true"])',
      '[role="radio"]:not([aria-disabled="true"])',
      '[role="menuitem"]',
      '[role="tab"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const collectFocusable = (): HTMLElement[] => {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      return nodes.filter((el) => {
        if (el.hasAttribute('disabled')) return false
        if (el.getAttribute('aria-hidden') === 'true') return false
        if (el.getAttribute('tabindex') === '-1') return false
        if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) {
          return false
        }
        return true
      })
    }

    const initial = collectFocusable()
    initial[0]?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        closeSettings()
        return
      }
      if (e.key !== 'Tab') return
      const nodes = collectFocusable()
      if (nodes.length === 0) return
      const idx = nodes.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault()
          nodes[nodes.length - 1].focus()
        }
      } else {
        if (idx === -1 || idx >= nodes.length - 1) {
          e.preventDefault()
          nodes[0].focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [settingsOpen, closeSettings])

  if (!settingsOpen) return null

  const tabs: { key: typeof settingsDrawerTab; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: 'general', label: '常用', icon: <LayoutGrid className="w-4 h-4" />, desc: '运行与回答偏好' },
    { key: 'mode', label: '模式', icon: <Monitor className="w-4 h-4" />, desc: '悬浮窗与笔试' },
    { key: 'kb', label: '知识库', icon: <BookOpen className="w-4 h-4" />, desc: '本地笔记引用' },
    { key: 'config', label: '语音', icon: <Mic className="w-4 h-4" />, desc: 'ASR 引擎与降级' },
    { key: 'timing', label: '节奏', icon: <Timer className="w-4 h-4" />, desc: '延迟与断句' },
    { key: 'hotwords', label: '热词', icon: <AudioWaveform className="w-4 h-4" />, desc: '岗位术语偏置' },
    { key: 'models', label: '模型', icon: <BrainCircuit className="w-4 h-4" />, desc: '队列与协议' },
    { key: 'appearance', label: '外观', icon: <Palette className="w-4 h-4" />, desc: '主题与快捷操作' },
    { key: 'phone', label: '连接手机', icon: <Smartphone className="w-4 h-4" />, desc: '局域网扫码访问' },
  ]

  const speechDirty = !!dirtyExplicitSections.speech
  const dirtyByTab: Partial<Record<typeof settingsDrawerTab, boolean>> = {
    config: speechDirty,
    timing: speechDirty,
    models: !!dirtyExplicitSections.models,
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-40" onClick={closeSettings} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 pointer-events-none">
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title settings-title-mobile"
          className="pointer-events-auto relative flex w-full max-w-5xl h-full max-h-[94vh] bg-bg-secondary rounded-2xl border border-bg-tertiary shadow-2xl overflow-hidden flex-col md:flex-row"
        >
          {/* ── 左侧导航栏（md 及以上）── */}
          <nav className="hidden md:flex w-52 flex-shrink-0 flex-col bg-bg-primary/50 border-r border-bg-tertiary/70 py-4" aria-label="设置分区">
            <div className="px-4 pb-4">
              <h2 id="settings-title" className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-accent-blue" />
                设置中心
              </h2>
              <p className="text-[10px] text-text-muted mt-1 leading-relaxed">常用偏好 · 语音链路 · 模型队列</p>
            </div>
            <div className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2">
              {tabs.map((t) => {
                const active = settingsDrawerTab === t.key
                const dirty = dirtyByTab[t.key]
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => changeTab(t.key)}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-accent-blue/12 text-accent-blue'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/60'
                    }`}
                  >
                    <span className={`flex-shrink-0 ${active ? 'text-accent-blue' : 'text-text-muted group-hover:text-text-secondary'}`}>
                      {t.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium leading-tight">{t.label}</span>
                      <span className={`block text-[10px] leading-tight mt-0.5 ${active ? 'text-accent-blue/70' : 'text-text-muted'}`}>
                        {t.desc}
                      </span>
                    </span>
                    {dirty && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-amber" title="有未保存更改" />}
                  </button>
                )
              })}
            </div>
            {dirtyExplicitLabels.length > 0 && (
              <div className="mt-auto px-4 pt-3 text-[10px] leading-relaxed text-accent-amber">
                未保存：{dirtyExplicitLabels.join(' · ')}
              </div>
            )}
          </nav>

          {/* ── 主列：标题 + 搜索 + 内容 ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-shrink-0 border-b border-bg-tertiary/70 px-4 pt-3.5 pb-3 md:pb-3.5 bg-bg-secondary/95">
              <div className="flex items-center gap-3">
                <h2 id="settings-title-mobile" className="md:hidden text-sm font-semibold text-text-primary flex items-center gap-2 flex-shrink-0">
                  <Settings2 className="w-4 h-4 text-accent-blue" />
                  设置
                </h2>
                {/* 搜索框: 快速过滤 Section/Collapsible (模型页直接在队列中编辑) */}
                {settingsDrawerTab === 'phone' ? (
                  <span className="flex-1 text-sm font-medium text-text-primary">连接手机</span>
                ) : <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && searchQuery) {
                        e.stopPropagation()
                        setSearchQuery('')
                      }
                    }}
                    placeholder={settingsDrawerTab === 'models' ? '模型页直接在队列中编辑' : '搜索设置项，如 VAD / 知识库 / 截图 / 主题'}
                    aria-label="搜索设置项"
                    className="w-full text-xs pl-8 pr-8 py-2 rounded-lg bg-bg-tertiary/60 border border-bg-hover/60 text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-blue/60 focus:ring-2 focus:ring-accent-blue/20 transition"
                    disabled={settingsDrawerTab === 'models'}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover/50"
                      aria-label="清空搜索"
                      title="清空搜索 (Esc)"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>}
                <button type="button" onClick={closeSettings} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary flex-shrink-0" aria-label="关闭">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {dirtyExplicitLabels.length > 0 && (
                <p className="md:hidden mt-2 text-[11px] font-medium text-accent-amber">
                  未保存：{dirtyExplicitLabels.join(' · ')}
                </p>
              )}

              {/* 移动端 tab（md 起由左侧导航取代） */}
              <div className="md:hidden mt-2.5">
                <div className="grid grid-cols-4 rounded-xl bg-bg-tertiary/80 p-1 gap-1">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => changeTab(t.key)}
                      aria-current={settingsDrawerTab === t.key ? 'page' : undefined}
                      className={`flex items-center justify-center gap-1 py-2 px-1 whitespace-nowrap rounded-lg text-xs font-medium transition-all ${
                        settingsDrawerTab === t.key
                          ? 'bg-bg-secondary text-accent-blue shadow-sm'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 内容区：整宽展示，不再被侧栏挤压 */}
            <div ref={contentRef} className="flex-1 overflow-y-auto min-h-0">
              <SettingsSearchContext.Provider value={settingsDrawerTab === 'models' ? '' : searchQuery}>
                <Suspense fallback={<div className="flex items-center justify-center py-12 text-text-muted text-sm">加载中…</div>}>
                  {settingsDrawerTab === 'general' && <PreferencesTab variant="main" />}
                  {settingsDrawerTab === 'mode' && <PreferencesTab variant="mode" />}
                  {settingsDrawerTab === 'kb' && <PreferencesTab variant="kb" />}
                  {settingsDrawerTab === 'appearance' && <PreferencesTab variant="appearance" />}
                  {settingsDrawerTab === 'phone' && <div className="p-4 md:p-5"><NetworkQRCode /></div>}
                  {settingsDrawerTab === 'config' && <SpeechTab variant="engines" />}
                  {settingsDrawerTab === 'timing' && <TimingTab variant="timing" />}
                  {settingsDrawerTab === 'hotwords' && <HotwordsTab />}
                  {settingsDrawerTab === 'models' && <ModelsTab />}
                </Suspense>
                {noResults && settingsDrawerTab !== 'phone' && (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                    <Search className="w-8 h-8 text-text-muted/40" />
                    <div>
                      <p className="text-sm text-text-primary font-medium">没有找到匹配 "{searchQuery}" 的设置项</p>
                      <p className="text-[11px] text-text-muted mt-1">
                        可以试试 "VAD / KB / 截图 / 主题 / 快捷词"，或切到其它分区
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bg-tertiary/60 border border-bg-hover/60 text-xs text-text-primary hover:bg-bg-hover/60 transition"
                    >
                      <X className="w-3 h-3" />
                      清空搜索
                    </button>
                  </div>
                )}
              </SettingsSearchContext.Provider>
            </div>
          </div>
        </div>
      </div>

      <style>{INPUT_FIELD_STYLE}</style>
    </>
  )
}
