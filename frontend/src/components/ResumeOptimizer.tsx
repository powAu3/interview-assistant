import { useEffect, useRef, useState } from 'react'
import { useInterviewStore } from '@/stores/configStore'
import { useShallow } from 'zustand/react/shallow'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { isLightColorScheme } from '@/lib/colorScheme'
import { api } from '@/lib/api'
import { Clipboard, FileSearch, Sparkles, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { ResumeMountPanel } from '@/components/resume/ResumeMount'

const JD_STORAGE_KEY = 'ia-resume-opt-jd-draft'

function readStorage(key: string, fallback = ''): string {
  try {
    return window.localStorage?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage?.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export default function ResumeOptimizer() {
  const [jdText, setJdText] = useState(() => readStorage(JD_STORAGE_KEY))
  const [optimizingLocal, setOptimizingLocal] = useState(false)
  const { config, resumeOptStreaming, resumeOptResult, resumeOptLoading, setToastMessage, resetResumeOpt } =
    useInterviewStore(
      useShallow((s) => ({
        config: s.config,
        resumeOptStreaming: s.resumeOptStreaming,
        resumeOptResult: s.resumeOptResult,
        resumeOptLoading: s.resumeOptLoading,
        setToastMessage: s.setToastMessage,
        resetResumeOpt: s.resetResumeOpt,
      })),
    )
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const lightMarkdown = isLightColorScheme(colorScheme)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const displayText = resumeOptResult || resumeOptStreaming
  const isAnalyzing = resumeOptLoading || optimizingLocal
  const analysisState = isAnalyzing ? '分析中' : displayText ? '已生成' : '待开始'

  useEffect(() => {
    writeStorage(JD_STORAGE_KEY, jdText)
  }, [jdText])

  useEffect(() => {
    if (!optimizingLocal) return
    if (resumeOptLoading || displayText) {
      setOptimizingLocal(false)
    }
  }, [displayText, optimizingLocal, resumeOptLoading])

  const handleAnalyze = async () => {
    if (!jdText.trim()) return
    if (!config?.has_resume) {
      setUploadError('请先上传简历')
      return
    }
    try {
      setUploadError(null)
      setOptimizingLocal(true)
      resetResumeOpt()
      await api.resumeOptimize(jdText.trim())
    } catch (e: any) {
      setOptimizingLocal(false)
      setUploadError(e.message || '分析失败')
    }
  }

  const handleCopy = async () => {
    if (!displayText) return
    try {
      await navigator.clipboard.writeText(displayText)
      setToastMessage('分析结果已复制')
    } catch {
      setToastMessage('复制失败，请检查浏览器权限')
    }
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]">
      {/* Left: input area */}
      <div className="md:w-[35%] md:min-w-[320px] border-b md:border-b-0 md:border-r border-bg-tertiary flex flex-col p-4 gap-3 flex-shrink-0 bg-bg-secondary/25">
        <div className="rounded-2xl border border-bg-hover/40 bg-bg-secondary/60 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-blue/10 border border-accent-blue/20">
              <Sparkles className="w-4 h-4 text-accent-blue" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">简历优化工作台</h3>
              <p className="text-[11px] text-text-muted">把简历、JD 和修改建议收在同一屏里。</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-xl border border-bg-hover/40 bg-bg-primary/60 px-3 py-2">
              <p className="text-text-muted">简历状态</p>
              <p className={`mt-1 font-medium ${config?.has_resume ? 'text-accent-green' : 'text-text-primary'}`}>
                {config?.has_resume ? '已挂载' : '未上传'}
              </p>
              {config?.resume_active_filename && (
                <p className="mt-1 truncate text-[10px] text-text-muted">
                  {config.resume_active_filename}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-bg-hover/40 bg-bg-primary/60 px-3 py-2">
              <p className="text-text-muted">JD 字数</p>
              <p className="mt-1 font-medium text-text-primary">{jdText.trim().length}</p>
            </div>
            <div className="rounded-xl border border-bg-hover/40 bg-bg-primary/60 px-3 py-2">
              <p className="text-text-muted">当前阶段</p>
              <p className="mt-1 font-medium text-accent-blue">{analysisState}</p>
            </div>
          </div>
        </div>

        <ResumeMountPanel
          title="Resume Mount"
          description="这里的分析直接使用当前挂载简历，不会维护另一份独立副本。"
          sharedNote="和主流程、模拟练习共用同一份简历历史与当前挂载记录。"
        />

        {uploadError && (
          <div className="flex items-center gap-2 bg-accent-red/10 text-accent-red text-xs px-3 py-2 rounded-lg">
            <span className="flex-1">{uploadError}</span>
            <button onClick={() => setUploadError(null)}><X className="w-3 h-3" /></button>
          </div>
        )}

        <div className="flex-1 flex flex-col gap-2 min-h-0 rounded-2xl border border-bg-hover/40 bg-bg-secondary/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-text-muted">粘贴目标岗位 JD</label>
            <span className="text-[11px] text-text-muted">{jdText.length} chars</span>
          </div>
          <textarea
            value={jdText}
            onChange={e => setJdText(e.target.value)}
            placeholder="将招聘 JD 粘贴到这里..."
            className="flex-1 min-h-[180px] md:min-h-0 bg-bg-tertiary text-text-primary text-xs rounded-xl p-3 border border-bg-hover focus:outline-none focus:border-accent-blue resize-none"
          />
          <div className="flex flex-wrap gap-2 text-[11px] text-text-muted">
            <span className="rounded-full border border-bg-hover/50 bg-bg-primary/70 px-2.5 py-1">职责范围</span>
            <span className="rounded-full border border-bg-hover/50 bg-bg-primary/70 px-2.5 py-1">技术关键词</span>
            <span className="rounded-full border border-bg-hover/50 bg-bg-primary/70 px-2.5 py-1">结果导向</span>
          </div>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing || !jdText.trim() || !config?.has_resume}
          className="w-full py-2.5 bg-accent-blue text-white text-xs font-medium rounded-lg hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAnalyzing ? '分析中...' : '开始分析'}
        </button>
      </div>

      {/* Right: result */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="rounded-2xl border border-bg-hover/40 bg-bg-secondary/40 min-h-full">
          <div className="flex items-center justify-between gap-3 border-b border-bg-hover/30 px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-accent-blue">Analysis Desk</p>
              <h4 className="mt-1 text-sm font-semibold text-text-primary">输出结果</h4>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-bg-hover/50 bg-bg-primary/70 px-3 py-1 text-[11px] text-text-secondary">
                {analysisState}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!displayText}
                className="inline-flex items-center gap-1 rounded-lg border border-bg-hover/50 px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Clipboard className="w-3.5 h-3.5" />
                复制
              </button>
            </div>
          </div>
          <div className="p-4">
        {!displayText && isAnalyzing ? (
          <div className="space-y-3 max-w-xl mx-auto" aria-busy="true" aria-live="polite">
            <span className="sr-only">正在分析简历与 JD 的匹配度…</span>
            <div className="flex items-center gap-2 text-xs text-accent-blue">
              <span className="inline-block w-2 h-2 rounded-full bg-accent-blue animate-pulse" />
              正在分析简历与 JD 的匹配度…
            </div>
            {/* 模拟"标题 + 段落 + 小节"骨架 */}
            {[0.7, 0.95, 0.85, 0.6, 0.9, 0.8].map((w, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-1/4 rounded bg-bg-tertiary/60 animate-pulse" style={{ animationDelay: `${i * 120}ms` }} />
                <div className="h-2 rounded bg-bg-tertiary/40 animate-pulse" style={{ animationDelay: `${i * 120 + 40}ms`, width: `${w * 100}%` }} />
                <div className="h-2 rounded bg-bg-tertiary/40 animate-pulse" style={{ animationDelay: `${i * 120 + 80}ms`, width: `${(w - 0.15) * 100}%` }} />
              </div>
            ))}
          </div>
        ) : !displayText ? (
          <div className="h-full flex items-center justify-center text-text-muted text-xs">
            <div className="text-center space-y-3 max-w-md">
              <FileSearch className="w-8 h-8 mx-auto opacity-30" />
              <p className="text-sm text-text-primary">先把材料放齐，再开始分析。</p>
              <div className="grid gap-2 text-left">
                {[
                  '1. 上传当前简历，确保内容已挂载。',
                  '2. 粘贴目标岗位 JD，把关键词和职责写完整。',
                  '3. 点击“开始分析”，等待模型生成修改建议。',
                ].map((item) => (
                  <div key={item} className="rounded-xl border border-bg-hover/40 bg-bg-primary/60 px-3 py-2 text-[11px]">
                    {item}
                  </div>
                ))}
              </div>
              <p className="text-[10px]">结果会聚焦匹配度、改写方向和更像“能投出去”的表达。</p>
            </div>
          </div>
        ) : (
          <div
            className={`prose prose-sm max-w-none markdown-body
            ${lightMarkdown ? '' : 'prose-invert'}
            prose-headings:text-text-primary prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
            prose-p:text-text-secondary prose-p:text-xs prose-p:leading-relaxed
            prose-li:text-text-secondary prose-li:text-xs
            prose-strong:text-text-primary
            prose-table:text-xs
            prose-th:text-text-primary prose-th:bg-bg-tertiary prose-th:px-2 prose-th:py-1
            prose-td:text-text-secondary prose-td:px-2 prose-td:py-1 prose-td:border-bg-hover
          `}
          >
            <ReactMarkdown>{displayText}</ReactMarkdown>
            {isAnalyzing && (
              <span className="inline-block w-1.5 h-3 bg-accent-blue animate-pulse rounded-sm ml-0.5" />
            )}
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  )
}
