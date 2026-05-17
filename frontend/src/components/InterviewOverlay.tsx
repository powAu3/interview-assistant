import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
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
  const config = useInterviewStore((s) => s.config)
  const isExamMode = config?.written_exam_mode === true
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

  const answerText =
    latestQa?.answer === '[已取消]'
      ? '上一条回答已取消'
      : latestQa?.answer?.trim() || (latestQa ? (latestQa.isThinking ? '思考中…' : '正在组织回答…') : '')
  const isStreaming = latestQa ? streamingIds.includes(latestQa.id) : false
  const hasContent = Boolean(latestQa)

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

  const suppressMouseSelection = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const selection = window.getSelection?.()
    if (selection && selection.rangeCount > 0) {
      selection.removeAllRanges()
    }
  }, [])

  if (!enabled) {
    return <div className="h-screen w-screen bg-transparent" />
  }

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
    <span className="ov-standby-hint" style={{ fontSize: `${answerFontSize}px` }}>
      {isRecording ? (isExamMode ? '笔试中…' : '正在聆听…') : (isExamMode ? '点击开始笔试' : '等待面试开始')}
    </span>
  )

  return (
    <div
      className="ov-root"
    >
      <div className={shellClass} style={{ opacity, color: fontColor }}>
        <div className="ov-grip" aria-hidden />

        <div
          ref={answerScrollRef}
          className="ov-content ov-answer"
          style={{ fontSize: `${answerFontSize}px` }}
          onMouseDown={suppressMouseSelection}
        >
          {renderedAnswer}
        </div>
      </div>
    </div>
  )
}
