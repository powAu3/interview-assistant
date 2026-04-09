export type InterviewOverlayMode = 'panel' | 'lyrics'

export const INTERVIEW_OVERLAY_STORAGE_KEYS = {
  enabled: 'ia_interview_overlay_enabled',
  mode: 'ia_interview_overlay_mode',
  opacity: 'ia_interview_overlay_opacity',
  panelFontSize: 'ia_interview_overlay_panel_font_size',
  panelWidth: 'ia_interview_overlay_panel_width',
  lyricLines: 'ia_interview_overlay_lyric_lines',
  lyricFontSize: 'ia_interview_overlay_lyric_font_size',
  lyricWidth: 'ia_interview_overlay_lyric_width',
  lyricColor: 'ia_interview_overlay_lyric_color',
  panelShowBg: 'ia_interview_overlay_panel_show_bg',
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
