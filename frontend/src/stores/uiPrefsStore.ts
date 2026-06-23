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
  isOverlayMode,
  overlayModeToShowBg,
  showBgToOverlayMode,
  type OverlayMode,
  type OverlayStatePayload,
} from '@/lib/interviewOverlay'

const ANSWER_LAYOUT_KEY = 'ia_answer_panel_layout'
const ASSIST_SPLIT_KEY = 'ia_assist_split_pct'
const ASSIST_TRANSCRIPT_COLLAPSED_KEY = 'ia_assist_transcript_collapsed'
const APP_MODE_KEY = 'ia_app_mode'

export type AppMode = 'assist' | 'review' | 'knowledge' | 'resume-opt' | 'job-tracker'

export const __UI_PREFS_TEST_KEYS = {
  overlayEnabled: INTERVIEW_OVERLAY_STORAGE_KEYS.enabled,
  overlayOpacity: INTERVIEW_OVERLAY_STORAGE_KEYS.opacity,
  overlayFontSize: INTERVIEW_OVERLAY_STORAGE_KEYS.fontSize,
  overlayFontColor: INTERVIEW_OVERLAY_STORAGE_KEYS.fontColor,
  overlayShowBg: INTERVIEW_OVERLAY_STORAGE_KEYS.showBg,
  overlayMode: INTERVIEW_OVERLAY_STORAGE_KEYS.mode,
  overlayFocusWidthPct: INTERVIEW_OVERLAY_STORAGE_KEYS.focusWidthPct,
  overlayFocusHeightPct: INTERVIEW_OVERLAY_STORAGE_KEYS.focusHeightPct,
  overlayPromptMaxWidth: INTERVIEW_OVERLAY_STORAGE_KEYS.promptMaxWidth,
  overlayMaxLines: INTERVIEW_OVERLAY_STORAGE_KEYS.maxLines,
}

const APP_MODE_VALUES: ReadonlySet<AppMode> = new Set([
  'assist',
  'review',
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
  return overlayModeToShowBg(readOverlayMode())
}

function readLegacyOverlayShowBg(): boolean {
  try {
    const v = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.showBg)
    if (v === '0') return false
  } catch { /* ignore */ }
  return true
}

function readOverlayMode(): OverlayMode {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.mode)
    if (isOverlayMode(raw)) return raw
  } catch { /* ignore */ }
  return showBgToOverlayMode(readLegacyOverlayShowBg())
}

function readOverlayFocusWidthPct(): number {
  return readOverlayPercent(INTERVIEW_OVERLAY_STORAGE_KEYS.focusWidthPct, 96, 50, 100)
}

function readOverlayFocusHeightPct(): number {
  return readOverlayPercent(INTERVIEW_OVERLAY_STORAGE_KEYS.focusHeightPct, 90, 35, 100)
}

function readOverlayPromptMaxWidth(): number {
  try {
    const raw = localStorage.getItem(INTERVIEW_OVERLAY_STORAGE_KEYS.promptMaxWidth)
    const value = raw == null ? 900 : Number(raw)
    if (Number.isFinite(value)) return Math.max(200, Math.min(1500, Math.round(value)))
  } catch { /* ignore */ }
  return 900
}

function readOverlayPercent(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    const value = raw == null ? fallback : Number(raw)
    if (Number.isFinite(value)) return Math.max(min, Math.min(max, Math.round(value)))
  } catch { /* ignore */ }
  return fallback
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

function normalizeOverlayMode(value: unknown): OverlayMode | null {
  return isOverlayMode(value) ? value : null
}

function normalizeOverlayFocusWidthPct(value: unknown): number | null {
  const next = Number(value)
  if (!Number.isFinite(next)) return null
  return Math.max(50, Math.min(100, Math.round(next)))
}

function normalizeOverlayFocusHeightPct(value: unknown): number | null {
  const next = Number(value)
  if (!Number.isFinite(next)) return null
  return Math.max(35, Math.min(100, Math.round(next)))
}

