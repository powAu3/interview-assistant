import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { applyStoredColorSchemeToDocument, COLOR_SCHEME_STORAGE_KEY } from '@/lib/colorScheme'
import {
  isInterviewOverlayStorageKey,
  warnInterviewOverlaySyncIssue,
} from '@/lib/interviewOverlay'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

export default function InterviewOverlay() {
  useInterviewWS()

  const qaPairs = useInterviewStore((s) => s.qaPairs)
  const streamingIds = useInterviewStore((s) => s.streamingIds)
  const isRecording = useInterviewStore((s) => s.isRecording)
  const enabled = useUiPrefsStore((s) => s.interviewOverlayEnabled)
  const opacity = useUiPrefsStore((s) => s.interviewOverlayOpacity)
  const fontSize = useUiPrefsStore((s) => s.interviewOverlayFontSize)
  const fontColor = useUiPrefsStore((s) => s.interviewOverlayFontColor)
  const showBg = useUiPrefsStore((s) => s.interviewOverlayShowBg)
  const maxLines = useUiPrefsStore((s) => s.interviewOverlayMaxLines)
  const syncPrefs = useUiPrefsStore((s) => s.syncInterviewOverlayPrefs)
  const applyState = useUiPrefsStore((s) => s.applyInterviewOverlayState)

  const latestQa = useMemo(() => {
    if (streamingIds.length > 0) {
      const currentId = streamingIds[streamingIds.length - 1]
      const active = qaPairs.find((item) => item.id === currentId)
      if (active) return active
    }
    return qaPairs[qaPairs.length - 1] ?? null
  }, [qaPairs, streamingIds])

  const questionText = latestQa?.question?.trim() || ''
  const answerText =
    latestQa?.answer === '[已取消]'
      ? '上一条回答已取消'
      : latestQa?.answer?.trim() || (latestQa ? (latestQa.isThinking ? '思考中…' : '正在组织回答…') : '')
  const isStreaming = latestQa ? streamingIds.includes(latestQa.id) : false
  const hasContent = Boolean(latestQa)
  const isThinking = Boolean(latestQa?.isThinking)

  const statusLabel = !hasContent
    ? (isRecording ? '聆听中' : '待命')
    : (isThinking ? '思考中' : (isStreaming ? '输出中' : '就绪'))

  const displayLines = useMemo(() => {
    if (!answerText) return []
    const lines = answerText.split('\n')
    if (maxLines > 0 && lines.length > maxLines) return lines.slice(-maxLines)
    return lines
  }, [answerText, maxLines])

  const answerScrollRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!isStreaming) return
    const el = answerScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [answerText, isStreaming])

  useEffect(() => {
    document.documentElement.classList.add('overlay-window')
    document.body.classList.add('overlay-window')
    applyStoredColorSchemeToDocument()

    const fontHref = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600&family=JetBrains+Mono:wght@400;500&display=swap'
    let link = document.querySelector<HTMLLinkElement>(`link[href="${fontHref}"]`)
    if (!link) {
      link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = fontHref
      document.head.appendChild(link)
    }

    return () => {
      document.documentElement.classList.remove('overlay-window')
      document.body.classList.remove('overlay-window')
    }
  }, [])

  useEffect(() => {
    syncPrefs()
    window.electronAPI?.getOverlayState?.()
      .then((payload) => { if (payload) applyState(payload) })
      .catch((error) => { warnInterviewOverlaySyncIssue('bootstrap overlay state', error) })

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === COLOR_SCHEME_STORAGE_KEY) applyStoredColorSchemeToDocument()
      if (!event.key || isInterviewOverlayStorageKey(event.key)) syncPrefs()
    }
    window.addEventListener('storage', onStorage)
    const removeOverlayListener = window.electronAPI?.onOverlayState?.((payload) => { applyState(payload) })
    return () => {
      window.removeEventListener('storage', onStorage)
      removeOverlayListener?.()
    }
  }, [applyState, syncPrefs])

  // --- drag ---
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => { return () => dragCleanupRef.current?.() }, [])

  const onDragStart = useCallback((e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('.ov-content')) return
    e.preventDefault()
    dragCleanupRef.current?.()
    dragOrigin.current = { x: e.screenX, y: e.screenY }
    window.electronAPI?.overlayDragStart?.()

    const onMove = (ev: globalThis.MouseEvent) => {
      if (!dragOrigin.current) return
      const dx = ev.screenX - dragOrigin.current.x
      const dy = ev.screenY - dragOrigin.current.y
      dragOrigin.current = { x: ev.screenX, y: ev.screenY }
      window.electronAPI?.moveOverlayWindow?.(dx, dy)
    }
    const cleanup = () => {
      dragOrigin.current = null
      dragCleanupRef.current = null
      window.electronAPI?.overlayDragEnd?.()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', cleanup)
    }
    dragCleanupRef.current = cleanup
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', cleanup)
  }, [])

  if (!enabled) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  const questionFontSize = Math.max(11, fontSize - 2)
  const answerFontSize = Math.max(12, fontSize)
  const shellClass = `ov-shell ${showBg ? 'ov-shell--bg' : 'ov-shell--nobg'}`
  const trimmedLines = maxLines > 0 ? displayLines : null

  const renderedAnswer = hasContent ? (
    <>
      {trimmedLines
        ? trimmedLines.map((line, i) => (
            <span key={i}>
              {line}
              {i < trimmedLines.length - 1 && '\n'}
            </span>
          ))
        : answerText}
      {isStreaming && <span className="ov-caret" />}
    </>
  ) : (
    <span className="ov-standby-hint">
      {isRecording ? '正在聆听…' : '等待面试开始'}
    </span>
  )

  return (
    <div
      className="ov-root ov-drag"
      onMouseDown={onDragStart}
    >
      <div className={shellClass} style={{ opacity, color: fontColor }}>
        <div className="ov-grip" aria-hidden />

        {showBg && (
          <div className="ov-header">
            <span className={`ov-dot ${isRecording ? 'ov-dot--rec' : isThinking ? 'ov-dot--think' : isStreaming ? 'ov-dot--stream' : ''}`} />
            <span className="ov-status">{statusLabel}</span>
            {hasContent && questionText && (
              <span
                className="ov-question"
                style={{ fontSize: `${questionFontSize}px` }}
                title={questionText}
              >
                {questionText}
              </span>
            )}
          </div>
        )}

        <div
          ref={answerScrollRef}
          className="ov-content ov-answer"
          style={{ fontSize: `${answerFontSize}px` }}
        >
          {renderedAnswer}
        </div>
      </div>
    </div>
  )
}
