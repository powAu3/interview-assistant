import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import dayjs from 'dayjs'
import {
  Briefcase,
  CalendarDays,
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import ApplicationsTable from './job-tracker/ApplicationsTable'

const KanbanBoard = lazy(() => import('./job-tracker/KanbanBoard'))
const OfferEditModal = lazy(() => import('./job-tracker/OfferEditModal'))
import type { Application, Offer, Stage } from './job-tracker/types'
import { parseApplication, parseOffer } from './job-tracker/types'
import { isLightColorScheme } from '@/lib/colorScheme'
import {
  ONGOING_STAGES,
  STAGE_LABELS,
  StageBadge,
  isRejectedStage,
  isTerminalStage,
  TERMINAL_STAGES,
} from './job-tracker/stageConfig'

const SHOW_TERMINAL_STORAGE_KEY = 'ia-jobtracker-show-terminal'

type ApplicationReviewItem = {
  id: number
  status: string
  started_at: number
  ended_at: number | null
  title?: string | null
  company?: string | null
  role?: string | null
  turn_count: number
  avg_score: number | null
  summary_preview?: string | null
  updated_at: number
}

type CreateApplicationDraft = {
  appliedAtInput: string
  company: string
  city: string
  position: string
  stage: Stage
}

type FocusFilter = 'all' | 'active' | 'interview' | 'offer' | 'due' | 'rejected' | 'withdrawn'

type CreateNotice = {
  id: number
  company: string
  position: string
  city: string
  appliedAt: number | null
  stage: string
}

type FocusNotice = {
  applicationId: number
  company: string
  position: string
  openReviews: boolean
}

type DetailIntent = {
  applicationId: number
  mode: 'edit_core' | 'extras' | 'quick_progress'
}

type HeaderSnapshotTone = 'neutral' | 'blue' | 'amber' | 'green' | 'red'

const PRIMARY_FOCUS_FILTERS: FocusFilter[] = ['active', 'due', 'interview', 'all']
const COMPACT_PRIMARY_FILTERS_WITH_REJECTED: FocusFilter[] = ['active', 'due', 'rejected', 'all']
const INTERVIEW_FOCUS_STAGES = new Set<string>(['written', 'interview1', 'interview2', 'interview3', 'hr'])

function createInitialDraft(): CreateApplicationDraft {
  return {
    appliedAtInput: dayjs().format('YYYY-MM-DD'),
    company: '',
    city: '',
    position: '',
    stage: 'applied',
  }
}

function useCompactLayout(maxWidth = 640) {
  const read = () => {
    if (typeof window === 'undefined') return false
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(`(max-width: ${Math.max(0, maxWidth - 0.02)}px)`).matches
    }
    return window.innerWidth < maxWidth
  }
  const [compact, setCompact] = useState(read)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const update = (next: boolean) => setCompact((current) => (current === next ? current : next))
    if (typeof window.matchMedia === 'function') {
      const media = window.matchMedia(`(max-width: ${Math.max(0, maxWidth - 0.02)}px)`)
      const onChange = () => update(media.matches)
      onChange()
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onChange)
        return () => media.removeEventListener('change', onChange)
      }
      media.addListener(onChange)
      return () => media.removeListener(onChange)
    }
    const onResize = () => update(window.innerWidth < maxWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maxWidth])

  return compact
}

function fromDateInput(value: string): number | null {
  return value ? dayjs(value).startOf('day').unix() : null
}

function matchesFocusFilter(
  app: Application,
  focusFilter: FocusFilter,
  offerByAppId: Map<number, Offer>,
  dueSoonCutoff: number,
): boolean {
  const hasOffer = app.stage === 'offer' || offerByAppId.has(app.id)
  switch (focusFilter) {
    case 'active':
      return !isTerminalStage(app.stage) && !hasOffer
    case 'interview':
      return ['written', 'interview1', 'interview2', 'interview3', 'hr'].includes(app.stage)
    case 'offer':
      return hasOffer
    case 'due':
      return !isTerminalStage(app.stage) && !hasOffer && app.next_followup_at != null && app.next_followup_at <= dueSoonCutoff
    case 'rejected':
      return isRejectedStage(app.stage)
    case 'withdrawn':
      return app.stage === 'withdrawn'
    case 'all':
    default:
      return true
  }
}

function getFocusFilterForStage(stage: string): FocusFilter {
  if (isRejectedStage(stage)) return 'rejected'
  if (stage === 'withdrawn') return 'withdrawn'
  if (stage === 'offer') return 'offer'
  if (INTERVIEW_FOCUS_STAGES.has(stage)) return 'interview'
  return 'active'
}

function describeCreateNotice(notice: CreateNotice): { rail: string } {
  const stageLabel = STAGE_LABELS[notice.stage] ?? notice.stage

  if (isRejectedStage(notice.stage)) {
    return {
      rail: '已归到“挂了”',
    }
  }

  if (notice.stage === 'withdrawn') {
    return {
      rail: '已归到“已放弃”',
    }
  }

  if (notice.stage === 'offer') {
    return {
      rail: '已归到“Offer”',
    }
  }

  if (INTERVIEW_FOCUS_STAGES.has(notice.stage)) {
    return {
      rail: '已归到“面试中”',
    }
  }

  return {
    rail: '已归到“进行中”',
  }
}

