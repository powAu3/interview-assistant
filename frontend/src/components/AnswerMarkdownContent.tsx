import ReactMarkdown from 'react-markdown'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import { oneDark, oneLight, a11yDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ColorSchemeId } from '@/lib/colorScheme'

const PRISM_LANGUAGE_REGISTRY: Record<string, unknown> = {
  bash,
  shell: bash,
  sh: bash,
  zsh: bash,
  'shell-session': bash,
  c,
  cpp,
  'c++': cpp,
  csharp,
  cs: csharp,
  'c#': csharp,
  css,
  diff,
  docker,
  dockerfile: docker,
  go,
  html: markup,
  java,
  javascript,
  js: javascript,
  json,
  jsx,
  kotlin,
  markdown,
  md: markdown,
  markup,
  php,
  python,
  py: python,
  ruby,
  rust,
  rs: rust,
  sql,
  svg: markup,
  swift,
  tsx,
  typescript,
  ts: typescript,
  xml: markup,
  yaml,
  yml: yaml,
}

export function parseMarkdownFenceLanguage(className?: string) {
  const match = /language-([A-Za-z0-9+#-]+)/.exec(className || '')
  return match?.[1].toLowerCase() ?? null
}

export function resolvePrismLanguage(requestedLang: string | null) {
  if (!requestedLang) return null
  return requestedLang in PRISM_LANGUAGE_REGISTRY ? requestedLang : null
}

for (const [languageName, languageModule] of Object.entries(PRISM_LANGUAGE_REGISTRY)) {
  SyntaxHighlighter.registerLanguage(languageName, languageModule)
}

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
        const codeStr = String(children).replace(/\n$/, '')
        const requestedLang = parseMarkdownFenceLanguage(className)
        const lang = resolvePrismLanguage(requestedLang)
        if (requestedLang) {
          return (
            <div className="code-block-shell my-3 rounded-xl overflow-hidden">
              <div className="code-block-head flex items-center justify-between px-3 py-2">
                <span className="text-[11px] uppercase tracking-wide text-accent-blue font-semibold">{requestedLang}</span>
                <CopyButton text={codeStr} />
              </div>
              {lang ? (
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
              ) : (
                <pre
                  className="m-0 overflow-x-auto bg-[rgb(var(--c-code-shell-bg))] px-4 py-3 text-[0.82rem] leading-[1.55] text-text-primary"
                >
                  <code style={{ fontFamily: 'JetBrains Mono, Consolas, monospace' }}>{codeStr}</code>
                </pre>
              )}
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
