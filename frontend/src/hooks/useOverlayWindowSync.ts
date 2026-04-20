import { useEffect, useRef } from 'react'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

export function useOverlayWindowSync(isRecording: boolean, appMode: string) {
  const interviewOverlayEnabled = useUiPrefsStore((s) => s.interviewOverlayEnabled)
  const interviewOverlayMode = useUiPrefsStore((s) => s.interviewOverlayMode)
  const interviewOverlayOpacity = useUiPrefsStore((s) => s.interviewOverlayOpacity)
  const interviewOverlayPanelFontSize = useUiPrefsStore((s) => s.interviewOverlayPanelFontSize)
  const interviewOverlayPanelWidth = useUiPrefsStore((s) => s.interviewOverlayPanelWidth)
  const interviewOverlayPanelShowBg = useUiPrefsStore((s) => s.interviewOverlayPanelShowBg)
  const interviewOverlayPanelFontColor = useUiPrefsStore((s) => s.interviewOverlayPanelFontColor)
  const interviewOverlayPanelHeight = useUiPrefsStore((s) => s.interviewOverlayPanelHeight)
  const interviewOverlayLyricLines = useUiPrefsStore((s) => s.interviewOverlayLyricLines)
  const interviewOverlayLyricFontSize = useUiPrefsStore((s) => s.interviewOverlayLyricFontSize)
  const interviewOverlayLyricWidth = useUiPrefsStore((s) => s.interviewOverlayLyricWidth)
  const interviewOverlayLyricColor = useUiPrefsStore((s) => s.interviewOverlayLyricColor)
  const applyInterviewOverlayState = useUiPrefsStore((s) => s.applyInterviewOverlayState)

  const overlaySyncUntilRef = useRef(0)
  const mainHiddenByOverlayRef = useRef(false)

  useEffect(() => {
    if (!window.electronAPI?.syncOverlayWindow) return
    overlaySyncUntilRef.current = Date.now() + 500
    // visible = enabled: 启用 overlay 后即显示窗口 (即使未录音, 内部会渲染等待提示)。
    // 这与 4/12 之前的语义一致, 修复 71ad03d 之后 Toggle UI 失效的回归。
    window.electronAPI.syncOverlayWindow({
      enabled: interviewOverlayEnabled,
      visible: interviewOverlayEnabled,
      mode: interviewOverlayMode,
      opacity: interviewOverlayOpacity,
      panelFontSize: interviewOverlayPanelFontSize,
      panelWidth: interviewOverlayPanelWidth,
      panelShowBg: interviewOverlayPanelShowBg,
      panelFontColor: interviewOverlayPanelFontColor,
      panelHeight: interviewOverlayPanelHeight,
      lyricLines: interviewOverlayLyricLines,
      lyricFontSize: interviewOverlayLyricFontSize,
      lyricWidth: interviewOverlayLyricWidth,
      lyricColor: interviewOverlayLyricColor,
    }).catch(() => {})
  }, [
    interviewOverlayEnabled,
    interviewOverlayLyricColor,
    interviewOverlayLyricFontSize,
    interviewOverlayLyricLines,
    interviewOverlayLyricWidth,
    interviewOverlayMode,
    interviewOverlayOpacity,
    interviewOverlayPanelFontColor,
    interviewOverlayPanelFontSize,
    interviewOverlayPanelHeight,
    interviewOverlayPanelShowBg,
    interviewOverlayPanelWidth,
  ])

  useEffect(() => {
    if (!window.electronAPI?.hideWindow) return
    const overlayVisible = interviewOverlayEnabled && isRecording && appMode === 'assist'
    if (overlayVisible) {
      window.electronAPI.getWindowState?.().then((state) => {
        if (state?.visible) {
          mainHiddenByOverlayRef.current = true
          window.electronAPI!.hideWindow()
        }
      }).catch(() => {})
    } else if (mainHiddenByOverlayRef.current) {
      mainHiddenByOverlayRef.current = false
      window.electronAPI.showWindow?.()
    }
  }, [appMode, interviewOverlayEnabled, isRecording])

  useEffect(() => {
    if (!window.electronAPI?.onOverlayState) return
    const removeOverlayListener = window.electronAPI.onOverlayState((payload) => {
      if (Date.now() < overlaySyncUntilRef.current) return
      applyInterviewOverlayState(payload)
    })
    return () => removeOverlayListener?.()
  }, [applyInterviewOverlayState])
}