function describeCreateNoticeNextStep(notice: CreateNotice): { title: string } {
  if (isRejectedStage(notice.stage)) {
    return {
      title: '结果已记录',
    }
  }

  if (notice.stage === 'withdrawn') {
    return {
      title: '已放弃',
    }
  }

  if (notice.stage === 'offer') {
    return {
      title: '补 Offer 细节',
    }
  }

  if (INTERVIEW_FOCUS_STAGES.has(notice.stage)) {
    return {
      title: '补跟进/待办',
    }
  }

  return {
    title: '补进度',
  }
}

function describeCreateContinueAction(notice: CreateNotice): { label: string; mode: DetailIntent['mode'] } {
  if (notice.stage === 'offer') {
    return { label: '补 Offer', mode: 'extras' }
  }
  if (isTerminalStage(notice.stage)) {
    return { label: '查看详情', mode: 'quick_progress' }
  }
  return { label: '补进度', mode: 'quick_progress' }
}

export default function JobTracker() {
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const appMode = useUiPrefsStore((s) => s.appMode)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)
  const jobTrackerDeepLink = useUiPrefsStore((s) => s.jobTrackerDeepLink)
  const clearJobTrackerDeepLink = useUiPrefsStore((s) => s.clearJobTrackerDeepLink)
  const setReviewDeepLinkSessionId = useUiPrefsStore((s) => s.setReviewDeepLinkSessionId)
  const isLight = isLightColorScheme(colorScheme)
  const [applications, setApplications] = useState<Application[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [focusFilter, setFocusFilter] = useState<FocusFilter>('active')
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null)
  const [highlightedAppId, setHighlightedAppId] = useState<number | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState<CreateApplicationDraft>(createInitialDraft)
  const [createNotice, setCreateNotice] = useState<CreateNotice | null>(null)
  const [focusNotice, setFocusNotice] = useState<FocusNotice | null>(null)
  const [detailIntent, setDetailIntent] = useState<DetailIntent | null>(null)
  const [offerModalApp, setOfferModalApp] = useState<Application | null>(null)
  const [reviewModalApp, setReviewModalApp] = useState<Application | null>(null)
  const [reviewItems, setReviewItems] = useState<ApplicationReviewItem[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewModalHighlightId, setReviewModalHighlightId] = useState<number | null>(null)
  const reviewRequestSeqRef = useRef(0)
  const [showSecondaryFilters, setShowSecondaryFilters] = useState(false)
  const isCompactLayout = useCompactLayout()
  const isNarrowDetailLayout = useCompactLayout(1024)
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

  useEffect(() => {
    if (highlightedAppId == null) return undefined
    const timer = window.setTimeout(() => setHighlightedAppId(null), 2400)
    return () => window.clearTimeout(timer)
  }, [highlightedAppId])

  useEffect(() => {
    if (focusNotice == null) return undefined
    const timer = window.setTimeout(() => setFocusNotice(null), 3600)
    return () => window.clearTimeout(timer)
  }, [focusNotice])

  useEffect(() => {
    if (!isCompactLayout) return
    if (view !== 'table') setView('table')
  }, [isCompactLayout, view])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [aRes, oRes] = await Promise.all([
        api.jobTrackerApplications(),
        api.jobTrackerListOffers(),
      ])
      const nextApplications = (aRes.items as Record<string, unknown>[]).map(parseApplication)
      const nextOffers = (oRes.items as Record<string, unknown>[]).map(parseOffer)
      startTransition(() => {
        setApplications(nextApplications)
        setOffers(nextOffers)
      })
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [setToastMessage])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (applications.length === 0) {
      setSelectedAppId(null)
      return
    }
    if (selectedAppId == null || !applications.some((app) => app.id === selectedAppId)) {
      setSelectedAppId(applications[0].id)
    }
  }, [applications, selectedAppId])

  const offerByAppId = useMemo(() => {
    const m = new Map<number, Offer>()
    for (const offer of offers) m.set(offer.application_id, offer)
    return m
  }, [offers])

  const onPatch = useCallback(
    async (id: number, patch: Partial<Application>) => {
      try {
        const raw = await api.jobTrackerPatchApplication(id, patch as Record<string, unknown>)
        const next = parseApplication(raw as Record<string, unknown>)
        startTransition(() => {
          setApplications((prev) => prev.map((item) => (item.id === id ? next : item)))
        })
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
        startTransition(() => {
          setApplications((prev) => prev.filter((item) => item.id !== id))
          setOffers((prev) => prev.filter((offer) => offer.application_id !== id))
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
        prev.map((app) => {
          const index = orderedIds.indexOf(app.id)
          if (index < 0 || app.stage !== stage) return app
          return { ...app, sort_order: index }
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

  const terminalApplicationsCount = useMemo(() => applications.filter((app) => isTerminalStage(app.stage)).length, [applications])
  const rejectedCount = useMemo(() => applications.filter((app) => isRejectedStage(app.stage)).length, [applications])
  const withdrawnCount = useMemo(() => applications.filter((app) => app.stage === 'withdrawn').length, [applications])
  const dueSoonCutoff = useMemo(() => dayjs().add(3, 'day').endOf('day').unix(), [])
  const offerCount = useMemo(
    () => applications.filter((app) => app.stage === 'offer' || offerByAppId.has(app.id)).length,
    [applications, offerByAppId],
  )
  const ongoingApplicationsCount = useMemo(
    () => applications.filter((app) => !isTerminalStage(app.stage) && app.stage !== 'offer' && !offerByAppId.has(app.id)).length,
    [applications, offerByAppId],
  )
  const dueSoonCount = useMemo(
    () =>
      applications.filter(
        (app) =>
          !isTerminalStage(app.stage) &&
          app.stage !== 'offer' &&
          !offerByAppId.has(app.id) &&
          app.next_followup_at != null &&
          app.next_followup_at <= dueSoonCutoff,
      ).length,
    [applications, dueSoonCutoff, offerByAppId],
  )
  const interviewCount = useMemo(
    () => applications.filter((app) => ['written', 'interview1', 'interview2', 'interview3', 'hr'].includes(app.stage)).length,
    [applications],
  )
  const filteredApplications = useMemo(
    () => applications.filter((app) => matchesFocusFilter(app, focusFilter, offerByAppId, dueSoonCutoff)),
    [applications, dueSoonCutoff, focusFilter, offerByAppId],
  )

  const createApplication = useCallback(async () => {
    const company = createDraft.company.trim()
    if (!company) {
      setToastMessage('先填公司名，再创建记录')
      return
    }
    setCreating(true)
    try {
      const raw = await api.jobTrackerCreateApplication({
        company,
        city: createDraft.city.trim(),
        position: createDraft.position.trim() || '岗位',
        stage: createDraft.stage,
        applied_at: fromDateInput(createDraft.appliedAtInput),
      })
      const row = parseApplication(raw as Record<string, unknown>)
      setApplications((prev) => [row, ...prev])
      setSearch('')
      setSelectedAppId(row.id)
      setHighlightedAppId(row.id)
      setFocusFilter(getFocusFilterForStage(row.stage))
      setShowSecondaryFilters(false)
      setView('table')
      setComposerOpen(false)
      setCreateDraft(createInitialDraft())
      setCreateNotice({
        id: row.id,
        company: row.company,
        position: row.position,
        city: row.city,
        appliedAt: row.applied_at,
        stage: row.stage,
      })
      setToastMessage(`已新建 ${row.company}`)
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : '新增失败')
    } finally {
      setCreating(false)
    }
  }, [createDraft, setToastMessage])

  const openOfferModal = useCallback((app: Application) => {
    setOfferModalApp(app)
  }, [])

  const openReviewsModal = useCallback(
    async (app: Application, highlightedReviewId: number | null = null) => {
      const requestSeq = reviewRequestSeqRef.current + 1
      reviewRequestSeqRef.current = requestSeq
      setReviewModalApp(app)
      setReviewModalHighlightId(highlightedReviewId)
      setReviewItems([])
      setReviewLoading(true)
      try {
        const res = await api.jobTrackerApplicationReviews(app.id)
        if (reviewRequestSeqRef.current !== requestSeq) return
        setReviewItems((res.items as Record<string, unknown>[]).map((item) => ({
          id: Number(item.id),
          status: String(item.status ?? ''),
          started_at: Number(item.started_at ?? 0),
          ended_at: item.ended_at != null ? Number(item.ended_at) : null,
          title: item.title != null ? String(item.title) : null,
          company: item.company != null ? String(item.company) : null,
          role: item.role != null ? String(item.role) : null,
          turn_count: Number(item.turn_count ?? 0),
          avg_score: item.avg_score != null ? Number(item.avg_score) : null,
          summary_preview: item.summary_preview != null ? String(item.summary_preview) : null,
          updated_at: Number(item.updated_at ?? 0),
        })))
      } catch (e) {
        if (reviewRequestSeqRef.current !== requestSeq) return
        setToastMessage(e instanceof Error ? e.message : '加载关联复盘失败')
      } finally {
        if (reviewRequestSeqRef.current === requestSeq) {
          setReviewLoading(false)
        }
      }
    },
    [setToastMessage],
  )

  const openReviewDetail = useCallback((sessionId: number) => {
    setReviewDeepLinkSessionId(sessionId)
    if (reviewModalApp) {
      setToastMessage(`已打开 ${reviewModalApp.company}${reviewModalApp.position ? ` · ${reviewModalApp.position}` : ''} 的复盘详情`)
    } else {
      setToastMessage('已打开复盘详情')
    }
    setAppMode('review')
  }, [reviewModalApp, setAppMode, setReviewDeepLinkSessionId, setToastMessage])

  useEffect(() => {
    if (appMode !== 'job-tracker' || !jobTrackerDeepLink || applications.length === 0) return
    const targetApp = applications.find((app) => app.id === jobTrackerDeepLink.applicationId)
    if (!targetApp) return
    setSelectedAppId(targetApp.id)
    setHighlightedAppId(targetApp.id)
    setFocusFilter(getFocusFilterForStage(targetApp.stage))
    setShowSecondaryFilters(false)
    setView('table')
    setFocusNotice({
      applicationId: targetApp.id,
      company: targetApp.company,
      position: targetApp.position,
      openReviews: Boolean(jobTrackerDeepLink.openReviews),
    })
    clearJobTrackerDeepLink()
    if (jobTrackerDeepLink.openReviews) {
      void openReviewsModal(targetApp, jobTrackerDeepLink.highlightReviewId ?? null)
    }
  }, [appMode, applications, clearJobTrackerDeepLink, jobTrackerDeepLink, openReviewsModal])

  const saveOffer = useCallback(
    async (payload: Record<string, unknown>) => {
      const raw = await api.jobTrackerUpsertOffer(payload)
      const offer = parseOffer(raw as Record<string, unknown>)
      startTransition(() => {
        setOffers((prev) => {
          const index = prev.findIndex((item) => item.application_id === offer.application_id)
          if (index < 0) return [...prev, offer]
          const next = [...prev]
          next[index] = offer
          return next
        })
      })
      setToastMessage('Offer 已保存')
    },
    [setToastMessage],
  )

  const offerForModal = offerModalApp ? offerByAppId.get(offerModalApp.id) ?? null : null
  const visibleCount = filteredApplications.length
  const focusFilterOptions: { key: FocusFilter; label: string; count: number }[] = [
    { key: 'active', label: '进行中', count: ongoingApplicationsCount },
    { key: 'due', label: '待跟进', count: dueSoonCount },
    { key: 'interview', label: '面试中', count: interviewCount },
    { key: 'offer', label: 'Offer', count: offerCount },
    { key: 'rejected', label: '挂了', count: rejectedCount },
    ...(withdrawnCount > 0
      ? [{ key: 'withdrawn' as FocusFilter, label: '已放弃', count: withdrawnCount }]
      : []),
    { key: 'all', label: '全部', count: applications.length },
  ]
  const primaryFocusFilterKeys = isCompactLayout && rejectedCount > 0
    ? COMPACT_PRIMARY_FILTERS_WITH_REJECTED
    : PRIMARY_FOCUS_FILTERS
  const primaryFocusFilterOptions = focusFilterOptions.filter((item) => primaryFocusFilterKeys.includes(item.key))
  const secondaryFocusFilterOptions = focusFilterOptions.filter((item) => !primaryFocusFilterKeys.includes(item.key))
  const visibleSecondaryFocusFilterOptions = secondaryFocusFilterOptions.filter((item) => item.count > 0 || item.key === focusFilter)
  const selectedSecondaryFilter = secondaryFocusFilterOptions.find((item) => item.key === focusFilter) ?? null
  const currentFocusOption = focusFilterOptions.find((item) => item.key === focusFilter) ?? focusFilterOptions[focusFilterOptions.length - 1]
  const snapshotItems = applications.length === 0
    ? []
    : [
        {
          label: focusFilter === 'all' ? '当前' : currentFocusOption.label,
          value: `${visibleCount} 条`,
          tone: focusFilter === 'all' ? 'blue' : 'green',
        },
        {
          label: '待跟进',
          value: dueSoonCount > 0 ? `${dueSoonCount} 条` : '已清空',
          tone: dueSoonCount > 0 ? 'amber' : 'neutral',
        },
        terminalApplicationsCount > 0
          ? {
              label: '已结束',
              value: `${terminalApplicationsCount} 条`,
              tone: rejectedCount > 0 ? 'red' : 'neutral',
            }
          : {
              label: 'Offer',
              value: offerCount > 0 ? `${offerCount} 条` : '暂无',
              tone: offerCount > 0 ? 'green' : 'neutral',
            },
      ] satisfies Array<{ label: string; value: string; tone: HeaderSnapshotTone }>

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-primary">
      <div
        className={`flex-shrink-0 border-b px-3 py-2.5 md:px-4 ${
          isLight ? 'border-bg-hover bg-white/95' : 'border-white/[0.06] bg-bg-secondary/20'
        }`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-bg-hover bg-bg-secondary text-accent-blue">
                <Briefcase className="h-4.5 w-4.5" strokeWidth={2} />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-base font-bold tracking-tight text-text-primary">求职进度</h2>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 lg:max-w-3xl">
              <div className="relative w-full lg:ml-auto lg:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <input
                  type="search"
                  placeholder="搜索公司 / 岗位 / 城市 / 待办"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && search) {
                      e.preventDefault()
                      setSearch('')
                    }
                  }}
                  className={`w-full rounded-lg border py-2 pl-9 ${search ? 'pr-9' : 'pr-3'} text-sm text-text-primary placeholder:text-text-muted/70 focus:border-accent-blue/40 focus:outline-none focus:ring-2 focus:ring-accent-blue/15 ${
                    isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/15'
                  }`}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                    aria-label="清空搜索"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {isCompactLayout ? (
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className={`rounded-lg border p-2 text-text-muted transition-colors hover:border-accent-blue/25 hover:text-accent-blue disabled:opacity-50 ${
                      isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/15'
                    }`}
                    title="刷新"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setComposerOpen((prev) => !prev)}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-blue px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.2} />
                    {composerOpen ? '收起新增' : '新增记录'}
                  </button>
                </div>
              ) : (
                <div className="flex w-full flex-wrap items-center gap-2 lg:justify-end">
                  <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className={`rounded-lg border p-2 text-text-muted transition-colors hover:border-accent-blue/25 hover:text-accent-blue disabled:opacity-50 ${
                      isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/15'
                    }`}
                    title="刷新"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setComposerOpen((prev) => !prev)}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-blue px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.2} />
                    {composerOpen ? '收起新增' : '新增记录'}
                  </button>
                  {applications.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setView((prev) => prev === 'table' ? 'kanban' : 'table')}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        isLight
                          ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                          : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {view === 'table' ? '整理模式' : '返回表格'}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {applications.length > 0 ? (
            <div className="text-[11px] leading-relaxed text-text-muted">
              {isCompactLayout ? (
                <div className="flex flex-wrap gap-2">
                  {snapshotItems.map((item) => (
                    <HeaderSnapshotPill
                      key={item.label}
                      label={item.label}
                      value={item.value}
                      tone={item.tone}
                      isLight={isLight}
                    />
                  ))}
                </div>
              ) : (
                <DesktopOverviewSummary
                  items={snapshotItems}
                  isLight={isLight}
                />
              )}
            </div>
          ) : null}

          {applications.length > 0 ? (
            isCompactLayout ? (
              <div className="space-y-2">
                <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {primaryFocusFilterOptions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setFocusFilter(item.key)
                        setShowSecondaryFilters(false)
                      }}
                      className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        focusFilter === item.key
                          ? 'border-bg-hover bg-transparent text-accent-blue'
                          : isLight
                            ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                            : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {item.label} · {item.count}
                    </button>
                  ))}
                  {visibleSecondaryFocusFilterOptions.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowSecondaryFilters((prev) => !prev)}
                      className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        selectedSecondaryFilter
                          ? 'border-bg-hover bg-transparent text-accent-blue'
                          : isLight
                            ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                            : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {selectedSecondaryFilter ? `${selectedSecondaryFilter.label} · ${selectedSecondaryFilter.count}` : '更多状态'}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSecondaryFilters ? 'rotate-180' : ''}`} />
                    </button>
                  ) : null}
                </div>

                {showSecondaryFilters ? (
                  <div className={`grid gap-2 rounded-lg border p-2 ${
                    isLight ? 'border-bg-hover bg-white/90' : 'border-white/[0.08] bg-black/12'
                  }`}>
                    {visibleSecondaryFocusFilterOptions.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setFocusFilter(item.key)
                          setShowSecondaryFilters(false)
                        }}
                        className={`rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
                          focusFilter === item.key
                            ? 'border-bg-hover bg-transparent text-accent-blue'
                            : isLight
                              ? 'border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary'
                              : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {item.label} · {item.count}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap">
                  {primaryFocusFilterOptions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setFocusFilter(item.key)
                        setShowSecondaryFilters(false)
                      }}
                      className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        focusFilter === item.key
                          ? 'border-bg-hover bg-transparent text-accent-blue'
                          : isLight
                            ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                            : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {item.label} · {item.count}
                    </button>
                  ))}
                  {visibleSecondaryFocusFilterOptions.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowSecondaryFilters((prev) => !prev)}
                      className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        selectedSecondaryFilter
                          ? 'border-bg-hover bg-transparent text-accent-blue'
                          : isLight
                            ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                            : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {selectedSecondaryFilter ? `${selectedSecondaryFilter.label} · ${selectedSecondaryFilter.count}` : '更多状态'}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSecondaryFilters ? 'rotate-180' : ''}`} />
                    </button>
                  ) : null}
                </div>

                {showSecondaryFilters && visibleSecondaryFocusFilterOptions.length > 0 ? (
                  <div className={`flex flex-wrap gap-2 rounded-lg border p-2 ${
                    isLight ? 'border-bg-hover bg-white/90' : 'border-white/[0.08] bg-black/12'
                  }`}>
                    {visibleSecondaryFocusFilterOptions.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setFocusFilter(item.key)
                          setShowSecondaryFilters(false)
                        }}
                        className={`rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
                          focusFilter === item.key
                            ? 'border-bg-hover bg-transparent text-accent-blue'
                            : isLight
                              ? 'border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary'
                              : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {item.label} · {item.count}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {composerOpen && (
            <QuickCreatePanel
              draft={createDraft}
              creating={creating}
              isLight={isLight}
              onChange={setCreateDraft}
              onCancel={() => {
                setComposerOpen(false)
                setCreateDraft(createInitialDraft())
              }}
              onSubmit={createApplication}
            />
          )}

          {createNotice != null && (
            <CreateSuccessBanner
              notice={createNotice}
              continueLabel={describeCreateContinueAction(createNotice).label}
              isLight={isLight}
              onDismiss={() => setCreateNotice(null)}
              onContinue={() => {
                const continueAction = describeCreateContinueAction(createNotice)
                setView('table')
                setSelectedAppId(createNotice.id)
                setHighlightedAppId(createNotice.id)
                setFocusFilter(getFocusFilterForStage(createNotice.stage))
                setShowSecondaryFilters(false)
                setDetailIntent({ applicationId: createNotice.id, mode: continueAction.mode })
                setCreateNotice(null)
              }}
              onUndo={async () => {
                await onDelete(createNotice.id)
                if (selectedAppId === createNotice.id) {
                  setSelectedAppId(null)
                }
                setCreateNotice(null)
                setToastMessage(`已撤销 ${createNotice.company}`)
              }}
            />
          )}

          {focusNotice != null && (
            <FocusArrivalBanner
              notice={focusNotice}
              isLight={isLight}
              onDismiss={() => setFocusNotice(null)}
            />
          )}
        </div>
      </div>

      <div
        className={`p-3 md:p-4 ${
          view === 'kanban'
            ? isLight
              ? 'bg-bg-secondary'
              : 'bg-bg-primary'
            : ''
        }`}
      >
        {loading && applications.length === 0 ? (
          <div className="space-y-2 px-1 py-2" aria-busy="true" aria-live="polite">
            <span className="sr-only">正在加载求职数据…</span>
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-12 animate-pulse rounded-xl bg-bg-tertiary/50"
                style={{ animationDelay: `${index * 70}ms`, opacity: 1 - index * 0.08 }}
              />
            ))}
          </div>
        ) : view === 'table' && applications.length === 0 ? (
          <JobTrackerZeroState
            onCreate={() => setComposerOpen(true)}
          />
        ) : view === 'table' ? (
          <ApplicationsTable
            applications={filteredApplications}
            offerByAppId={offerByAppId}
            onPatch={onPatch}
            onDelete={onDelete}
            onOpenOffer={openOfferModal}
            onOpenReviews={openReviewsModal}
            search={deferredSearch}
            selectedId={selectedAppId}
            onSelect={setSelectedAppId}
            highlightedId={highlightedAppId}
            compactDetailLayout={isNarrowDetailLayout}
            detailIntent={detailIntent}
            onConsumeDetailIntent={() => setDetailIntent(null)}
            hiddenApplicationsCount={Math.max(0, applications.length - filteredApplications.length)}
            hiddenApplicationsPreview={applications.filter((app) => !matchesFocusFilter(app, focusFilter, offerByAppId, dueSoonCutoff)).slice(0, 3)}
            focusFilterLabel={currentFocusOption.label}
            onShowAll={() => setFocusFilter('all')}
          />
        ) : (
          <div>
            <Suspense fallback={<div className="flex h-48 items-center justify-center text-sm text-text-muted">加载看板中…</div>}>
              <KanbanBoard
                applications={filteredApplications}
                onStageChange={onStageChange}
                onReorderInStage={onReorderInStage}
                search={deferredSearch}
                showTerminalStages={showTerminalStages}
                onShowTerminalStagesChange={setShowTerminalStages}
                terminalApplicationsCount={terminalApplicationsCount}
              />
            </Suspense>
          </div>
        )}
      </div>

      {offerModalApp != null && (
        <Suspense fallback={null}>
          <OfferEditModal
            open={offerModalApp != null}
            application={offerModalApp}
            offer={offerForModal}
            onClose={() => setOfferModalApp(null)}
            onSave={saveOffer}
          />
        </Suspense>
      )}

      {reviewModalApp != null && (
        <ApplicationReviewsModal
          app={reviewModalApp}
          items={reviewItems}
          loading={reviewLoading}
          highlightedReviewId={reviewModalHighlightId}
          onClose={() => {
            reviewRequestSeqRef.current += 1
            setReviewModalApp(null)
            setReviewModalHighlightId(null)
            setReviewItems([])
            setReviewLoading(false)
          }}
          onViewDetail={openReviewDetail}
        />
      )}
    </div>
  )
}

