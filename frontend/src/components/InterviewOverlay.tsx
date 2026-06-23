import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { useInterviewWS } from '@/hooks/useInterviewWS'
import { applyStoredColorSchemeToDocument, COLOR_SCHEME_STORAGE_KEY } from '@/lib/colorScheme'
import { api, getErrorMessage } from '@/lib/api'
import {
  isInterviewOverlayStorageKey,
  warnInterviewOverlaySyncIssue,
} from '@/lib/interviewOverlay'
import { getShortcutDisplay } from '@/lib/shortcuts'
import { useInterviewStore } from '@/stores/configStore'
import { useShortcutsStore } from '@/stores/shortcutsStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

type FocusTabPane = {
  key: string
  label: string
  content: string
  isGenerating?: boolean
}

const FOCUS_TAB_CACHE_LIMIT = 20
const FOCUS_TEXT_COLOR = '#263241'

const OVERLAY_MARKDOWN_COMPONENTS: Components = {
  a({ children }) {
    return <span>{children}</span>
  },
  pre({ children }) {
    return <pre className="ov-code-block">{children}</pre>
  },
  code({ className, children }) {
    return <code className={className ? `ov-code ${className}` : 'ov-code'}>{children}</code>
  },
}

export default function InterviewOverlay() {
  useInterviewWS()

  const qaPairs = useInterviewStore((s) => s.qaPairs)
  const streamingIds = useInterviewStore((s) => s.streamingIds)
  const isRecording = useInterviewStore((s) => s.isRecording)
  const clearSession = useInterviewStore((s) => s.clearSession)
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)
  const config = useInterviewStore((s) => s.config)
  const shortcuts = useShortcutsStore((s) => s.shortcuts)
  const setShortcuts = useShortcutsStore((s) => s.setShortcuts)
  const isExamMode = config?.written_exam_mode === true
  const enabled = useUiPrefsStore((s) => s.interviewOverlayEnabled)
  const opacity = useUiPrefsStore((s) => s.interviewOverlayOpacity)
  const fontSize = useUiPrefsStore((s) => s.interviewOverlayFontSize)
  const fontColor = useUiPrefsStore((s) => s.interviewOverlayFontColor)
  const overlayMode = useUiPrefsStore((s) => s.interviewOverlayMode)
  const maxLines = useUiPrefsStore((s) => s.interviewOverlayMaxLines)
  const overlayPromptMaxWidth = useUiPrefsStore((s) => s.interviewOverlayPromptMaxWidth)
  const syncPrefs = useUiPrefsStore((s) => s.syncInterviewOverlayPrefs)
  const applyState = useUiPrefsStore((s) => s.applyInterviewOverlayState)
  const [activeFocusTabsByQaId, setActiveFocusTabsByQaId] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [reviewQaId, setReviewQaId] = useState<string | null>(null)
  const [liveFocusQaId, setLiveFocusQaId] = useState<string | null>(null)
  const pinnedFocusTabsByQaIdRef = useRef<Record<string, boolean>>({})

  const latestQa = useMemo(() => {
    if (streamingIds.length > 0) {
      const currentId = streamingIds[streamingIds.length - 1]
      const active = qaPairs.find((item) => item.id === currentId)
      if (active) return active
    }
    return qaPairs[qaPairs.length - 1] ?? null
  }, [qaPairs, streamingIds])
  const liveFocusQa = useMemo(
    () => (liveFocusQaId ? qaPairs.find((item) => item.id === liveFocusQaId) : null),
    [liveFocusQaId, qaPairs],
  )
  const displayedQa = useMemo(
    () => (reviewQaId ? qaPairs.find((item) => item.id === reviewQaId) : null) ?? liveFocusQa ?? latestQa,
    [latestQa, liveFocusQa, qaPairs, reviewQaId],
  )
  const displayedQaIndex = displayedQa ? qaPairs.findIndex((item) => item.id === displayedQa.id) : -1
  const isReviewingHistory = Boolean(reviewQaId && displayedQa)

  const answerText =
    displayedQa?.status === 'cancelled'
      ? '上一条回答已取消'
      : displayedQa?.status === 'error'
        ? `保存失败: ${displayedQa.errorMessage || '未知原因'}`
        : displayedQa?.answer?.trim() || (displayedQa ? (displayedQa.isThinking ? '思考中…' : '正在组织回答…') : '')
  const isStreaming = displayedQa ? streamingIds.includes(displayedQa.id) : false
  const hasContent = Boolean(displayedQa)
  const liveGeneratingQa = useMemo(
    () => qaPairs.find((item) => item.id !== displayedQa?.id && streamingIds.includes(item.id)) ?? null,
    [displayedQa?.id, qaPairs, streamingIds],
  )
  const focusTabs = useMemo(
    () => buildFocusTabs(answerText, displayedQa?.question ?? '', isStreaming),
    [answerText, displayedQa?.question, isStreaming],
  )
  const displayedQaKey = displayedQa?.id ?? '__empty__'
  const retainedFocusQaIds = useMemo(
    () => getRetainedFocusQaIds(qaPairs.map((item) => item.id), displayedQa?.id ?? null, streamingIds),
    [displayedQa?.id, qaPairs, streamingIds],
  )
  const activeFocusTab = activeFocusTabsByQaId[displayedQaKey] ?? focusTabs[0]?.key ?? 'answer'
  const activeSection = focusTabs.find((tab) => tab.key === activeFocusTab) ?? focusTabs[0]

  const overlayAnswerSlice = useMemo(() => sliceMaxLines(answerText, maxLines), [answerText, maxLines])

  const answerScrollRef = useRef<HTMLDivElement | null>(null)
  const answerAutoFollowRef = useRef(true)
  const updateAnswerAutoFollow = useCallback(() => {
    const el = answerScrollRef.current
    if (!el) return
    answerAutoFollowRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 28
  }, [])

  useEffect(() => {
    answerAutoFollowRef.current = true
  }, [displayedQaKey, overlayMode, activeFocusTab])

  useLayoutEffect(() => {
    if (!isStreaming) return
    const el = answerScrollRef.current
    if (!el) return
    if (!answerAutoFollowRef.current) return
    el.scrollTop = el.scrollHeight
  }, [answerText, activeFocusTab, isStreaming])

  useLayoutEffect(() => {
    if (!enabled || overlayMode !== 'prompt') return
    const el = answerScrollRef.current
    if (!el) return
    const contentEl = el.querySelector<HTMLElement>('.ov-markdown') ?? el
    const contentWidth = Math.ceil(Math.max(
      contentEl.scrollWidth,
      contentEl.getBoundingClientRect().width,
      el.scrollWidth,
    ))
    const contentHeight = Math.ceil(el.scrollHeight)
    const nextWidth = Math.max(180, Math.min(overlayPromptMaxWidth, contentWidth + 16))
    const nextHeight = Math.max(72, Math.min(420, contentHeight + 12))
    window.electronAPI?.resizeOverlayWindow?.({ width: nextWidth, height: nextHeight })?.catch(() => {})
  }, [answerText, enabled, fontSize, hasContent, maxLines, overlayMode, overlayAnswerSlice.text, overlayPromptMaxWidth])

  const refreshShortcuts = useCallback(() => {
    window.electronAPI?.getShortcuts?.()
      .then((nextShortcuts) => { setShortcuts(nextShortcuts) })
      .catch(() => {})
  }, [setShortcuts])

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
    refreshShortcuts()

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === COLOR_SCHEME_STORAGE_KEY) applyStoredColorSchemeToDocument()
      if (!event.key || isInterviewOverlayStorageKey(event.key)) syncPrefs()
    }
    window.addEventListener('storage', onStorage)
    const removeOverlayListener = window.electronAPI?.onOverlayState?.((payload) => { applyState(payload) })
    const removeShortcutsListener = window.electronAPI?.onShortcuts?.((nextShortcuts) => { setShortcuts(nextShortcuts) })
    return () => {
      window.removeEventListener('storage', onStorage)
      removeOverlayListener?.()
      removeShortcutsListener?.()
    }
  }, [applyState, refreshShortcuts, setShortcuts, syncPrefs])

  const suppressMouseSelection = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const selection = window.getSelection?.()
    if (selection && selection.rangeCount > 0) {
      selection.removeAllRanges()
    }
  }, [])

  const suppressToolbarMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
  }, [])

  const runOverlayAction = useCallback(async (action: 'screen' | 'cancel' | 'clear' | 'hide') => {
    if (busyAction) return
    setBusyAction(action)
    try {
      if (action === 'screen') {
        await api.askFromServerScreen()
        setToastMessage('已提交截图审题')
      } else if (action === 'cancel') {
        await api.cancelAsk()
        setToastMessage('已取消生成')
      } else if (action === 'clear') {
        await api.clear()
        clearSession()
        setToastMessage('已清空')
      } else {
        await window.electronAPI?.syncOverlayWindow?.({ visible: false })
      }
    } catch (error) {
      setToastMessage(getErrorMessage(error, '操作失败'))
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, clearSession, setToastMessage])

  useEffect(() => {
    if (reviewQaId && !qaPairs.some((item) => item.id === reviewQaId)) {
      setReviewQaId(null)
    }
  }, [qaPairs, reviewQaId])

  useEffect(() => {
    if (reviewQaId) return
    setLiveFocusQaId((current) => {
      const currentStillLive = Boolean(
        current
        && streamingIds.includes(current)
        && qaPairs.some((item) => item.id === current),
      )
      if (currentStillLive) return current
      return latestQa?.id ?? null
    })
  }, [latestQa?.id, qaPairs, reviewQaId, streamingIds])

  useEffect(() => {
    setActiveFocusTabsByQaId((current) => {
      const next = pruneFocusTabCache(current, retainedFocusQaIds)
      return next === current ? current : next
    })

    const pinnedTabs = pinnedFocusTabsByQaIdRef.current
    for (const qaId of Object.keys(pinnedTabs)) {
      if (!retainedFocusQaIds.has(qaId)) delete pinnedTabs[qaId]
    }
  }, [retainedFocusQaIds])

  useEffect(() => {
    if (!focusTabs.length) return
    if (!focusTabs.some((tab) => tab.key === activeFocusTab)) {
      pinnedFocusTabsByQaIdRef.current[displayedQaKey] = false
      setActiveFocusTabsByQaId((current) => {
        if (current[displayedQaKey] === focusTabs[0].key) return current
        return pruneFocusTabCache({ ...current, [displayedQaKey]: focusTabs[0].key }, retainedFocusQaIds)
      })
      return
    }
    if (isStreaming && !pinnedFocusTabsByQaIdRef.current[displayedQaKey]) {
      const latestGeneratingTab = [...focusTabs].reverse().find((tab) => tab.isGenerating)
      if (latestGeneratingTab && latestGeneratingTab.key !== activeFocusTab) {
        setActiveFocusTabsByQaId((current) => ({
          ...pruneFocusTabCache(current, retainedFocusQaIds),
          ...(retainedFocusQaIds.has(displayedQaKey) ? { [displayedQaKey]: latestGeneratingTab.key } : {}),
        }))
      }
    }
  }, [activeFocusTab, displayedQaKey, focusTabs, isStreaming, retainedFocusQaIds])

  const moveFocusTab = useCallback((direction: 'prev' | 'next') => {
    pinnedFocusTabsByQaIdRef.current[displayedQaKey] = true
    setActiveFocusTabsByQaId((currentTabs) => {
      if (!focusTabs.length) return currentTabs
      const current = currentTabs[displayedQaKey] ?? focusTabs[0]?.key ?? 'answer'
      const currentIndex = Math.max(0, focusTabs.findIndex((tab) => tab.key === current))
      const delta = direction === 'next' ? 1 : -1
      const nextIndex = (currentIndex + delta + focusTabs.length) % focusTabs.length
      const nextKey = focusTabs[nextIndex]?.key ?? current
      return pruneFocusTabCache({ ...currentTabs, [displayedQaKey]: nextKey }, retainedFocusQaIds)
    })
  }, [displayedQaKey, focusTabs, retainedFocusQaIds])

  const moveOverlayQuestion = useCallback((direction: 'prev' | 'next') => {
    if (qaPairs.length < 2) return
    setReviewQaId((currentReviewId) => {
      const baseId = currentReviewId ?? displayedQa?.id ?? latestQa?.id ?? qaPairs[qaPairs.length - 1]?.id
      const currentIndex = Math.max(0, qaPairs.findIndex((item) => item.id === baseId))
      const delta = direction === 'next' ? 1 : -1
      const nextIndex = Math.max(0, Math.min(qaPairs.length - 1, currentIndex + delta))
      const nextId = qaPairs[nextIndex]?.id ?? baseId
      return nextId === liveFocusQaId ? null : nextId
    })
  }, [displayedQa?.id, latestQa?.id, liveFocusQaId, qaPairs])

  useEffect(() => {
    return window.electronAPI?.onFocusTabCommand?.((direction) => { moveFocusTab(direction) })
  }, [moveFocusTab])

  useEffect(() => {
    return window.electronAPI?.onOverlayQuestionCommand?.((direction) => { moveOverlayQuestion(direction) })
  }, [moveOverlayQuestion])

  if (!enabled) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  const answerFontSize = Math.max(12, fontSize)
  const shellClass = `ov-shell ${overlayMode === 'focus' ? 'ov-shell--focus' : overlayMode === 'prompt' ? 'ov-shell--nobg' : 'ov-shell--bg'}`
  const focusSurfaceAlpha = Math.max(0.1, Math.min(0.95, opacity))
  const focusShellStyle = {
    '--ov-focus-bg-alpha': String(focusSurfaceAlpha),
    '--ov-focus-toolbar-alpha': String(Math.max(0.08, Math.min(0.42, focusSurfaceAlpha * 0.48))),
    '--ov-focus-tabs-alpha': String(Math.max(0.12, Math.min(0.58, focusSurfaceAlpha * 0.7))),
    '--ov-focus-key-alpha': String(Math.max(0.2, Math.min(0.76, focusSurfaceAlpha * 0.86))),
  } as CSSProperties
  const focusTools = [
    { key: 'screen' as const, label: '截图审题', shortcut: shortcuts.askFromServerScreen?.key },
    { key: 'cancel' as const, label: '取消生成', shortcut: shortcuts.cancelAnswer?.key },
    { key: 'clear' as const, label: '清空重来', shortcut: shortcuts.hardClearSession?.key },
    { key: 'hide' as const, label: '隐藏面板', shortcut: shortcuts.toggleInterviewOverlay?.key },
  ]

  const renderedAnswer = hasContent ? (
    <>
      {displayedQa && qaPairs.length > 1 && (
        <div className="ov-review-line">
          {isReviewingHistory ? '回看' : '当前'} {displayedQaIndex + 1}/{qaPairs.length} · {displayedQa.question}
        </div>
      )}
      <OverlayMarkdown content={overlayAnswerSlice.text} />
      {isStreaming && <span className="ov-caret" />}
    </>
  ) : (
    <span className="ov-standby-hint" style={{ fontSize: `${answerFontSize}px` }}>
      {isRecording ? (isExamMode ? '笔试中…' : '正在聆听…') : (isExamMode ? '点击开始笔试' : '等待面试开始')}
    </span>
  )

  if (overlayMode === 'focus') {
    return (
      <div className="ov-root ov-root--focus">
        <div className={shellClass} style={focusShellStyle} onMouseDown={suppressMouseSelection}>
          <div className="ov-grip" aria-hidden />
          <div className="ov-focus-toolbar" aria-label="专注面板工具">
            {focusTools.map((tool) => (
              <span
                key={tool.key}
                className={`ov-focus-tool ${busyAction === tool.key ? 'ov-focus-tool--busy' : ''}`}
                role="button"
                tabIndex={-1}
                onMouseDown={suppressToolbarMouseDown}
                onClick={() => runOverlayAction(tool.key)}
              >
                <span>{busyAction === tool.key ? '处理中…' : tool.label}</span>
                {tool.shortcut && <kbd>{getShortcutDisplay(tool.shortcut)}</kbd>}
              </span>
            ))}
          </div>

          <div className="ov-focus-tabs" aria-label="答案分区">
            {focusTabs.map((tab) => (
              <span
                key={tab.key}
                className={`ov-focus-tab ${tab.key === activeFocusTab ? 'ov-focus-tab--active' : ''} ${tab.isGenerating ? 'ov-focus-tab--forming' : ''}`}
                role="button"
                tabIndex={-1}
                onMouseDown={suppressToolbarMouseDown}
                onClick={() => {
                  pinnedFocusTabsByQaIdRef.current[displayedQaKey] = true
                  setActiveFocusTabsByQaId((current) => (
                    pruneFocusTabCache({ ...current, [displayedQaKey]: tab.key }, retainedFocusQaIds)
                  ))
                }}
              >
                {tab.label}
              </span>
            ))}
            <span className="ov-focus-tab-keys" aria-hidden>
              <span>切换分区</span>
              <kbd>{getShortcutDisplay(shortcuts.focusPrevTab?.key ?? 'CommandOrControl+Left')}</kbd>
              <kbd>{getShortcutDisplay(shortcuts.focusNextTab?.key ?? 'CommandOrControl+Right')}</kbd>
            </span>
          </div>
          {displayedQa && (
            <div className="ov-focus-question-strip" aria-label="题目导航">
              <span>{isReviewingHistory ? '回看' : '当前'} {displayedQaIndex + 1}/{qaPairs.length || 1}</span>
              <strong>{displayedQa.question}</strong>
              {liveGeneratingQa && (
                <span className="ov-focus-live-hint" title={liveGeneratingQa.question}>
                  新答案生成中
                </span>
              )}
              <span aria-hidden>
                <span className="ov-focus-key-label">切换题目</span>
                <kbd>{getShortcutDisplay(shortcuts.overlayPrevQuestion?.key ?? 'CommandOrControl+Up')}</kbd>
                <kbd>{getShortcutDisplay(shortcuts.overlayNextQuestion?.key ?? 'CommandOrControl+Down')}</kbd>
              </span>
            </div>
          )}

          <div
            ref={answerScrollRef}
            className="ov-focus-content"
            style={{ fontSize: `${answerFontSize}px`, color: FOCUS_TEXT_COLOR }}
            onScroll={updateAnswerAutoFollow}
          >
            {hasContent ? (
              <div className="ov-focus-active-pane" key={`${displayedQaKey}:${activeSection.key}`}>
                <FocusSection
                  title={activeSection.label}
                  section={sliceMaxLines(activeSection.content, maxLines)}
                  muted={!activeSection.content.trim()}
                  emptyHint={activeSection.isGenerating ? '正在生成这个分区…' : '当前回答还没有拆出这个分区。'}
                />
                {isStreaming && <span className="ov-caret" />}
              </div>
            ) : (
              <span className="ov-standby-hint" style={{ fontSize: `${answerFontSize}px` }}>
                {isRecording ? (isExamMode ? '笔试中…' : '正在聆听…') : (isExamMode ? '点击开始笔试' : '等待面试开始')}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`ov-root ${overlayMode === 'prompt' ? 'ov-root--prompt' : ''}`}
    >
      <div className={shellClass} style={{ opacity, color: fontColor }}>
        <div className="ov-grip" aria-hidden />

        <div
          ref={answerScrollRef}
          className="ov-content ov-answer"
          style={{ fontSize: `${answerFontSize}px` }}
          onMouseDown={suppressMouseSelection}
          onScroll={updateAnswerAutoFollow}
        >
          {renderedAnswer}
        </div>
      </div>
    </div>
  )
}

function getRetainedFocusQaIds(qaIds: string[], displayedQaId: string | null, streamingQaIds: string[]) {
  const liveQaIds = new Set(qaIds)
  const retained: string[] = []
  const seen = new Set<string>()
  const add = (qaId: string | null | undefined) => {
    if (!qaId || seen.has(qaId) || !liveQaIds.has(qaId) || retained.length >= FOCUS_TAB_CACHE_LIMIT) return
    seen.add(qaId)
    retained.push(qaId)
  }

  add(displayedQaId)
  for (let i = streamingQaIds.length - 1; i >= 0 && retained.length < FOCUS_TAB_CACHE_LIMIT; i -= 1) {
    add(streamingQaIds[i])
  }
  for (let i = qaIds.length - 1; i >= 0 && retained.length < FOCUS_TAB_CACHE_LIMIT; i -= 1) {
    add(qaIds[i])
  }
  return seen
}

function pruneFocusTabCache<T>(cache: Record<string, T>, retainedQaIds: Set<string>) {
  let changed = false
  const next: Record<string, T> = {}
  for (const [qaId, value] of Object.entries(cache)) {
    if (retainedQaIds.has(qaId)) {
      next[qaId] = value
    } else {
      changed = true
    }
  }
  return changed ? next : cache
}

function sliceMaxLines(text: string, maxLines: number): { text: string; omitted: boolean } {
  if (maxLines <= 0) return { text, omitted: false }
  const lines = text.split('\n')
  if (lines.length <= maxLines) return { text, omitted: false }
  const start = Math.max(0, lines.length - maxLines)
  const tail = lines.slice(start)
  const openFence = getOpenMarkdownFenceAt(lines.slice(0, start))
  if (openFence) tail.unshift(openFence)
  return { text: tail.join('\n'), omitted: true }
}

function getOpenMarkdownFenceAt(lines: string[]) {
  let openFence = ''
  let openFenceMarker = ''
  for (const line of lines) {
    const match = line.match(/^\s{0,3}(```+|~~~+)(.*)$/)
    if (!match) continue
    const marker = match[1]
    if (!openFence) {
      openFence = `${marker}${match[2] ?? ''}`.trimEnd()
      openFenceMarker = marker
    } else if (marker[0] === openFenceMarker[0] && marker.length >= openFenceMarker.length) {
      openFence = ''
      openFenceMarker = ''
    }
  }
  return openFence
}

function buildFocusTabs(answerText: string, question: string, isStreaming: boolean): FocusTabPane[] {
  const sections = parseMarkdownFocusSections(answerText)
  if (sections.length) {
    return sections.map((section, index) => ({
      key: `section-${index}`,
      label: section.label,
      content: section.content,
      isGenerating: isStreaming && index === sections.length - 1,
    }))
  }

  const body = answerText.trim()
  if (body) {
    return [{
      key: 'answer',
      label: isStreaming ? '生成中' : '回答',
      content: body,
      isGenerating: isStreaming,
    }]
  }

  const questionText = question.trim()
  if (questionText) {
    return [{
      key: 'question',
      label: '问题',
      content: questionText,
      isGenerating: isStreaming,
    }]
  }

  return [{
    key: 'waiting',
    label: isStreaming ? '生成中' : '等待',
    content: isStreaming ? '正在生成答案结构…' : '等待新的回答…',
    isGenerating: isStreaming,
  }]
}

function parseMarkdownFocusSections(answerText: string): Array<{ label: string; content: string }> {
  const sections: Array<{ label: string; content: string }> = []
  let current: { label: string; content: string } | null = null
  let inCode = false
  let preamble = ''

  for (const rawLine of answerText.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      if (current) current.content = appendFocusLine(current.content, rawLine)
      continue
    }

    const label = inCode ? null : getFocusHeadingLabel(line)
    if (label) {
      current = { label, content: '' }
      sections.push(current)
      continue
    }

    if (current) {
      current.content = appendFocusLine(current.content, rawLine)
    } else {
      preamble = appendFocusLine(preamble, rawLine)
    }
  }

  const cleanPreamble = preamble.trim()
  const withPreamble = cleanPreamble ? [{ label: getOpeningTabLabel(cleanPreamble), content: cleanPreamble }, ...sections] : sections

  return withPreamble
    .map((tab) => ({ ...tab, content: tab.content.trim() }))
    .filter((tab) => tab.label)
}

function getOpeningTabLabel(text: string) {
  if (/```|class\s+\w+|def\s+\w+|function\s+\w+|SELECT\s+/i.test(text)) return '代码'
  if (/[。！？.!?]\s*$/.test(text) && text.length <= 90) return '结论'
  return '概览'
}

function getFocusHeadingLabel(line: string) {
  const markdown = line.match(/^\s{0,3}#{2,4}\s+(.+?)\s*#*\s*$/)
  const bracket = line.match(/^\s*【([^】]{1,28})】\s*$/)
  const raw = markdown?.[1] ?? bracket?.[1]
  if (!raw) return null
  const label = raw
    .replace(/^[\d一二三四五六七八九十]+[.)、\s-]+/, '')
    .replace(/[：:]\s*$/, '')
    .trim()
  if (!label || label.length > 18) return null
  return label
}

function appendFocusLine(content: string, line: string) {
  return `${content}${content ? '\n' : ''}${line}`
}

function OverlayMarkdown({ content }: { content: string }) {
  return (
    <div className="ov-markdown markdown-body">
      <ReactMarkdown components={OVERLAY_MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
    </div>
  )
}

function FocusSection({
  title,
  section,
  muted = false,
  emptyHint = '等待内容…',
}: {
  title: string
  section: { text: string; omitted: boolean }
  muted?: boolean
  emptyHint?: string
}) {
  const body = section.text.trim()
  return (
    <section className="ov-focus-section">
      <h2>{title}</h2>
      <div className={muted ? 'ov-focus-muted' : ''}>
        {section.omitted && <div className="ov-focus-omitted">…以上内容已省略</div>}
        {body ? <OverlayMarkdown content={body} /> : emptyHint}
      </div>
    </section>
  )
}
