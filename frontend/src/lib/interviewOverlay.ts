export interface OverlayStatePayload {
  enabled: boolean
  opacity: number
  fontSize: number
  fontColor: string
  showBg: boolean
  maxLines: number
}

export const INTERVIEW_OVERLAY_STORAGE_KEYS = {
  enabled: 'ia_overlay_enabled',
  opacity: 'ia_overlay_opacity',
  fontSize: 'ia_overlay_font_size',
  fontColor: 'ia_overlay_font_color',
  showBg: 'ia_overlay_show_bg',
  maxLines: 'ia_overlay_max_lines',
} as const

export const INTERVIEW_OVERLAY_STORAGE_KEY_SET = new Set<string>(Object.values(INTERVIEW_OVERLAY_STORAGE_KEYS))

export function isInterviewOverlayStorageKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && INTERVIEW_OVERLAY_STORAGE_KEY_SET.has(key)
}

export function warnInterviewOverlaySyncIssue(context: string, error: unknown) {
  const isDevRuntime =
    typeof window !== 'undefined' && /^(localhost|127(?:\.\d{1,3}){3})$/.test(window.location.hostname)
  if (!isDevRuntime) return
  console.warn(`[interview-overlay] ${context}`, error)
}
