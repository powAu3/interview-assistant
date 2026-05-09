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
  type OverlayStatePayload,
} from '@/lib/interviewOverlay'

const ANSWER_LAYOUT_KEY = 'ia_answer_panel_layout'
const ASSIST_SPLIT_KEY = 'ia_assist_split_pct'
const ASSIST_TRANSCRIPT_COLLAPSED_KEY = 'ia_assist_transcript_collapsed'
const APP_MODE_KEY = 'ia_app_mode'

export type AppMode = 'assist' | 'practice' | 'knowledge' | 'resume-opt' | 'job-tracker'

export const __UI_PREFS_TEST_KEYS = {
  overlayEnabled: INTERVIEW_OVERLAY_STORAGE_KEYS.enabled,
  overlayOpacity: INTERVIEW_OVERLAY_STORAGE_KEYS.opacity,
  overlayFontSize: INTERVIEW_OVERLAY_STORAGE_KEYS.fontSize,
  overlayFontColor: INTERVIEW_OVERLAY_STORAGE_KEYS.fontColor,
  overlayShowBg: INTERVIEW_OVERLAY_STORAGE_KEYS.showBg,
  overlayMaxLines: INTERVIEW_OVERLAY_STORAGE_KEYS.maxLines,
}

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

function readOverlayEnabled(): boolean {
  try {
    const v = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.enabled)
    if (v === '1') return true
  } catch { /* ignore */ }
  return false
}

function readOverlayOpacity(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.opacity)
    const value = raw == null ? 0.88 : Number(raw)
    if (Number.isFinite(value)) return Math.min(1, Math.max(0, value))
  } catch { /* ignore */ }
  return 0.88
}

function readOverlayFontSize(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.fontSize)
    const value = raw == null ? 14 : Number(raw)
    if (Number.isFinite(value)) return Math.max(10, Math.min(48, Math.round(value)))
  } catch { /* ignore */ }
  return 14
}

function readOverlayFontColor(): string {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.fontColor)
    if (raw && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  } catch { /* ignore */ }
  return '#e2e8f0'
}

function readOverlayShowBg(): boolean {
  try {
    const v = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.showBg)
    if (v === '0') return false
  } catch { /* ignore */ }
  return true
}

function readOverlayMaxLines(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.maxLines)
    const value = raw == null ? 0 : Number(raw)
    if (Number.isFinite(value)) return Math.max(0, Math.min(50, Math.round(value)))
  } catch { /* ignore */ }
  return 0
}

function normalizeOverlayEnabled(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normalizeOverlayOpacity(value: unknown): number | null {
  const next = Number(value)
  if (!Number.isFinite(next)) return null
  return Math.min(1, Math.max(0, next))
}

function normalizeOverlayFontSize(value: unknown): number | null {
  const next = Number(value)
  if (!Number.isFinite(next)) return null
  return Math.max(10, Math.min(48, Math.round(next)))
}

function normalizeOverlayFontColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null
}

