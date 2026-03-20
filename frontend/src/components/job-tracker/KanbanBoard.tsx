import { useCallback, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  closestCenter,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import dayjs from 'dayjs'
import {
  Building2,
  Briefcase,
  MapPin,
  Calendar,
  GripVertical,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Inbox,
} from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { isLightColorScheme } from '@/lib/colorScheme'
import type { Application } from './types'
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_HEADER_ICON,
  ONGOING_STAGES,
  TERMINAL_STAGES,
  STAGE_CARD_LEFT_BORDER,
} from './stageConfig'

const dropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.5' } },
  }),
}

function sortAppsInColumn(apps: Application[]): Application[] {
  return [...apps].sort((a, b) => {
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (so !== 0) return so
    const fa = a.next_followup_at
    const fb = b.next_followup_at
    if (fa == null && fb == null) return a.id - b.id
    if (fa == null) return 1
    if (fb == null) return -1
    return fa - fb
  })
}

function buildColumnIds(apps: Application[], visibleStages: string[]): Record<string, number[]> {
  const byStage = new Map<string, Application[]>()
  for (const s of STAGE_ORDER) byStage.set(s, [])
  for (const a of apps) {
    let k = a.stage
    if (!STAGE_ORDER.includes(k as (typeof STAGE_ORDER)[number])) k = 'applied'
    byStage.get(k)!.push(a)
  }
  const out: Record<string, number[]> = {}
  for (const s of visibleStages) {
    out[s] = sortAppsInColumn(byStage.get(s) ?? []).map((x) => x.id)
  }
  return out
}

function filterApplications(apps: Application[], search: string): Application[] {
  const q = search.trim().toLowerCase()
  if (!q) return apps
  return apps.filter(
    (a) =>
      a.company.toLowerCase().includes(q) ||
      a.position.toLowerCase().includes(q) ||
      a.city.toLowerCase().includes(q),
  )
}

/** 左侧轨 / 顶栏用的极短标签 */
const RAIL_LABEL: Record<string, string> = {
  applied: '投递',
  written: '笔试',
  interview1: '一面',
  interview2: '二面',
  interview3: '三面',
  hr: 'HR',
  offer: 'Offer',
  rejected: '挂',
  withdrawn: '弃',
}

function StageSelect({
  value,
  disabled,
  isLight,
  onChange,
}: {
  value: string
  disabled?: boolean
  isLight: boolean
  onChange: (stage: string) => void
}) {
  const ongoing = [...ONGOING_STAGES]
  const terminal = [...TERMINAL_STAGES]
  const cls = `mt-2 w-full max-w-full rounded-lg border px-2 py-1.5 text-[11px] font-medium outline-none transition-colors ${
    isLight
      ? 'border-bg-hover bg-bg-primary text-text-primary focus:border-accent-blue/40 focus:ring-1 focus:ring-accent-blue/20'
      : 'border-white/[0.1] bg-black/20 text-text-primary focus:border-accent-blue/40 focus:ring-1 focus:ring-accent-blue/25'
  }`
  return (
    <select
      className={cls}
      value={value}
      disabled={disabled}
      aria-label="阶段"
      onChange={(e) => onChange(e.target.value)}
    >
      <optgroup label="进行中">
        {ongoing.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s] ?? s}
          </option>
        ))}
      </optgroup>
      <optgroup label="已结束">
        {terminal.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s] ?? s}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

