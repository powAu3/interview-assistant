import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Bot, Loader2, Copy, Check, ChevronRight, Brain, Ban } from 'lucide-react'
import { useInterviewStore, QAPair } from '@/stores/configStore'

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

function ThinkBlock({ content, isThinking }: { content: string; isThinking: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isThinking && content) setCollapsed(true)
  }, [isThinking])

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
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${collapsed ? 'max-h-0' : 'max-h-[200px]'}`}
      >
        <div
          ref={contentRef}
          className="px-3 pb-2.5 text-xs text-text-muted/80 leading-relaxed overflow-y-auto max-h-[200px] whitespace-pre-wrap select-text"
        >
          {content}
          {isThinking && <span className="inline-block w-1.5 h-3 bg-accent-amber/60 ml-0.5 animate-pulse" />}
        </div>
      </div>
    </div>
  )
}

export default function AnswerPanel() {
  const { qaPairs, currentStreamingId } = useInterviewStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [qaPairs, currentStreamingId])

  if (qaPairs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center space-y-3">
          <Bot className="w-12 h-12 text-text-muted mx-auto opacity-40" />
          <p className="text-text-muted text-sm">AI 答案将在这里显示</p>
          <p className="text-text-muted text-xs">识别到面试问题后自动生成回答，也可以手动输入问题</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-3 md:p-4 space-y-5">
      {qaPairs.map((qa) => {
        const isStreaming = qa.id === currentStreamingId
        return (
          <div key={qa.id} className="space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-accent-blue text-xs font-bold">Q</span>
              </div>
              <p className="text-sm text-text-primary leading-relaxed pt-1">{qa.question}</p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-accent-green/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-accent-green text-xs font-bold">A</span>
              </div>
              <div className="flex-1 min-w-0">
                {qa.thinkContent && (
                  <ThinkBlock content={qa.thinkContent} isThinking={qa.isThinking} />
                )}
                {qa.answer === '[已取消]' ? (
                  <div className="flex items-center gap-1.5 text-text-muted italic text-sm">
                    <Ban className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>已取消</span>
                  </div>
                ) : qa.answer ? (
                  <div className="markdown-body text-sm text-text-primary leading-relaxed">
                    <ReactMarkdown
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '')
                          const codeStr = String(children).replace(/\n$/, '')
                          if (match) {
                            const lang = match[1].toLowerCase()
                            return (
                              <div className="my-3 rounded-xl border border-accent-blue/35 bg-[#0b1220] shadow-[0_0_0_1px_rgba(59,130,246,0.08)] overflow-hidden">
                                <div className="flex items-center justify-between px-3 py-2 bg-[#111a2e] border-b border-accent-blue/20">
                                  <span className="text-[11px] uppercase tracking-wide text-accent-blue/90 font-semibold">{lang}</span>
                                  <CopyButton text={codeStr} />
                                </div>
                                <SyntaxHighlighter
                                  style={oneDark}
                                  language={lang}
                                  PreTag="div"
                                  customStyle={{
                                    margin: 0,
                                    borderRadius: 0,
                                    fontSize: '0.82rem',
                                    lineHeight: 1.55,
                                    background: '#0b1220',
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
                              className="px-1.5 py-0.5 rounded-md bg-[#1b2438] border border-accent-blue/25 text-[#dbeafe]"
                              {...props}
                            >
                              {children}
                            </code>
                          )
                        },
                      }}
                    >
                      {qa.answer}
                    </ReactMarkdown>
                  </div>
                ) : isStreaming && !qa.isThinking ? (
                  <div className="flex items-center gap-2 text-text-muted text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    生成中...
                  </div>
                ) : null}
                {isStreaming && qa.answer && !qa.isThinking && (
                  <span className="inline-block w-2 h-4 bg-accent-green ml-0.5 animate-pulse-dot" />
                )}
              </div>
            </div>
            <div className="border-b border-bg-tertiary/50" />
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
