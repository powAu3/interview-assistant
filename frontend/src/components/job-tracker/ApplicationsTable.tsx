import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  FileText,
  MapPin,
  Trash2,
} from 'lucide-react'
import type { Application, Offer, Stage, TodoItem } from './types'
import { filterApplicationsBySearch } from './search'
import {
  getStageOrderIndex,
  isRejectedStage,
  isTerminalStage,
  ONGOING_STAGES,
  STAGE_LABELS,
  StageBadge,
  TERMINAL_STAGES,
} from './stageConfig'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { isLightColorScheme } from '@/lib/colorScheme'

type EditorDraft = {
  company: string
  position: string
  city: string
  stage: string
  appliedAtInput: string
  nextFollowupInput: string
  notes: string
  todoText: string
}

type Props = {
  applications: Application[]
  offerByAppId: Map<number, Offer>
  onPatch: (id: number, patch: Partial<Application>) => void | Promise<boolean>
  onDelete: (id: number) => void
  onOpenOffer: (app: Application) => void
  onOpenReviews: (app: Application) => void
  search: string
  selectedId: number | null
  onSelect: (id: number | null) => void
  highlightedId?: number | null
  compactDetailLayout: boolean
  detailIntent?: { applicationId: number; mode: 'edit_core' | 'extras' | 'quick_progress' } | null
  onConsumeDetailIntent?: () => void
  hiddenApplicationsCount?: number
  hiddenApplicationsPreview?: Application[]
  focusFilterLabel?: string
  onShowAll?: () => void
}

const CORE_PATCH_KEYS = ['company', 'position', 'city', 'stage', 'applied_at', 'next_followup_at'] as const
const EXTRA_PATCH_KEYS = ['notes', 'todos'] as const

function toDateInput(unix: number | null): string {
  return unix != null ? dayjs.unix(Math.floor(unix)).format('YYYY-MM-DD') : ''
}

function fromDateInput(value: string): number | null {
  return value ? dayjs(value).startOf('day').unix() : null
}

function createDraft(app: Application): EditorDraft {
  return {
    company: app.company,
    position: app.position,
    city: app.city,
    stage: app.stage,
    appliedAtInput: toDateInput(app.applied_at),
    nextFollowupInput: toDateInput(app.next_followup_at),
    notes: app.notes,
    todoText: app.todos.map((todo) => todo.title).join('\n'),
  }
}

function todosFromText(text: string, currentTodos: TodoItem[]): TodoItem[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const existingByTitle = new Map(currentTodos.map((todo) => [todo.title, todo]))
  return lines.map((title, index) => {
    const indexed = currentTodos[index]
    const matched = indexed?.title === title ? indexed : existingByTitle.get(title)
    return {
      id: matched?.id ?? crypto.randomUUID(),
      title,
      done: matched?.done ?? false,
      due: matched?.due,
    }
  })
}

function serializeTodos(todos: TodoItem[]): string {
  return JSON.stringify(
    todos.map((todo) => ({
      title: todo.title,
      done: Boolean(todo.done),
      due: todo.due ?? null,
    })),
  )
}

function buildPatch(app: Application, draft: EditorDraft): Partial<Application> {
  const nextTodos = todosFromText(draft.todoText, app.todos)
  const patch: Partial<Application> = {}
  if (draft.company !== app.company) patch.company = draft.company
  if (draft.position !== app.position) patch.position = draft.position
  if (draft.city !== app.city) patch.city = draft.city
  if (draft.stage !== app.stage) patch.stage = draft.stage

  const appliedAt = fromDateInput(draft.appliedAtInput)
  if (draft.appliedAtInput !== toDateInput(app.applied_at)) patch.applied_at = appliedAt

  const nextFollowupAt = fromDateInput(draft.nextFollowupInput)
  if (draft.nextFollowupInput !== toDateInput(app.next_followup_at)) patch.next_followup_at = nextFollowupAt

  if (draft.notes !== app.notes) patch.notes = draft.notes
  if (serializeTodos(nextTodos) !== serializeTodos(app.todos)) patch.todos = nextTodos
  return patch
}

function pickPatchKeys(
  patch: Partial<Application>,
  keys: readonly (keyof Partial<Application>)[],
): Partial<Application> {
  const next: Partial<Application> = {}
  for (const key of keys) {
    if (key in patch) {
      ;(next as Record<string, unknown>)[String(key)] = patch[key] as unknown
    }
  }
  return next
}

function compareApplications(a: Application, b: Application): number {
  const rankA = getStageOrderIndex(a.stage)
  const rankB = getStageOrderIndex(b.stage)
  if (rankA !== rankB) return rankA - rankB

  const appliedA = a.applied_at ?? 0
  const appliedB = b.applied_at ?? 0
  if (appliedA !== appliedB) return appliedB - appliedA

  return (b.updated_at ?? 0) - (a.updated_at ?? 0)
}

function formatDate(unix: number | null, fallback = '--') {
  return unix != null ? dayjs.unix(Math.floor(unix)).format('YYYY-MM-DD') : fallback
}

