import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight, a11yDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Bot, Loader2, Copy, Check, ChevronRight, Brain, Ban, Layers, ArrowDown } from 'lucide-react'
import { useInterviewStore, QAPair } from '@/stores/configStore'
import type { ColorSchemeId } from '@/lib/colorScheme'

function prismThemeForScheme(id: ColorSchemeId) {
  if (id === 'vscode-light-plus') return oneLight
  if (id === 'vscode-dark-hc') return a11yDark
  return oneDark
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
  server_screen_left: '电脑左屏',
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

  const renderAnswerBody = (qa: QAPair, isStreaming: boolean) => (
    <>
      {qa.thinkContent && <ThinkBlock content={qa.thinkContent} isThinking={qa.isThinking} streamLayout={stream} />}
      {qa.answer === '[已取消]' ? (
        <div className="flex items-center gap-1.5 text-text-muted italic text-sm">
          <Ban className="w-3.5 h-3.5 flex-shrink-0" />
          <span>已取消</span>
        </div>
      ) : qa.answer ? (
        <div className={`markdown-body text-sm text-text-primary leading-relaxed ${stream ? 'max-w-none' : ''}`}>
          <ReactMarkdown components={mdComponents as any}>{qa.answer}</ReactMarkdown>
        </div>
      ) : isStreaming && !qa.isThinking ? (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          生成中…
        </div>
      ) : null}
      {isStreaming && qa.answer && !qa.isThinking && (
        <span className="inline-block w-2 h-4 bg-accent-green ml-0.5 animate-pulse-dot" />
      )}
      {qa.modelLabel && qa.answer && qa.answer !== '[已取消]' && (
        <p
          className={`text-[10px] text-text-muted mt-2 pt-2 border-t border-bg-tertiary/40 ${stream ? 'border-bg-hover/50' : ''}`}
        >
          由 <span className="text-accent-blue/90 font-medium">{qa.modelLabel}</span> 生成
        </p>
      )}
    </>
  )

  if (qaPairs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center space-y-3 max-w-sm">
          <Bot className="w-12 h-12 text-text-muted mx-auto opacity-40" />
          <p className="text-text-muted text-sm">AI 答案将在这里显示</p>
          <p className="text-text-muted text-xs">识别到面试问题后自动生成回答，也可以手动输入问题</p>
          <p className="text-text-muted text-xs">请先选择音频设备并点击「开始」开始面试。</p>
          {needsConfig && (
            <div className="pt-2">
              <p className="text-text-muted text-xs mb-2">请先在设置中配置模型与 API Key</p>
              <button type="button" onClick={() => toggleSettings()} className="text-accent-blue text-xs font-medium hover:underline">
                去设置
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 flex flex-col">
      <div
        ref={scrollContainerRef}
        className={`flex-1 min-h-0 overflow-y-auto px-3 py-3 md:px-4 md:py-4 ${stream ? 'space-y-10' : 'space-y-5'}`}
      >
      {multiStream && (
        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-amber/10 border border-accent-amber/25 text-accent-amber text-xs font-medium backdrop-blur-sm">
          <Layers className="w-4 h-4 flex-shrink-0" />
          <span>
            {streamingIds.length} 路模型同时生成中，答案自上而下依次出现，请向下滚动查看各路输出
          </span>
        </div>
      )}

      {qaPairs.map((qa) => {
        const isStreaming = streamingIds.includes(qa.id)
        const srcLabel = qa.questionSource ? SOURCE_LABELS[qa.questionSource] : null

        if (stream) {
          return (
            <div key={qa.id} className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center flex-shrink-0 text-accent-blue text-xs font-bold">
                  Q
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    {srcLabel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-muted border border-bg-hover">
                        {srcLabel}
                      </span>
                    )}
                    {isStreaming && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green border border-accent-green/20">
                        输出中
                      </span>
                    )}
                  </div>
                  <p className="text-sm md:text-[15px] text-text-primary leading-relaxed">{qa.question}</p>
                </div>
              </div>
              <div className="flex items-start gap-2 sm:gap-3 pl-1 sm:pl-2">
                <span className="w-7 sm:w-8 flex-shrink-0 text-center text-accent-green text-xs font-bold pt-1">A</span>
                <div className="flex-1 min-w-0 pb-4 border-l-2 border-accent-green/30 pl-3 sm:pl-4 -ml-1">
                  {renderAnswerBody(qa, isStreaming)}
                </div>
              </div>
            </div>
          )
        }

        return (
          <div key={qa.id} className="space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-accent-blue text-xs font-bold">Q</span>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {srcLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-muted border border-bg-hover">
                      {srcLabel}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-primary leading-relaxed">{qa.question}</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-accent-green/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-accent-green text-xs font-bold">A</span>
              </div>
              <div className="flex-1 min-w-0 max-h-[280px] overflow-y-auto rounded-lg border border-bg-tertiary/50 bg-bg-tertiary/20 p-3">
                {renderAnswerBody(qa, isStreaming)}
              </div>
            </div>
            <div className="border-b border-bg-tertiary/50" />
          </div>
        )
      })}
      <div ref={bottomRef} />
      </div>

      {showScrollToLatestFab && (
        <div className="pointer-events-none absolute bottom-4 right-5 z-20 hidden md:block">
          <button
            type="button"
            onClick={scrollToLatest}
            title="下方正在生成，点击回到底部"
            aria-label="滚动到最新生成内容"
            className="pointer-events-auto flex h-[52px] w-[52px] items-center justify-center rounded-full shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-transform hover:scale-105 active:scale-95"
          >
            <span className="relative flex h-[52px] w-[52px] items-center justify-center">
              <span
                className="absolute inset-0 rounded-full border-[3px] border-sky-300/25"
                aria-hidden
              />
              <span
                className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-sky-400 border-r-sky-300 animate-spin"
                style={{ animationDuration: '1.05s' }}
                aria-hidden
              />
              <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white ring-1 ring-black/5">
                <ArrowDown className="h-[18px] w-[18px] text-neutral-900" strokeWidth={2.75} />
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
