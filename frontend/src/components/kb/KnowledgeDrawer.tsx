import { useEffect, useRef, useState } from 'react'
import { X, BookOpen, Files, Search, History, RefreshCw } from 'lucide-react'
import { useKbStore } from '@/stores/kbStore'
import { api } from '@/lib/api'
import BetaBadge from './BetaBadge'
import KbFilesPanel from './KbFilesPanel'
import KbSearchTestPanel from './KbSearchTestPanel'
import KbRecentHitsPanel from './KbRecentHitsPanel'
import KbStatusHeader from './KbStatusHeader'

type Tab = 'files' | 'search' | 'recent'

export default function KnowledgeDrawer() {
  const open = useKbStore((s) => s.drawerOpen)
  const setOpen = useKbStore((s) => s.setDrawerOpen)
  const setStatus = useKbStore((s) => s.setStatus)
  const setDocs = useKbStore((s) => s.setDocs)
  const setRecentHits = useKbStore((s) => s.setRecentHits)
  const drawerRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('files')
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      const [s, d, r] = await Promise.all([
        api.kbStatus(),
        api.kbDocs(),
        api.kbHitsRecent(50),
      ])
      setStatus(s)
      setDocs(d.items)
      setRecentHits(r.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!open) return
    refresh()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'files', label: '文件', icon: <Files className="w-3.5 h-3.5" /> },
    { key: 'search', label: '检索测试', icon: <Search className="w-3.5 h-3.5" /> },
    { key: 'recent', label: '最近命中', icon: <History className="w-3.5 h-3.5" /> },
  ]

  const activeIdx = tabs.findIndex((t) => t.key === tab)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setOpen(false)} />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-drawer-title"
        className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] bg-bg-secondary z-50 shadow-2xl flex flex-col border-l border-bg-tertiary"
      >
        <div className="flex-shrink-0 border-b border-bg-tertiary px-3 pt-3 pb-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 id="kb-drawer-title" className="text-base font-semibold text-text-primary flex items-center gap-2">
              <BookOpen className="w-4.5 h-4.5 text-amber-400" />
              知识库
              <BetaBadge />
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                title="刷新"
                aria-label="刷新"
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <KbStatusHeader />

          {error && (
            <div className="mx-1 mb-2 px-2 py-1.5 rounded-lg border border-accent-red/30 bg-accent-red/10 text-[11px] text-accent-red">
              {error}
            </div>
          )}

          <div className="relative">
            <div className="flex rounded-lg bg-bg-tertiary/80 p-1 gap-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-all z-10 ${
                    tab === t.key
                      ? 'text-amber-400'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
            <div
              className="absolute top-1 bottom-1 rounded-md bg-bg-secondary shadow-sm transition-all duration-200 ease-out"
              style={{
                left: `calc(${activeIdx} * ${100 / tabs.length}% + 4px)`,
                width: `calc(${100 / tabs.length}% - 8px)`,
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-3">
          {tab === 'files' && <KbFilesPanel onChanged={refresh} />}
          {tab === 'search' && <KbSearchTestPanel />}
          {tab === 'recent' && <KbRecentHitsPanel />}
        </div>
      </div>
    </>
  )
}
