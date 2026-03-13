import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { RefreshCw, Trash2, ChevronDown, ChevronUp, Target, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface TagSummary {
  tag: string
  count: number
  avg_score: number | null
  trend: 'up' | 'down' | 'stable'
}

interface HistoryRecord {
  id: number
  session_type: string
  question: string
  answer: string
  score: number | null
  tags: string[]
  created_at: number
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
    }
  })

  const gridLevels = [0.25, 0.5, 0.75, 1.0]
  const polyStr = points.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <svg viewBox="0 0 300 260" className="w-full max-w-[320px] mx-auto">
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
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" fill="#3b82f6" />
          <text x={p.lx} y={p.ly} textAnchor="middle" dominantBaseline="middle"
            className="fill-text-secondary" fontSize="9">{p.tag}</text>
          <text x={p.lx} y={p.ly + 12} textAnchor="middle"
            className="fill-text-muted" fontSize="8">{p.score?.toFixed(1)}</text>
        </g>
      ))}
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
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [genLoading, setGenLoading] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [sumRes, histRes] = await Promise.all([
        api.knowledgeSummary(),
        api.knowledgeHistory(1, 20),
      ])
      setTags(sumRes.tags || [])
      setHistory(histRes.records || [])
      setHistoryTotal(histRes.total || 0)
      setHistoryPage(1)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const loadMoreHistory = async () => {
    const next = historyPage + 1
    try {
      const res = await api.knowledgeHistory(next, 20)
      setHistory(prev => [...prev, ...(res.records || [])])
      setHistoryPage(next)
    } catch {}
  }

  const handleReset = async () => {
    if (!confirm('确定要清空所有知识记录吗？')) return
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
        alert('暂无薄弱知识点，多做几道题再来')
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

      {tags.length === 0 ? (
        <div className="text-center py-16 text-text-muted text-xs space-y-2">
          <p>暂无数据</p>
          <p>完成面试辅助或模拟练习后，知识点会自动记录</p>
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
            <h3 className="text-xs font-medium text-text-secondary mb-3">
              历史记录 <span className="text-text-muted">({historyTotal})</span>
            </h3>
            <div className="space-y-2">
              {history.map(rec => (
                <div key={rec.id} className="border border-bg-tertiary rounded-lg overflow-hidden">
                  <button onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-tertiary/50 transition-colors">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${rec.session_type === 'practice' ? 'bg-accent-blue/10 text-accent-blue' : 'bg-accent-green/10 text-accent-green'}`}>
                      {rec.session_type === 'practice' ? '练习' : '辅助'}
                    </span>
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
                        <p className="text-[10px] text-text-muted mb-1">回答</p>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap">{rec.answer?.slice(0, 500) || '(无回答)'}</p>
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
            {history.length < historyTotal && (
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
