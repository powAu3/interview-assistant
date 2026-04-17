import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '@/lib/api'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { RefreshCw, Trash2, ChevronDown, ChevronUp, Target, TrendingUp, TrendingDown, Minus, Sparkles, Mic, BookOpen, Loader2 } from 'lucide-react'
import {
  ASSIST_MERGE_GAP_SEC,
  mergeHistoryByTimeGap,
  type HistoryRecord,
} from './knowledge-map/mergeHistory'

interface TagSummary {
  tag: string
  count: number
  avg_score: number | null
  trend: 'up' | 'down' | 'stable'
}

function trendLabel(trend: string) {
  if (trend === 'up') return '上升'
  if (trend === 'down') return '下降'
  return '持平'
}

function RadarChart({ tags }: { tags: TagSummary[] }) {
  const top = tags.filter(t => t.avg_score !== null).slice(0, 8)
  if (top.length < 3) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-xs">
        至少需要 3 个有评分的知识点才能显示雷达图
      </div>
    )
  }

  const cx = 150, cy = 130, r = 90
  const n = top.length
  const points = top.map((t, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    const val = (t.avg_score ?? 0) / 10
    return {
      x: cx + r * val * Math.cos(angle),
      y: cy + r * val * Math.sin(angle),
      lx: cx + (r + 20) * Math.cos(angle),
      ly: cy + (r + 20) * Math.sin(angle),
      tag: t.tag,
      score: t.avg_score,
      count: t.count,
      trend: t.trend,
    }
  })

  const gridLevels = [0.25, 0.5, 0.75, 1.0]
  const polyStr = points.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <svg viewBox="0 0 300 260" className="w-full max-w-[320px] mx-auto" role="img" aria-label="知识点掌握度雷达图">
      <title>知识点掌握度 (0-10 分)</title>
      <desc>
        {top.map(t => `${t.tag}: ${t.avg_score?.toFixed(1) ?? '无评分'}分, ${t.count}次, 趋势${trendLabel(t.trend)}`).join('; ')}
      </desc>
      {gridLevels.map(level => {
        const gp = Array.from({ length: n }, (_, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2
          return `${cx + r * level * Math.cos(angle)},${cy + r * level * Math.sin(angle)}`
        }).join(' ')
        return <polygon key={level} points={gp} fill="none" stroke="currentColor" className="text-bg-hover" strokeWidth="0.5" />
      })}
      {points.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos((Math.PI * 2 * i) / n - Math.PI / 2)}
          y2={cy + r * Math.sin((Math.PI * 2 * i) / n - Math.PI / 2)}
          stroke="currentColor" className="text-bg-hover" strokeWidth="0.5" />
      ))}
      <polygon points={polyStr} fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth="1.5" />
      {points.map((p, i) => {
        const tooltip = `${p.tag} · ${p.score?.toFixed(1) ?? '--'}/10 · ${p.count}次 · 趋势${trendLabel(p.trend)}`
        return (
          <g key={i}>
            {/* 扩大命中半径, 便于 hover / 触控点中 */}
            <circle cx={p.x} cy={p.y} r="10" fill="transparent" className="cursor-help">
              <title>{tooltip}</title>
            </circle>
            <circle cx={p.x} cy={p.y} r="3" fill="#3b82f6" />
            <text x={p.lx} y={p.ly} textAnchor="middle" dominantBaseline="middle"
              className="fill-text-secondary" fontSize="9">{p.tag}
              <title>{tooltip}</title>
            </text>
            <text x={p.lx} y={p.ly + 12} textAnchor="middle"
              className="fill-text-muted" fontSize="8">{p.score?.toFixed(1)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') return <TrendingUp className="w-3 h-3 text-accent-green" />
  if (trend === 'down') return <TrendingDown className="w-3 h-3 text-accent-red" />
  return <Minus className="w-3 h-3 text-text-muted" />
}

export default function KnowledgeMap() {
  const [tags, setTags] = useState<TagSummary[]>([])
  /** 接口返回的原始行（分页累积），合并仅用于展示 */
  const [rawHistory, setRawHistory] = useState<HistoryRecord[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [firstLoaded, setFirstLoaded] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)

  const history = useMemo(() => mergeHistoryByTimeGap(rawHistory), [rawHistory])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [sumRes, histRes] = await Promise.all([
        api.knowledgeSummary(),
        api.knowledgeHistory(1, 20),
      ])
      setTags(sumRes.tags || [])
      setRawHistory(histRes.records || [])
      setHistoryTotal(histRes.total || 0)
      setHistoryPage(1)
    } catch {}
    setLoading(false)
    setFirstLoaded(true)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const loadMoreHistory = async () => {
    const next = historyPage + 1
    try {
      const res = await api.knowledgeHistory(next, 20)
      setRawHistory((prev) => [...prev, ...(res.records || [])])
      setHistoryPage(next)
    } catch {}
  }

  const handleReset = async () => {
    if (!confirm('确定要清空所有知识记录吗？清空后不可恢复。')) return
    await api.knowledgeReset()
    loadData()
  }

  const handleGenerateReview = async () => {
    setGenLoading(true)
    try {
      const weakTags = tags
        .filter(t => t.avg_score !== null)
        .sort((a, b) => (a.avg_score ?? 10) - (b.avg_score ?? 10))
        .slice(0, 3)
        .map(t => t.tag)

      if (weakTags.length === 0) {
        useInterviewStore.getState().setToastMessage('暂无薄弱知识点，多做几道题再来')
        setGenLoading(false)
        return
      }

      const text = `请针对以下薄弱知识点出 3 道面试题：${weakTags.join('、')}`
      await api.ask(text)
    } catch {}
    setGenLoading(false)
  }

  const weakTags = tags
    .filter(t => t.avg_score !== null)
    .sort((a, b) => (a.avg_score ?? 10) - (b.avg_score ?? 10))

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Target className="w-4 h-4 text-accent-blue" />
          能力分析
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleReset}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted hover:text-accent-red transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!firstLoaded && loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-accent-blue/70" />
          <p className="text-xs">正在加载能力分析数据…</p>
        </div>
      ) : tags.length === 0 && rawHistory.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-5 max-w-md mx-auto text-center">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-blue/15 to-violet-500/10 animate-glow" />
            <div className="relative flex items-center justify-center w-20 h-20 rounded-2xl bg-bg-tertiary/50 border border-bg-hover/40">
              <Target className="w-9 h-9 text-accent-blue/70" />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-text-primary text-sm font-semibold flex items-center justify-center gap-1.5">
              还没有能力画像
              <Sparkles className="w-3.5 h-3.5 text-accent-amber/80" />
            </p>
            <p className="text-text-muted text-xs leading-relaxed">
              完成几次「实时辅助」或「模拟练习」后，系统会自动从问答中提取知识点，
              <br className="hidden sm:inline" />
              生成雷达图、薄弱点排名和历史记录。
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <button
              type="button"
              onClick={() => setAppMode('assist')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent-blue text-white text-xs font-medium shadow-sm shadow-accent-blue/20 hover:brightness-110 transition"
            >
              <Mic className="w-3.5 h-3.5" />
              开始实时辅助
            </button>
            <button
              type="button"
              onClick={() => setAppMode('practice')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-bg-tertiary/60 border border-bg-hover/60 text-text-primary text-xs font-medium hover:bg-bg-hover/60 transition"
            >
              <BookOpen className="w-3.5 h-3.5 text-accent-blue" />
              进入模拟练习
            </button>
          </div>
          <p className="text-[10px] text-text-muted/70 max-w-xs leading-relaxed">
            小贴士:完成越多不同主题的问答,雷达图越有参考价值;一次对话里的多条提问会按 {ASSIST_MERGE_GAP_SEC} 秒间隔自动合并。
          </p>
        </div>
      ) : (
        <>
          {/* Radar */}
          <div className="bg-bg-secondary rounded-xl p-4 border border-bg-tertiary">
            <h3 className="text-xs font-medium text-text-secondary mb-2">知识点掌握度</h3>
            <RadarChart tags={tags} />
          </div>

          {/* Weak points */}
          <div className="bg-bg-secondary rounded-xl p-4 border border-bg-tertiary">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-text-secondary">薄弱点排名</h3>
              <button onClick={handleGenerateReview} disabled={genLoading}
                className="text-[10px] px-2 py-1 rounded-md bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors disabled:opacity-50">
                {genLoading ? '生成中...' : '生成针对性复习题'}
              </button>
            </div>
            <div className="space-y-2">
              {weakTags.slice(0, 10).map((t, i) => (
                <div key={t.tag} className="flex items-center gap-3 text-xs">
                  <span className="w-4 text-text-muted text-right">{i + 1}</span>
                  <span className="flex-1 text-text-primary truncate">{t.tag}</span>
                  <div className="w-20 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${((t.avg_score ?? 0) / 10) * 100}%`,
                        backgroundColor: (t.avg_score ?? 0) >= 7 ? '#22c55e' : (t.avg_score ?? 0) >= 4 ? '#f59e0b' : '#ef4444'
                      }} />
                  </div>
                  <span className="w-8 text-right text-text-muted">{t.avg_score?.toFixed(1)}</span>
                  <TrendIcon trend={t.trend} />
                  <span className="w-8 text-right text-text-muted">{t.count}次</span>
                </div>
              ))}
            </div>
          </div>

          {/* History */}
          <div className="bg-bg-secondary rounded-xl p-4 border border-bg-tertiary">
            <h3 className="text-xs font-medium text-text-secondary mb-1">
              历史记录{' '}
              <span className="text-text-muted">
                ({history.length} 组{rawHistory.length !== history.length ? ` · 原始 ${rawHistory.length} 条` : ''})
              </span>
            </h3>
            <p className="text-[10px] text-text-muted mb-3 leading-snug">
              同一次辅助/练习中、间隔在约 {ASSIST_MERGE_GAP_SEC} 秒内的连续语音提问会合并为一行，便于阅读；展开可查看合并后的完整问答。
            </p>
            <div className="space-y-2">
              {history.map((rec) => (
                <div key={`${rec.id}-${rec.mergedCount ?? 1}`} className="border border-bg-tertiary rounded-lg overflow-hidden">
                  <button onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-tertiary/50 transition-colors">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${rec.session_type === 'practice' ? 'bg-accent-blue/10 text-accent-blue' : 'bg-accent-green/10 text-accent-green'}`}>
                      {rec.session_type === 'practice' ? '练习' : '辅助'}
                    </span>
                    {rec.mergedCount != null && rec.mergedCount > 1 && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-bg-tertiary text-text-muted shrink-0" title="由多条语音识别片段合并">
                        ×{rec.mergedCount}
                      </span>
                    )}
                    <span className="flex-1 text-xs text-text-primary truncate">{rec.question}</span>
                    {rec.score !== null && <span className="text-[10px] text-accent-amber">{rec.score}/10</span>}
                    <span className="text-[10px] text-text-muted">
                      {new Date(rec.created_at * 1000).toLocaleDateString()}
                    </span>
                    {expandedId === rec.id ? <ChevronUp className="w-3 h-3 text-text-muted" /> : <ChevronDown className="w-3 h-3 text-text-muted" />}
                  </button>
                  {expandedId === rec.id && (
                    <div className="px-3 pb-3 space-y-2 border-t border-bg-tertiary">
                      <div className="pt-2">
                        <p className="text-[10px] text-text-muted mb-1">问题（合并展示）</p>
                        <p className="text-xs text-text-primary whitespace-pre-wrap leading-relaxed">{rec.question || '(无)'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted mb-1">回答{rec.mergedCount != null && rec.mergedCount > 1 ? '（多段按顺序拼接）' : ''}</p>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed max-h-[min(50vh,24rem)] overflow-y-auto">
                          {rec.answer?.trim() ? rec.answer : '(无回答)'}
                        </p>
                      </div>
                      {rec.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {rec.tags.map(tag => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-bg-tertiary text-text-muted rounded">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {rawHistory.length < historyTotal && (
              <button onClick={loadMoreHistory}
                className="w-full mt-3 py-2 text-xs text-accent-blue hover:text-accent-blue/80 transition-colors">
                加载更多
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
