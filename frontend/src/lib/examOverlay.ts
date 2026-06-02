import { useUiPrefsStore } from '@/stores/uiPrefsStore'

export function forceExamOverlayPrompt() {
  const prefs = useUiPrefsStore.getState()
  prefs.setInterviewOverlayEnabled(true)
  prefs.setInterviewOverlayMode('prompt')

  const next = useUiPrefsStore.getState()
  window.electronAPI?.syncOverlayWindow?.({
    enabled: true,
    visible: true,
    opacity: next.interviewOverlayOpacity,
    fontSize: next.interviewOverlayFontSize,
    fontColor: next.interviewOverlayFontColor,
    showBg: false,
    mode: 'prompt',
    focusWidthPct: next.interviewOverlayFocusWidthPct,
    focusHeightPct: next.interviewOverlayFocusHeightPct,
    maxLines: next.interviewOverlayMaxLines,
  }).catch(() => {})
}
