import { Check, CircleOff, Settings2, Zap } from 'lucide-react'
import { useKbStore } from '@/stores/kbStore'
import { useInterviewStore } from '@/stores/configStore'

const DEP_LABELS: Record<string, string> = {
  docx: 'DOCX',
  pdf: 'PDF',
  ocr: 'OCR',
  vision: 'Vision',
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
  return sorted[idx]
}

export default function KbStatusHeader() {
  const status = useKbStore((s) => s.status)
  const recentHits = useKbStore((s) => s.recentHits)
  const setKbDrawerOpen = useKbStore((s) => s.setDrawerOpen)
  const toggleSettings = useInterviewStore((s) => s.toggleSettings)
  const setSettingsTab = useInterviewStore((s) => s.setSettingsDrawerTab)
  const settingsOpen = useInterviewStore((s) => s.settingsOpen)

  const stats = (() => {
    if (!recentHits.length) return null
    const lats = recentHits.map((h) => h.latency_ms)
    const timedOut = recentHits.filter((h) => h.timed_out).length
    const errored = recentHits.filter((h) => h.error).length
    return {
      n: recentHits.length,
      p50: Math.round(percentile(lats, 0.5)),
      p95: Math.round(percentile(lats, 0.95)),
      timed_out: timedOut,
      errored,
    }
  })()

  if (!status) {
    return (
      <div className="mx-1 mb-2 px-3 py-2 rounded-xl border border-bg-hover/40 bg-bg-tertiary/30 text-[11px] text-text-muted">
        <span className="inline-block w-2 h-2 rounded-full bg-text-muted/50 mr-1.5 animate-pulse" />
        加载状态中…
      </div>
    )
  }

  const jumpToSettings = () => {
    setKbDrawerOpen(false)
    if (!settingsOpen) toggleSettings()
    setSettingsTab('general')
  }

  const enabled = status.enabled

  return (
    <div
      className={`mx-1 mb-2 rounded-xl border overflow-hidden transition-colors ${
        enabled
          ? 'border-accent-green/25 bg-accent-green/[0.04]'
          : 'border-bg-hover/50 bg-bg-tertiary/30'
      }`}
    >
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`relative flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 ${
              enabled ? 'bg-accent-green/15' : 'bg-bg-hover/40'
            }`}
            aria-hidden
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                enabled ? 'bg-accent-green' : 'bg-text-muted'
              }`}
            />
            {enabled && (
              <span className="absolute inset-0 rounded-full bg-accent-green/30 animate-ping" />
            )}
          </span>
          <div className="flex flex-col min-w-0">
            <span
              className={`text-[11px] font-semibold leading-tight ${
                enabled ? 'text-accent-green' : 'text-text-secondary'
              }`}
            >
              {enabled ? '主流程已启用' : '总开关未开启'}
            </span>
            <span className="text-[10px] text-text-muted leading-tight mt-0.5 truncate">
              {status.total_docs} 文档 · {status.total_chunks} 切片 · deadline{' '}
              {status.deadline_ms}ms / ASR {status.asr_deadline_ms}ms
            </span>
          </div>
        </div>
        {stats && (
          <span
            title={`最近 ${stats.n} 次检索 · P50 ${stats.p50}ms · P95 ${stats.p95}ms · 超时 ${stats.timed_out} · 异常 ${stats.errored}`}
            className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border tabular-nums ${
              stats.p95 > (status.deadline_ms ?? 150)
                ? 'border-accent-red/30 bg-accent-red/10 text-accent-red'
                : 'border-bg-hover/50 bg-bg-tertiary/40 text-text-muted'
            }`}
          >
            <Zap className="w-3 h-3" strokeWidth={2} />
            P50·{stats.p50}ms
          </span>
        )}
      </div>

      <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
        {Object.entries(status.deps).map(([k, v]) => (
          <span
            key={k}
            title={v ? `${DEP_LABELS[k] ?? k} 已就绪` : `${DEP_LABELS[k] ?? k} 未启用 / 未安装`}
            className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border ${
              v
                ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                : 'border-bg-hover/50 bg-bg-tertiary/40 text-text-muted/70'
            }`}
          >
            {v ? (
              <Check className="w-2.5 h-2.5" strokeWidth={3} />
            ) : (
              <CircleOff className="w-2.5 h-2.5" strokeWidth={2} />
            )}
            {DEP_LABELS[k] ?? k}
          </span>
        ))}
      </div>

      {!enabled && (
        <button
          type="button"
          onClick={jumpToSettings}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 border-t border-amber-500/20 bg-amber-500/[0.06] hover:bg-amber-500/[0.12] transition-colors text-left group"
        >
          <span className="flex items-center gap-2 min-w-0 text-[10.5px] text-text-secondary leading-snug">
            <Settings2 className="w-3.5 h-3.5 flex-shrink-0 text-amber-400/90" />
            <span className="truncate">
              主流程不引用本地笔记。
              <span className="text-amber-400/90 font-medium">点此打开设置中心 →</span>
            </span>
          </span>
          <span className="text-[10px] text-text-muted group-hover:text-amber-400/80 flex-shrink-0 transition-colors">
            偏好 · 知识库
          </span>
        </button>
      )}
    </div>
  )
}
