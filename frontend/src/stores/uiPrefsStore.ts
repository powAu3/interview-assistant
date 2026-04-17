import { create } from 'zustand'
import type { ColorSchemeId } from '@/lib/colorScheme'
import {
  COLOR_SCHEME_STORAGE_KEY,
  readStoredColorScheme,
  applyColorSchemeToDocument,
  applyStoredColorSchemeToDocument,
} from '@/lib/colorScheme'
import {
  INTERVIEW_OVERLAY_STORAGE_KEYS,
  type InterviewOverlayMode,
  type OverlayStatePayload,
} from '@/lib/interviewOverlay'

const ANSWER_LAYOUT_KEY = 'ia_answer_panel_layout'
const ASSIST_SPLIT_KEY = 'ia_assist_split_pct'
const APP_MODE_KEY = 'ia_app_mode'

export type AppMode = 'assist' | 'practice' | 'knowledge' | 'resume-opt' | 'job-tracker'

const APP_MODE_VALUES: ReadonlySet<AppMode> = new Set([
  'assist',
  'practice',
  'knowledge',
  'resume-opt',
  'job-tracker',
])

function readAppMode(): AppMode {
  try {
    const v = localStorage.getItem(APP_MODE_KEY)
    if (v && APP_MODE_VALUES.has(v as AppMode)) return v as AppMode
  } catch {
    /* ignore */
  }
  return 'assist'
}

function readAnswerPanelLayout(): 'cards' | 'stream' {
  try {
    const v = localStorage.getItem(ANSWER_LAYOUT_KEY)
    if (v === 'stream' || v === 'cards') return v
  } catch {
    /* ignore */
  }
  return 'cards'
}

function readInterviewOverlayEnabled(): boolean {
  try {
    return localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.enabled) === '1'
  } catch {
    return false
  }
}

function readInterviewOverlayMode(): InterviewOverlayMode {
  try {
    const v = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.mode)
    if (v === 'panel' || v === 'lyrics') return v
  } catch {
    /* ignore */
  }
  return 'panel'
}

function readInterviewOverlayOpacity(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.opacity)
    const value = raw == null ? 0.82 : Number(raw)
    if (Number.isFinite(value)) return Math.min(1, Math.max(0, value))
  } catch {
    /* ignore */
  }
  return 0.82
}

function readInterviewOverlayPanelFontSize(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.panelFontSize)
    const value = raw == null ? 13 : Number(raw)
    if (Number.isFinite(value)) return Math.max(1, Math.round(value))
  } catch {
    /* ignore */
  }
  return 13
}

function readInterviewOverlayPanelShowBg(): boolean {
  try {
    const v = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.panelShowBg)
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return true
}

function readInterviewOverlayPanelWidth(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.panelWidth)
    const value = raw == null ? 420 : Number(raw)
    if (Number.isFinite(value)) return Math.min(800, Math.max(280, Math.round(value)))
  } catch {
    /* ignore */
  }
  return 420
}

function readInterviewOverlayPanelFontColor(): string {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.panelFontColor)
    if (raw && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  } catch {
    /* ignore */
  }
  return '#ffffff'
}

function readInterviewOverlayPanelHeight(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.panelHeight)
    const value = raw == null ? 0 : Number(raw)
    if (Number.isFinite(value)) return Math.max(0, Math.min(1200, Math.round(value)))
  } catch {
    /* ignore */
  }
  return 0
}

function readInterviewOverlayLyricLines(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.lyricLines)
    const value = raw == null ? 2 : Number(raw)
    if (Number.isFinite(value)) return Math.min(8, Math.max(1, Math.round(value)))
  } catch {
    /* ignore */
  }
  return 2
}

function readInterviewOverlayLyricFontSize(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.lyricFontSize)
    const value = raw == null ? 23 : Number(raw)
    if (Number.isFinite(value)) return Math.max(1, Math.round(value))
  } catch {
    /* ignore */
  }
  return 23
}

function readInterviewOverlayLyricWidth(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.lyricWidth)
    const value = raw == null ? 760 : Number(raw)
    if (Number.isFinite(value)) return Math.min(1200, Math.max(420, Math.round(value)))
  } catch {
    /* ignore */
  }
  return 760
}

function readInterviewOverlayLyricColor(): string {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.lyricColor)
    if (raw && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  } catch {
    /* ignore */
  }
  return '#ffffff'
}

function clampAssistSplitPct(value: number): number {
  return Math.min(62, Math.max(24, value))
}

