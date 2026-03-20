import type { LucideIcon } from 'lucide-react'
import {
  Send,
  FileText,
  UserRound,
  Users,
  Layers,
  HeartHandshake,
  Trophy,
  XCircle,
  LogOut,
} from 'lucide-react'
import type { Stage } from './types'

/** 看板列标题图标（与阶段语义对应） */
export const STAGE_HEADER_ICON: Record<string, LucideIcon> = {
  applied: Send,
  written: FileText,
  interview1: UserRound,
  interview2: Users,
  interview3: Layers,
  hr: HeartHandshake,
  offer: Trophy,
  rejected: XCircle,
  withdrawn: LogOut,
}

/** 列头左侧强调条 + 图标底色（Tailwind） */
export const STAGE_COLUMN_THEME: Record<
  string,
  { bar: string; iconBg: string; iconText: string; headerBg: string }
> = {
  applied: {
    bar: 'from-slate-400/80 to-slate-500/40',
    iconBg: 'bg-slate-500/20',
    iconText: 'text-slate-300',
    headerBg: 'from-slate-900/40 via-bg-secondary/80 to-transparent',
  },
  written: {
    bar: 'from-violet-400/80 to-violet-600/40',
    iconBg: 'bg-violet-500/20',
    iconText: 'text-violet-300',
    headerBg: 'from-violet-950/35 via-bg-secondary/80 to-transparent',
  },
  interview1: {
    bar: 'from-sky-400/80 to-sky-600/40',
    iconBg: 'bg-sky-500/20',
    iconText: 'text-sky-300',
    headerBg: 'from-sky-950/30 via-bg-secondary/80 to-transparent',
  },
  interview2: {
    bar: 'from-blue-400/80 to-blue-600/40',
    iconBg: 'bg-blue-500/20',
    iconText: 'text-blue-300',
    headerBg: 'from-blue-950/30 via-bg-secondary/80 to-transparent',
  },
  interview3: {
    bar: 'from-indigo-400/80 to-indigo-600/40',
    iconBg: 'bg-indigo-500/20',
    iconText: 'text-indigo-300',
    headerBg: 'from-indigo-950/30 via-bg-secondary/80 to-transparent',
  },
  hr: {
    bar: 'from-amber-400/80 to-amber-600/40',
    iconBg: 'bg-amber-500/20',
    iconText: 'text-amber-300',
    headerBg: 'from-amber-950/25 via-bg-secondary/80 to-transparent',
  },
  offer: {
    bar: 'from-emerald-400/90 to-teal-600/50',
    iconBg: 'bg-emerald-500/25',
    iconText: 'text-emerald-300',
    headerBg: 'from-emerald-950/35 via-bg-secondary/80 to-transparent',
  },
  rejected: {
    bar: 'from-red-400/70 to-red-600/40',
    iconBg: 'bg-red-500/20',
    iconText: 'text-red-300',
    headerBg: 'from-red-950/25 via-bg-secondary/80 to-transparent',
  },
  withdrawn: {
    bar: 'from-zinc-400/60 to-zinc-600/35',
    iconBg: 'bg-zinc-500/15',
    iconText: 'text-zinc-400',
    headerBg: 'from-zinc-900/40 via-bg-secondary/80 to-transparent',
  },
}

export function getStageColumnTheme(stage: string) {
  return (
    STAGE_COLUMN_THEME[stage] ?? {
      bar: 'from-zinc-500/50 to-zinc-600/30',
      iconBg: 'bg-zinc-500/15',
      iconText: 'text-zinc-400',
      headerBg: 'from-bg-tertiary/50 via-bg-secondary/80 to-transparent',
    }
  )
}

/** 卡片左侧强调线（与阶段同色） */
export const STAGE_CARD_LEFT_BORDER: Record<string, string> = {
  applied: 'border-l-slate-400/55',
  written: 'border-l-violet-400/55',
  interview1: 'border-l-sky-400/55',
  interview2: 'border-l-blue-400/55',
  interview3: 'border-l-indigo-400/55',
  hr: 'border-l-amber-400/55',
  offer: 'border-l-emerald-400/65',
  rejected: 'border-l-red-400/50',
  withdrawn: 'border-l-zinc-500/45',
}

export const STAGE_ORDER: Stage[] = [
  'applied',
  'written',
  'interview1',
  'interview2',
  'interview3',
  'hr',
  'offer',
  'rejected',
  'withdrawn',
]

/** 已结束阶段（看板可折叠隐藏） */
export const TERMINAL_STAGES: Stage[] = ['rejected', 'withdrawn']

/** 进行中（不含已拒/已放弃） */
export const ONGOING_STAGES: Stage[] = STAGE_ORDER.filter((s) => !TERMINAL_STAGES.includes(s))

/** 快捷「下一阶段」：沿 STAGE_ORDER 走一步，不进入已结束列，且 offer 后无「下一」 */
export function nextStageAfter(current: string): string | null {
  const i = STAGE_ORDER.indexOf(current as Stage)
  if (i < 0) return null
  const next = STAGE_ORDER[i + 1]
  if (!next || TERMINAL_STAGES.includes(next)) return null
  return next
}

export const STAGE_LABELS: Record<string, string> = {
  applied: '已投递',
  written: '笔试',
  interview1: '一面',
  interview2: '二面',
  interview3: '三面+',
  hr: 'HR 面',
  offer: 'Offer',
  rejected: '已拒/挂',
  withdrawn: '已放弃',
}

/** Tailwind 类：浅色底 + 深色字，飞书式标签 */
export function stagePillClass(stage: string): string {
  const map: Record<string, string> = {
    applied: 'bg-slate-500/15 text-slate-200 border-slate-500/25',
    written: 'bg-violet-500/15 text-violet-200 border-violet-500/25',
    interview1: 'bg-sky-500/15 text-sky-200 border-sky-500/25',
    interview2: 'bg-blue-500/15 text-blue-200 border-blue-500/25',
    interview3: 'bg-indigo-500/15 text-indigo-200 border-indigo-500/25',
    hr: 'bg-amber-500/15 text-amber-200 border-amber-500/25',
    offer: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30',
    rejected: 'bg-red-500/15 text-red-200 border-red-500/25',
    withdrawn: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/25',
  }
  return map[stage] ?? 'bg-bg-tertiary text-text-muted border-bg-hover'
}

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${stagePillClass(stage)}`}
    >
      {STAGE_LABELS[stage] ?? stage}
    </span>
  )
}
