import { useEffect, useRef } from 'react'
import {
  X,
  LayoutGrid,
  Mic,
  BrainCircuit,
  Settings2,
} from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { INPUT_FIELD_STYLE } from './shared'
import PreferencesTab from './PreferencesTab'
import SpeechTab from './SpeechTab'
import ModelsTab from './ModelsTab'

export default function SettingsDrawer() {
  const {
    settingsOpen,
    toggleSettings,
    settingsDrawerTab,
    setSettingsDrawerTab,
  } = useInterviewStore()

  const drawerRef = useRef<HTMLDivElement>(null)
  const previousActiveRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!settingsOpen || !drawerRef.current) return
    previousActiveRef.current = document.activeElement as HTMLElement | null
    const focusable = drawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')
    const first = focusable[0]
    if (first) first.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleSettings()
        previousActiveRef.current?.focus()
        return
      }
      if (e.key !== 'Tab' || !drawerRef.current) return
      const focusableNodes = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea'))
      const len = focusableNodes.length
      if (len === 0) return
      const idx = focusableNodes.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); focusableNodes[len - 1].focus() }
      } else {
        if (idx === -1 || idx >= len - 1) { e.preventDefault(); focusableNodes[0].focus() }
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
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={toggleSettings} />
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
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className={settingsDrawerTab !== 'general' ? 'hidden' : ''}>
            <PreferencesTab />
          </div>
          <div className={settingsDrawerTab !== 'config' ? 'hidden' : ''}>
            <SpeechTab />
          </div>
          <div className={settingsDrawerTab !== 'models' ? 'hidden' : ''}>
            <ModelsTab />
          </div>
        </div>
      </div>

      <style>{INPUT_FIELD_STYLE}</style>
    </>
  )
}