function readAssistSplitPct(): number {
  try {
    const raw = localStorage.getItem(ASSIST_SPLIT_KEY)
    if (raw == null) return 32
    const value = parseFloat(raw)
    if (Number.isFinite(value)) return clampAssistSplitPct(value)
  } catch {
    /* ignore */
  }
  return 32
}

function persistOverlayPref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('interview-overlay-prefs-updated'))
}

interface UiPrefsState {
  appMode: AppMode
  setAppMode: (mode: AppMode) => void
  answerPanelLayout: 'cards' | 'stream'
  colorScheme: ColorSchemeId
  assistSplitPct: number
  interviewOverlayEnabled: boolean
  interviewOverlayMode: InterviewOverlayMode
  interviewOverlayOpacity: number
  interviewOverlayPanelFontSize: number
  interviewOverlayPanelWidth: number
  interviewOverlayPanelShowBg: boolean
  interviewOverlayPanelFontColor: string
  interviewOverlayPanelHeight: number
  interviewOverlayLyricLines: number
  interviewOverlayLyricFontSize: number
  interviewOverlayLyricWidth: number
  interviewOverlayLyricColor: string
  setAnswerPanelLayout: (layout: 'cards' | 'stream') => void
  setColorScheme: (id: ColorSchemeId) => void
  setAssistSplitPct: (pct: number) => void
  persistAssistSplitPct: (pct: number) => void
  setInterviewOverlayEnabled: (enabled: boolean) => void
  setInterviewOverlayMode: (mode: InterviewOverlayMode) => void
  setInterviewOverlayOpacity: (opacity: number) => void
  setInterviewOverlayPanelFontSize: (size: number) => void
  setInterviewOverlayPanelWidth: (width: number) => void
  setInterviewOverlayPanelShowBg: (show: boolean) => void
  setInterviewOverlayPanelFontColor: (color: string) => void
  setInterviewOverlayPanelHeight: (height: number) => void
  setInterviewOverlayLyricLines: (lines: number) => void
  setInterviewOverlayLyricFontSize: (size: number) => void
  setInterviewOverlayLyricWidth: (width: number) => void
  setInterviewOverlayLyricColor: (color: string) => void
  syncInterviewOverlayPrefs: () => void
  applyInterviewOverlayState: (payload: OverlayStatePayload) => void
}

