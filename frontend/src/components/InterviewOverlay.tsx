import { useEffect, useMemo } from 'react'
import { Captions, Loader2, MessageSquareQuote, Mic } from 'lucide-react'
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
    interviewOverlayLyricLines,
    interviewOverlayLyricFontSize,
    interviewOverlayLyricWidth,
    syncInterviewOverlayPrefs,
    setInterviewOverlayEnabled,
    setInterviewOverlayMode,
    setInterviewOverlayOpacity,
    setInterviewOverlayLyricLines,
    setInterviewOverlayLyricFontSize,
    setInterviewOverlayLyricWidth,
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
        setInterviewOverlayLyricLines(payload.lyricLines)
        setInterviewOverlayLyricFontSize(payload.lyricFontSize)
        setInterviewOverlayLyricWidth(payload.lyricWidth)
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
      setInterviewOverlayLyricLines(payload.lyricLines)
      setInterviewOverlayLyricFontSize(payload.lyricFontSize)
      setInterviewOverlayLyricWidth(payload.lyricWidth)
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
    setInterviewOverlayMode,
    setInterviewOverlayOpacity,
    syncInterviewOverlayPrefs,
  ])

  const waitingHint = isRecording ? '等待识别到问题…' : '开始面试后会自动出现'

  if (!interviewOverlayEnabled) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  if (interviewOverlayMode === 'lyrics') {
    return (
      <div className="h-screen w-screen bg-transparent p-2 flex items-start justify-center ia-overlay-drag">
        <div
          className="w-full px-4 py-3 space-y-1.5"
          style={{ maxWidth: `${interviewOverlayLyricWidth}px`, opacity: interviewOverlayOpacity }}
        >
          {lyricLines.length > 0 ? (
            lyricLines.map((line, index) => (
              <p
                key={`${index}-${line}`}
                className={`font-semibold tracking-[0.01em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] ${index === lyricLines.length - 1 ? 'text-text-primary' : 'text-text-secondary'}`}
                style={{ fontSize: `${interviewOverlayLyricFontSize}px`, lineHeight: 1.32 }}
              >
                {line}
                {isStreaming && index === lyricLines.length - 1 ? (
                  <span className="inline-block w-2 h-2 ml-2 rounded-full bg-accent-green animate-pulse align-middle" />
                ) : null}
              </p>
            ))
          ) : (
            <p className="text-text-secondary text-sm">
              {isRecording ? '等待识别到问题…' : '开始面试后自动显示'}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-transparent p-4 flex items-start justify-end ia-overlay-drag">
      <div
        className="ia-overlay-shell w-full max-w-[460px] rounded-[26px] text-text-primary"
        style={{ opacity: interviewOverlayOpacity }}
      >
        <div className="ia-overlay-header flex items-center gap-2 px-4 py-3 text-[11px] uppercase tracking-[0.24em] text-text-secondary">
          <MessageSquareQuote className="w-3.5 h-3.5" />
          Interview Prompt
        </div>

        <div className="px-4 py-4 space-y-4 ia-overlay-content text-sm leading-relaxed">
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-accent-blue/80">Ask</div>
            <div className="rounded-2xl border border-accent-blue/20 bg-bg-primary/12 px-3.5 py-3 text-text-primary min-h-[72px]">
              {latestQa?.question?.trim() || waitingHint}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-accent-green/80">
              <span>Answer</span>
              {isStreaming ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            </div>
            <div className="rounded-2xl border border-accent-green/20 bg-bg-primary/12 px-3.5 py-3 text-text-primary min-h-[120px] whitespace-pre-wrap break-words">
              {answerText || (latestQa ? '正在组织回答…' : waitingHint)}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
