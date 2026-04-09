import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight, a11yDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Bot, Loader2, Copy, Check, ChevronRight, Brain, Ban, Layers, ArrowDown, Sparkles } from 'lucide-react'
import { useInterviewStore, QAPair } from '@/stores/configStore'
import SoundTest from './SoundTest'
import { isLightColorScheme, type ColorSchemeId } from '@/lib/colorScheme'

function prismThemeForScheme(id: ColorSchemeId) {
  if (id === 'vscode-dark-hc') return a11yDark
  return isLightColorScheme(id) ? oneLight : oneDark
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-bg-hover text-text-muted hover:text-text-primary transition-colors text-[11px]"
      title="复制代码"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Copy className="w-3.5 h-3.5" />}
      <span>{copied ? '已复制' : '复制'}</span>
    </button>
  )
}

function ThinkBlock({ content, isThinking, streamLayout }: { content: string; isThinking: boolean; streamLayout?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const maxH = streamLayout ? 'max-h-[min(55vh,420px)]' : 'max-h-[min(50vh,360px)]'

  useEffect(() => {
    if (isThinking && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content, isThinking])

  if (!content) return null

  return (
    <div className="mb-3 rounded-lg border border-bg-hover/60 bg-bg-tertiary/30 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-xs hover:bg-bg-tertiary/50 transition-colors"
      >
        {isThinking ? (
          <>
            <Brain className="w-3.5 h-3.5 text-accent-amber animate-pulse" />
            <span className="text-accent-amber font-medium">思考中...</span>
          </>
        ) : (
          <>
            <ChevronRight className={`w-3 h-3 text-text-muted transition-transform duration-200 ${!collapsed ? 'rotate-90' : ''}`} />
            <Brain className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-text-muted">思考过程</span>
            <span className="text-text-muted/50 text-[10px] ml-1">{content.length} 字</span>
          </>
        )}
      </button>
      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${collapsed ? 'max-h-0' : maxH}`}>
        <div
          ref={contentRef}
          className={`px-3 pb-2.5 text-xs text-text-secondary leading-relaxed overflow-y-auto ${maxH} whitespace-pre-wrap select-text`}
        >
          {content}
          {isThinking && <span className="inline-block w-1.5 h-3 bg-accent-amber/60 ml-0.5 animate-pulse" />}
        </div>
      </div>
    </div>
  )
}

const SOURCE_LABELS: Record<string, string> = {
  conversation_loopback: '会议拾音',
  conversation_mic: '本机麦克风',
  manual_text: '键盘速记',
  manual_image: '截图审题',
  server_screen_left: '服务端截图审题',
}

function useMarkdownComponents(colorScheme: ColorSchemeId) {
  const prismStyle = prismThemeForScheme(colorScheme)
  return useMemo(
    () => ({
      code({ className, children, ...props }: { className?: string; children?: React.ReactNode } & Record<string, unknown>) {
        const match = /language-(\w+)/.exec(className || '')
        const codeStr = String(children).replace(/\n$/, '')
        if (match) {
          const lang = match[1].toLowerCase()
          return (
            <div className="code-block-shell my-3 rounded-xl overflow-hidden">
              <div className="code-block-head flex items-center justify-between px-3 py-2">
                <span className="text-[11px] uppercase tracking-wide text-accent-blue font-semibold">{lang}</span>
                <CopyButton text={codeStr} />
              </div>
              <SyntaxHighlighter
                style={prismStyle}
                language={lang}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  fontSize: '0.82rem',
                  lineHeight: 1.55,
                  background: 'rgb(var(--c-code-shell-bg))',
                  padding: '0.9rem 1rem',
                }}
                codeTagProps={{ style: { fontFamily: 'JetBrains Mono, Consolas, monospace' } }}
                wrapLongLines={false}
              >
                {codeStr}
              </SyntaxHighlighter>
            </div>
          )
        }
        return (
          <code
            className="px-1.5 py-0.5 rounded-md border border-accent-blue/25"
            style={{
              background: 'rgb(var(--c-code-inline-bg))',
              color: 'rgb(var(--c-code-inline-fg))',
            }}
            {...props}
          >
            {children}
          </code>
        )
      },
    }),
    [prismStyle, colorScheme],
  )
}

export default function AnswerPanel() {
  const { qaPairs, streamingIds, config, toggleSettings, answerPanelLayout, colorScheme } = useInterviewStore()
  const stream = answerPanelLayout === 'stream'
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const mdComponents = useMarkdownComponents(colorScheme)

  const scrollThreshold = Math.max(4, Math.min(400, config?.answer_autoscroll_bottom_px ?? 40))
  const [nearBottom, setNearBottom] = useState(true)

  const updateNearBottom = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const d = el.scrollHeight - el.scrollTop - el.clientHeight
    setNearBottom(d <= scrollThreshold)
  }, [scrollThreshold])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !bottomRef.current) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= scrollThreshold
    if (atBottom) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
    updateNearBottom()
  }, [qaPairs, streamingIds, scrollThreshold, updateNearBottom])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    updateNearBottom()
    el.addEventListener('scroll', updateNearBottom, { passive: true })
    const ro = new ResizeObserver(() => updateNearBottom())
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateNearBottom)
      ro.disconnect()
    }
  }, [updateNearBottom])

  const hasActiveGeneration =
    streamingIds.length > 0 || qaPairs.some((q) => q.isThinking)
  const showScrollToLatestFab = qaPairs.length > 0 && hasActiveGeneration && !nearBottom

  const scrollToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    requestAnimationFrame(() => updateNearBottom())
  }

  const needsConfig = config && (!config.models?.length || !config.api_key_set)
  const multiStream = streamingIds.length > 1
  const panelHeader = (
    <div className="ia-console-topbar flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-accent-blue/15 bg-gradient-to-br from-accent-blue/15 to-transparent">
            <Bot className="h-4 w-4 text-accent-blue" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">Answer console</p>
            <h2 className="text-sm font-semibold tracking-tight text-text-primary md:text-[15px]">
              {stream ? '流式回答编排' : '卡片式回答工作区'}
            </h2>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="rounded-full border border-bg-hover/60 bg-bg-tertiary/30 px-3 py-1 text-[11px] font-medium text-text-secondary">
          {stream ? 'Stream layout' : 'Card layout'}
        </div>
        {multiStream && (
          <div className="flex items-center gap-1.5 rounded-full border border-accent-amber/25 bg-accent-amber/10 px-3 py-1 text-[11px] font-medium text-accent-amber">
            <Layers className="h-3.5 w-3.5" />
            {streamingIds.length} 路并行
          </div>
        )}
        {hasActiveGeneration && (
          <div className="flex items-center gap-1.5 rounded-full border border-accent-green/20 bg-accent-green/10 px-3 py-1 text-[11px] font-medium text-accent-green">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            实时生成中
          </div>
        )}
      </div>
    </div>
  )

  const renderAnswerBody = (qa: QAPair, isStreaming: boolean) => (
    <>
      {qa.thinkContent && <ThinkBlock content={qa.thinkContent} isThinking={qa.isThinking} streamLayout={stream} />}
      {qa.answer === '[\u5DF2\u53D6\u6D88]' ? (
        <div className="flex items-center gap-1.5 text-text-muted italic text-sm">
          <Ban className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{'\u5DF2\u53D6\u6D88'}</span>
        </div>
      ) : qa.answer ? (
        isStreaming && !qa.isThinking ? (
          <div className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words">
            {qa.answer}
            <span className="inline-block w-2 h-4 bg-accent-green ml-0.5 animate-pulse-dot rounded-full align-middle" />
          </div>
        ) : (
          <div className={`markdown-body text-sm text-text-primary leading-relaxed ${stream ? 'max-w-none' : ''}`}>
            <ReactMarkdown components={mdComponents as any}>{qa.answer}</ReactMarkdown>
          </div>
        )
      ) : isStreaming && !qa.isThinking ? (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          {'\u751F\u6210\u4E2D\u2026'}
        </div>
      ) : null}
      {qa.modelLabel && qa.answer && qa.answer !== '[\u5DF2\u53D6\u6D88]' && (
        <p
          className={`text-[10px] text-text-muted/70 mt-2.5 pt-2 border-t border-bg-tertiary/30 flex items-center gap-1 ${stream ? 'border-bg-hover/40' : ''}`}
        >
          <Brain className="w-3 h-3 opacity-50" />
          {'\u7531 '}<span className="text-accent-blue/80 font-medium">{qa.modelLabel}</span>{' \u751F\u6210'}
        </p>
      )}
    </>
  )

  const isIdle = !useInterviewStore.getState().isRecording

  if (qaPairs.length === 0) {
    return (
      <div className="ia-console-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[24px]">
        {panelHeader}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-4 md:p-6">
          <div className="max-w-md rounded-[26px] border border-bg-hover/60 bg-bg-tertiary/10 px-6 py-7 text-center shadow-[0_16px_42px_rgba(0,0,0,0.08)]">
            <div className="relative mx-auto h-14 w-14">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-blue/15 to-violet-500/10 animate-glow" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-tertiary/50">
                <Bot className="h-7 w-7 text-text-muted/60" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-text-primary">
                AI 面试助手
                <Sparkles className="h-3 w-3 text-accent-amber/80" />
              </p>
              <p className="text-xs leading-relaxed text-text-secondary">
                识别到问题后会自动生成回答；也可以在下方控制台直接追问、粘贴截图或切换工作模式。
              </p>
            </div>
            {needsConfig && (
              <div className="mt-4 rounded-2xl border border-accent-amber/20 bg-accent-amber/10 px-4 py-3">
                <p className="text-xs text-text-secondary">请先在设置中配置模型与 API Key</p>
                <button type="button" onClick={() => toggleSettings()} className="mt-2 text-xs font-medium text-accent-blue hover:underline">
                  去设置
                </button>
              </div>
            )}
          </div>

          {isIdle && <SoundTest />}
        </div>
      </div>
    )
  }

  return (
    <div className="ia-console-panel relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px]">
      {panelHeader}
      <div
        ref={scrollContainerRef}
        className={`flex-1 min-h-0 overflow-y-auto px-3 py-3 md:px-4 md:py-4 ${stream ? 'space-y-8' : 'space-y-5'}`}
      >
        {multiStream && (
          <div className="sticky top-0 z-10 flex items-center gap-2 rounded-2xl border border-accent-amber/25 bg-bg-secondary/95 px-3 py-2 text-xs font-medium text-accent-amber backdrop-blur-sm">
            <Layers className="w-4 h-4 flex-shrink-0" />
            <span>
              {streamingIds.length} 路模型同时生成中，答案自上而下依次出现，请向下滚动查看各路输出
            </span>
          </div>
        )}

        {qaPairs.map((qa, idx) => {
        const isStreaming = streamingIds.includes(qa.id)
        const srcLabel = qa.questionSource ? SOURCE_LABELS[qa.questionSource] : null

        if (stream) {
          return (
            <div key={qa.id} className="space-y-3 animate-fade-up" style={{ animationDelay: `${Math.min(idx * 50, 200)}ms` }}>
              <div className="rounded-[22px] border border-bg-hover/60 bg-bg-tertiary/12 px-4 py-3.5 shadow-[0_12px_30px_rgba(0,0,0,0.05)]">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-blue/25 to-indigo-500/15 text-accent-blue ring-1 ring-accent-blue/15">
                    <span className="text-xs font-bold">Q</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-bg-hover/60 bg-bg-tertiary/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                        Question
                      </span>
                      {srcLabel && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-muted border border-bg-hover/60 font-medium">
                          {srcLabel}
                        </span>
                      )}
                      {isStreaming && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green border border-accent-green/20 font-medium animate-pulse">
                          {'\u8F93\u51FA\u4E2D'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm md:text-[15px] text-text-primary leading-relaxed font-medium">{qa.question}</p>
                  </div>
                </div>
              </div>
              <div className="ia-console-panel overflow-hidden rounded-[22px]">
                <div className="ia-console-topbar flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-green/25 to-emerald-500/15 text-accent-green ring-1 ring-accent-green/15">
                      <span className="text-xs font-bold">A</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Answer</p>
                      <p className="text-xs text-text-secondary">
                        {isStreaming ? '跟随流式输出实时刷新' : '完整渲染为 Markdown / 代码块'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-4">
                  {renderAnswerBody(qa, isStreaming)}
                </div>
              </div>
            </div>
          )
        }

        return (
          <div key={qa.id} className="ia-console-panel answer-card overflow-hidden rounded-[24px] animate-fade-up" style={{ animationDelay: `${Math.min(idx * 50, 200)}ms` }}>
            <div className="ia-console-topbar flex items-start gap-3 px-4 py-3">
              <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-blue/25 to-indigo-500/15 ring-1 ring-accent-blue/15">
                <span className="text-accent-blue text-xs font-bold">Q</span>
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-bg-hover/60 bg-bg-tertiary/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Prompt
                  </span>
                  {srcLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-muted border border-bg-hover/60 font-medium">
                      {srcLabel}
                    </span>
                  )}
                  {isStreaming && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green border border-accent-green/20 font-medium animate-pulse">
                      输出中
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-primary leading-relaxed font-medium">{qa.question}</p>
              </div>
            </div>

            <div className="space-y-3 p-4">
              <div className="rounded-[22px] border border-accent-green/15 bg-bg-tertiary/18 p-4 shadow-[0_12px_30px_rgba(0,0,0,0.05)]">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-green/25 to-emerald-500/15 ring-1 ring-accent-green/15">
                    <span className="text-accent-green text-xs font-bold">A</span>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Answer draft</p>
                    <p className="text-xs text-text-secondary">
                      {isStreaming ? '正在持续追加内容' : '已完成结构化渲染'}
                    </p>
                  </div>
                </div>
                <div className="max-h-[320px] overflow-y-auto rounded-xl bg-bg-tertiary/10 p-3">
                  {renderAnswerBody(qa, isStreaming)}
                </div>
              </div>
            </div>
          </div>
        )
        })}
        <div ref={bottomRef} />
      </div>

      {showScrollToLatestFab && (
        <div className="pointer-events-none absolute bottom-4 right-3 sm:right-5 z-20">
          <button
            type="button"
            onClick={scrollToLatest}
            title="下方正在生成，点击回到底部"
            aria-label="滚动到最新生成内容"
            className="pointer-events-auto flex h-[52px] w-[52px] items-center justify-center rounded-full shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-transform hover:scale-105 active:scale-95"
          >
            <span className="relative flex h-[52px] w-[52px] items-center justify-center">
              <span
                className="absolute inset-0 rounded-full border-[3px] border-accent-blue/20"
                aria-hidden
              />
              <span
                className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-accent-blue border-r-accent-blue/60 animate-spin"
                style={{ animationDuration: '1.05s' }}
                aria-hidden
              />
              <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-bg-secondary ring-1 ring-bg-hover">
                <ArrowDown className="h-[18px] w-[18px] text-text-primary" strokeWidth={2.75} />
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
