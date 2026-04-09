import { useEffect, useMemo } from 'react'
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
    setInterviewOverlayPanelWidth,
    syncInterviewOverlayPrefs,
  ])

  const waitingHint = isRecording ? '等待识别到问题…' : '开始面试后会自动出现'

  if (!interviewOverlayEnabled) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  if (interviewOverlayMode === 'lyrics') {
    const dimColor = interviewOverlayLyricColor + '99'
    return (
      <div className="h-screen w-screen bg-transparent p-1 flex items-start justify-center ia-overlay-drag">
        <div
          className="w-full space-y-0.5"
          style={{ maxWidth: `${interviewOverlayLyricWidth}px`, opacity: interviewOverlayOpacity }}
        >
          {lyricLines.length > 0 ? (
            lyricLines.map((line, index) => (
              <p
                key={`${index}-${line}`}
                className="font-semibold tracking-[0.01em]"
                style={{
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
            ))
          ) : (
            <p style={{ color: dimColor, fontSize: '13px' }}>
              {isRecording ? '等待识别到问题…' : '开始面试后自动显示'}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-transparent p-2 flex items-start justify-end ia-overlay-drag">
      <div
        className="ia-overlay-shell w-full rounded-xl text-text-primary"
        style={{ opacity: interviewOverlayOpacity, maxWidth: `${interviewOverlayPanelWidth}px`, fontSize: `${interviewOverlayPanelFontSize}px` }}
      >
        <div className="px-3 py-2 space-y-1.5 ia-overlay-content leading-relaxed">
          <div className="text-text-secondary/60 truncate" style={{ fontSize: `${Math.max(10, interviewOverlayPanelFontSize - 2)}px` }}>
            <Mic className="inline w-3 h-3 mr-1 align-[-2px]" />
            {latestQa?.question?.trim() || waitingHint}
          </div>

          <div className="whitespace-pre-wrap break-words text-text-primary">
            {isStreaming && <Loader2 className="inline w-3 h-3 mr-1 animate-spin align-[-2px] text-accent-green" />}
            {answerText || (latestQa ? '正在组织回答…' : waitingHint)}
          </div>
        </div>
      </div>
    </div>
  )
}
