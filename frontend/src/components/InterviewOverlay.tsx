import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Loader2, Mic } from 'lucide-react'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { applyStoredColorSchemeToDocument, COLOR_SCHEME_STORAGE_KEY } from '@/lib/colorScheme'
import {
  isInterviewOverlayStorageKey,
  warnInterviewOverlaySyncIssue,
} from '@/lib/interviewOverlay'
import { useInterviewStore } from '@/stores/configStore'

function compactAnswerText(text: string): string {
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
    for (let i = 0; i < segment.length; i += 28) {
      chunks.push(segment.slice(i, i + 28))
    }
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
  const isStreaming = latestQa ? streamingIds.includes(latestQa.id) : false
  const answerText = latestQa?.answer === '[已取消]' ? '上一条回答已取消' : latestQa?.answer?.trim() || ''
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

  const waitingHint = isRecording ? '等待识别到问题…' : '开始面试后会自动出现'

  const dragOrigin = useRef<{ x: number; y: number } | null>(null)

  const onDragStart = useCallback((e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('.ia-overlay-content')) return
    e.preventDefault()
    dragOrigin.current = { x: e.screenX, y: e.screenY }
    window.electronAPI?.overlayDragStart?.()

    const onMove = (ev: globalThis.MouseEvent) => {
      if (!dragOrigin.current) return
      const dx = ev.screenX - dragOrigin.current.x
      const dy = ev.screenY - dragOrigin.current.y
      dragOrigin.current = { x: ev.screenX, y: ev.screenY }
      window.electronAPI?.moveOverlayWindow?.(dx, dy)
    }
    const onUp = () => {
      dragOrigin.current = null
      window.electronAPI?.overlayDragEnd?.()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const handlePanelResize = useCallback(() => {
    const el = panelRef.current
    if (!el) return
    const w = el.offsetWidth
    if (w !== interviewOverlayPanelWidth) setInterviewOverlayPanelWidth(w)
  }, [interviewOverlayPanelWidth, setInterviewOverlayPanelWidth])

  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(() => handlePanelResize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [handlePanelResize])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [answerText])

  if (!interviewOverlayEnabled) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  if (interviewOverlayMode === 'lyrics') {
    const dimColor = interviewOverlayLyricColor + '99'
    const hasContent = lyricLines.length > 0
    return (
      <div className="h-screen w-screen bg-transparent flex items-start justify-center ia-overlay-drag" style={{ padding: 0 }} onMouseDown={onDragStart}>
        {hasContent ? (
          <div style={{ maxWidth: `${interviewOverlayLyricWidth}px`, opacity: interviewOverlayOpacity, width: '100%' }}>
            {lyricLines.map((line, index) => (
              <p
                key={`${index}-${line}`}
                style={{
                  margin: 0,
                  padding: 0,
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  fontSize: `${interviewOverlayLyricFontSize}px`,
                  lineHeight: 1.32,
                  color: index === lyricLines.length - 1 ? interviewOverlayLyricColor : dimColor,
                  textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                }}
              >
                {line}
                {isStreaming && index === lyricLines.length - 1 ? (
                  <span className="inline-block w-2 h-2 ml-2 rounded-full bg-accent-green animate-pulse align-middle" />
                ) : null}
              </p>
            ))}
          </div>
        ) : (
          <p style={{ color: dimColor, fontSize: '13px', margin: 0, opacity: interviewOverlayOpacity }}>
            {isRecording ? '等待识别到问题…' : '开始面试后自动显示'}
          </p>
        )}
      </div>
    )
  }

  const panelShellClass = interviewOverlayPanelShowBg
    ? 'ia-overlay-shell rounded-xl ia-overlay-resize'
    : 'ia-overlay-resize'

  return (
    <div className="h-screen w-screen bg-transparent flex items-start justify-end ia-overlay-drag" style={{ padding: 0 }} onMouseDown={onDragStart}>
      <div
        ref={panelRef}
        className={panelShellClass}
        style={{
          opacity: interviewOverlayOpacity,
          width: `${interviewOverlayPanelWidth}px`,
          height: interviewOverlayPanelHeight > 0 ? `${interviewOverlayPanelHeight}px` : undefined,
          fontSize: `${interviewOverlayPanelFontSize}px`,
          color: interviewOverlayPanelFontColor,
          minWidth: '180px',
          maxWidth: '100vw',
        }}
      >
        <div
          ref={scrollRef}
          className="px-3 py-2 space-y-1 leading-relaxed ia-overlay-content"
          style={{ overflowY: 'auto', maxHeight: interviewOverlayPanelHeight > 0 ? `${interviewOverlayPanelHeight}px` : '100vh' }}
        >
          <div
            className="truncate"
            style={{
              fontSize: `${Math.max(8, interviewOverlayPanelFontSize - 2)}px`,
              opacity: 0.7,
              textShadow: interviewOverlayPanelShowBg ? undefined : '0 1px 3px rgba(0,0,0,0.6)',
            }}
          >
            <Mic className="inline w-3 h-3 mr-1 align-[-2px]" />
            {latestQa?.question?.trim() || waitingHint}
          </div>
          <div
            className="whitespace-pre-wrap break-words"
            style={{
              textShadow: interviewOverlayPanelShowBg ? undefined : '0 1px 4px rgba(0,0,0,0.7)',
            }}
          >
            {isStreaming && <Loader2 className="inline w-3 h-3 mr-1 animate-spin align-[-2px] text-accent-green" />}
            {answerText || (latestQa ? '正在组织回答…' : waitingHint)}
          </div>
        </div>
      </div>
    </div>
  )
}