function HeaderSnapshotPill({
  label,
  value,
  tone,
  isLight,
}: {
  label: string
  value: string
  tone: HeaderSnapshotTone
  isLight: boolean
}) {
  const toneClass = {
    neutral: isLight ? 'text-text-secondary' : 'text-text-secondary',
    blue: isLight ? 'text-accent-blue' : 'text-accent-blue',
    amber: isLight ? 'text-yellow-600' : 'text-yellow-400',
    green: isLight ? 'text-emerald-600' : 'text-emerald-400',
    red: isLight ? 'text-red-600' : 'text-red-400',
  }[tone]

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className={`shrink-0 font-semibold ${toneClass}`}>{value}</span>
    </span>
  )
}

function DesktopOverviewSummary({
  items,
  isLight,
}: {
  items: Array<{ label: string; value: string; tone: HeaderSnapshotTone }>
  isLight: boolean
}) {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
        {items.map((item) => (
          <DesktopOverviewInlineStat
            key={item.label}
            label={item.label}
            value={item.value}
            tone={item.tone}
            isLight={isLight}
          />
        ))}
    </div>
  )
}

function DesktopOverviewInlineStat({
  label,
  value,
  tone,
  isLight,
}: {
  label: string
  value: string
  tone: HeaderSnapshotTone
  isLight: boolean
}) {
  const toneClass = {
    neutral: isLight ? 'text-text-secondary' : 'text-text-secondary',
    blue: isLight ? 'text-accent-blue' : 'text-accent-blue',
    amber: isLight ? 'text-yellow-600' : 'text-yellow-400',
    green: isLight ? 'text-emerald-600' : 'text-emerald-400',
    red: isLight ? 'text-red-600' : 'text-red-400',
  }[tone]

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className={`shrink-0 font-semibold ${toneClass}`}>{value}</span>
    </span>
  )
}

