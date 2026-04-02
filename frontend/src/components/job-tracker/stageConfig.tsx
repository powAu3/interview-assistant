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

export const STAGE_EMOJI: Record<string, string> = {
  applied: '\u{1F4E8}',
  written: '\u{1F4DD}',
  interview1: '\u{1F464}',
  interview2: '\u{1F465}',
  interview3: '\u{1F3AF}',
  hr: '\u{1F91D}',
  offer: '\u{1F389}',
  rejected: '\u{274C}',
  withdrawn: '\u{1F6AA}',
}

interface StageTheme {
  bar: string
  iconBg: string
  iconText: string
  headerBg: string
  dotColor: string
  cardGlow: string
}

export const STAGE_COLUMN_THEME: Record<string, { dark: StageTheme; light: StageTheme }> = {
  applied: {
    dark: {
      bar: 'from-blue-400 to-slate-500/60',
      iconBg: 'bg-blue-500/20',
      iconText: 'text-blue-300',
      headerBg: 'from-blue-950/40 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-blue-400',
      cardGlow: 'hover:shadow-blue-500/8',
    },
    light: {
      bar: 'from-blue-500 to-slate-400',
      iconBg: 'bg-blue-500/12',
      iconText: 'text-blue-600',
      headerBg: 'from-blue-50 via-white to-transparent',
      dotColor: 'bg-blue-500',
      cardGlow: 'hover:shadow-blue-200/40',
    },
  },
  written: {
    dark: {
      bar: 'from-violet-400 to-purple-600/60',
      iconBg: 'bg-violet-500/20',
      iconText: 'text-violet-300',
      headerBg: 'from-violet-950/35 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-violet-400',
      cardGlow: 'hover:shadow-violet-500/8',
    },
    light: {
      bar: 'from-violet-500 to-purple-500',
      iconBg: 'bg-violet-500/12',
      iconText: 'text-violet-600',
      headerBg: 'from-violet-50 via-white to-transparent',
      dotColor: 'bg-violet-500',
      cardGlow: 'hover:shadow-violet-200/40',
    },
  },
  interview1: {
    dark: {
      bar: 'from-emerald-400 to-green-600/60',
      iconBg: 'bg-emerald-500/20',
      iconText: 'text-emerald-300',
      headerBg: 'from-emerald-950/30 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-emerald-400',
      cardGlow: 'hover:shadow-emerald-500/8',
    },
    light: {
      bar: 'from-emerald-500 to-green-500',
      iconBg: 'bg-emerald-500/12',
      iconText: 'text-emerald-600',
      headerBg: 'from-emerald-50 via-white to-transparent',
      dotColor: 'bg-emerald-500',
      cardGlow: 'hover:shadow-emerald-200/40',
    },
  },
  interview2: {
    dark: {
      bar: 'from-teal-400 to-cyan-600/60',
      iconBg: 'bg-teal-500/20',
      iconText: 'text-teal-300',
      headerBg: 'from-teal-950/30 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-teal-400',
      cardGlow: 'hover:shadow-teal-500/8',
    },
    light: {
      bar: 'from-teal-500 to-cyan-500',
      iconBg: 'bg-teal-500/12',
      iconText: 'text-teal-600',
      headerBg: 'from-teal-50 via-white to-transparent',
      dotColor: 'bg-teal-500',
      cardGlow: 'hover:shadow-teal-200/40',
    },
  },
  interview3: {
    dark: {
      bar: 'from-cyan-400 to-sky-600/60',
      iconBg: 'bg-cyan-500/20',
      iconText: 'text-cyan-300',
      headerBg: 'from-cyan-950/30 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-cyan-400',
      cardGlow: 'hover:shadow-cyan-500/8',
    },
    light: {
      bar: 'from-cyan-500 to-sky-500',
      iconBg: 'bg-cyan-500/12',
      iconText: 'text-cyan-600',
      headerBg: 'from-cyan-50 via-white to-transparent',
      dotColor: 'bg-cyan-500',
      cardGlow: 'hover:shadow-cyan-200/40',
    },
  },
  hr: {
    dark: {
      bar: 'from-amber-400 to-orange-500/60',
      iconBg: 'bg-amber-500/20',
      iconText: 'text-amber-300',
      headerBg: 'from-amber-950/25 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-amber-400',
      cardGlow: 'hover:shadow-amber-500/8',
    },
    light: {
      bar: 'from-amber-500 to-orange-500',
      iconBg: 'bg-amber-500/12',
      iconText: 'text-amber-700',
      headerBg: 'from-amber-50 via-white to-transparent',
      dotColor: 'bg-amber-500',
      cardGlow: 'hover:shadow-amber-200/40',
    },
  },
  offer: {
    dark: {
      bar: 'from-emerald-400 to-green-500',
      iconBg: 'bg-emerald-500/25',
      iconText: 'text-emerald-300',
      headerBg: 'from-emerald-950/35 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-emerald-400',
      cardGlow: 'hover:shadow-emerald-500/12',
    },
    light: {
      bar: 'from-emerald-500 to-green-500',
      iconBg: 'bg-emerald-500/15',
      iconText: 'text-emerald-600',
      headerBg: 'from-emerald-50/80 via-white to-transparent',
      dotColor: 'bg-emerald-500',
      cardGlow: 'hover:shadow-emerald-200/50',
    },
  },
  rejected: {
    dark: {
      bar: 'from-red-400 to-rose-600/70',
      iconBg: 'bg-red-500/20',
      iconText: 'text-red-300',
      headerBg: 'from-red-950/25 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-red-400',
      cardGlow: 'hover:shadow-red-500/8',
    },
    light: {
      bar: 'from-red-500 to-rose-500',
      iconBg: 'bg-red-500/12',
      iconText: 'text-red-600',
      headerBg: 'from-red-50 via-white to-transparent',
      dotColor: 'bg-red-500',
      cardGlow: 'hover:shadow-red-200/40',
    },
  },
  withdrawn: {
    dark: {
      bar: 'from-zinc-400 to-zinc-600/50',
      iconBg: 'bg-zinc-500/15',
      iconText: 'text-zinc-400',
      headerBg: 'from-zinc-900/40 via-bg-secondary/80 to-transparent',
      dotColor: 'bg-zinc-400',
      cardGlow: 'hover:shadow-zinc-500/5',
    },
    light: {
      bar: 'from-zinc-400 to-zinc-500',
      iconBg: 'bg-zinc-500/10',
      iconText: 'text-zinc-500',
      headerBg: 'from-zinc-100 via-white to-transparent',
      dotColor: 'bg-zinc-400',
      cardGlow: 'hover:shadow-zinc-200/30',
    },
  },
}