function SortableKanbanCard({
  app,
  isLight,
  sortDisabled,
  busy,
  onStageChange,
}: {
  app: Application
  isLight: boolean
  sortDisabled: boolean
  busy: boolean
  onStageChange: (id: number, stage: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: app.id,
    disabled: sortDisabled || busy,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  }
  const fu = app.next_followup_at
  const leftBorder = STAGE_CARD_LEFT_BORDER[app.stage] ?? 'border-l-zinc-400/40'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        rounded-2xl border pl-2 pr-3 py-2.5 border-l-[3px] transition-shadow
        ${leftBorder}
        ${isLight ? 'border-bg-hover bg-bg-primary shadow-sm' : 'border-white/[0.07] bg-bg-secondary/90 shadow-md shadow-black/20'}
        ${busy ? 'opacity-50 pointer-events-none' : ''}
        ${isDragging ? 'opacity-40 ring-2 ring-accent-blue/30' : 'hover:shadow-md'}
      `}
    >
      <div className="flex gap-2">
        <button
          type="button"
          className={`
            mt-0.5 flex h-8 w-7 shrink-0 items-center justify-center self-start rounded-lg
            touch-none cursor-grab active:cursor-grabbing outline-none
            ${sortDisabled || busy ? 'cursor-not-allowed opacity-30' : ''}
            ${isLight ? 'text-text-muted hover:bg-bg-hover' : 'text-text-muted/60 hover:bg-white/[0.06]'}
          `}
          aria-label="拖动排序"
          disabled={sortDisabled || busy}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                isLight ? 'bg-accent-blue/10 text-accent-blue' : 'bg-accent-blue/15 text-accent-blue/90'
              }`}
            >
              <Building2 className="w-4 h-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-text-primary leading-snug line-clamp-2">{app.company}</p>
              <p className="mt-0.5 flex items-start gap-1 text-[11px] text-text-secondary">
                <Briefcase className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
                <span className="line-clamp-2">{app.position || '岗位'}</span>
              </p>
            </div>
          </div>
          {app.city ? (
            <div className="mt-1.5 flex items-center gap-1 pl-[2.5rem] text-[10px] text-text-muted">
              <MapPin className="w-3 h-3 shrink-0 opacity-70" />
              {app.city}
            </div>
          ) : null}
          {fu != null ? (
            <div
              className={`mt-1.5 ml-[2.5rem] inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                isLight ? 'bg-amber-500/12 text-amber-900' : 'bg-amber-500/15 text-amber-100/90'
              }`}
            >
              <Calendar className="w-3 h-3 opacity-80" />
              跟进 {dayjs.unix(Math.floor(fu)).format('M/D')}
            </div>
          ) : null}
          <StageSelect
            value={app.stage}
            isLight={isLight}
            disabled={busy}
            onChange={(st) => onStageChange(app.id, st)}
          />
        </div>
      </div>
    </div>
  )
}

