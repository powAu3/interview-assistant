import { useState, useEffect } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'
import dayjs from 'dayjs'
import ReactMarkdown from 'react-markdown'
import { api, getErrorMessage } from '../../lib/api'
import type { ReviewSessionDetail, ReviewTurn } from './types'

interface Props {
  sessionId: number
  onBack: () => void
}

export default function ReviewSessionDetail({ sessionId, onBack }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReviewSessionDetail | null>(null)
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await api.reviewSessionDetail(sessionId)
        setDetail(data)
        if (data.turns && data.turns.length > 0) {
          setExpandedTurns(new Set([data.turns[0].id]))
        }
      } catch (err) {
        setError(getErrorMessage(err, '加载详情失败'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  const toggleTurn = (turnId: number) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev)
      if (next.has(turnId)) {
        next.delete(turnId)
      } else {
        next.add(turnId)
      }
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm">加载中...</div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="text-text-muted text-sm">{error || '未找到该记录'}</div>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm rounded-lg bg-bg-tertiary text-text-primary hover:bg-bg-hover transition-colors"
        >
          返回列表
        </button>
      </div>
    )
  }

  const avgScoreDisplay =
    detail.avg_score != null ? detail.avg_score.toFixed(1) : '—'

  return (
    <div className="flex-1 flex flex-col gap-4 p-6 overflow-hidden">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg text-text-muted hover:bg-bg-tertiary transition-colors"
          title="返回列表"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-text-primary">
            {detail.company && detail.role
              ? `${detail.company} - ${detail.role}`
              : detail.company || detail.role || '面试详情'}
          </h2>
          <div className="flex items-center gap-4 mt-1 text-xs text-text-muted">
            <span>
              {dayjs.unix(Math.floor(detail.started_at)).format('YYYY-MM-DD HH:mm')}
            </span>
            {detail.ended_at && (
              <span>
                时长 {Math.floor((detail.ended_at - detail.started_at) / 60)} 分钟
              </span>
            )}
            <span>{detail.turn_count} 轮问答</span>
            <span>平均分 {avgScoreDisplay}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="space-y-4">
          {detail.summary_markdown && (
            <div className="rounded-xl border border-bg-hover/80 bg-bg-secondary/40 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
              <h3 className="text-sm font-semibold text-text-primary mb-3">整体评价</h3>
              <div className="prose prose-sm prose-invert max-w-none text-text-primary">
                <ReactMarkdown>{detail.summary_markdown}</ReactMarkdown>
              </div>
            </div>
          )}

          {(detail.strong_points && detail.strong_points.length > 0) ||
          (detail.weak_points && detail.weak_points.length > 0) ? (
            <div className="grid grid-cols-2 gap-4">
              {detail.strong_points && detail.strong_points.length > 0 && (
                <div className="rounded-xl border border-bg-hover/80 bg-bg-secondary/40 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                  <h3 className="text-sm font-semibold text-green-500 mb-3">高频亮点</h3>
                  <ul className="space-y-2">
                    {detail.strong_points.map((point, idx) => (
                      <li key={idx} className="text-sm text-text-primary flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.weak_points && detail.weak_points.length > 0 && (
                <div className="rounded-xl border border-bg-hover/80 bg-bg-secondary/40 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                  <h3 className="text-sm font-semibold text-yellow-500 mb-3">高频短板</h3>
                  <ul className="space-y-2">
                    {detail.weak_points.map((point, idx) => (
                      <li key={idx} className="text-sm text-text-primary flex items-start gap-2">
                        <span className="text-yellow-500 mt-0.5">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          {detail.turns && detail.turns.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-primary">逐题分析</h3>
              {detail.turns.map((turn) => (
                <TurnCard
                  key={turn.id}
                  turn={turn}
                  expanded={expandedTurns.has(turn.id)}
                  onToggle={() => toggleTurn(turn.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TurnCard({
  turn,
  expanded,
  onToggle,
}: {
  turn: ReviewTurn
  expanded: boolean
  onToggle: () => void
}) {
  const hasAnalysis =
    (turn.strengths && turn.strengths.length > 0) ||
    (turn.risks && turn.risks.length > 0) ||
    (turn.scorecard && Object.keys(turn.scorecard).length > 0)

  return (
    <div className="rounded-xl border border-bg-hover/80 bg-bg-secondary/40 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-bg-tertiary/25 transition-colors"
      >
        <div className="flex-shrink-0 mt-0.5">
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-text-muted" />
          ) : (
            <ChevronRight className="w-5 h-5 text-text-muted" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-text-muted">第 {turn.seq} 题</span>
            {turn.is_partial && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-500">
                部分录制
              </span>
            )}
          </div>
          <div className="text-sm text-text-primary line-clamp-2">{turn.question_text}</div>
        </div>
        {turn.scorecard && Object.keys(turn.scorecard).length > 0 && (
          <div className="flex-shrink-0 text-right">
            <div className="text-sm font-semibold text-text-primary">
              {Object.values(turn.scorecard).reduce((a, b) => a + b, 0) /
                Object.keys(turn.scorecard).length}
            </div>
            <div className="text-[10px] text-text-muted">平均分</div>
          </div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-bg-hover/50 p-4 space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-text-muted mb-2">候选人回答</h4>
            <div className="text-sm text-text-primary whitespace-pre-wrap">
              {turn.candidate_answer_text || '(未录制到回答)'}
            </div>
          </div>

          {turn.code_text && (
            <div>
              <h4 className="text-xs font-semibold text-text-muted mb-2">代码</h4>
              <pre className="text-xs bg-bg-tertiary/50 p-3 rounded-lg overflow-x-auto">
                <code>{turn.code_text}</code>
              </pre>
            </div>
          )}

          {hasAnalysis && (
            <>
              {turn.scorecard && Object.keys(turn.scorecard).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-text-muted mb-2">评分</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {Object.entries(turn.scorecard).map(([key, score]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-tertiary/30"
                      >
                        <span className="text-xs text-text-muted">{key}</span>
                        <span className="text-sm font-semibold text-text-primary">{score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {turn.strengths && turn.strengths.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-green-500 mb-2">亮点</h4>
                  <ul className="space-y-1.5">
                    {turn.strengths.map((s, idx) => (
                      <li key={idx} className="text-sm text-text-primary flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {turn.risks && turn.risks.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-yellow-500 mb-2">风险</h4>
                  <ul className="space-y-1.5">
                    {turn.risks.map((r, idx) => (
                      <li key={idx} className="text-sm text-text-primary flex items-start gap-2">
                        <span className="text-yellow-500 mt-0.5">⚠</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {!hasAnalysis && (
            <div className="text-xs text-text-muted text-center py-2">
              {turn.analysis_status === 'pending'
                ? '等待分析'
                : turn.analysis_status === 'analyzing'
                  ? '分析中...'
                  : '暂无分析'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
