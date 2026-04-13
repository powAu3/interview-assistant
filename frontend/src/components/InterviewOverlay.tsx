import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { applyStoredColorSchemeToDocument, COLOR_SCHEME_STORAGE_KEY } from '@/lib/colorScheme'
import {
  isInterviewOverlayStorageKey,
  warnInterviewOverlaySyncIssue,
} from '@/lib/interviewOverlay'
import { useInterviewStore } from '@/stores/configStore'

function compactAnswerText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' 代码片段 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_-]+/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitLyricLines(text: string, maxLines: number): string[] {
  const normalized = compactAnswerText(text)
  if (!normalized) return []
  const segments = normalized
    .split(/\n+|(?<=[。！？；;!?])\s*|(?<=[，、,:：])\s*/)
    .map((part) => part.trim())
    .filter(Boolean)

  const lines = (segments.length > 0 ? segments : [normalized]).flatMap((segment) => {
    if (segment.length <= 28) return [segment]
    const chunks: string[] = []
    for (let i = 0; i < segment.length; i += 28) chunks.push(segment.slice(i, i + 28))
    return chunks
  })

  return lines.slice(-maxLines)
}

export default function InterviewOverlay() {
  useInterviewWS()

  const {
    qaPairs,
    streamingIds,
    isRecording,
    interviewOverlayEnabled,
    interviewOverlayMode,
    interviewOverlayOpacity,
    interviewOverlayPanelFontSize,
    interviewOverlayPanelWidth,
    interviewOverlayPanelShowBg,
    interviewOverlayPanelFontColor,
    interviewOverlayPanelHeight,
    interviewOverlayLyricLines,
    interviewOverlayLyricFontSize,
    interviewOverlayLyricWidth,
    interviewOverlayLyricColor,
    syncInterviewOverlayPrefs,
    setInterviewOverlayEnabled,
    setInterviewOverlayMode,
    setInterviewOverlayOpacity,
    setInterviewOverlayPanelFontSize,
    setInterviewOverlayPanelWidth,
    setInterviewOverlayPanelShowBg,
    setInterviewOverlayPanelFontColor,
    setInterviewOverlayPanelHeight,
    setInterviewOverlayLyricLines,
    setInterviewOverlayLyricFontSize,
    setInterviewOverlayLyricWidth,
    setInterviewOverlayLyricColor,
  } = useInterviewStore()

  const latestQa = useMemo(() => {
    if (streamingIds.length > 0) {
      const currentId = streamingIds[streamingIds.length - 1]
      const active = qaPairs.find((item) => item.id === currentId)
      if (active) return active
    }
    return qaPairs[qaPairs.length - 1] ?? null
  }, [qaPairs, streamingIds])

  const waitingHint = isRecording ? '等待识别到问题…' : '开始面试后会自动出现'
  const questionText = latestQa?.question?.trim() || waitingHint
  const answerText =
    latestQa?.answer === '[已取消]'
      ? '上一条回答已取消'
      : latestQa?.answer?.trim() || (latestQa ? (latestQa.isThinking ? '思考中…' : '正在组织回答…') : waitingHint)
  const isStreaming = latestQa ? streamingIds.includes(latestQa.id) : false
  const lyricLines = useMemo(
    () => splitLyricLines(answerText, interviewOverlayLyricLines),
    [answerText, interviewOverlayLyricLines],
  )

  useEffect(() => {
    document.body.classList.add('overlay-window')
    applyStoredColorSchemeToDocument()
    return () => {
      document.body.classList.remove('overlay-window')
    }
  }, [])

  useEffect(() => {
    syncInterviewOverlayPrefs()
    window.electronAPI?.getOverlayState?.()
      .then((payload) => {
        if (!payload) return
        setInterviewOverlayEnabled(payload.enabled)
        setInterviewOverlayMode(payload.mode)
        setInterviewOverlayOpacity(payload.opacity)
        setInterviewOverlayPanelFontSize(payload.panelFontSize)
        setInterviewOverlayPanelWidth(payload.panelWidth)
        setInterviewOverlayPanelShowBg(payload.panelShowBg)
        setInterviewOverlayPanelFontColor(payload.panelFontColor)
        setInterviewOverlayPanelHeight(payload.panelHeight)
        setInterviewOverlayLyricLines(payload.lyricLines)
        setInterviewOverlayLyricFontSize(payload.lyricFontSize)
        setInterviewOverlayLyricWidth(payload.lyricWidth)
        setInterviewOverlayLyricColor(payload.lyricColor)
      })
      .catch((error) => {
        warnInterviewOverlaySyncIssue('failed to read overlay state during bootstrap', error)
      })

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === COLOR_SCHEME_STORAGE_KEY) {
        applyStoredColorSchemeToDocument()
      }
      if (!event.key || isInterviewOverlayStorageKey(event.key)) {
        syncInterviewOverlayPrefs()
      }
    }

    window.addEventListener('storage', onStorage)
    window.electronAPI?.onOverlayState?.((payload) => {
      setInterviewOverlayEnabled(payload.enabled)
      setInterviewOverlayMode(payload.mode)
      setInterviewOverlayOpacity(payload.opacity)
      setInterviewOverlayPanelFontSize(payload.panelFontSize)
      setInterviewOverlayPanelWidth(payload.panelWidth)
      setInterviewOverlayPanelShowBg(payload.panelShowBg)
      setInterviewOverlayPanelFontColor(payload.panelFontColor)
      setInterviewOverlayPanelHeight(payload.panelHeight)
      setInterviewOverlayLyricLines(payload.lyricLines)
      setInterviewOverlayLyricFontSize(payload.lyricFontSize)
      setInterviewOverlayLyricWidth(payload.lyricWidth)
      setInterviewOverlayLyricColor(payload.lyricColor)
    })

    return () => {
      window.removeEventListener('storage', onStorage)
      window.electronAPI?.removeOverlayStateListener?.()
    }
  }, [
    setInterviewOverlayEnabled,
    setInterviewOverlayLyricFontSize,
    setInterviewOverlayLyricLines,
    setInterviewOverlayLyricWidth,
    setInterviewOverlayLyricColor,
    setInterviewOverlayMode,
    setInterviewOverlayOpacity,
    setInterviewOverlayPanelFontSize,
    setInterviewOverlayPanelFontColor,
    setInterviewOverlayPanelHeight,
    setInterviewOverlayPanelWidth,
    setInterviewOverlayPanelShowBg,
    syncInterviewOverlayPrefs,
  ])

  const dragOrigin = useRef<{ x: number; y: number } | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => dragCleanupRef.current?.()
  }, [])

  const onDragStart = useCallback((e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('.ia-overlay-content')) return
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

  if (!interviewOverlayEnabled) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  if (interviewOverlayMode === 'lyrics') {
    const secondaryColor = `${interviewOverlayLyricColor}99`
    return (
      <div className="h-screen w-screen bg-transparent flex items-start justify-center ia-overlay-drag" style={{ padding: 0 }} onMouseDown={onDragStart}>
        <div
          className="w-full px-4 py-1.5"
          style={{ maxWidth: `${interviewOverlayLyricWidth}px`, opacity: interviewOverlayOpacity }}
        >
          {lyricLines.length > 0 ? (
            lyricLines.map((line, index) => (
              <p
                key={`${index}-${line}`}
                style={{
                  margin: 0,
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  fontSize: `${interviewOverlayLyricFontSize}px`,
                  lineHeight: 1.26,
                  color: index === lyricLines.length - 1 ? interviewOverlayLyricColor : secondaryColor,
                  textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                }}
              >
                {line}
                {isStreaming && index === lyricLines.length - 1 ? (
                  <span className="inline-block w-2 h-2 ml-2 rounded-full bg-accent-green animate-pulse align-middle" />
                ) : null}
              </p>
            ))
          ) : (
            <p style={{ color: secondaryColor, fontSize: '13px', margin: 0 }}>
              {waitingHint}
            </p>
          )}
        </div>
      </div>
    )
  }

  const shellClassName = interviewOverlayPanelShowBg
    ? 'ia-overlay-shell rounded-xl'
    : 'rounded-xl border border-white/10 bg-black/10 backdrop-blur-[6px]'

  return (
    <div className="h-screen w-screen bg-transparent flex items-start justify-end ia-overlay-drag" style={{ padding: 12 }} onMouseDown={onDragStart}>
      <div
          className={shellClassName}
          style={{
          opacity: interviewOverlayOpacity,
          width: `${interviewOverlayPanelWidth}px`,
          height: interviewOverlayPanelHeight > 0 ? `${interviewOverlayPanelHeight}px` : undefined,
          color: interviewOverlayPanelFontColor,
          minWidth: '220px',
          maxWidth: '100vw',
        }}
      >
        <div className="ia-overlay-header flex items-center gap-1.5 px-2.5 py-1 text-[8px] uppercase tracking-[0.12em] text-text-muted/55">
          <span>overlay</span>
          {isStreaming ? <Loader2 className="ml-auto w-3 h-3 animate-spin text-accent-green" /> : null}
        </div>
        <div
          className="ia-overlay-content px-2.5 py-2 space-y-2"
          style={{
            fontSize: `${interviewOverlayPanelFontSize}px`,
            overflowY: 'auto',
            maxHeight: interviewOverlayPanelHeight > 0 ? `${interviewOverlayPanelHeight - 36}px` : '100vh',
          }}
        >
          <div className="rounded-md border border-bg-hover/12 bg-bg-primary/8 px-2.5 py-1.5 leading-relaxed">
            <span className="mr-1.5 text-[10px] font-medium text-text-muted/60">问题：</span>
            <span style={{ fontSize: `${Math.max(interviewOverlayPanelFontSize - 1, 11)}px` }}>{questionText}</span>
          </div>
          <div
            className="rounded-md border border-bg-hover/12 bg-bg-primary/8 px-2.5 py-1.75 leading-relaxed whitespace-pre-wrap break-words"
            style={{ fontSize: `${Math.max(interviewOverlayPanelFontSize + 1, 13)}px`, lineHeight: 1.5 }}
          >
            <span className="mr-1.5 text-[10px] font-medium text-text-muted/60">回答：</span>
            {answerText}
          </div>
        </div>
      </div>
    </div>
  )
}
