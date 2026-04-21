import { useEffect, useRef } from 'react'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

export function useOverlayWindowSync(_isRecording: boolean, _appMode: string) {
  void _isRecording
  void _appMode
  const interviewOverlayEnabled = useUiPrefsStore((s) => s.interviewOverlayEnabled)
  const interviewOverlayOpacity = useUiPrefsStore((s) => s.interviewOverlayOpacity)
  const interviewOverlayFontSize = useUiPrefsStore((s) => s.interviewOverlayFontSize)
  const interviewOverlayFontColor = useUiPrefsStore((s) => s.interviewOverlayFontColor)
  const interviewOverlayShowBg = useUiPrefsStore((s) => s.interviewOverlayShowBg)
  const interviewOverlayMaxLines = useUiPrefsStore((s) => s.interviewOverlayMaxLines)
  const applyInterviewOverlayState = useUiPrefsStore((s) => s.applyInterviewOverlayState)

  const overlaySyncUntilRef = useRef(0)
  const prevEnabledRef = useRef(interviewOverlayEnabled)

  useEffect(() => {
    if (!window.electronAPI?.syncOverlayWindow) return
    overlaySyncUntilRef.current = Date.now() + 500

    const payload: Record<string, unknown> = {
      opacity: interviewOverlayOpacity,
      fontSize: interviewOverlayFontSize,
      fontColor: interviewOverlayFontColor,
      showBg: interviewOverlayShowBg,
      maxLines: interviewOverlayMaxLines,
    }

    // enabled OFF → force hide overlay + show main window
    if (prevEnabledRef.current && !interviewOverlayEnabled) {
      payload.enabled = false
      payload.visible = false
    }
    prevEnabledRef.current = interviewOverlayEnabled

    window.electronAPI.syncOverlayWindow(payload).catch(() => {})
  }, [
    interviewOverlayEnabled,
    interviewOverlayOpacity,
    interviewOverlayFontSize,
    interviewOverlayFontColor,
    interviewOverlayShowBg,
    interviewOverlayMaxLines,
  ])

  useEffect(() => {
    if (!window.electronAPI?.onOverlayState) return
    const removeOverlayListener = window.electronAPI.onOverlayState((payload) => {
      if (Date.now() < overlaySyncUntilRef.current) return
      applyInterviewOverlayState(payload)
    })
    return () => removeOverlayListener?.()
  }, [applyInterviewOverlayState])
}
