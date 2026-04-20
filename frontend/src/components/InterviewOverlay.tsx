import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { applyStoredColorSchemeToDocument, COLOR_SCHEME_STORAGE_KEY } from '@/lib/colorScheme'
import {
  isInterviewOverlayStorageKey,
  warnInterviewOverlaySyncIssue,
} from '@/lib/interviewOverlay'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

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

  const qaPairs = useInterviewStore((s) => s.qaPairs)
  const streamingIds = useInterviewStore((s) => s.streamingIds)
  const isRecording = useInterviewStore((s) => s.isRecording)
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
  const syncInterviewOverlayPrefs = useUiPrefsStore((s) => s.syncInterviewOverlayPrefs)
  const applyInterviewOverlayState = useUiPrefsStore((s) => s.applyInterviewOverlayState)

  const latestQa = useMemo(() => {
    if (streamingIds.length > 0) {
      const currentId = streamingIds[streamingIds.length - 1]
      const active = qaPairs.find((item) => item.id === currentId)
      if (active) return active
    }
    return qaPairs[qaPairs.length - 1] ?? null
  }, [qaPairs, streamingIds])

  const waitingHint = isRecording ? 'listening…' : 'standby'
  const questionText = latestQa?.question?.trim() || ''
  const answerText =
    latestQa?.answer === '[已取消]'
      ? '上一条回答已取消'
      : latestQa?.answer?.trim() || (latestQa ? (latestQa.isThinking ? '思考中…' : '正在组织回答…') : '')
  const isStreaming = latestQa ? streamingIds.includes(latestQa.id) : false
  const hasContent = Boolean(latestQa)
  const lyricLines = useMemo(
    () => splitLyricLines(answerText, interviewOverlayLyricLines),
    [answerText, interviewOverlayLyricLines],
  )

  // 流式时自动滚到底（panel 模式），让用户始终看到最新答案。
  // useLayoutEffect 避免视觉跳动；deps 含 answerText 才能跟随增量更新。
  const answerScrollRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!isStreaming) return
    const el = answerScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [answerText, isStreaming])

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
        applyInterviewOverlayState(payload)
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
    const removeOverlayListener = window.electronAPI?.onOverlayState?.((payload) => {
      applyInterviewOverlayState(payload)
    })

    return () => {
      window.removeEventListener('storage', onStorage)
      removeOverlayListener?.()
    }
  }, [applyInterviewOverlayState, syncInterviewOverlayPrefs])

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

  // ===== Lyrics 模式：teleprompter 风格 =====
  // - 历史行 opacity 渐弱，最新行 100% + 流式光标
  // - 文字描边保证任意桌面背景可读
  // - 居中顶部对齐，最大化「眼角扫过」体验
  if (interviewOverlayMode === 'lyrics') {
    const lastIdx = lyricLines.length - 1
    return (
      <div
        className="h-screen w-screen bg-transparent flex items-start justify-center ia-overlay-drag"
        onMouseDown={onDragStart}
      >
        <div
          className="w-full px-4 py-2"
          style={{ maxWidth: `${interviewOverlayLyricWidth}px`, opacity: interviewOverlayOpacity }}
        >
          {lyricLines.length > 0 ? (
            lyricLines.map((line, index) => {
              // 历史行 fade：基于到 latest 的距离衰减 (0.45 → 1.0)
              const distFromLast = lastIdx - index
              const opacity = Math.max(0.45, 1 - distFromLast * 0.18)
              const isLast = index === lastIdx
              return (
                <p
                  key={`${index}-${line}`}
                  style={{
                    margin: 0,
                    fontWeight: isLast ? 600 : 500,
                    letterSpacing: '0.01em',
                    fontSize: `${interviewOverlayLyricFontSize}px`,
                    lineHeight: 1.32,
                    color: interviewOverlayLyricColor,
                    opacity,
                    textShadow: '0 1px 3px rgba(0,0,0,0.85), 0 0 12px rgba(0,0,0,0.45)',
                    transition: 'opacity 220ms ease-out',
                  }}
                >
                  {line}
                  {isStreaming && isLast ? <span className="ia-overlay-caret" /> : null}
                </p>
              )
            })
          ) : (
            <p
              className="ia-overlay-waiting"
              style={{
                color: interviewOverlayLyricColor,
                opacity: 0.45,
                fontSize: `${Math.max(13, Math.round(interviewOverlayLyricFontSize * 0.55))}px`,
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span className="ia-overlay-pulse" />
              {waitingHint}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ===== Panel 模式：HUD 卡片 =====
  // 三层信息：状态条 (问题 + 流式脉冲) → 答案主文 → 拖拽手柄
  // 紧贴右上角，最小 chrome，最大内容密度
  const panelHeight = interviewOverlayPanelHeight > 0 ? interviewOverlayPanelHeight : undefined
  const answerFontSize = Math.max(13, interviewOverlayPanelFontSize + 1)
  const questionFontSize = Math.max(11, interviewOverlayPanelFontSize - 1)

  const shellClassName = interviewOverlayPanelShowBg
    ? 'ia-overlay-shell relative rounded-2xl flex flex-col'
    : 'relative rounded-2xl flex flex-col border border-white/8 bg-black/20 backdrop-blur-[8px]'

  return (
    <div
      className="h-screen w-screen bg-transparent flex items-start justify-end ia-overlay-drag"
      style={{ padding: 10 }}
      onMouseDown={onDragStart}
    >
      <div
        className={shellClassName}
        style={{
          opacity: interviewOverlayOpacity,
          width: `${interviewOverlayPanelWidth}px`,
          height: panelHeight ? `${panelHeight}px` : undefined,
          color: interviewOverlayPanelFontColor,
          minWidth: '240px',
          maxWidth: '100vw',
        }}
      >
        <div className="ia-overlay-grip" aria-hidden />

        {/* 状态条：问题 + 流式脉冲（hasContent 时才显示） */}
        {hasContent ? (
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
            <span
              className="ia-overlay-question flex-1"
              style={{ fontSize: `${questionFontSize}px`, color: `${interviewOverlayPanelFontColor}99` }}
              title={questionText || undefined}
            >
              {questionText || '—'}
            </span>
            {isStreaming ? <span className="ia-overlay-pulse flex-shrink-0" /> : null}
          </div>
        ) : null}

        {/* 答案主体或等待态 */}
        <div
          ref={answerScrollRef}
          className="ia-overlay-answer ia-overlay-content flex-1 px-3.5 pb-3.5"
          style={{
            fontSize: `${answerFontSize}px`,
            color: interviewOverlayPanelFontColor,
            paddingTop: hasContent ? 0 : 18,
            maxHeight: panelHeight ? `${panelHeight - (hasContent ? 44 : 18)}px` : undefined,
          }}
        >
          {hasContent ? (
            <>
              {answerText}
              {isStreaming ? <span className="ia-overlay-caret" /> : null}
            </>
          ) : (
            <div className="flex items-center gap-2.5 h-full" style={{ minHeight: 24 }}>
              <span className="ia-overlay-pulse" />
              <span className="ia-overlay-waiting">{waitingHint}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
