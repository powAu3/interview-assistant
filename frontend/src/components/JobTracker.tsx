import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LayoutGrid,
  Plus,
  Search,
  Scale,
  Table2,
  Rows3,
  RefreshCw,
  Briefcase,
  Sparkles,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useInterviewStore } from '@/stores/configStore'
import ApplicationsTable from './job-tracker/ApplicationsTable'
import KanbanBoard from './job-tracker/KanbanBoard'
import OfferCompareModal from './job-tracker/OfferCompareModal'
import OfferEditModal from './job-tracker/OfferEditModal'
import type { Application, Offer, Stage } from './job-tracker/types'
import { parseApplication, parseOffer } from './job-tracker/types'
import { isLightColorScheme } from '@/lib/colorScheme'
import { STAGE_LABELS, TERMINAL_STAGES } from './job-tracker/stageConfig'

const SHOW_TERMINAL_STORAGE_KEY = 'ia-jobtracker-show-terminal'

export default function JobTracker() {
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)
  const colorScheme = useInterviewStore((s) => s.colorScheme)
  const isLight = isLightColorScheme(colorScheme)
  const [applications, setApplications] = useState<Application[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [dense, setDense] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedOfferIds, setSelectedOfferIds] = useState<Set<number>>(new Set())
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareItems, setCompareItems] = useState<Offer[]>([])
  const [offerModalApp, setOfferModalApp] = useState<Application | null>(null)
  const [showTerminalStages, setShowTerminalStages] = useState(() => {
    try {
      const v = localStorage.getItem(SHOW_TERMINAL_STORAGE_KEY)
      if (v === null) return false
      return v === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_TERMINAL_STORAGE_KEY, showTerminalStages ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [showTerminalStages])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [aRes, oRes] = await Promise.all([
        api.jobTrackerApplications(),
        api.jobTrackerListOffers(),
      ])
      setApplications((aRes.items as Record<string, unknown>[]).map(parseApplication))
      setOffers((oRes.items as Record<string, unknown>[]).map(parseOffer))
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [setToastMessage])

  useEffect(() => {
    load()
  }, [load])

  const offerByAppId = useMemo(() => {
    const m = new Map<number, Offer>()
    for (const o of offers) m.set(o.application_id, o)
    return m
  }, [offers])

  const toggleOfferSelect = useCallback((offerId: number) => {
    setSelectedOfferIds((prev) => {
      const next = new Set(prev)
      if (next.has(offerId)) next.delete(offerId)
      else next.add(offerId)
      return next
    })
  }, [])

  const onPatch = useCallback(
    async (id: number, patch: Partial<Application>) => {
      try {
        const raw = await api.jobTrackerPatchApplication(id, patch as Record<string, unknown>)
        const next = parseApplication(raw as Record<string, unknown>)
        setApplications((prev) => prev.map((x) => (x.id === id ? next : x)))
        return true
      } catch (e) {
        setToastMessage(e instanceof Error ? e.message : '保存失败')
        load()
        return false
      }
    },
    [load, setToastMessage],
  )

  const onDelete = useCallback(
    async (id: number) => {
      try {
        await api.jobTrackerDeleteApplication(id)
        setApplications((prev) => prev.filter((x) => x.id !== id))
        setOffers((prev) => {
          const removedIds = prev.filter((o) => o.application_id === id).map((o) => o.id)
          if (removedIds.length) {
            setSelectedOfferIds((s) => {
              const n = new Set(s)
              removedIds.forEach((oid) => n.delete(oid))
              return n
            })
          }
          return prev.filter((o) => o.application_id !== id)
        })
      } catch (e) {
        setToastMessage(e instanceof Error ? e.message : '删除失败')
      }
    },
    [setToastMessage],
  )

  const onStageChange = useCallback(
    async (appId: number, stage: string) => {
      const ok = await onPatch(appId, { stage })
      if (ok) {
        setToastMessage(`已移至 ${STAGE_LABELS[stage] ?? stage}`)
      }
    },
    [onPatch, setToastMessage],
  )

  const onReorderInStage = useCallback(
    async (stage: string, orderedIds: number[]) => {
      setApplications((prev) =>
        prev.map((a) => {
          const i = orderedIds.indexOf(a.id)
          if (i < 0 || a.stage !== stage) return a
          return { ...a, sort_order: i }
        }),
      )
      try {
        await api.jobTrackerReorderStage(stage, orderedIds)
      } catch (e) {
        setToastMessage(e instanceof Error ? e.message : '排序失败')
        load()
      }
    },
    [load, setToastMessage],
  )

  const terminalApplicationsCount = useMemo(
    () => applications.filter((a) => TERMINAL_STAGES.includes(a.stage as Stage)).length,
    [applications],
  )

  const addRow = useCallback(async () => {
    try {
      const raw = await api.jobTrackerCreateApplication({
        company: '新公司',
        position: '岗位',
        stage: 'applied',
      })
      const row = parseApplication(raw as Record<string, unknown>)
      setApplications((prev) => [row, ...prev])
      setToastMessage('已新增一行，可直接编辑')
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : '新增失败')
    }
  }, [setToastMessage])

  const openOfferModal = useCallback((app: Application) => {
    setOfferModalApp(app)
  }, [])

  const saveOffer = useCallback(
    async (payload: Record<string, unknown>) => {
      const raw = await api.jobTrackerUpsertOffer(payload)
      const o = parseOffer(raw as Record<string, unknown>)
      setOffers((prev) => {
        const i = prev.findIndex((x) => x.application_id === o.application_id)
        if (i < 0) return [...prev, o]
        const next = [...prev]
        next[i] = o
        return next
      })
      setToastMessage('Offer 已保存')
    },
    [setToastMessage],
  )

  const runCompare = useCallback(async () => {
    const ids = [...selectedOfferIds]
    if (ids.length < 2) {
      setToastMessage('请至少勾选 2 个 Offer')
      return
    }
    try {
      const res = await api.jobTrackerCompare(ids)
      setCompareItems((res.items as Record<string, unknown>[]).map(parseOffer))
      setCompareOpen(true)
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : '对比失败')
    }
  }, [selectedOfferIds, setToastMessage])

  const offerForModal = offerModalApp ? offerByAppId.get(offerModalApp.id) ?? null : null

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      <div
        className={`relative flex-shrink-0 overflow-hidden border-b px-4 py-3.5 md:px-5 ${
          isLight ? 'border-bg-hover bg-bg-secondary' : 'border-white/[0.06]'
        }`}
      >
        {!isLight && (
          <>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-indigo-950/40 via-bg-secondary/90 to-violet-950/25" />
            <div className="pointer-events-none absolute -top-20 right-0 h-40 w-40 rounded-full bg-accent-blue/15 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 left-1/3 h-24 w-64 rounded-full bg-violet-500/10 blur-2xl" />
          </>
        )}
        <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-blue/25 to-indigo-600/20 text-accent-blue ring-1 ring-accent-blue/25 shadow-lg shadow-accent-blue/10">
              <Briefcase className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary tracking-tight flex items-center gap-2">
                求职进度
                <Sparkles className="w-3.5 h-3.5 text-amber-400/90" strokeWidth={2} />
              </h2>
              <p className="text-[11px] text-text-muted/90 mt-0.5 leading-relaxed max-w-md">
                本地保存 · 表格 / 看板 · Offer 对比
                <span className="text-text-muted/50">（仅桌面端）</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px] max-w-xs group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted group-focus-within:text-accent-blue/80 transition-colors" />
              <input
                type="search"
                placeholder="搜索公司、岗位、城市…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full pl-9 pr-3 py-2.5 rounded-xl text-xs text-text-primary placeholder:text-text-muted/60 focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/20 focus:outline-none transition-shadow shadow-inner ${
                  isLight ? 'bg-bg-tertiary border border-bg-hover' : 'bg-black/20 border border-white/[0.08]'
                }`}
              />
            </div>
            <div
              className={`flex rounded-2xl border p-1 shadow-inner backdrop-blur-sm ${
                isLight ? 'border-bg-hover bg-bg-tertiary/80' : 'border-white/[0.08] bg-black/15'
              }`}
            >
              <button
                type="button"
                onClick={() => setView('table')}
                className={`px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 rounded-xl transition-all ${
                  view === 'table'
                    ? 'bg-gradient-to-b from-accent-blue to-blue-600 text-white shadow-md shadow-accent-blue/25'
                    : isLight
                      ? 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                      : 'text-text-muted hover:text-text-primary hover:bg-white/[0.04]'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                表格
              </button>
              <button
                type="button"
                onClick={() => setView('kanban')}
                className={`px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 rounded-xl transition-all ${
                  view === 'kanban'
                    ? 'bg-gradient-to-b from-violet-600 to-indigo-700 text-white shadow-md shadow-violet-500/25'
                    : isLight
                      ? 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                      : 'text-text-muted hover:text-text-primary hover:bg-white/[0.04]'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                看板
              </button>
            </div>
            <button
              type="button"
              onClick={() => setDense(!dense)}
              className={`px-3 py-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all ${
                dense
                  ? 'border-accent-blue/40 bg-accent-blue/12 text-accent-blue shadow-sm shadow-accent-blue/10'
                  : isLight
                    ? 'border-bg-hover bg-bg-tertiary text-text-muted hover:border-bg-hover hover:text-text-primary'
                    : 'border-white/[0.08] bg-black/10 text-text-muted hover:border-white/15 hover:text-text-primary'
              }`}
              title="行高"
            >
              <Rows3 className="w-3.5 h-3.5" />
              {dense ? '紧凑' : '舒适'}
            </button>
            <button
              type="button"
              onClick={runCompare}
              className={`px-3 py-2 rounded-xl border text-xs font-medium text-text-secondary hover:border-amber-500/30 hover:bg-amber-500/5 flex items-center gap-1.5 transition-colors ${
                isLight
                  ? 'border-bg-hover bg-bg-tertiary hover:text-amber-800'
                  : 'border-white/[0.08] bg-black/10 hover:text-amber-200/90'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              对比 Offer
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className={`p-2.5 rounded-xl border text-text-muted hover:text-accent-blue hover:border-accent-blue/25 disabled:opacity-50 transition-colors ${
                isLight ? 'border-bg-hover bg-bg-tertiary' : 'border-white/[0.08] bg-black/10'
              }`}
              title="刷新"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={addRow}
              className="px-4 py-2.5 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 bg-gradient-to-r from-accent-blue via-blue-600 to-indigo-600 shadow-lg shadow-accent-blue/30 hover:brightness-110 active:scale-[0.98] transition-all"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} />
              新增记录
            </button>
          </div>
        </div>
      </div>

      <div
        className={`flex-1 min-h-0 overflow-hidden p-3 md:p-4 ${
          view === 'kanban'
            ? isLight
              ? 'bg-bg-secondary'
              : 'bg-gradient-to-b from-bg-primary via-[#0f0f16] to-indigo-950/[0.12]'
            : ''
        }`}
      >
        {loading && applications.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-text-muted text-sm">加载中…</div>
        ) : view === 'table' ? (
          <ApplicationsTable
            applications={applications}
            offerByAppId={offerByAppId}
            selectedOfferIds={selectedOfferIds}
            toggleOfferSelect={toggleOfferSelect}
            onPatch={onPatch}
            onDelete={onDelete}
            onOpenOffer={openOfferModal}
            dense={dense}
            search={search}
          />
        ) : (
          <KanbanBoard
            applications={applications}
            onStageChange={onStageChange}
            onReorderInStage={onReorderInStage}
            search={search}
            showTerminalStages={showTerminalStages}
            onShowTerminalStagesChange={setShowTerminalStages}
            terminalApplicationsCount={terminalApplicationsCount}
          />
        )}
      </div>

      <OfferEditModal
        open={offerModalApp != null}
        application={offerModalApp}
        offer={offerForModal}
        onClose={() => setOfferModalApp(null)}
        onSave={saveOffer}
      />

      <OfferCompareModal open={compareOpen} items={compareItems} onClose={() => setCompareOpen(false)} />
    </div>
  )
}
