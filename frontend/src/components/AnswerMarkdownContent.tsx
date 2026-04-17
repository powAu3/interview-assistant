import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight, a11yDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ColorSchemeId } from '@/lib/colorScheme'

function prismThemeForScheme(id: ColorSchemeId) {
  if (id === 'vscode-light-plus') return oneLight
  if (id === 'vscode-dark-hc') return a11yDark
  return oneDark
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // 卸载时清掉残留 timer, 避免已卸载组件仍触发 setState
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
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
    [prismStyle],
  )
}

function AnswerMarkdownContentInner({
  answer,
  colorScheme,
  stream,
}: {
  answer: string
  colorScheme: ColorSchemeId
  stream: boolean
}) {
  const mdComponents = useMarkdownComponents(colorScheme)
  return (
    <div className={`markdown-body text-sm text-text-primary leading-relaxed ${stream ? 'max-w-none' : ''}`}>
      <ReactMarkdown components={mdComponents as any}>{answer}</ReactMarkdown>
    </div>
  )
}

const AnswerMarkdownContent = memo(AnswerMarkdownContentInner)
export default AnswerMarkdownContent