const _fallbackTheme: StageTheme = {
  bar: 'from-zinc-500/50 to-zinc-600/30',
  iconBg: 'bg-zinc-500/15',
  iconText: 'text-zinc-400',
  headerBg: 'from-bg-tertiary/50 via-bg-secondary/80 to-transparent',
  dotColor: 'bg-zinc-400',
  cardGlow: '',
}

export function getStageTheme(stage: string, isLight: boolean): StageTheme {
  const entry = STAGE_COLUMN_THEME[stage]
  if (!entry) return _fallbackTheme
  return isLight ? entry.light : entry.dark
}

/** @deprecated use getStageTheme instead */
export function getStageColumnTheme(stage: string) {
  const entry = STAGE_COLUMN_THEME[stage]
  if (!entry) return _fallbackTheme
  return entry.dark
}

export const STAGE_CARD_LEFT_BORDER: Record<string, { dark: string; light: string }> = {
  applied: { dark: 'border-l-blue-400/60', light: 'border-l-blue-500' },
  written: { dark: 'border-l-violet-400/60', light: 'border-l-violet-500' },
  interview1: { dark: 'border-l-emerald-400/60', light: 'border-l-emerald-500' },
  interview2: { dark: 'border-l-teal-400/60', light: 'border-l-teal-500' },
  interview3: { dark: 'border-l-cyan-400/60', light: 'border-l-cyan-500' },
  hr: { dark: 'border-l-amber-400/60', light: 'border-l-amber-500' },
  offer: { dark: 'border-l-emerald-400/70', light: 'border-l-emerald-500' },
  rejected: { dark: 'border-l-red-400/55', light: 'border-l-red-500' },
  withdrawn: { dark: 'border-l-zinc-500/45', light: 'border-l-zinc-400' },
}

export function getCardLeftBorder(stage: string, isLight: boolean): string {
  const entry = STAGE_CARD_LEFT_BORDER[stage]
  if (!entry) return isLight ? 'border-l-zinc-300' : 'border-l-zinc-400/40'
  return isLight ? entry.light : entry.dark
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

export const TERMINAL_STAGES: Stage[] = ['rejected', 'withdrawn']
export const ONGOING_STAGES: Stage[] = STAGE_ORDER.filter((s) => !TERMINAL_STAGES.includes(s))

export function nextStageAfter(current: string): string | null {
  const i = STAGE_ORDER.indexOf(current as Stage)
  if (i < 0) return null
  const next = STAGE_ORDER[i + 1]
  if (!next || TERMINAL_STAGES.includes(next)) return null
  return next
}

export const STAGE_LABELS: Record<string, string> = {
  applied: '\u5DF2\u6295\u9012',
  written: '\u7B14\u8BD5',
  interview1: '\u4E00\u9762',
  interview2: '\u4E8C\u9762',
  interview3: '\u4E09\u9762+',
  hr: 'HR \u9762',
  offer: 'Offer',
  rejected: '\u5DF2\u62D2/\u6302',
  withdrawn: '\u5DF2\u653E\u5F03',
}

interface PillColors { dark: string; light: string }

const STAGE_PILL_MAP: Record<string, PillColors> = {
  applied: {
    dark: 'bg-blue-500/15 text-blue-200 border-blue-500/25',
    light: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  written: {
    dark: 'bg-violet-500/15 text-violet-200 border-violet-500/25',
    light: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  interview1: {
    dark: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/25',
    light: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  interview2: {
    dark: 'bg-teal-500/15 text-teal-200 border-teal-500/25',
    light: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  interview3: {
    dark: 'bg-cyan-500/15 text-cyan-200 border-cyan-500/25',
    light: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  },
  hr: {
    dark: 'bg-amber-500/15 text-amber-200 border-amber-500/25',
    light: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  offer: {
    dark: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30',
    light: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  },
  rejected: {
    dark: 'bg-red-500/15 text-red-200 border-red-500/25',
    light: 'bg-red-50 text-red-600 border-red-200',
  },
  withdrawn: {
    dark: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/25',
    light: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  },
}

export function stagePillClass(stage: string, isLight = false): string {
  const entry = STAGE_PILL_MAP[stage]
  if (!entry) return isLight ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-bg-tertiary text-text-muted border-bg-hover'
  return isLight ? entry.light : entry.dark
}

export function StageBadge({ stage, isLight = false }: { stage: string; isLight?: boolean }) {
  const emoji = STAGE_EMOJI[stage] ?? ''
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${stagePillClass(stage, isLight)}`}
    >
      <span className="text-[9px]">{emoji}</span>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  )
}
