export type OverlayMode = 'glass' | 'prompt' | 'focus'

export interface OverlayStatePayload {
  initialized?: boolean
  enabled: boolean
  visible?: boolean
  mode?: OverlayMode
  opacity: number
  fontSize: number
  fontColor: string
  showBg: boolean
  focusWidthPct?: number
  focusHeightPct?: number
  promptMaxWidth?: number
  maxLines: number
}

export const INTERVIEW_OVERLAY_STORAGE_KEYS = {
  enabled: 'ia_overlay_enabled',
  opacity: 'ia_overlay_opacity',
  fontSize: 'ia_overlay_font_size',
  fontColor: 'ia_overlay_font_color',
  showBg: 'ia_overlay_show_bg',
  mode: 'ia_overlay_mode',
  focusWidthPct: 'ia_overlay_focus_width_pct',
  focusHeightPct: 'ia_overlay_focus_height_pct',
  promptMaxWidth: 'ia_overlay_prompt_max_width',
  maxLines: 'ia_overlay_max_lines',
} as const

export const INTERVIEW_OVERLAY_STORAGE_KEY_SET = new Set<string>(Object.values(INTERVIEW_OVERLAY_STORAGE_KEYS))

export function isOverlayMode(value: unknown): value is OverlayMode {
  return value === 'glass' || value === 'prompt' || value === 'focus'
}

export function overlayModeToShowBg(mode: OverlayMode): boolean {
  return mode !== 'prompt'
}

export function showBgToOverlayMode(showBg: boolean): OverlayMode {
  return showBg ? 'glass' : 'prompt'
}

export function isInterviewOverlayStorageKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && INTERVIEW_OVERLAY_STORAGE_KEY_SET.has(key)
}

export function warnInterviewOverlaySyncIssue(context: string, error: unknown) {
  const isDevRuntime =
    typeof window !== 'undefined' && /^(localhost|127(?:\.\d{1,3}){3})$/.test(window.location.hostname)
  if (!isDevRuntime) return
  console.warn(`[interview-overlay] ${context}`, error)
}
