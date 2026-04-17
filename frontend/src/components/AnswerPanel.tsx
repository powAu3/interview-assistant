import { lazy, Suspense, useEffect, useRef, useState, useCallback } from 'react'
import { Bot, Loader2, ChevronRight, Brain, Ban, Layers, ArrowDown, Sparkles, ShieldCheck, ShieldAlert, Shield } from 'lucide-react'
import { useInterviewStore, QAPair } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import KbReferenceBanner from '@/components/kb/KbReferenceBanner'

const SoundTest = lazy(() => import('./SoundTest'))
const AnswerMarkdownContent = lazy(() => import('./AnswerMarkdownContent'))

function VisionVerifyBadge({ verdict, reason }: { verdict: 'PASS' | 'FAIL' | 'UNKNOWN'; reason: string }) {
  const palette =
    verdict === 'PASS'
      ? {
          icon: <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />,
          label: '截图自检通过',
          ring: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
        }
      : verdict === 'FAIL'
        ? {
            icon: <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />,
            label: '截图自检不一致,请人工复核',
            ring: 'border-accent-amber/50 bg-accent-amber/10 text-accent-amber',
          }
        : {
            icon: <Shield className="w-3.5 h-3.5 flex-shrink-0" />,
            label: '截图自检无定论',
            ring: 'border-bg-hover/60 bg-bg-tertiary/40 text-text-muted',
          }
  return (
    <div className={`mt-3 flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug ${palette.ring}`}>
      {palette.icon}
      <div className="min-w-0">
        <div className="font-medium">{palette.label}</div>
        {reason && <div className="opacity-80 mt-0.5 break-words">{reason}</div>}
      </div>
    </div>
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

export default function AnswerPanel() {
  const { qaPairs, streamingIds, config, toggleSettings } = useInterviewStore()
  const answerPanelLayout = useUiPrefsStore((s) => s.answerPanelLayout)
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const stream = answerPanelLayout === 'stream'
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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
          <Suspense fallback={<div className="text-sm text-text-muted">渲染答案中…</div>}>
            <AnswerMarkdownContent answer={qa.answer} colorScheme={colorScheme} stream={stream} />
          </Suspense>
        )
      ) : isStreaming && !qa.isThinking ? (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          {'\u751F\u6210\u4E2D\u2026'}
        </div>
      ) : null}
      {qa.visionVerify && qa.answer && qa.answer !== '[\u5DF2\u53D6\u6D88]' && (
        <VisionVerifyBadge verdict={qa.visionVerify.verdict} reason={qa.visionVerify.reason} />
      )}
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
      <div className="flex flex-col items-center justify-center h-full p-4 overflow-y-auto gap-6">
        {/* Main empty state */}
        <div className="text-center space-y-3 max-w-sm">
          <div className="relative mx-auto w-14 h-14">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-blue/15 to-violet-500/10 animate-glow" />
            <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-tertiary/50">
              <Bot className="w-7 h-7 text-text-muted/60" />
            </div>
          </div>
          <div>
            <p className="text-text-primary text-sm font-semibold flex items-center justify-center gap-1.5">
              AI {'\u9762\u8BD5\u52A9\u624B'}
              <Sparkles className="w-3 h-3 text-accent-amber/80" />
            </p>
            <p className="text-text-muted text-xs mt-1 leading-relaxed">
              {'\u8BC6\u522B\u5230\u95EE\u9898\u540E\u81EA\u52A8\u751F\u6210\u56DE\u7B54\uFF0C\u4E5F\u53EF\u4EE5\u624B\u52A8\u8F93\u5165\u6216\u622A\u56FE\u5BA1\u9898'}
            </p>
          </div>
          {needsConfig && (
            <div className="pt-1">
              <p className="text-text-muted text-xs mb-2">{'\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6A21\u578B\u4E0E API Key'}</p>
              <button type="button" onClick={() => toggleSettings()} className="text-accent-blue text-xs font-medium hover:underline">
                {'\u53BB\u8BBE\u7F6E'}
              </button>
            </div>
          )}
        </div>

        {/* Sound Test - only show when idle (not recording) */}
        {isIdle && (
          <Suspense fallback={<div className="text-xs text-text-muted">加载链路检测中…</div>}>
            <SoundTest />
          </Suspense>
        )}
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

      {qaPairs.map((qa, idx) => {
        const isStreaming = streamingIds.includes(qa.id)
        const srcLabel = qa.questionSource ? SOURCE_LABELS[qa.questionSource] : null

        if (stream) {
          return (
            <div key={qa.id} className="space-y-3 animate-fade-up" style={{ animationDelay: `${Math.min(idx * 50, 200)}ms` }}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-blue/25 to-indigo-500/15 flex items-center justify-center flex-shrink-0 text-accent-blue text-xs font-bold ring-1 ring-accent-blue/15">
                  Q
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
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
              <div className="flex items-start gap-2 sm:gap-3 pl-1 sm:pl-2">
                <span className="w-7 sm:w-8 flex-shrink-0 text-center text-accent-green text-xs font-bold pt-1">A</span>
                <div className="flex-1 min-w-0 pb-4 border-l-2 border-accent-green/25 pl-3 sm:pl-4 -ml-1">
                  <KbReferenceBanner qaId={qa.id} />
                  {renderAnswerBody(qa, isStreaming)}
                </div>
              </div>
            </div>
          )
        }

        return (
          <div key={qa.id} className="answer-card p-4 space-y-3 animate-fade-up" style={{ animationDelay: `${Math.min(idx * 50, 200)}ms` }}>
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-accent-blue/25 to-indigo-500/15 flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-accent-blue/15">
                <span className="text-accent-blue text-xs font-bold">Q</span>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {srcLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-muted border border-bg-hover/60 font-medium">
                      {srcLabel}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-primary leading-relaxed font-medium">{qa.question}</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-accent-green/25 to-emerald-500/15 flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-accent-green/15">
                <span className="text-accent-green text-xs font-bold">A</span>
              </div>
              <div className="flex-1 min-w-0 max-h-[280px] overflow-y-auto rounded-xl bg-bg-tertiary/15 p-3">
                <KbReferenceBanner qaId={qa.id} />
                {renderAnswerBody(qa, isStreaming)}
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
