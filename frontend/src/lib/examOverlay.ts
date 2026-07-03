import { useUiPrefsStore } from '@/stores/uiPrefsStore'

export function prepareExamOverlayPrompt() {
  const prefs = useUiPrefsStore.getState()
  prefs.setInterviewOverlayEnabled(true)
  prefs.setInterviewOverlayMode('prompt')
}

export function showExamOverlayPrompt() {
  prepareExamOverlayPrompt()
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
    promptMaxWidth: next.interviewOverlayPromptMaxWidth,
    promptAutoFollow: next.interviewOverlayPromptAutoFollow,
    maxLines: next.interviewOverlayMaxLines,
  }).catch(() => {})
}
