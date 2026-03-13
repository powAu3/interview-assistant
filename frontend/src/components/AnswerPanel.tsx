import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Bot, Loader2, Copy, Check } from 'lucide-react'
import { useInterviewStore } from '@/stores/configStore'
import { useState } from 'react'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handleCopy} className="absolute top-2 right-2 p-1 rounded bg-bg-hover/80 text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100">
      {copied ? <Check className="w-3.5 h-3.5 text-accent-green" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
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
                {qa.answer ? (
                  <div className="markdown-body text-sm text-text-primary leading-relaxed">
                    <ReactMarkdown
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '')
                          const codeStr = String(children).replace(/\n$/, '')
                          if (match) {
                            return (
                              <div className="relative group my-2">
                                <CopyButton text={codeStr} />
                                <SyntaxHighlighter
                                  style={oneDark}
                                  language={match[1]}
                                  PreTag="div"
                                  customStyle={{ margin: 0, borderRadius: '0.5rem', fontSize: '0.8rem' }}
                                >
                                  {codeStr}
                                </SyntaxHighlighter>
                              </div>
                            )
                          }
                          return <code className={className} {...props}>{children}</code>
                        },
                      }}
                    >
                      {qa.answer}
                    </ReactMarkdown>
                  </div>
                ) : isStreaming ? (
                  <div className="flex items-center gap-2 text-text-muted text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    生成中...
                  </div>
                ) : null}
                {isStreaming && qa.answer && (
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