function KanbanColumn({
  stage,
  appMap,
  ids,
  isLight,
  sortDisabled,
  busyId,
  onStageChange,
}: {
  stage: string
  appMap: Map<number, Application>
  ids: number[]
  isLight: boolean
  sortDisabled: boolean
  busyId: number | null
  onStageChange: (id: number, stage: string) => void
}) {
  const Icon = STAGE_HEADER_ICON[stage] ?? LayoutGrid
  const list = useMemo(
    () => ids.map((id) => appMap.get(id)).filter(Boolean) as Application[],
    [ids, appMap],
  )

  const barClass =
    (STAGE_CARD_LEFT_BORDER[stage] ?? 'border-l-zinc-400/50').replace('border-l-', 'bg-') || 'bg-zinc-400/50'

  return (
    <div
      data-kanban-stage={stage}
      className={`
        flex w-[min(100vw-2rem,280px)] shrink-0 snap-start flex-col rounded-2xl border overflow-hidden min-h-[min(480px,60vh)] max-h-[calc(100vh-200px)]
        ${isLight ? 'border-bg-hover bg-bg-secondary/80' : 'border-white/[0.08] bg-bg-secondary/40'}
      `}
    >
      <div className={`h-1 w-full shrink-0 ${barClass}`} style={{ opacity: 0.85 }} />
      <div
        className={`flex items-center gap-2 border-b px-3 py-2.5 shrink-0 ${
          isLight ? 'border-bg-hover bg-bg-tertiary/50' : 'border-white/[0.06] bg-black/20'
        }`}
      >
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            isLight ? 'bg-bg-hover text-text-primary' : 'bg-white/[0.06] text-text-primary'
          }`}
        >
          <Icon className="w-4 h-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-bold text-text-primary truncate">{STAGE_LABELS[stage] ?? stage}</h3>
          <p className="text-[10px] text-text-muted">{list.length} 条</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5 [scrollbar-width:thin]">
        <SortableContext items={list.map((a) => a.id)} strategy={verticalListSortingStrategy} id={stage}>
          {list.map((app) => (
            <SortableKanbanCard
              key={app.id}
              app={app}
              isLight={isLight}
              sortDisabled={sortDisabled}
              busy={busyId === app.id}
              onStageChange={onStageChange}
            />
          ))}
        </SortableContext>
        {list.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
            <Inbox className="w-8 h-8 text-text-muted/40" strokeWidth={1.5} />
            <p className="text-[11px] text-text-muted">无匹配记录</p>
          </div>
        )}
      </div>
    </div>
  )
}

function CardPreview({ app, isLight }: { app: Application; isLight: boolean }) {
  const leftBorder = STAGE_CARD_LEFT_BORDER[app.stage] ?? 'border-l-zinc-400/40'
  return (
    <div
      className={`
        w-[260px] cursor-grabbing rounded-2xl border border-l-[3px] px-3 py-2.5 shadow-2xl
        ${leftBorder}
        ${isLight ? 'border-bg-hover bg-bg-primary' : 'border-white/20 bg-[#1e1e2a]'}
      `}
    >
      <p className="text-[13px] font-semibold text-text-primary line-clamp-2">{app.company}</p>
      <p className="mt-1 text-[11px] text-text-secondary line-clamp-1">{app.position || '岗位'}</p>
    </div>
  )
}

type Props = {
  applications: Application[]
  onStageChange: (appId: number, stage: string) => void | Promise<void>
  onReorderInStage: (stage: string, orderedIds: number[]) => void | Promise<void>
  search: string
  showTerminalStages: boolean
  onShowTerminalStagesChange: (show: boolean) => void
  terminalApplicationsCount: number
}

export default function KanbanBoard({
  applications,
  onStageChange,
  onReorderInStage,
  search,
  showTerminalStages,
  onShowTerminalStagesChange,
  terminalApplicationsCount,
}: Props) {
  const colorScheme = useInterviewStore((s) => s.colorScheme)
  const isLight = isLightColorScheme(colorScheme)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  const movingRef = useRef<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const visibleStages = useMemo(
    () => (showTerminalStages ? [...STAGE_ORDER] : [...ONGOING_STAGES]),
    [showTerminalStages],
  )

  const filteredApps = useMemo(() => filterApplications(applications, search), [applications, search])
  const sortDisabled = search.trim().length > 0

  /** 全量 id（提交排序 API 必须用完整列） */
  const fullColumnIds = useMemo(
    () => buildColumnIds(applications, visibleStages),
    [applications, visibleStages],
  )
  /** 有搜索时只展示匹配卡片；排序已禁用 */
  const displayColumnIds = useMemo(
    () => (sortDisabled ? buildColumnIds(filteredApps, visibleStages) : fullColumnIds),
    [sortDisabled, filteredApps, visibleStages, fullColumnIds],
  )

  const appMap = useMemo(() => new Map(applications.map((a) => [a.id, a])), [applications])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleStageSelect = useCallback(
    async (id: number, stage: string) => {
      const app = applications.find((x) => x.id === id)
      if (!app || app.stage === stage || movingRef.current != null) return
      movingRef.current = id
      setBusyId(id)
      try {
        await Promise.resolve(onStageChange(id, stage))
      } finally {
        movingRef.current = null
        setBusyId(null)
      }
    },
    [applications, onStageChange],
  )

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(Number(e.active.id))
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    setActiveId(null)
    if (sortDisabled || !over) return
    const a = Number(active.id)
    const o = Number(over.id)
    if (a === o) return
    const stage = visibleStages.find((s) => fullColumnIds[s]?.includes(a))
    if (!stage) return
    const list = fullColumnIds[stage]
    if (!list.includes(o)) return
    const oldIndex = list.indexOf(a)
    const newIndex = list.indexOf(o)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const next = arrayMove(list, oldIndex, newIndex)
    void onReorderInStage(stage, next)
  }

  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: 'smooth' })

  const scrollToStage = (stage: string) => {
    const run = () =>
      document.querySelector(`[data-kanban-stage="${stage}"]`)?.scrollIntoView({
        behavior: 'smooth',
        inline: 'nearest',
        block: 'nearest',
      })
    if (!(visibleStages as readonly string[]).includes(stage)) {
      onShowTerminalStagesChange(true)
      requestAnimationFrame(() => requestAnimationFrame(run))
      return
    }
    run()
  }

  const activeApp = activeId != null ? appMap.get(activeId) : undefined

  return (
    <div
      className={`flex h-full min-h-0 gap-3 rounded-2xl border p-3 md:p-4 ${
        isLight ? 'border-bg-hover bg-bg-secondary/60' : 'border-white/[0.07] bg-bg-primary/40'
      }`}
    >
      {/* 左侧阶段轨（桌面） */}
      <nav
        className={`hidden w-12 shrink-0 flex-col gap-1 md:flex ${isLight ? '' : 'border-r border-white/[0.06] pr-2'}`}
        aria-label="阶段导航"
      >
        {visibleStages.map((st) => {
          const Icon = STAGE_HEADER_ICON[st] ?? LayoutGrid
          const n = displayColumnIds[st]?.length ?? 0
          return (
            <button
              key={st}
              type="button"
              title={`${STAGE_LABELS[st] ?? st}（${n}）`}
              onClick={() => scrollToStage(st)}
              className={`
                relative flex flex-col items-center gap-0.5 rounded-xl py-2 text-[9px] font-bold transition-all
                ${isLight ? 'text-text-muted hover:bg-bg-hover hover:text-text-primary' : 'text-text-muted/70 hover:bg-white/[0.06] hover:text-text-primary'}
              `}
            >
              <Icon className="w-4 h-4 opacity-90" strokeWidth={2} />
              <span className="scale-90">{RAIL_LABEL[st] ?? st.slice(0, 1)}</span>
              {n > 0 ? (
                <span
                  className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                    isLight ? 'bg-accent-blue text-white' : 'bg-accent-blue/90 text-white'
                  }`}
                >
                  {n > 99 ? '99+' : n}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                isLight ? 'bg-accent-blue/12 text-accent-blue' : 'bg-violet-500/20 text-violet-200'
              }`}
            >
              <LayoutGrid className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-text-primary tracking-tight">求职管道</h2>
              <p className="text-[10px] text-text-muted mt-0.5">
                列内拖动手柄排序（{sortDisabled ? '搜索时已禁用排序' : '已启用'}）· 下拉框快速改阶段
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!showTerminalStages && terminalApplicationsCount > 0 ? (
              <button
                type="button"
                onClick={() => onShowTerminalStagesChange(true)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${
                  isLight ? 'bg-red-500/10 text-red-800 ring-red-500/20' : 'bg-red-500/15 text-red-200 ring-red-400/25'
                }`}
              >
                {terminalApplicationsCount} 条在已结束 · 展开
              </button>
            ) : null}
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium ${
                isLight ? 'border-bg-hover bg-bg-tertiary/80' : 'border-white/[0.08] bg-black/20'
              }`}
            >
              <input
                type="checkbox"
                className="rounded border-bg-hover text-accent-blue"
                checked={showTerminalStages}
                onChange={(e) => onShowTerminalStagesChange(e.target.checked)}
              />
              显示已结束
            </label>
            <div className="flex rounded-xl border border-bg-hover p-0.5">
              <button
                type="button"
                aria-label="向左"
                className="rounded-lg p-1.5 text-text-muted hover:bg-bg-hover"
                onClick={() => scrollBy(-320)}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="向右"
                className="rounded-lg p-1.5 text-text-muted hover:bg-bg-hover"
                onClick={() => scrollBy(320)}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* 移动端顶栏阶段 */}
        <div className="flex gap-1 overflow-x-auto pb-1 md:hidden [scrollbar-width:none]">
          {visibleStages.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => scrollToStage(st)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap ${
                isLight ? 'bg-bg-tertiary border border-bg-hover' : 'bg-white/[0.06] border border-white/10'
              }`}
            >
              {RAIL_LABEL[st]} · {displayColumnIds[st]?.length ?? 0}
            </button>
          ))}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={scrollRef}
            className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-1 scroll-smooth snap-x snap-mandatory [scrollbar-width:thin]"
          >
            {visibleStages.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                appMap={appMap}
                ids={displayColumnIds[stage] ?? []}
                isLight={isLight}
                sortDisabled={sortDisabled}
                busyId={busyId}
                onStageChange={handleStageSelect}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={dropAnimation}>
            {activeApp ? <CardPreview app={activeApp} isLight={isLight} /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  )
}