function JobTrackerZeroState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="border-l border-bg-hover/80 py-2 pl-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">暂无岗位记录</div>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-accent-blue px-4 text-sm font-semibold text-white transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          新建记录
        </button>
      </div>
    </section>
  )
}

function CreateSuccessBanner({
  notice,
  continueLabel,
  isLight,
  onContinue,
  onDismiss,
  onUndo,
}: {
  notice: CreateNotice
  continueLabel: string
  isLight: boolean
  onContinue: () => void
  onDismiss: () => void
  onUndo: () => void | Promise<void>
}) {
  const noticeCopy = describeCreateNotice(notice)
  const nextStepCopy = describeCreateNoticeNextStep(notice)
  const identityText = [notice.position || '岗位', notice.city].filter(Boolean).join(' · ')

  return (
    <section
      className={`flex flex-col gap-3 border-l pl-3 lg:flex-row lg:items-center lg:justify-between ${
        isLight ? 'border-bg-hover' : 'border-white/[0.12]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <div className="text-sm font-semibold text-text-primary">
            已创建 {notice.company}
          </div>
          {identityText ? (
            <span className="text-[11px] text-text-secondary">
              {identityText}
            </span>
          ) : null}
          <span className="text-[11px] font-medium text-accent-blue">
            {noticeCopy.rail}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          <span>{continueLabel === '补进度' ? '补阶段/跟进' : nextStepCopy.title}</span>
          <span>已定位详情</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-md bg-accent-blue px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
        >
          {continueLabel}
        </button>
        <button
          type="button"
          onClick={() => void onUndo()}
          className="inline-flex items-center gap-1.5 rounded-md border border-bg-hover px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          <Undo2 className="h-3.5 w-3.5" />
          撤销
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-bg-hover px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          收起
        </button>
      </div>
    </section>
  )
}

function FocusArrivalBanner({
  notice,
  isLight,
  onDismiss,
}: {
  notice: FocusNotice
  isLight: boolean
  onDismiss: () => void
}) {
  return (
    <section
      className={`flex flex-col gap-3 border-l pl-3 md:flex-row md:items-center md:justify-between ${
        isLight ? 'border-bg-hover' : 'border-white/[0.12]'
      }`}
    >
      <div>
        <div className="text-sm font-semibold text-text-primary">
          已定位到 {notice.company}{notice.position ? ` · ${notice.position}` : ''}
        </div>
        <div className="mt-1 text-xs text-text-muted">{notice.openReviews ? '已打开复盘时间线' : '已选中详情'}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-bg-hover px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          知道了
        </button>
      </div>
    </section>
  )
}

function QuickCreatePanel({
  draft,
  creating,
  isLight,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: CreateApplicationDraft
  creating: boolean
  isLight: boolean
  onChange: (draft: CreateApplicationDraft) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const inputClass = `rounded-lg border px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/15 ${
    isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/15'
  }`

  return (
    <section
      className={`rounded-lg border p-3.5 ${
        isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/20'
      }`}
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">快速新增</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-bg-hover px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={onSubmit}
            className="rounded-md bg-accent-blue px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {creating ? '创建中...' : '创建记录'}
          </button>
        </div>
      </div>

      <div className="mt-3.5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          投递日期
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="date"
              value={draft.appliedAtInput}
              onChange={(e) => onChange({ ...draft, appliedAtInput: e.target.value })}
              className={`${inputClass} w-full pl-9`}
            />
          </div>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          公司名称
          <input
            autoFocus
            value={draft.company}
            onChange={(e) => onChange({ ...draft, company: e.target.value })}
            placeholder="例如 OpenAI"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          城市
          <input
            value={draft.city}
            onChange={(e) => onChange({ ...draft, city: e.target.value })}
            placeholder="例如 上海 / Remote"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          岗位名称
          <input
            value={draft.position}
            onChange={(e) => onChange({ ...draft, position: e.target.value })}
            placeholder="例如 Frontend Engineer"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          阶段
          <select
            value={draft.stage}
            onChange={(e) => onChange({ ...draft, stage: e.target.value as Stage })}
            className={inputClass}
          >
            <optgroup label="进行中">
              {ONGOING_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage] ?? stage}
                </option>
              ))}
            </optgroup>
            <optgroup label="已结束">
              {TERMINAL_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage] ?? stage}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
    </section>
  )
}

function ApplicationReviewsModal({
  app,
  items,
  loading,
  highlightedReviewId,
  onClose,
  onViewDetail,
}: {
  app: Application
  items: ApplicationReviewItem[]
  loading: boolean
  highlightedReviewId?: number | null
  onClose: () => void
  onViewDetail: (sessionId: number) => void
}) {
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const isLight = isLightColorScheme(colorScheme)
  const latestReviewAt = items[0]?.ended_at ?? items[0]?.started_at ?? null
  const latestScore = items[0]?.avg_score ?? null
  const scoredCount = items.filter((item) => item.avg_score != null).length
  const closedStage = isTerminalStage(app.stage)
  const latestReviewLabel = latestReviewAt != null
    ? dayjs.unix(Math.floor(latestReviewAt)).format('YYYY-MM-DD HH:mm')
    : '--'
  const latestScoreLabel = latestScore != null ? latestScore.toFixed(1) : '未出分'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-0 sm:p-4">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-none border border-bg-hover bg-bg-secondary shadow-xl sm:h-auto sm:max-h-[82vh] sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-bg-hover px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-text-primary">关联复盘</h3>
              <StageBadge stage={app.stage} isLight={isLight} />
            </div>
            <p className="mt-1 truncate text-xs text-text-muted">
              {app.company} · {app.position || '岗位'}
              {app.city ? ` · ${app.city}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-bg-hover hover:text-text-primary"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-text-muted">加载中...</div>
          ) : items.length === 0 ? (
            <div className="border-l border-bg-hover/80 py-2 pl-3">
              <div className="text-sm font-semibold text-text-primary">暂无关联复盘</div>
              <div className="mt-1 text-xs text-text-muted">
                {closedStage ? '已结束，可手动补挂。' : '暂无复盘。'}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-1.5 border-b border-bg-hover/80 pb-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                  <span className="font-medium text-text-primary">{items.length} 场复盘</span>
                  <span>最近 {latestReviewLabel}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  <span>最近得分 <span className="font-semibold text-text-primary">{latestScoreLabel}</span></span>
                  <span>已出分 <span className="font-semibold text-text-primary">{scoredCount}</span></span>
                </div>
              </div>

              <div>
                {items.map((item, index) => {
                  const reviewAt = item.ended_at ?? item.started_at
                  const highlighted = highlightedReviewId != null && item.id === highlightedReviewId
                  return (
                    <div key={item.id} className="relative pl-6">
                      {index < items.length - 1 ? (
                        <div className="absolute left-[11px] top-8 h-[calc(100%-0.5rem)] w-px bg-bg-hover" aria-hidden />
                      ) : null}
                      <div className={`absolute left-0 top-5 h-3 w-3 rounded-full border-2 bg-bg-secondary ${
                        highlighted ? 'border-accent-blue' : 'border-bg-hover'
                      }`} aria-hidden />
                      <div className="border-b border-bg-hover/70 py-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-text-primary">
                                {item.title || item.company || item.role || `复盘 #${item.id}`}
                              </div>
                              <span className={`text-[11px] font-medium ${reviewStatusTone(item.status)}`}>
                                {reviewStatusLabel(item.status)}
                              </span>
                              {highlighted ? (
                                <span className="text-[11px] font-medium text-accent-blue">
                                  当前这场
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                              <span>{reviewAt != null ? dayjs.unix(Math.floor(reviewAt)).format('YYYY-MM-DD HH:mm') : '--'}</span>
                              <span>{item.turn_count} 轮</span>
                              <span>{item.role || app.position || '岗位未填写'}</span>
                            </div>
                            {item.summary_preview ? (
                              <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-text-secondary">{item.summary_preview}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <div className={`text-xs font-bold ${reviewScoreTone(item.avg_score)}`}>
                              {item.avg_score != null ? item.avg_score.toFixed(1) : '未出分'}
                            </div>
                            <button
                              type="button"
                              onClick={() => onViewDetail(item.id)}
                              className="rounded-md border border-accent-blue/25 bg-transparent px-3 py-2 text-xs font-medium text-accent-blue transition-colors hover:bg-accent-blue/5"
                            >
                              打开复盘
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function reviewScoreTone(score: number | null) {
  if (score == null) return 'text-text-muted'
  if (score < 6) return 'text-yellow-500'
  if (score >= 8) return 'text-green-500'
  return 'text-blue-500'
}

function reviewStatusLabel(status: string) {
  switch (status) {
    case 'recording':
      return '录制中'
    case 'recorded':
      return '待生成'
    case 'analyzing':
      return '分析中'
    case 'completed':
      return '已完成'
    case 'partial_capture':
      return '部分录制'
    case 'analysis_failed':
      return '分析失败'
    default:
      return status
  }
}

function reviewStatusTone(status: string) {
  switch (status) {
    case 'completed':
      return 'text-green-500'
    case 'analysis_failed':
      return 'text-red-500'
    case 'analyzing':
      return 'text-blue-500'
    case 'partial_capture':
      return 'text-yellow-500'
    case 'recorded':
      return 'text-amber-500'
    default:
      return 'text-text-muted'
  }
}