function normalizeOverlayShowBg(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normalizeOverlayMaxLines(value: unknown): number | null {
  const next = Number(value)
  if (!Number.isFinite(next)) return null
  return Math.max(0, Math.min(50, Math.round(next)))
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

function readAssistTranscriptCollapsed(): boolean {
  try {
    return localStorage.getItem(ASSIST_TRANSCRIPT_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function persistOverlayPref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('interview-overlay-prefs-updated'))
}

function persistOverlayPrefSilently(key: string, value: string) {
  try {
    if (localStorage.getItem(key) === value) return
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

interface UiPrefsState {
  appMode: AppMode
  setAppMode: (mode: AppMode) => void
  answerPanelLayout: 'cards' | 'stream'
  colorScheme: ColorSchemeId
  assistSplitPct: number
  assistTranscriptCollapsed: boolean

  interviewOverlayEnabled: boolean
  interviewOverlayOpacity: number
  interviewOverlayFontSize: number
  interviewOverlayFontColor: string
  interviewOverlayShowBg: boolean
  interviewOverlayMaxLines: number

  setAnswerPanelLayout: (layout: 'cards' | 'stream') => void
  setColorScheme: (id: ColorSchemeId) => void
  setAssistSplitPct: (pct: number) => void
  persistAssistSplitPct: (pct: number) => void
  setAssistTranscriptCollapsed: (collapsed: boolean) => void
  toggleAssistTranscriptCollapsed: () => void

  setInterviewOverlayEnabled: (enabled: boolean) => void
  setInterviewOverlayOpacity: (opacity: number) => void
  setInterviewOverlayFontSize: (size: number) => void
  setInterviewOverlayFontColor: (color: string) => void
  setInterviewOverlayShowBg: (show: boolean) => void
  setInterviewOverlayMaxLines: (lines: number) => void
  syncInterviewOverlayPrefs: () => void
  applyInterviewOverlayState: (payload: OverlayStatePayload, options?: { persistStyle?: boolean }) => void
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
  assistTranscriptCollapsed: readAssistTranscriptCollapsed(),

  interviewOverlayEnabled: readOverlayEnabled(),
  interviewOverlayOpacity: readOverlayOpacity(),
  interviewOverlayFontSize: readOverlayFontSize(),
  interviewOverlayFontColor: readOverlayFontColor(),
  interviewOverlayShowBg: readOverlayShowBg(),
  interviewOverlayMaxLines: readOverlayMaxLines(),

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
  setAssistTranscriptCollapsed: (collapsed) => {
    try {
      localStorage.setItem(ASSIST_TRANSCRIPT_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
    set((state) =>
      state.assistTranscriptCollapsed === collapsed
        ? state
        : { assistTranscriptCollapsed: collapsed },
    )
  },
  toggleAssistTranscriptCollapsed: () => {
    set((state) => {
      const next = !state.assistTranscriptCollapsed
      try {
        localStorage.setItem(ASSIST_TRANSCRIPT_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return { assistTranscriptCollapsed: next }
    })
  },

  setInterviewOverlayEnabled: (enabled) => {
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.enabled, enabled ? '1' : '0')
    set({ interviewOverlayEnabled: enabled })
  },
  setInterviewOverlayOpacity: (opacity) => {
    const next = normalizeOverlayOpacity(opacity) ?? 0.88
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.opacity, String(next))
    set({ interviewOverlayOpacity: next })
  },
  setInterviewOverlayFontSize: (size) => {
    const next = normalizeOverlayFontSize(size) ?? 14
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.fontSize, String(next))
    set({ interviewOverlayFontSize: next })
  },
  setInterviewOverlayFontColor: (color) => {
    const next = normalizeOverlayFontColor(color) ?? '#e2e8f0'
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.fontColor, next)
    set({ interviewOverlayFontColor: next })
  },
  setInterviewOverlayShowBg: (show) => {
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.showBg, show ? '1' : '0')
    set({ interviewOverlayShowBg: show })
  },
  setInterviewOverlayMaxLines: (lines) => {
    const next = normalizeOverlayMaxLines(lines) ?? 0
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.maxLines, String(next))
    set({ interviewOverlayMaxLines: next })
  },

  syncInterviewOverlayPrefs: () =>
    set({
      interviewOverlayEnabled: readOverlayEnabled(),
      interviewOverlayOpacity: readOverlayOpacity(),
      interviewOverlayFontSize: readOverlayFontSize(),
      interviewOverlayFontColor: readOverlayFontColor(),
      interviewOverlayShowBg: readOverlayShowBg(),
      interviewOverlayMaxLines: readOverlayMaxLines(),
    }),
  applyInterviewOverlayState: (payload, options = {}) => {
    const shouldApplyStyle = options.persistStyle === true || payload.initialized === true
    const enabled = shouldApplyStyle ? normalizeOverlayEnabled(payload.enabled) : null
    const opacity = shouldApplyStyle ? normalizeOverlayOpacity(payload.opacity) : null
    const fontSize = shouldApplyStyle ? normalizeOverlayFontSize(payload.fontSize) : null
    const fontColor = shouldApplyStyle ? normalizeOverlayFontColor(payload.fontColor) : null
    const showBg = shouldApplyStyle ? normalizeOverlayShowBg(payload.showBg) : null
    const maxLines = shouldApplyStyle ? normalizeOverlayMaxLines(payload.maxLines) : null

    if (enabled !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.enabled, enabled ? '1' : '0')
    if (opacity !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.opacity, String(opacity))
    if (fontSize !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.fontSize, String(fontSize))
    if (fontColor !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.fontColor, fontColor)
    if (showBg !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.showBg, showBg ? '1' : '0')
    if (maxLines !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.maxLines, String(maxLines))

    set((state) => ({
      interviewOverlayEnabled: enabled ?? state.interviewOverlayEnabled,
      interviewOverlayOpacity: opacity ?? state.interviewOverlayOpacity,
      interviewOverlayFontSize: fontSize ?? state.interviewOverlayFontSize,
      interviewOverlayFontColor: fontColor ?? state.interviewOverlayFontColor,
      interviewOverlayShowBg: showBg ?? state.interviewOverlayShowBg,
      interviewOverlayMaxLines: maxLines ?? state.interviewOverlayMaxLines,
    }))
  },
}))

applyStoredColorSchemeToDocument()