function getScheduleMeta(app: Application) {
  if (isTerminalStage(app.stage)) {
    const reviewAt = app.review_summary.latest_review_at
    const isRejected = isRejectedStage(app.stage)
    const stageLabel = STAGE_LABELS[app.stage] ?? app.stage
    const tone = isRejected ? 'text-red-500' : 'text-text-muted'
    if (reviewAt != null) {
      const target = dayjs.unix(Math.floor(reviewAt))
      return {
        label: `复盘 ${target.format('MM-DD')}`,
        tone,
      }
    }
    return {
      label: isRejected ? stageLabel : '已放弃',
      tone,
    }
  }
  if (app.next_followup_at == null) {
    return {
      label: '跟进 未设',
      tone: 'text-text-muted',
    }
  }
  const target = dayjs.unix(Math.floor(app.next_followup_at))
  const now = dayjs()
  if (target.isBefore(now.startOf('day'))) {
    return {
      label: `跟进 ${target.format('MM-DD')}`,
      tone: 'text-red-500',
    }
  }
  if (target.isBefore(now.add(3, 'day').endOf('day'))) {
    return {
      label: `跟进 ${target.format('MM-DD')}`,
      tone: 'text-amber-500',
    }
  }
  return {
    label: `跟进 ${target.format('MM-DD')}`,
    tone: 'text-text-secondary',
  }
}

function reviewSummaryText(app: Application) {
  const summary = app.review_summary
  if (summary.review_count <= 0) {
    return { label: '暂无', tone: 'text-text-muted' }
  }
  if (summary.latest_avg_score == null) {
    return { label: `${summary.review_count} 场`, tone: 'text-text-secondary' }
  }
  if (summary.latest_avg_score < 6) {
    return { label: `${summary.review_count} 场 · ${summary.latest_avg_score.toFixed(1)}`, tone: 'text-yellow-500' }
  }
  if (summary.latest_avg_score >= 8) {
    return { label: `${summary.review_count} 场 · ${summary.latest_avg_score.toFixed(1)}`, tone: 'text-green-500' }
  }
  return { label: `${summary.review_count} 场 · ${summary.latest_avg_score.toFixed(1)}`, tone: 'text-blue-500' }
}

function hasReviewTimeline(app: Application) {
  return app.review_summary.review_count > 0
}

function reviewShortcutLabel(app: Application) {
  const count = app.review_summary.review_count
  if (count <= 0) return '暂无复盘'
  return count > 1 ? `看 ${count} 场复盘` : '看复盘'
}

function reviewShortcutClass(app: Application) {
  const latestScore = app.review_summary.latest_avg_score
  if (latestScore == null) return 'border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary'
  if (latestScore < 6) return 'border-yellow-500/20 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/15'
  if (latestScore >= 8) return 'border-green-500/20 bg-green-500/10 text-green-500 hover:bg-green-500/15'
  return 'border-accent-blue/20 bg-accent-blue/8 text-accent-blue hover:bg-accent-blue/12'
}

function signalSurfaceTone(tone: string) {
  if (tone.includes('red-500')) return 'border-red-500/12 bg-red-500/[0.05]'
  if (tone.includes('yellow-500')) return 'border-yellow-500/12 bg-yellow-500/[0.05]'
  if (tone.includes('green-500')) return 'border-green-500/12 bg-green-500/[0.05]'
  if (tone.includes('blue-500') || tone.includes('accent-blue')) return 'border-accent-blue/12 bg-accent-blue/[0.05]'
  return 'border-bg-hover/80 bg-bg-secondary/55'
}

function hiddenPreviewLabel(app: Application) {
  const stageLabel = STAGE_LABELS[app.stage] ?? app.stage
  const reviewCount = app.review_summary.review_count
  if (reviewCount > 1) return `${stageLabel} · ${reviewCount} 场复盘`
  if (reviewCount === 1) return `${stageLabel} · 1 场复盘`
  return stageLabel
}

