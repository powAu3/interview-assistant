import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
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
  const syncPrefs = useUiPrefsStore((s) => s.syncInterviewOverlayPrefs)
  const applyState = useUiPrefsStore((s) => s.applyInterviewOverlayState)
  const [activeFocusTab, setActiveFocusTab] = useState('answer')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const userPinnedFocusTabRef = useRef(false)
  const lastQaIdRef = useRef<string | null>(null)

  const latestQa = useMemo(() => {
    if (streamingIds.length > 0) {
      const currentId = streamingIds[streamingIds.length - 1]
      const active = qaPairs.find((item) => item.id === currentId)
      if (active) return active
    }
    return qaPairs[qaPairs.length - 1] ?? null
  }, [qaPairs, streamingIds])

  const answerText =
    latestQa?.status === 'cancelled'
      ? '上一条回答已取消'
      : latestQa?.status === 'error'
        ? `保存失败: ${latestQa.errorMessage || '未知原因'}`
        : latestQa?.answer?.trim() || (latestQa ? (latestQa.isThinking ? '思考中…' : '正在组织回答…') : '')
  const isStreaming = latestQa ? streamingIds.includes(latestQa.id) : false
  const hasContent = Boolean(latestQa)
  const focusTabs = useMemo(
    () => buildFocusTabs(answerText, latestQa?.question ?? '', isStreaming),
    [answerText, isStreaming, latestQa?.question],
  )
  const activeSection = focusTabs.find((tab) => tab.key === activeFocusTab) ?? focusTabs[0]

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
    const nextQaId = latestQa?.id ?? null
    if (lastQaIdRef.current === nextQaId) return
    lastQaIdRef.current = nextQaId
    userPinnedFocusTabRef.current = false
  }, [latestQa?.id])

  useEffect(() => {
    if (!focusTabs.length) return
    if (!focusTabs.some((tab) => tab.key === activeFocusTab)) {
      userPinnedFocusTabRef.current = false
      setActiveFocusTab(focusTabs[0].key)
      return
    }
    if (isStreaming && !userPinnedFocusTabRef.current) {
      const latestGeneratingTab = [...focusTabs].reverse().find((tab) => tab.isGenerating)
      if (latestGeneratingTab && latestGeneratingTab.key !== activeFocusTab) {
        setActiveFocusTab(latestGeneratingTab.key)
      }
    }
  }, [activeFocusTab, focusTabs, isStreaming])

  const moveFocusTab = useCallback((direction: 'prev' | 'next') => {
    userPinnedFocusTabRef.current = true
    setActiveFocusTab((current) => {
      if (!focusTabs.length) return current
      const currentIndex = Math.max(0, focusTabs.findIndex((tab) => tab.key === current))
      const delta = direction === 'next' ? 1 : -1
      const nextIndex = (currentIndex + delta + focusTabs.length) % focusTabs.length
      return focusTabs[nextIndex]?.key ?? current
    })
  }, [focusTabs])

  useEffect(() => {
    return window.electronAPI?.onFocusTabCommand?.((direction) => { moveFocusTab(direction) })
  }, [moveFocusTab])

  if (!enabled) {
    return <div className="h-screen w-screen bg-transparent" />
  }

  const answerFontSize = Math.max(12, fontSize)
  const shellClass = `ov-shell ${overlayMode === 'focus' ? 'ov-shell--focus' : overlayMode === 'prompt' ? 'ov-shell--nobg' : 'ov-shell--bg'}`
  const trimmedLines = maxLines > 0 ? displayLines : null
  const focusSurfaceAlpha = Math.max(0.1, Math.min(0.95, opacity))
  const focusShellStyle = {
    '--ov-focus-bg-alpha': String(focusSurfaceAlpha),
    '--ov-focus-toolbar-alpha': String(Math.max(0.08, Math.min(0.42, focusSurfaceAlpha * 0.48))),
    '--ov-focus-tabs-alpha': String(Math.max(0.12, Math.min(0.58, focusSurfaceAlpha * 0.7))),
    '--ov-focus-key-alpha': String(Math.max(0.2, Math.min(0.76, focusSurfaceAlpha * 0.86))),
  } as CSSProperties
  const focusTools = [
    { key: 'screen' as const, label: '截图审题', shortcut: shortcuts.askFromServerScreen?.key },
    { key: 'cancel' as const, label: '取消生成', shortcut: null },
    { key: 'clear' as const, label: '清空重来', shortcut: shortcuts.hardClearSession?.key },
    { key: 'hide' as const, label: '隐藏面板', shortcut: shortcuts.toggleInterviewOverlay?.key },
  ]

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
                  userPinnedFocusTabRef.current = true
                  setActiveFocusTab(tab.key)
                }}
              >
                {tab.label}
              </span>
            ))}
            <span className="ov-focus-tab-keys" aria-hidden>
              <kbd>{getShortcutDisplay(shortcuts.focusPrevTab?.key ?? 'CommandOrControl+Left')}</kbd>
              <kbd>{getShortcutDisplay(shortcuts.focusNextTab?.key ?? 'CommandOrControl+Right')}</kbd>
            </span>
          </div>

          <div
            ref={answerScrollRef}
            className="ov-focus-content"
            style={{ fontSize: `${answerFontSize}px`, color: fontColor }}
          >
            {hasContent ? (
              <div className="ov-focus-active-pane">
                <FocusSection
                  title={activeSection.label}
                  content={sliceMaxLines(activeSection.content, maxLines)}
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
          <div className="ov-focus-handle" aria-hidden>‹</div>
        </div>
      </div>
    )
  }

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

function sliceMaxLines(text: string, maxLines: number) {
  if (maxLines <= 0) return text
  const lines = text.split('\n')
  return lines.length > maxLines ? lines.slice(-maxLines).join('\n') : text
}

function buildFocusTabs(answerText: string, question: string, isStreaming: boolean): FocusTabPane[] {
  const parsed = parseMarkdownFocusTabs(answerText)
  if (parsed.length) {
    return parsed.map((tab, index) => ({
      ...tab,
      isGenerating: isStreaming && index === parsed.length - 1,
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

function parseMarkdownFocusTabs(answerText: string): FocusTabPane[] {
  const tabs: FocusTabPane[] = []
  let current: FocusTabPane | null = null
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
      current = { key: `${slugFocusLabel(label)}-${tabs.length}`, label, content: '' }
      tabs.push(current)
      continue
    }

    if (current) {
      current.content = appendFocusLine(current.content, rawLine)
    } else {
      preamble = appendFocusLine(preamble, rawLine)
    }
  }

  const cleanPreamble = preamble.trim()
  const withPreamble = cleanPreamble
    ? [{ key: 'opening-0', label: getOpeningTabLabel(cleanPreamble), content: cleanPreamble }, ...tabs]
    : tabs

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

function slugFocusLabel(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'tab'
}

function FocusSection({
  title,
  content,
  muted = false,
  emptyHint = '等待内容…',
}: {
  title: string
  content: string
  muted?: boolean
  emptyHint?: string
}) {
  const body = content.trim()
  return (
    <section className="ov-focus-section">
      <h2>{title}</h2>
      <div className={muted ? 'ov-focus-muted' : ''}>{body || emptyHint}</div>
    </section>
  )
}