export const useUiPrefsStore = create<UiPrefsState>((set) => ({
  appMode: readAppMode(),
  setAppMode: (mode) => {
    if (!APP_MODE_VALUES.has(mode)) return
    try {
      localStorage.setItem(APP_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
    set({ appMode: mode })
  },
  answerPanelLayout: readAnswerPanelLayout(),
  colorScheme: readStoredColorScheme(),
  assistSplitPct: readAssistSplitPct(),
  interviewOverlayEnabled: readInterviewOverlayEnabled(),
  interviewOverlayMode: readInterviewOverlayMode(),
  interviewOverlayOpacity: readInterviewOverlayOpacity(),
  interviewOverlayPanelFontSize: readInterviewOverlayPanelFontSize(),
  interviewOverlayPanelWidth: readInterviewOverlayPanelWidth(),
  interviewOverlayPanelShowBg: readInterviewOverlayPanelShowBg(),
  interviewOverlayPanelFontColor: readInterviewOverlayPanelFontColor(),
  interviewOverlayPanelHeight: readInterviewOverlayPanelHeight(),
  interviewOverlayLyricLines: readInterviewOverlayLyricLines(),
  interviewOverlayLyricFontSize: readInterviewOverlayLyricFontSize(),
  interviewOverlayLyricWidth: readInterviewOverlayLyricWidth(),
  interviewOverlayLyricColor: readInterviewOverlayLyricColor(),
  setAnswerPanelLayout: (layout) => {
    try {
      localStorage.setItem(ANSWER_LAYOUT_KEY, layout)
    } catch {
      /* ignore */
    }
    set({ answerPanelLayout: layout })
  },
  setColorScheme: (id) => {
    try {
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, id)
    } catch {
      /* ignore */
    }
    applyColorSchemeToDocument(id)
    set({ colorScheme: id })
  },
  setAssistSplitPct: (pct) => {
    const next = clampAssistSplitPct(pct)
    set((state) => (state.assistSplitPct === next ? state : { assistSplitPct: next }))
  },
  persistAssistSplitPct: (pct) => {
    const next = clampAssistSplitPct(pct)
    try {
      localStorage.setItem(ASSIST_SPLIT_KEY, String(Math.round(next * 10) / 10))
    } catch {
      /* ignore */
    }
    set((state) => (state.assistSplitPct === next ? state : { assistSplitPct: next }))
  },
  setInterviewOverlayEnabled: (enabled) => {
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.enabled, enabled ? '1' : '0')
    set({ interviewOverlayEnabled: enabled })
  },
  setInterviewOverlayMode: (mode) => {
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.mode, mode)
    set({ interviewOverlayMode: mode })
  },
  setInterviewOverlayOpacity: (opacity) => {
    const next = Math.min(1, Math.max(0, opacity))
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.opacity, String(next))
    set({ interviewOverlayOpacity: next })
  },
  setInterviewOverlayPanelFontSize: (size) => {
    const next = Math.max(1, Math.round(size))
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.panelFontSize, String(next))
    set({ interviewOverlayPanelFontSize: next })
  },
  setInterviewOverlayPanelWidth: (width) => {
    const next = Math.min(800, Math.max(280, Math.round(width)))
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.panelWidth, String(next))
    set({ interviewOverlayPanelWidth: next })
  },
  setInterviewOverlayPanelShowBg: (show) => {
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.panelShowBg, show ? '1' : '0')
    set({ interviewOverlayPanelShowBg: show })
  },
  setInterviewOverlayPanelFontColor: (color) => {
    const next = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#ffffff'
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.panelFontColor, next)
    set({ interviewOverlayPanelFontColor: next })
  },
  setInterviewOverlayPanelHeight: (height) => {
    const next = Math.max(0, Math.min(1200, Math.round(height)))
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.panelHeight, String(next))
    set({ interviewOverlayPanelHeight: next })
  },
  setInterviewOverlayLyricLines: (lines) => {
    const next = Math.min(8, Math.max(1, Math.round(lines)))
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.lyricLines, String(next))
    set({ interviewOverlayLyricLines: next })
  },
  setInterviewOverlayLyricFontSize: (size) => {
    const next = Math.max(1, Math.round(size))
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.lyricFontSize, String(next))
    set({ interviewOverlayLyricFontSize: next })
  },
  setInterviewOverlayLyricWidth: (width) => {
    const next = Math.min(1200, Math.max(420, Math.round(width)))
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.lyricWidth, String(next))
    set({ interviewOverlayLyricWidth: next })
  },
  setInterviewOverlayLyricColor: (color) => {
    const next = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#ffffff'
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.lyricColor, next)
    set({ interviewOverlayLyricColor: next })
  },
  syncInterviewOverlayPrefs: () =>
    set({
      interviewOverlayEnabled: readInterviewOverlayEnabled(),
      interviewOverlayMode: readInterviewOverlayMode(),
      interviewOverlayOpacity: readInterviewOverlayOpacity(),
      interviewOverlayPanelFontSize: readInterviewOverlayPanelFontSize(),
      interviewOverlayPanelWidth: readInterviewOverlayPanelWidth(),
      interviewOverlayPanelShowBg: readInterviewOverlayPanelShowBg(),
      interviewOverlayPanelFontColor: readInterviewOverlayPanelFontColor(),
      interviewOverlayPanelHeight: readInterviewOverlayPanelHeight(),
      interviewOverlayLyricLines: readInterviewOverlayLyricLines(),
      interviewOverlayLyricFontSize: readInterviewOverlayLyricFontSize(),
      interviewOverlayLyricWidth: readInterviewOverlayLyricWidth(),
      interviewOverlayLyricColor: readInterviewOverlayLyricColor(),
    }),
  applyInterviewOverlayState: (payload) =>
    set({
      interviewOverlayEnabled: payload.enabled,
      interviewOverlayMode: payload.mode,
      interviewOverlayOpacity: payload.opacity,
      interviewOverlayPanelFontSize: payload.panelFontSize,
      interviewOverlayPanelWidth: payload.panelWidth,
      interviewOverlayPanelShowBg: payload.panelShowBg,
      interviewOverlayPanelFontColor: payload.panelFontColor,
      interviewOverlayPanelHeight: payload.panelHeight,
      interviewOverlayLyricLines: payload.lyricLines,
      interviewOverlayLyricFontSize: payload.lyricFontSize,
      interviewOverlayLyricWidth: payload.lyricWidth,
      interviewOverlayLyricColor: payload.lyricColor,
    }),
}))

applyStoredColorSchemeToDocument()
