import { useMemo } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  closestCorners,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import dayjs from 'dayjs'
import {
  Building2,
  Briefcase,
  MapPin,
  CalendarDays,
  GripVertical,
  LayoutGrid,
  Sparkles,
  Inbox,
} from 'lucide-react'
import type { Application } from './types'
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_HEADER_ICON,
  getStageColumnTheme,
  STAGE_CARD_LEFT_BORDER,
} from './stageConfig'

function KanbanCard({ app }: { app: Application }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `app-${app.id}`,
    data: { app },
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.92 : 1,
  }
  const fu = app.next_followup_at
  const leftBorder = STAGE_CARD_LEFT_BORDER[app.stage] ?? 'border-l-zinc-500/40'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        group relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-[#222230]/98 via-[#1a1a24]/95 to-[#14141c]/98
        pl-2 pr-3 py-3 border-l-[3px] shadow-md shadow-black/30
        cursor-grab active:cursor-grabbing
        transition-all duration-200 ease-out
        hover:border-white/[0.14] hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5
        before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/15 before:to-transparent
        ${leftBorder}
      `}
    >
      <div className="absolute left-1 top-1/2 -translate-y-1/2 text-text-muted/25 group-hover:text-text-muted/45 pointer-events-none">
        <GripVertical className="w-3.5 h-3.5" strokeWidth={2} />
      </div>
      <div className="pl-4 space-y-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-blue/12 text-accent-blue/90 ring-1 ring-accent-blue/20">
            <Building2 className="w-3.5 h-3.5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-text-primary leading-snug tracking-tight line-clamp-2">
              {app.company}
            </p>
            <div className="mt-1 flex items-start gap-1.5 text-[11px] text-text-secondary/90">
              <Briefcase className="w-3 h-3 mt-0.5 shrink-0 text-text-muted" strokeWidth={2} />
              <span className="line-clamp-2 leading-relaxed">{app.position || '岗位待填'}</span>
            </div>
          </div>
        </div>
        {app.city ? (
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted pl-[2.25rem]">
            <MapPin className="w-3 h-3 text-sky-400/70 shrink-0" strokeWidth={2} />
            <span>{app.city}</span>
          </div>
        ) : null}
        {fu != null ? (
          <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/[0.08] px-2 py-1.5 pl-[2.25rem] text-[10px] text-amber-200/90 ring-1 ring-amber-500/15">
            <CalendarDays className="w-3.5 h-3.5 text-amber-400/80 shrink-0" strokeWidth={2} />
            <span className="font-medium">跟进 {dayjs.unix(Math.floor(fu)).format('M月D日')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function KanbanColumn({
  stage,
  apps,
  search,
}: {
  stage: string
  apps: Application[]
  search: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const q = search.trim().toLowerCase()
  const list = useMemo(() => {
    if (!q) return apps
    return apps.filter(
      (a) =>
        a.company.toLowerCase().includes(q) ||
        a.position.toLowerCase().includes(q) ||
        a.city.toLowerCase().includes(q),
    )
  }, [apps, q])

  const theme = getStageColumnTheme(stage)
  const Icon = STAGE_HEADER_ICON[stage] ?? Sparkles

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col min-w-[240px] max-w-[272px] shrink-0 rounded-2xl overflow-hidden
        border transition-all duration-300 ease-out backdrop-blur-md
        shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)]
        ${
          isOver
            ? 'border-accent-blue/50 ring-2 ring-accent-blue/30 bg-accent-blue/[0.08] scale-[1.015] shadow-[0_16px_48px_rgba(59,130,246,0.12)]'
            : 'border-white/[0.07] bg-[#14141f]/55'
        }
      `}
    >
      {/* 列顶装饰条 */}
      <div className={`h-1 w-full bg-gradient-to-r ${theme.bar} shrink-0`} />

      <div
        className={`relative px-3.5 py-3 border-b border-white/[0.05] bg-gradient-to-br ${theme.headerBg}`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${theme.iconBg} ${theme.iconText} shadow-inner ring-1 ring-white/[0.06]`}
          >
            <Icon className="w-[18px] h-[18px]" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-bold text-text-primary tracking-tight leading-tight">
              {STAGE_LABELS[stage] ?? stage}
            </h3>
            <p className="text-[10px] text-text-muted/80 mt-0.5">拖放卡片调整阶段</p>
          </div>
          <span
            className={`
              flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-2
              text-[11px] font-bold tabular-nums
              bg-black/25 text-text-primary ring-1 ring-white/10
            `}
          >
            {list.length}
          </span>
        </div>
      </div>

      <div
        className={`
          p-2.5 space-y-2.5 flex-1 min-h-[min(440px,52vh)] max-h-[calc(100vh-240px)] overflow-y-auto overflow-x-hidden
          bg-gradient-to-b from-white/[0.02] via-transparent to-black/[0.18]
          [scrollbar-width:thin] [scrollbar-color:rgba(129,140,248,0.45)_transparent]
        `}
      >
        {list.map((app) => (
          <KanbanCard key={app.id} app={app} />
        ))}
        {list.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.06]">
              <Inbox className="w-5 h-5 text-text-muted/50" strokeWidth={1.8} />
            </div>
            <p className="text-[11px] text-text-muted/70 leading-relaxed">
              暂无记录
              <br />
              <span className="text-[10px] text-text-muted/45">从左侧拖入或表格新增</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

type Props = {
  applications: Application[]
  onStageChange: (appId: number, stage: string) => void
  search: string
}

export default function KanbanBoard({ applications, onStageChange, search }: Props) {
  const byStage = useMemo(() => {
    const m = new Map<string, Application[]>()
    for (const s of STAGE_ORDER) m.set(s, [])
    for (const a of applications) {
      let k = a.stage
      if (!STAGE_ORDER.includes(k as (typeof STAGE_ORDER)[number])) k = 'applied'
      m.get(k)!.push(a)
    }
    return m
  }, [applications])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over) return
    const overId = String(over.id)
    if (!STAGE_ORDER.includes(overId as (typeof STAGE_ORDER)[number])) return
    const aid = String(active.id)
    if (!aid.startsWith('app-')) return
    const appId = parseInt(aid.slice(4), 10)
    const app = applications.find((x) => x.id === appId)
    if (!app || app.stage === overId) return
    onStageChange(appId, overId)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="relative overflow-hidden rounded-[1.35rem] border border-white/[0.07] p-4 md:p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-white/[0.04]">
        <div className="pointer-events-none absolute -right-8 -top-16 h-56 w-56 rounded-full bg-violet-600/12 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage: `radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)`,
            backgroundSize: '16px 16px',
          }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4 px-0.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-indigo-600/20 text-violet-200 ring-1 ring-violet-400/25 shadow-lg shadow-violet-900/20">
              <LayoutGrid className="w-[18px] h-[18px]" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-[13px] font-bold text-text-primary tracking-tight flex items-center gap-2">
                流程看板
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200/90 ring-1 ring-amber-400/20">
                  <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                  拖拽
                </span>
              </p>
              <p className="text-[10px] text-text-muted/80 mt-1 leading-relaxed">
                横向滑动浏览各阶段 · 松开卡片即可完成阶段变更
              </p>
            </div>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-1 pt-0.5 scroll-smooth [scrollbar-width:thin] [scrollbar-color:rgba(139,92,246,0.4)_transparent]">
            {STAGE_ORDER.map((stage) => (
              <KanbanColumn key={stage} stage={stage} apps={byStage.get(stage) ?? []} search={search} />
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  )
}