function normalizeOverlayPromptMaxWidth(value: unknown): number | null {
  const next = Number(value)
  if (!Number.isFinite(next)) return null
  return Math.max(200, Math.min(1500, Math.round(next)))
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
  interviewOverlayMode: OverlayMode
  interviewOverlayFocusWidthPct: number
  interviewOverlayFocusHeightPct: number
  interviewOverlayPromptMaxWidth: number
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
  setInterviewOverlayMode: (mode: OverlayMode) => void
  setInterviewOverlayFocusWidthPct: (pct: number) => void
  setInterviewOverlayFocusHeightPct: (pct: number) => void
  setInterviewOverlayPromptMaxWidth: (width: number) => void
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
  interviewOverlayMode: readOverlayMode(),
  interviewOverlayFocusWidthPct: readOverlayFocusWidthPct(),
  interviewOverlayFocusHeightPct: readOverlayFocusHeightPct(),
  interviewOverlayPromptMaxWidth: readOverlayPromptMaxWidth(),
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
    const mode = showBgToOverlayMode(show)
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.mode, mode)
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.showBg, show ? '1' : '0')
    set({ interviewOverlayShowBg: show, interviewOverlayMode: mode })
  },
  setInterviewOverlayMode: (mode) => {
    const next = normalizeOverlayMode(mode) ?? 'glass'
    const showBg = overlayModeToShowBg(next)
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.mode, next)
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.showBg, showBg ? '1' : '0')
    set({ interviewOverlayMode: next, interviewOverlayShowBg: showBg })
  },
  setInterviewOverlayFocusWidthPct: (pct) => {
    const next = normalizeOverlayFocusWidthPct(pct) ?? 96
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.focusWidthPct, String(next))
    set({ interviewOverlayFocusWidthPct: next })
  },
  setInterviewOverlayFocusHeightPct: (pct) => {
    const next = normalizeOverlayFocusHeightPct(pct) ?? 90
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.focusHeightPct, String(next))
    set({ interviewOverlayFocusHeightPct: next })
  },
  setInterviewOverlayPromptMaxWidth: (width) => {
    const next = normalizeOverlayPromptMaxWidth(width) ?? 900
    persistOverlayPref(INTERVIEW_OVERLAY_STORAGE_KEYS.promptMaxWidth, String(next))
    set({ interviewOverlayPromptMaxWidth: next })
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
      interviewOverlayMode: readOverlayMode(),
      interviewOverlayFocusWidthPct: readOverlayFocusWidthPct(),
      interviewOverlayFocusHeightPct: readOverlayFocusHeightPct(),
      interviewOverlayPromptMaxWidth: readOverlayPromptMaxWidth(),
      interviewOverlayMaxLines: readOverlayMaxLines(),
    }),
  applyInterviewOverlayState: (payload, options = {}) => {
    const shouldApplyStyle = options.persistStyle === true || payload.initialized === true
    const enabled = shouldApplyStyle ? normalizeOverlayEnabled(payload.enabled) : null
    const opacity = shouldApplyStyle ? normalizeOverlayOpacity(payload.opacity) : null
    const fontSize = shouldApplyStyle ? normalizeOverlayFontSize(payload.fontSize) : null
    const fontColor = shouldApplyStyle ? normalizeOverlayFontColor(payload.fontColor) : null
    const payloadMode = shouldApplyStyle ? normalizeOverlayMode(payload.mode) : null
    const payloadShowBg = shouldApplyStyle ? normalizeOverlayShowBg(payload.showBg) : null
    const mode = payloadMode ?? (payloadShowBg === null ? null : showBgToOverlayMode(payloadShowBg))
    const showBg = mode === null ? null : overlayModeToShowBg(mode)
    const focusWidthPct = shouldApplyStyle ? normalizeOverlayFocusWidthPct(payload.focusWidthPct) : null
    const focusHeightPct = shouldApplyStyle ? normalizeOverlayFocusHeightPct(payload.focusHeightPct) : null
    const promptMaxWidth = shouldApplyStyle ? normalizeOverlayPromptMaxWidth(payload.promptMaxWidth) : null
    const maxLines = shouldApplyStyle ? normalizeOverlayMaxLines(payload.maxLines) : null

    if (enabled !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.enabled, enabled ? '1' : '0')
    if (opacity !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.opacity, String(opacity))
    if (fontSize !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.fontSize, String(fontSize))
    if (fontColor !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.fontColor, fontColor)
    if (mode !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.mode, mode)
    if (showBg !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.showBg, showBg ? '1' : '0')
    if (focusWidthPct !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.focusWidthPct, String(focusWidthPct))
    if (focusHeightPct !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.focusHeightPct, String(focusHeightPct))
    if (promptMaxWidth !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.promptMaxWidth, String(promptMaxWidth))
    if (maxLines !== null) persistOverlayPrefSilently(INTERVIEW_OVERLAY_STORAGE_KEYS.maxLines, String(maxLines))

    set((state) => ({
      interviewOverlayEnabled: enabled ?? state.interviewOverlayEnabled,
      interviewOverlayOpacity: opacity ?? state.interviewOverlayOpacity,
      interviewOverlayFontSize: fontSize ?? state.interviewOverlayFontSize,
      interviewOverlayFontColor: fontColor ?? state.interviewOverlayFontColor,
      interviewOverlayShowBg: showBg ?? state.interviewOverlayShowBg,
      interviewOverlayMode: mode ?? state.interviewOverlayMode,
      interviewOverlayFocusWidthPct: focusWidthPct ?? state.interviewOverlayFocusWidthPct,
      interviewOverlayFocusHeightPct: focusHeightPct ?? state.interviewOverlayFocusHeightPct,
      interviewOverlayPromptMaxWidth: promptMaxWidth ?? state.interviewOverlayPromptMaxWidth,
      interviewOverlayMaxLines: maxLines ?? state.interviewOverlayMaxLines,
    }))
  },
}))

applyStoredColorSchemeToDocument()