export default function ApplicationsTable({
  applications,
  offerByAppId,
  onPatch,
  onDelete,
  onOpenOffer,
  onOpenReviews,
  search,
  selectedId,
  onSelect,
  highlightedId,
  compactDetailLayout,
  detailIntent,
  onConsumeDetailIntent,
  hiddenApplicationsCount = 0,
  hiddenApplicationsPreview = [],
  focusFilterLabel = '当前筛选',
  onShowAll,
}: Props) {
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const isLight = isLightColorScheme(colorScheme)
  const filtered = useMemo(() => filterApplicationsBySearch(applications, search), [applications, search])
  const ordered = useMemo(() => [...filtered].sort(compareApplications), [filtered])
  const current = ordered.find((app) => app.id === selectedId) ?? ordered[0] ?? null

  useEffect(() => {
    if (ordered.length === 0) return
    const nextId = current?.id ?? null
    if (nextId !== selectedId) onSelect(nextId)
  }, [current?.id, onSelect, ordered.length, selectedId])

  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [editCoreOpen, setEditCoreOpen] = useState(false)
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [pendingDetailFocusId, setPendingDetailFocusId] = useState<number | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const patch = useMemo(
    () => (current && draft ? buildPatch(current, draft) : {}),
    [current, draft],
  )

  useEffect(() => {
    setDraft(current ? createDraft(current) : null)
    setSaveNotice(null)
    setEditCoreOpen(false)
    setExtrasOpen(false)
  }, [current?.id, current?.updated_at])

  useEffect(() => {
    if (!compactDetailLayout) {
      setMobileDetailOpen(true)
      return
    }
    if (!current) {
      setMobileDetailOpen(false)
    }
  }, [compactDetailLayout, current])

  useEffect(() => {
    if (!saveNotice) return undefined
    const timer = window.setTimeout(() => setSaveNotice(null), 2200)
    return () => window.clearTimeout(timer)
  }, [saveNotice])

  useEffect(() => {
    if (pendingDetailFocusId == null || current?.id !== pendingDetailFocusId) return
    if (!compactDetailLayout) {
      setPendingDetailFocusId(null)
      return
    }
    const node = detailRef.current
    if (!node) return
    const raf = window.requestAnimationFrame(() => {
      if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      setPendingDetailFocusId(null)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [compactDetailLayout, current?.id, pendingDetailFocusId])

  useEffect(() => {
    if (!compactDetailLayout) return
    if (highlightedId == null || current?.id !== highlightedId) return
    setMobileDetailOpen(true)
  }, [compactDetailLayout, current?.id, highlightedId])

  useEffect(() => {
    if (!detailIntent || current?.id !== detailIntent.applicationId) return
    if (compactDetailLayout) {
      setMobileDetailOpen(true)
      setPendingDetailFocusId(detailIntent.applicationId)
    }
    if (detailIntent.mode === 'edit_core') {
      setEditCoreOpen(true)
      setExtrasOpen(false)
    } else if (detailIntent.mode === 'extras') {
      setExtrasOpen(true)
    } else {
      setEditCoreOpen(false)
      setExtrasOpen(false)
      setSaveNotice('进度已打开')
    }
    onConsumeDetailIntent?.()
  }, [compactDetailLayout, current?.id, detailIntent, onConsumeDetailIntent])

  const handleSave = useCallback(async (scope: 'all' | 'core' | 'extras' = 'all') => {
    if (!current || !draft) return
    const scopedPatch = scope === 'core'
      ? pickPatchKeys(patch, CORE_PATCH_KEYS)
      : scope === 'extras'
        ? pickPatchKeys(patch, EXTRA_PATCH_KEYS)
        : patch
    if (Object.keys(scopedPatch).length === 0) {
      setSaveNotice(scope === 'core' ? '核心无变更' : scope === 'extras' ? '补充无变更' : '没有新变更')
      return
    }
    setSaving(true)
    const result = await Promise.resolve(onPatch(current.id, scopedPatch))
    setSaving(false)
    if (result !== false) {
      setSaveNotice(scope === 'core' ? '已保存核心信息' : scope === 'extras' ? '已保存补充信息' : '已保存')
      if (scope === 'core' || scope === 'all') setEditCoreOpen(false)
    }
  }, [current, draft, onPatch, patch])

  const handleSelect = useCallback((id: number, focusDetail = false) => {
    if (focusDetail && compactDetailLayout) {
      setMobileDetailOpen(true)
    }
    if (focusDetail) setPendingDetailFocusId(id)
    onSelect(id)
  }, [compactDetailLayout, onSelect])

  const currentOffer = current ? offerByAppId.get(current.id) : undefined
  const corePatch = useMemo(() => pickPatchKeys(patch, CORE_PATCH_KEYS), [patch])
  const extrasPatch = useMemo(() => pickPatchKeys(patch, EXTRA_PATCH_KEYS), [patch])
  const coreDirty = Object.keys(corePatch).length > 0
  const extrasDirty = Object.keys(extrasPatch).length > 0
  const dirty = coreDirty || extrasDirty
  const openTodoCount = current?.todos.filter((todo) => !todo.done).length ?? 0
  const draftTodoLines = draft?.todoText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean) ?? []
  const draftTodoPreview = draftTodoLines.slice(0, 3)
  const offerSummaryBits = currentOffer
    ? [
        currentOffer.base_salary || null,
        currentOffer.location || null,
        currentOffer.deadline != null ? `截止 ${dayjs.unix(Math.floor(currentOffer.deadline)).format('MM-DD')}` : null,
      ].filter((item): item is string => Boolean(item))
    : []
  const scheduleMeta = current ? getScheduleMeta(current) : null
  const currentReview = current ? reviewSummaryText(current) : null
  const currentHasReviewTimeline = current ? hasReviewTimeline(current) : false
  const stageLabel = current ? STAGE_LABELS[current.stage] ?? current.stage : ''
  const currentIsTerminal = current ? isTerminalStage(current.stage) : false
  const desktopSplitLayout = !compactDetailLayout
  const mobileFocusedList = compactDetailLayout && mobileDetailOpen && current != null
  const mobileVisibleApps = mobileFocusedList && current
    ? ordered.filter((app) => app.id === current.id)
    : ordered
  const mobileFocusedSummary = mobileFocusedList
    ? `已聚焦 1 条 · 当前筛选 ${ordered.length} 条`
    : `${ordered.length} / ${applications.length}`
  const extrasSummary = `复盘 ${current?.review_summary.review_count ?? 0} · 待办 ${openTodoCount} · ${currentOffer ? 'Offer 已记录' : 'Offer 暂无'}`
  const detailAction = current ? (() => {
    if (currentOffer && current.stage === 'offer') {
      return {
        title: '补 Offer 细节',
        primaryLabel: '补 Offer',
        primaryClass: 'bg-emerald-500 text-white hover:brightness-110',
        onPrimary: () => onOpenOffer(current),
        secondaryLabel: currentHasReviewTimeline ? '看复盘' : null,
        onSecondary: currentHasReviewTimeline ? () => onOpenReviews(current) : null,
      }
    }

    if (currentIsTerminal) {
      if (currentHasReviewTimeline) {
        return {
          title: '回看最后一场复盘',
          primaryLabel: '看复盘',
          primaryClass: 'bg-accent-blue text-white hover:brightness-110',
          onPrimary: () => onOpenReviews(current),
          secondaryLabel: openTodoCount > 0 ? '看补充信息' : null,
          onSecondary: openTodoCount > 0 ? () => setExtrasOpen(true) : null,
        }
      }
      return {
        title: '流程已结束',
        primaryLabel: '编辑核心信息',
        primaryClass: 'border border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary',
        onPrimary: () => setEditCoreOpen(true),
        secondaryLabel: null,
        onSecondary: null,
      }
    }

    if (current.next_followup_at == null) {
      return {
        title: '补下次跟进',
        primaryLabel: '补时间',
        primaryClass: 'bg-accent-blue text-white hover:brightness-110',
        onPrimary: () => setEditCoreOpen(true),
        secondaryLabel: openTodoCount === 0 ? '补 1 条待办' : currentHasReviewTimeline ? '看复盘' : null,
        onSecondary: openTodoCount === 0
          ? () => setExtrasOpen(true)
          : currentHasReviewTimeline
            ? () => onOpenReviews(current)
            : null,
      }
    }

    if (openTodoCount === 0) {
      return {
        title: '补 1 条下一步',
        primaryLabel: '补待办',
        primaryClass: 'bg-accent-blue text-white hover:brightness-110',
        onPrimary: () => setExtrasOpen(true),
        secondaryLabel: currentHasReviewTimeline ? '看复盘' : '编辑核心信息',
        onSecondary: currentHasReviewTimeline ? () => onOpenReviews(current) : () => setEditCoreOpen(true),
      }
    }

    if (currentHasReviewTimeline) {
      return {
        title: '已有复盘时间线',
        primaryLabel: '看复盘',
        primaryClass: 'bg-accent-blue text-white hover:brightness-110',
        onPrimary: () => onOpenReviews(current),
        secondaryLabel: '看补充信息',
        onSecondary: () => setExtrasOpen(true),
      }
    }

    return {
      title: '继续推进',
      primaryLabel: '编辑核心信息',
      primaryClass: 'border border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary',
      onPrimary: () => setEditCoreOpen(true),
      secondaryLabel: '看补充信息',
      onSecondary: () => setExtrasOpen(true),
    }
  })() : null
  const latestReviewLabel = current?.review_summary.latest_review_at != null
    ? dayjs.unix(Math.floor(current.review_summary.latest_review_at)).format('MM-DD HH:mm')
    : null
  const standalonePanelClass = isLight ? 'border-bg-hover bg-white' : 'border-white/[0.06] bg-bg-secondary/35'
  const stackedDetailShellClass = isLight
    ? 'border-bg-hover bg-white'
    : 'border-white/[0.08] bg-bg-secondary'
  const workspaceShellClass = isLight
    ? 'border-bg-hover bg-white'
    : 'border-white/[0.08] bg-bg-secondary/40'
  const detailSectionClass = isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/12'
  const hiddenPreviewItems = hiddenApplicationsPreview.slice(0, 2)
  const mainlinePulse = current ? [
    {
      label: currentIsTerminal ? '结果' : '时间',
      value: scheduleMeta?.label ?? '未设置',
      hint: currentIsTerminal ? '终态' : '节奏',
      tone: scheduleMeta?.tone ?? 'text-text-secondary',
    },
    {
      label: '复盘',
      value: currentReview?.label ?? '暂无',
      hint: current.review_summary.review_count > 1
        ? latestReviewLabel ?? '时间线'
        : current.review_summary.review_count === 1
          ? latestReviewLabel ?? '最近一场'
          : '未绑定',
      tone: currentReview?.tone ?? 'text-text-secondary',
    },
    {
      label: '待办',
      value: openTodoCount > 0 ? `${openTodoCount} 条` : '暂无',
      hint: openTodoCount > 0 ? '待推进' : '无待办',
      tone: openTodoCount > 0 ? 'text-accent-blue' : 'text-text-secondary',
    },
  ] : []
  const inputClass =
    'rounded-lg border border-bg-hover bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/15'
  const textareaClass = `${inputClass} min-h-[104px] resize-y`
  const resetCoreDraft = useCallback(() => {
    if (!current) return
    const source = createDraft(current)
    setDraft((prev) => prev ? ({
      ...prev,
      company: source.company,
      position: source.position,
      city: source.city,
      stage: source.stage,
      appliedAtInput: source.appliedAtInput,
      nextFollowupInput: source.nextFollowupInput,
    }) : source)
  }, [current])
  const resetExtrasDraft = useCallback(() => {
    if (!current) return
    const source = createDraft(current)
    setDraft((prev) => prev ? ({
      ...prev,
      notes: source.notes,
      todoText: source.todoText,
    }) : source)
  }, [current])
  const pendingSaveScope = coreDirty && !extrasDirty
    ? 'core'
    : extrasDirty && !coreDirty
      ? 'extras'
      : 'all'
  const pendingSaveLabel = coreDirty && extrasDirty
    ? '保存全部'
    : coreDirty
      ? '保存核心信息'
      : '保存补充信息'
  const pendingSaveTitle = coreDirty && extrasDirty
    ? '这条岗位还有 2 处未保存修改'
    : coreDirty
      ? '核心信息还没保存'
      : '补充信息还没保存'
  const pendingSaveAssistAction = coreDirty && !editCoreOpen
    ? {
        label: '继续改核心信息',
        onClick: () => setEditCoreOpen(true),
      }
    : extrasDirty && !extrasOpen
      ? {
          label: '去补充信息',
          onClick: () => setExtrasOpen(true),
        }
      : null
  const quickProgressDirty = current != null && draft != null
    ? draft.stage !== current.stage || draft.nextFollowupInput !== toDateInput(current.next_followup_at)
    : false
  const quickProgressTitle = currentIsTerminal ? '改结果' : '更新进度'
  const headerQuickProgressShellClass = isLight
    ? 'border-bg-hover bg-bg-secondary/25'
    : 'border-white/[0.08] bg-black/12'

  return (
    <div className={desktopSplitLayout
      ? 'flex min-h-0 flex-col gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.88fr)] xl:items-start'
      : 'flex flex-col gap-3'}
    >
      <section
        className={`overflow-hidden ${desktopSplitLayout ? `min-w-0 rounded-lg border ${workspaceShellClass}` : `rounded-lg border ${standalonePanelClass}`}`}
      >
        <div className="border-b border-bg-hover px-3 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">进度表</h3>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {mobileFocusedList ? (
                <button
                  type="button"
                  onClick={() => setMobileDetailOpen(false)}
                  className="rounded-md border border-bg-hover bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary sm:hidden"
                >
                  返回列表
                </button>
              ) : null}
              <div className="text-xs text-text-muted">
                {mobileFocusedSummary}
              </div>
            </div>
          </div>
        </div>

        {compactDetailLayout ? (
          mobileVisibleApps.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-2 p-3">
              {mobileVisibleApps.map((app) => {
                const selected = current?.id === app.id
                const detailOpenForApp = compactDetailLayout && mobileDetailOpen && selected
                const schedule = getScheduleMeta(app)
                const review = reviewSummaryText(app)
                const reviewLinked = hasReviewTimeline(app)
                return (
                  <article
                    key={app.id}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selected
                    ? 'border-accent-blue/35 bg-bg-secondary'
                    : isLight
                      ? 'border-bg-hover bg-white hover:border-accent-blue/20'
                      : 'border-white/[0.08] bg-bg-secondary/30 hover:border-accent-blue/20'
                } ${highlightedId === app.id ? 'ring-2 ring-accent-blue/25' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-text-primary">{app.company || '未命名公司'}</span>
                          {highlightedId === app.id ? (
                            <span className="rounded-md border border-accent-blue/20 bg-transparent px-1.5 py-0.5 text-[10px] font-semibold text-accent-blue">
                              NEW
                            </span>
                          ) : null}
                          {detailOpenForApp ? (
                            <span className="rounded-md border border-accent-blue/20 bg-transparent px-1.5 py-0.5 text-[10px] font-semibold text-accent-blue">
                              详情已展开
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-text-secondary">{app.position || '岗位未填写'}</div>
                      </div>
                      <ChevronRight className={`h-4 w-4 shrink-0 ${selected ? 'text-accent-blue' : 'text-text-muted'}`} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <StageBadge stage={app.stage} isLight={isLight} />
                      <span className={`text-xs ${schedule.tone}`}>{schedule.label}</span>
                      <span className={`text-xs ${review.tone}`}>复盘 {review.label}</span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                      {app.city ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {app.city}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        投递 {formatDate(app.applied_at)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelect(app.id, true)}
                          className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? 'border-accent-blue/25 bg-accent-blue/10 text-accent-blue'
                            : 'border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary'
                        }`}
                        aria-label={`${detailOpenForApp ? '定位' : '查看'} ${app.company || '该岗位'} 详情`}
                      >
                        {detailOpenForApp ? '定位详情' : '查看详情'}
                      </button>
                      {reviewLinked ? (
                        <button
                          type="button"
                          onClick={() => onOpenReviews(app)}
                          className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${reviewShortcutClass(app)}`}
                          aria-label={`查看 ${app.company || '该岗位'} 的 ${app.review_summary.review_count} 场复盘`}
                        >
                          {reviewShortcutLabel(app)}
                        </button>
                      ) : (
                        <span className="text-[11px] text-text-muted">暂无复盘</span>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )
        ) : (
          ordered.length === 0 ? (
            <EmptyState />
          ) : (
            <div>
              <div className="divide-y divide-bg-hover/80">
                {ordered.map((app) => {
                  const selected = current?.id === app.id
                  const schedule = getScheduleMeta(app)
                  const review = reviewSummaryText(app)
                  const reviewLinked = hasReviewTimeline(app)
                  const appOpenTodoCount = app.todos.filter((todo) => !todo.done).length
                  return (
                    <article
                      key={app.id}
                      onClick={() => handleSelect(app.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleSelect(app.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`查看 ${app.company || '该岗位'} 详情`}
                      className={`grid cursor-pointer gap-3 px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue/30 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(230px,0.8fr)_auto] xl:items-center ${
                        selected ? 'bg-bg-secondary' : 'hover:bg-bg-secondary/55'
                      } ${highlightedId === app.id ? 'ring-2 ring-inset ring-accent-blue/20' : ''}`}
                    >
                      <div className="min-w-0 lg:row-start-1 lg:col-start-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StageBadge stage={app.stage} isLight={isLight} />
                          <div className="truncate text-base font-semibold tracking-tight text-text-primary">
                            {app.company || '未命名公司'}
                          </div>
                          {selected ? (
                            <span className="rounded-md border border-accent-blue/25 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-accent-blue">
                              当前查看
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-secondary">
                          <span>{app.position || '岗位未填写'}</span>
                          {app.city ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {app.city}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1 text-text-muted">
                            <Calendar className="h-3.5 w-3.5" />
                            投递 {formatDate(app.applied_at)}
                          </span>
                        </div>
                      </div>

                      <div className="min-w-0 lg:col-span-2 lg:row-start-2 xl:col-span-1 xl:row-auto">
                        <div className="flex flex-wrap items-center gap-2">
                          <DesktopSignalChip
                            label={isTerminalStage(app.stage) ? '结果' : '时间'}
                            value={schedule.label}
                            tone={schedule.tone}
                          />
                          {reviewLinked ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onOpenReviews(app)
                              }}
                              className="inline-flex"
                              aria-label={`查看 ${app.company || '该岗位'} 的 ${app.review_summary.review_count} 场复盘`}
                            >
                              <DesktopSignalChip
                                label="复盘"
                                value={review.label}
                                tone={review.tone}
                                actionLabel={app.review_summary.review_count > 1 ? '看时间线' : '看复盘'}
                              />
                            </button>
                          ) : (
                            <DesktopSignalChip
                              label="复盘"
                              value={review.label}
                              tone={review.tone}
                            />
                          )}
                          {appOpenTodoCount > 0 ? (
                            <DesktopSignalChip
                              label="待办"
                              value={`${appOpenTodoCount} 条`}
                              tone="text-accent-blue"
                            />
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-start justify-start gap-2 lg:col-start-2 lg:row-start-1 lg:justify-end xl:col-auto xl:row-auto xl:flex-col xl:items-end xl:justify-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelect(app.id)
                          }}
                          className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                            selected
                              ? 'border-accent-blue/35 bg-transparent text-accent-blue'
                              : 'border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          {selected ? '已定位详情' : '查看详情'}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>

              {hiddenApplicationsCount > 0 && onShowAll ? (
                <div className="border-t border-bg-hover/80 bg-bg-tertiary/12 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="rounded-md border border-bg-hover bg-bg-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                      当前只看 {focusFilterLabel}
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      另外还有 {hiddenApplicationsCount} 条记录
                    </span>
                    {hiddenPreviewItems.map((app) => (
                      <span
                        key={app.id}
                        className="text-[11px] text-text-muted"
                      >
                        <span className="font-medium text-text-secondary">{app.company || '未命名公司'}</span>
                        <span> · {hiddenPreviewLabel(app)}</span>
                      </span>
                    ))}
                    {hiddenApplicationsCount > hiddenPreviewItems.length ? (
                      <span className="text-[11px] text-text-muted">等</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={onShowAll}
                      className="rounded-md border border-accent-blue/20 bg-accent-blue/10 px-3 py-1.5 text-xs font-medium text-accent-blue transition-colors hover:bg-accent-blue/15"
                    >
                      查看全部
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        )}
      </section>

      {!compactDetailLayout || mobileDetailOpen ? (
      <section
        ref={detailRef}
        className={`flex flex-col ${
          desktopSplitLayout
            ? `overflow-visible rounded-lg border ${stackedDetailShellClass} xl:min-h-0 xl:overflow-hidden xl:self-start xl:sticky xl:top-3`
            : `rounded-lg border ${standalonePanelClass}`
        }`}
      >
        {!current || !draft ? (
          <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
            <div className="text-sm font-semibold text-text-primary">选一条记录查看详情</div>
          </div>
        ) : (
          <>
            <div className="border-b border-bg-hover px-4 py-3">
              <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-lg font-bold tracking-tight text-text-primary">
                      {current.company || '未命名公司'}
                    </h3>
                    <StageBadge stage={current.stage} isLight={isLight} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
                    <span>{current.position || '岗位未填写'}</span>
                    {current.city ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {current.city}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 text-text-muted">
                      <Calendar className="h-3.5 w-3.5" />
                      最近更新 {dayjs.unix(Math.floor(current.updated_at)).format('MM-DD HH:mm')}
                    </span>
                  </div>
                  {saveNotice ? (
                    <div className="mt-2 inline-flex rounded-md border border-accent-blue/20 bg-accent-blue/10 px-2.5 py-1 text-[11px] text-accent-blue">
                      {saveNotice}
                    </div>
                  ) : null}
                </div>

                <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
                  <button
                    type="button"
                    onClick={() => setMobileDetailOpen(false)}
                    className="whitespace-nowrap rounded-md border border-bg-hover px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary lg:hidden"
                  >
                    收起详情
                  </button>
                </div>
              </div>
              <div className={`mt-3 rounded-md border px-3 py-2.5 ${headerQuickProgressShellClass}`}>
                <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                        {quickProgressTitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditCoreOpen((prev) => !prev)}
                      className="rounded-md border border-bg-hover bg-bg-secondary/75 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {editCoreOpen ? '收起完整编辑' : '编辑核心信息'}
                    </button>
                    <button
                      type="button"
                      disabled={!quickProgressDirty || saving}
                      onClick={() => void handleSave('core')}
                      className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                        quickProgressDirty
                          ? 'bg-accent-blue text-white hover:brightness-110'
                          : 'border border-bg-hover bg-bg-tertiary/60 text-text-secondary'
                      } disabled:opacity-60`}
                    >
                      {saving ? '保存中...' : '保存进度'}
                    </button>
                  </div>
                </div>
                <div className={`mt-2.5 grid gap-2.5 ${currentIsTerminal ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
                  <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                    当前阶段
                    <select
                      value={draft.stage}
                      onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
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
                  {!currentIsTerminal ? (
                    <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                      下次跟进
                      <input
                        type="date"
                        value={draft.nextFollowupInput}
                        onChange={(e) => setDraft({ ...draft, nextFollowupInput: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                  ) : (
                    <div className="flex flex-col gap-1.5 text-xs text-text-secondary">
                      <span>当前状态</span>
                      <div className="rounded-md border border-bg-hover bg-bg-secondary/70 px-3 py-2 text-sm text-text-muted">
                        已结束 · 不进入待跟进
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {dirty ? (
                <div className="mt-2.5 flex flex-col gap-2 border-t border-accent-blue/20 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="mr-2 text-[11px] font-semibold text-accent-blue">待确认修改</span>
                    <span className="text-sm font-semibold text-text-primary">{pendingSaveTitle}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {pendingSaveAssistAction ? (
                      <button
                        type="button"
                        onClick={pendingSaveAssistAction.onClick}
                        className="rounded-md border border-bg-hover bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                      >
                        {pendingSaveAssistAction.label}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSave(pendingSaveScope)}
                      className="rounded-md bg-accent-blue px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      {saving ? '保存中...' : pendingSaveLabel}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="p-2.5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              <div className="space-y-2.5">
                <section className={`rounded-lg border p-3 ${detailSectionClass}`}>
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-text-muted">
                          下一步
                        </div>
                        <div className="mt-1.5 text-base font-semibold text-text-primary">
                          {detailAction?.title ?? (currentIsTerminal ? `${stageLabel}回看` : `围绕 ${stageLabel} 继续推进`)}
                        </div>
                      </div>
                      {detailAction ? (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={detailAction.onPrimary}
                            className={`rounded-md px-3 py-2 text-xs font-semibold transition ${detailAction.primaryClass}`}
                          >
                            {detailAction.primaryLabel}
                          </button>
                          {detailAction.secondaryLabel && detailAction.onSecondary ? (
                            <button
                              type="button"
                              onClick={detailAction.onSecondary}
                              className="rounded-md border border-bg-hover bg-bg-tertiary/60 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                            >
                              {detailAction.secondaryLabel}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {mainlinePulse.map((item) => (
                        <InlineSummaryPill
                          key={item.label}
                          label={item.label}
                          value={item.value}
                          tone={item.tone}
                        />
                      ))}
                    </div>
                  </div>
                </section>

                {editCoreOpen ? (
                <section className={`rounded-lg border p-3 ${detailSectionClass}`}>
                  <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-text-primary">编辑核心信息</h4>
                      {isTerminalStage(draft.stage) ? (
                        <div className="mt-1 text-[11px] text-text-muted">已结束 · 不进入待跟进</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {coreDirty ? (
                        <button
                          type="button"
                          onClick={resetCoreDraft}
                          className="rounded-md border border-bg-hover bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                        >
                          恢复核心信息
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={!coreDirty || saving}
                        onClick={() => void handleSave('core')}
                        className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                          coreDirty
                            ? 'bg-accent-blue text-white hover:brightness-110'
                            : 'border border-bg-hover bg-bg-tertiary/60 text-text-secondary'
                        } disabled:opacity-60`}
                      >
                        {saving ? '保存中...' : '保存核心信息'}
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                      公司名称
                      <input
                        value={draft.company}
                        onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                      岗位名称
                      <input
                        value={draft.position}
                        onChange={(e) => setDraft({ ...draft, position: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                      城市
                      <input
                        value={draft.city}
                        onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                        placeholder="Remote / 上海"
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                      当前阶段
                      <select
                        value={draft.stage}
                        onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
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
                    <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                      投递日期
                      <input
                        type="date"
                        value={draft.appliedAtInput}
                        onChange={(e) => setDraft({ ...draft, appliedAtInput: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                      下次跟进
                      <input
                        type="date"
                        value={draft.nextFollowupInput}
                        onChange={(e) => setDraft({ ...draft, nextFollowupInput: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                  </div>
                </section>
                ) : null}

                <section className={`rounded-lg border ${detailSectionClass}`}>
                  <button
                    type="button"
                    onClick={() => setExtrasOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                  >
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-text-primary">补充信息</h4>
                      <div className="mt-1 text-[11px] text-text-secondary">{extrasSummary}</div>
                    </div>
                    <span className="rounded-md border border-bg-hover p-1.5 text-text-muted">
                      {extrasOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>

                  {extrasOpen ? (
                    <div className="space-y-2.5 border-t border-bg-hover/80 px-3.5 py-3">
                      {extrasDirty ? (
                        <section className="rounded-md border border-accent-blue/20 bg-accent-blue/[0.05] px-3 py-2.5">
                          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-text-primary">补充待保存</div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={resetExtrasDraft}
                                className="rounded-md border border-bg-hover bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                              >
                                恢复补充信息
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void handleSave('extras')}
                                className="rounded-md bg-accent-blue px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                              >
                                {saving ? '保存中...' : '保存补充信息'}
                              </button>
                            </div>
                          </div>
                        </section>
                      ) : null}

                      <div className="grid gap-4 xl:grid-cols-[minmax(220px,0.62fr)_minmax(0,1.38fr)]">
                        <section className="min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                                <FileText className="h-4 w-4 text-emerald-500" />
                                Offer
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => onOpenOffer(current)}
                              className="rounded-md border border-bg-hover px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                            >
                              {currentOffer ? '编辑 Offer' : '记录 Offer'}
                            </button>
                          </div>
                          <div className="mt-2.5 text-xs leading-relaxed text-text-secondary">
                            {currentOffer ? (
                              offerSummaryBits.length > 0 ? (
                                <span className="text-emerald-600">{offerSummaryBits.join(' · ')}</span>
                              ) : (
                                <span className="text-emerald-600">Offer 已记录</span>
                              )
                            ) : (
                              <span className="text-text-muted">暂无 Offer</span>
                            )}
                          </div>
                        </section>

                        <section className="min-w-0 border-t border-bg-hover/80 pt-3 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
                          <div className="mb-2.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h5 className="text-sm font-semibold text-text-primary">待办与备注</h5>
                            </div>
                            <span className="text-[11px] text-text-muted">
                              当前 {draftTodoLines.length} 条待办
                            </span>
                          </div>
                          {draftTodoPreview.length > 0 ? (
                            <div className="mb-2.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-text-secondary">
                              {draftTodoPreview.map((todo, index) => (
                                <span key={`${todo}-${index}`}>{todo}</span>
                              ))}
                              {draftTodoLines.length > draftTodoPreview.length ? (
                                <span className="text-text-muted">
                                  还有 {draftTodoLines.length - draftTodoPreview.length} 条
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="grid gap-3">
                            <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                              待办清单
                              <textarea
                                value={draft.todoText}
                                onChange={(e) => setDraft({ ...draft, todoText: e.target.value })}
                                placeholder={'每行一条，例如：\n补做系统设计容量估算\n周五前跟进 recruiter'}
                                className={textareaClass}
                              />
                            </label>
                            <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
                              备注
                              <textarea
                                value={draft.notes}
                                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                                placeholder="补充 JD 重点、薪资预期或内部推荐等信息"
                                className={textareaClass}
                              />
                            </label>
                          </div>
                        </section>
                      </div>

                      <details className="rounded-md border border-red-500/15 bg-red-500/6">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
                          <span>删除记录</span>
                        </summary>
                        <div className="border-t border-red-500/10 px-3 py-2.5">
                          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-[11px] leading-relaxed text-text-secondary">
                              会删除关联数据。
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`删除「${current.company}」这条记录？`)) onDelete(current.id)
                              }}
                              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/20 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              删除这条记录
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          </>
        )}
      </section>
      ) : null}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="px-4 py-12 text-center text-sm text-text-muted">
      没有匹配记录。
    </div>
  )
}

function DesktopSignalChip({
  label,
  value,
  tone,
  actionLabel,
}: {
  label: string
  value: string
  tone: string
  actionLabel?: string | null
}) {
  const surface = signalSurfaceTone(tone)
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${surface}`}>
      <span className="font-medium text-text-muted">{label}</span>
      <span className={`font-semibold ${tone}`}>{value}</span>
      {actionLabel ? (
        <span className="font-medium text-accent-blue">{actionLabel}</span>
      ) : null}
    </div>
  )
}

function DesktopSignalLine({
  label,
  value,
  hint,
  tone,
  className,
  actionLabel,
}: {
  label: string
  value: string
  hint: string
  tone: string
  className: string
  actionLabel?: string | null
}) {
  return (
    <div className={`rounded-md border px-3 py-2.5 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="w-11 shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
          {label}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className={`min-w-0 text-[14px] font-semibold ${tone}`}>
              {value}
            </div>
            {actionLabel ? (
              <div className="shrink-0 text-[11px] font-medium text-accent-blue">{actionLabel}</div>
            ) : null}
          </div>
          <div className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-text-muted">
            {hint}
          </div>
        </div>
      </div>
    </div>
  )
}

function InlineSummaryPill({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: string
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="font-medium text-text-muted">{label}</span>
      <span className={`font-semibold ${tone}`}>{value}</span>
    </span>
  )
}
