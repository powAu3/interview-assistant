import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import {
  X,
  LayoutGrid,
  Mic,
  BrainCircuit,
  Settings2,
  Search,
} from 'lucide-react'
import { useUiSettings } from '@/stores/hooks'
import { INPUT_FIELD_STYLE, SettingsSearchContext } from './shared'
import PreferencesTab from './PreferencesTab'

const SpeechTab = lazy(() => import('./SpeechTab'))
const ModelsTab = lazy(() => import('./ModelsTab'))

export default function SettingsDrawer() {
  const { settingsOpen, toggleSettings, settingsDrawerTab, setSettingsDrawerTab } = useUiSettings()

  const drawerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousActiveRef = useRef<HTMLElement | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [noResults, setNoResults] = useState(false)

  // 检查搜索是否有命中 (仅 general/config tab 判断, 兼容 lazy tab 的挂载时序)
  useEffect(() => {
    if (!settingsOpen) return
    if (!searchQuery.trim() || settingsDrawerTab === 'models') {
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
    if (!settingsOpen || !drawerRef.current) return
    previousActiveRef.current = document.activeElement as HTMLElement | null
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
      if (e.key === 'Escape') {
        toggleSettings()
        previousActiveRef.current?.focus()
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
      previousActiveRef.current?.focus()
    }
  }, [settingsOpen, toggleSettings])

  if (!settingsOpen) return null

  const tabs: { key: typeof settingsDrawerTab; label: string; icon: React.ReactNode }[] = [
    { key: 'general', label: '偏好', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { key: 'config', label: '配置', icon: <Mic className="w-3.5 h-3.5" /> },
    { key: 'models', label: '模型', icon: <BrainCircuit className="w-3.5 h-3.5" /> },
  ]

  const activeTabIdx = tabs.findIndex((t) => t.key === settingsDrawerTab)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={toggleSettings} />
      <div ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="fixed right-0 top-0 bottom-0 w-full sm:w-[440px] bg-bg-secondary z-50 shadow-2xl flex flex-col border-l border-bg-tertiary">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-bg-tertiary px-3 pt-3 pb-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 id="settings-title" className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Settings2 className="w-4.5 h-4.5 text-accent-blue" />
              设置中心
            </h2>
            <button type="button" onClick={toggleSettings} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary" aria-label="关闭">
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* 搜索框: 快速过滤 Section/Collapsible (仅 general/config tab 支持结构化过滤) */}
          <div className="relative mb-2 px-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
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
              placeholder={settingsDrawerTab === 'models' ? '搜索暂不支持模型 Tab (切到偏好/配置 Tab 使用)' : '搜索设置项 (如 vad / kb / 截图 / 主题…)'}
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
          </div>

          {/* Tab bar with animated indicator */}
          <div className="relative">
            <div className="flex rounded-lg bg-bg-tertiary/80 p-1 gap-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setSettingsDrawerTab(t.key)}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-all z-10 ${
                    settingsDrawerTab === t.key
                      ? 'text-accent-blue'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
            {/* Sliding indicator */}
            <div
              className="absolute top-1 bottom-1 rounded-md bg-bg-secondary shadow-sm transition-all duration-200 ease-out"
              style={{
                left: `calc(${activeTabIdx} * ${100 / tabs.length}% + 4px)`,
                width: `calc(${100 / tabs.length}% - 8px)`,
              }}
            />
          </div>
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto min-h-0">
          <SettingsSearchContext.Provider value={settingsDrawerTab === 'models' ? '' : searchQuery}>
            <Suspense fallback={<div className="flex items-center justify-center py-12 text-text-muted text-sm">加载中…</div>}>
              {settingsDrawerTab === 'general' && <PreferencesTab />}
              {settingsDrawerTab === 'config' && <SpeechTab />}
              {settingsDrawerTab === 'models' && <ModelsTab />}
            </Suspense>
            {noResults && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <Search className="w-8 h-8 text-text-muted/40" />
                <div>
                  <p className="text-sm text-text-primary font-medium">没有找到匹配 "{searchQuery}" 的设置项</p>
                  <p className="text-[11px] text-text-muted mt-1">
                    可以试试 "VAD / KB / 截图 / 主题 / 快捷词"，或切到其它 Tab
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

      <style>{INPUT_FIELD_STYLE}</style>
    </>
  )
}
