import { useState, useEffect } from 'react'
import type { ComponentType } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Edit2,
  Sparkles,
  RotateCw,
  Loader2,
  BarChart3,
  ListTodo,
  MessageSquareQuote,
  ShieldCheck,
  Activity,
  ClipboardCheck,
  Tags,
  Link2,
  Unlink,
  ExternalLink,
} from 'lucide-react'
import dayjs from 'dayjs'
import ReactMarkdown from 'react-markdown'
import { api, getErrorMessage } from '../../lib/api'
import type { ReviewSessionDetail, ReviewTurn } from './types'
import type { Application } from '../job-tracker/types'
import { parseApplication } from '../job-tracker/types'
import { STAGE_LABELS } from '../job-tracker/stageConfig'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

interface Props {
  sessionId: number
  onBack: () => void
}

export default function ReviewSessionDetail({ sessionId, onBack }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReviewSessionDetail | null>(null)
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ title: '', company: '', role: '' })
  const [triggering, setTriggering] = useState(false)
  const [applications, setApplications] = useState<Application[]>([])
  const [applicationSearch, setApplicationSearch] = useState('')
  const [binding, setBinding] = useState(false)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await api.reviewSessionDetail(sessionId)
        setDetail(data)
        setEditForm({
          title: data.title || '',
          company: data.company || '',
          role: data.role || '',
        })
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

  useEffect(() => {
    let cancelled = false
    async function loadApplications() {
      try {
        const res = await api.jobTrackerApplications()
        if (!cancelled) {
          setApplications((res.items as Record<string, unknown>[]).map(parseApplication))
        }
      } catch {
        if (!cancelled) setApplications([])
      }
    }
    loadApplications()
    return () => {
      cancelled = true
    }
  }, [])

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

  const handleSaveEdit = async () => {
    try {
      await api.reviewUpdateSession(sessionId, editForm)
      setDetail((prev) => prev ? { ...prev, ...editForm } : prev)
      setEditing(false)
    } catch (err) {
      alert(getErrorMessage(err, '保存失败'))
    }
  }

  const handleTriggerAnalysis = async () => {
    setTriggering(true)
    try {
      const result = await api.reviewTriggerAnalysis(sessionId)
      if (result.status === 'started' || result.status === 'pending') {
        setDetail((prev) => prev ? { ...prev, status: 'analyzing' } : prev)
        alert('复盘分析已开始，请稍后刷新查看结果')
      } else if (result.status === 'done') {
        alert('复盘已完成')
      }
    } catch (err) {
      alert(getErrorMessage(err, '触发分析失败'))
    } finally {
      setTriggering(false)
    }
  }

  const handleBindApplication = async (applicationId: number | null) => {
    setBinding(true)
    try {
      await api.reviewUpdateSession(sessionId, { application_id: applicationId })
      const data = await api.reviewSessionDetail(sessionId)
      setDetail(data)
      alert(applicationId == null ? '已解除求职记录关联' : '已关联求职记录，并同步复盘待办')
    } catch (err) {
      alert(getErrorMessage(err, '关联求职记录失败'))
    } finally {
      setBinding(false)
    }
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

  const hasGeneratedAnalysis = Boolean(detail.summary_markdown) || detail.avg_score != null ||
    detail.turns?.some((turn) =>
      turn.analysis_status === 'completed' &&
      ((turn.strengths?.length ?? 0) > 0 || (turn.risks?.length ?? 0) > 0 || Object.keys(turn.scorecard ?? {}).length > 0),
    )
  const canTrigger = detail.status === 'analysis_failed' ||
    detail.status === 'recorded' ||
    detail.status === 'recording' ||
    detail.status === 'partial_capture' ||
    (detail.status === 'completed' && !hasGeneratedAnalysis)
  const isAnalyzing = detail.status === 'analyzing'
  const correctedCount = detail.turns?.filter((turn) =>
    Boolean(turn.original_candidate_answer_text && turn.original_candidate_answer_text !== turn.candidate_answer_text),
  ).length ?? 0
  const scoredTurns = detail.turns
    ?.map((turn) => ({ turn, avg: getTurnAvgScore(turn) }))
    .filter((item): item is { turn: ReviewTurn; avg: number } => item.avg !== null) ?? []
  const lowScoreTurns = scoredTurns.filter((item) => item.avg < 6).length
  const nextActions = buildNextActions(detail)
  const scoreDimensions = buildScoreDimensions(detail)
  const followUpDrills = buildFollowUpDrills(detail)
  const applicationQuery = applicationSearch.trim().toLowerCase()
  const filteredApplications = applications
    .filter((app) => {
      if (!applicationQuery) return true
      return `${app.company} ${app.position} ${app.city}`.toLowerCase().includes(applicationQuery)
    })
    .slice(0, 8)

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
          {editing ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="面试标题（可选）"
                className="w-full px-3 py-1.5 rounded-lg bg-bg-secondary border border-bg-hover text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editForm.company}
                  onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                  placeholder="公司名称"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-bg-secondary border border-bg-hover text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
                />
                <input
                  type="text"
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  placeholder="岗位名称"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-bg-secondary border border-bg-hover text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent-blue/50"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-accent-blue/90 transition-colors"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false)
                    setEditForm({
                      title: detail.title || '',
                      company: detail.company || '',
                      role: detail.role || '',
                    })
                  }}
                  className="px-3 py-1.5 rounded-lg bg-bg-tertiary text-text-primary text-xs font-medium hover:bg-bg-hover transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-text-primary">
                  {detail.title || (detail.company && detail.role
                    ? `${detail.company} - ${detail.role}`
                    : detail.company || detail.role || '面试详情')}
                </h2>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                  title="编辑信息"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
              {detail.title && (detail.company || detail.role) && (
                <div className="text-sm text-text-secondary mt-1">
                  {detail.company} {detail.company && detail.role ? '-' : ''} {detail.role}
                </div>
              )}
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
                <span>平均分：{avgScoreDisplay}</span>
              </div>
            </>
          )}
        </div>
        {!editing && canTrigger && !isAnalyzing && (
          <button
            type="button"
            onClick={handleTriggerAnalysis}
            disabled={triggering}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              detail.status === 'analysis_failed'
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50'
                : 'bg-accent-green/10 text-accent-green hover:bg-accent-green/20 disabled:opacity-50'
            }`}
          >
            {triggering ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                处理中
              </>
            ) : detail.status === 'analysis_failed' ? (
              <>
                <RotateCw className="w-4 h-4" />
                重新生成复盘
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                生成复盘
              </>
            )}
          </button>
        )}
        {isAnalyzing && (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 text-blue-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            分析中
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetailMetric icon={BarChart3} label="综合评分" value={detail.avg_score != null ? detail.avg_score.toFixed(1) : '--'} hint="满分 10.0" tone={scoreTone(detail.avg_score)} />
            <DetailMetric icon={ListTodo} label="问答轮次" value={String(detail.turn_count)} hint={`${scoredTurns.length} 轮已评分`} tone="blue" />
            <DetailMetric icon={ShieldCheck} label="低分题" value={String(lowScoreTurns)} hint="低于 6 分需优先补强" tone={lowScoreTurns > 0 ? 'amber' : 'green'} />
            <DetailMetric icon={MessageSquareQuote} label="ASR 纠错" value={String(correctedCount)} hint="保留原文可回看" tone={correctedCount > 0 ? 'blue' : 'neutral'} />
          </div>

          {nextActions.length > 0 && (
            <div className="rounded-lg border border-bg-hover/70 bg-bg-secondary/45 p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <div className="h-5 w-1 rounded-full bg-accent-blue" />
                下一轮补强
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                {nextActions.map((item, idx) => (
                  <div key={`${item}-${idx}`} className="rounded-lg border border-bg-hover bg-bg-tertiary/35 px-3 py-2 text-sm leading-relaxed text-text-primary">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          <ApplicationLinkPanel
            detail={detail}
            applications={filteredApplications}
            search={applicationSearch}
            binding={binding}
            onSearch={setApplicationSearch}
            onBind={handleBindApplication}
            onGoJobTracker={() => setAppMode('job-tracker')}
          />

          {(scoreDimensions.length > 0 || followUpDrills.length > 0) && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              {scoreDimensions.length > 0 && (
                <div className="rounded-lg border border-bg-hover/70 bg-bg-secondary/45 p-5">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <Activity className="h-4 w-4 text-accent-blue" />
                    能力维度
                  </h3>
                  <div className="space-y-3">
                    {scoreDimensions.map((item) => (
                      <div key={item.name}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                          <span className="font-medium text-text-secondary">{item.name}</span>
                          <span className={`font-semibold ${dimensionTone(item.avg)}`}>{item.avg.toFixed(1)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
                          <div
                            className={`h-full rounded-full ${dimensionBarTone(item.avg)}`}
                            style={{ width: `${Math.max(4, Math.min(100, item.avg * 10))}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-text-muted">{item.count} 题覆盖</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {followUpDrills.length > 0 && (
                <div className="rounded-lg border border-bg-hover/70 bg-bg-secondary/45 p-5">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <ClipboardCheck className="h-4 w-4 text-accent-green" />
                    追问训练
                  </h3>
                  <div className="space-y-3">
                    {followUpDrills.map((item) => (
                      <div key={`${item.seq}-${item.question}`} className="rounded-lg border border-bg-hover bg-bg-tertiary/35 p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-bg-hover px-2 py-1 text-[10px] font-medium text-text-muted">第 {item.seq} 题</span>
                          {item.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center gap-1 rounded-md border border-accent-blue/20 bg-accent-blue/10 px-2 py-1 text-[10px] text-accent-blue">
                              <Tags className="h-3 w-3" />
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="text-sm leading-relaxed text-text-primary">{item.question}</div>
                        {item.advice && (
                          <div className="mt-2 text-xs leading-relaxed text-text-muted">{item.advice}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {detail.summary_markdown && (
            <div className="rounded-lg border border-bg-hover/60 bg-bg-secondary/40 p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h3 className="text-base font-semibold text-text-primary mb-4 flex items-center gap-2">
                <div className="w-1 h-5 bg-accent-blue rounded-full"></div>
                整体评价
              </h3>
              <div className="prose prose-sm prose-invert max-w-none text-text-primary leading-relaxed">
                <ReactMarkdown>{detail.summary_markdown}</ReactMarkdown>
              </div>
            </div>
          )}

          {(detail.strong_points && detail.strong_points.length > 0) ||
          (detail.weak_points && detail.weak_points.length > 0) ? (
            <div className="grid grid-cols-2 gap-5">
              {detail.strong_points && detail.strong_points.length > 0 && (
                <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-6 shadow-[0_2px_8px_rgba(34,197,94,0.08)]">
                  <h3 className="text-base font-semibold text-green-500 mb-4 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                      <span className="text-sm">✓</span>
                    </div>
                    高频亮点
                  </h3>
                  <ul className="space-y-3">
                    {detail.strong_points.map((point, idx) => (
                      <li key={idx} className="text-sm text-text-primary flex items-start gap-3 leading-relaxed">
                        <span className="text-green-500 mt-1 text-lg">•</span>
                        <span className="flex-1">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.weak_points && detail.weak_points.length > 0 && (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-6 shadow-[0_2px_8px_rgba(234,179,8,0.08)]">
                  <h3 className="text-base font-semibold text-yellow-500 mb-4 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center">
                      <span className="text-sm">!</span>
                    </div>
                    待改进点
                  </h3>
                  <ul className="space-y-3">
                    {detail.weak_points.map((point, idx) => (
                      <li key={idx} className="text-sm text-text-primary flex items-start gap-3 leading-relaxed">
                        <span className="text-yellow-500 mt-1 text-lg">•</span>
                        <span className="flex-1">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          {detail.turns && detail.turns.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
                <div className="w-1 h-5 bg-accent-blue rounded-full"></div>
                逐题分析
              </h3>
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

  // 计算平均分和颜色
  const avgScore = getTurnAvgScore(turn)
  const hasAsrCorrection = Boolean(
    turn.original_candidate_answer_text &&
    turn.original_candidate_answer_text !== turn.candidate_answer_text,
  )

  const scoreColor = avgScore !== null
    ? avgScore >= 8 ? 'text-green-500 bg-green-500/15 border-green-500/30'
      : avgScore >= 6 ? 'text-blue-500 bg-blue-500/15 border-blue-500/30'
      : avgScore >= 4 ? 'text-yellow-500 bg-yellow-500/15 border-yellow-500/30'
      : 'text-red-500 bg-red-500/15 border-red-500/30'
    : 'text-text-muted bg-bg-hover border-bg-hover'

  return (
    <div className="rounded-lg border border-bg-hover/60 bg-bg-secondary/40 overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-all">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-4 p-5 text-left hover:bg-bg-tertiary/25 transition-colors"
      >
        <div className="flex-shrink-0 mt-1">
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-text-muted" />
          ) : (
            <ChevronRight className="w-5 h-5 text-text-muted" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-text-muted px-2 py-0.5 rounded-full bg-bg-hover">第 {turn.seq} 题</span>
            {turn.is_partial && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500 border border-yellow-500/30">
                部分录制
              </span>
            )}
          </div>
          <div className="text-sm text-text-primary leading-relaxed">{turn.question_text}</div>
        </div>
        {avgScore !== null && (
          <div className="flex-shrink-0 text-right">
            <div className={`inline-flex items-center justify-center w-14 h-14 rounded-full border-2 ${scoreColor}`}>
              <span className="text-lg font-bold">{avgScore.toFixed(1)}</span>
            </div>
          </div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-bg-hover/40 p-5 space-y-5 bg-bg-tertiary/20">
          <div>
            <h4 className="text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">候选人回答</h4>
            {hasAsrCorrection && (
              <div className="mb-3 rounded-lg border border-accent-blue/25 bg-accent-blue/10 px-3 py-2">
                <div className="mb-1 text-[11px] font-semibold text-accent-blue">ASR 已纠错</div>
                <div className="text-xs leading-relaxed text-text-muted">
                  原始转写：{turn.original_candidate_answer_text}
                </div>
              </div>
            )}
            <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed bg-bg-secondary/50 p-4 rounded-lg">
              {turn.candidate_answer_text || '(未录制到回答)'}
            </div>
          </div>

          {turn.code_text && (
            <div>
              <h4 className="text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">代码</h4>
              <pre className="text-xs bg-bg-tertiary/80 p-4 rounded-lg overflow-x-auto border border-bg-hover/40">
                <code>{turn.code_text}</code>
              </pre>
            </div>
          )}

          {hasAnalysis && (
            <>
              {turn.scorecard && Object.keys(turn.scorecard).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-text-muted mb-3 uppercase tracking-wider">评分详情</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {Object.entries(turn.scorecard).map(([key, score]) => {
                      const itemColor = score >= 8 ? 'border-green-500/30 bg-green-500/10 text-green-500'
                        : score >= 6 ? 'border-blue-500/30 bg-blue-500/10 text-blue-500'
                        : score >= 4 ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500'
                        : 'border-red-500/30 bg-red-500/10 text-red-500'

                      return (
                        <div
                          key={key}
                          className={`flex flex-col items-center justify-center px-4 py-3 rounded-lg border ${itemColor}`}
                        >
                          <span className="text-xs text-text-muted mb-1">{key}</span>
                          <span className="text-2xl font-bold">{score}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {turn.strengths && turn.strengths.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-green-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                      <span className="text-xs">✓</span>
                    </div>
                    亮点
                  </h4>
                  <ul className="space-y-2">
                    {turn.strengths.map((s, idx) => (
                      <li key={idx} className="text-sm text-text-primary flex items-start gap-3 leading-relaxed">
                        <span className="text-green-500 mt-1 flex-shrink-0">✓</span>
                        <span className="flex-1">{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {turn.risks && turn.risks.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-yellow-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center">
                      <span className="text-xs">!</span>
                    </div>
                    待改进
                  </h4>
                  <ul className="space-y-2">
                    {turn.risks.map((r, idx) => (
                      <li key={idx} className="text-sm text-text-primary flex items-start gap-3 leading-relaxed">
                        <span className="text-yellow-500 mt-1 flex-shrink-0">⚠</span>
                        <span className="flex-1">{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {!hasAnalysis && (
            <div className="text-xs text-text-muted text-center py-4 bg-bg-secondary/30 rounded-lg">
              {turn.analysis_status === 'pending'
                ? '⏳ 等待分析'
                : turn.analysis_status === 'analyzing'
                  ? '🔄 分析中...'
                  : '暂无分析'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApplicationLinkPanel({
  detail,
  applications,
  search,
  binding,
  onSearch,
  onBind,
  onGoJobTracker,
}: {
  detail: ReviewSessionDetail
  applications: Application[]
  search: string
  binding: boolean
  onSearch: (value: string) => void
  onBind: (applicationId: number | null) => void
  onGoJobTracker: () => void
}) {
  const linked = detail.application
  const [changing, setChanging] = useState(false)
  const selecting = !linked || changing
  return (
    <div className="rounded-lg border border-bg-hover/70 bg-bg-secondary/45 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Link2 className="h-4 w-4 text-accent-blue" />
          关联求职记录
        </h3>
        {linked ? (
          <button
            type="button"
            onClick={onGoJobTracker}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-blue/25 bg-accent-blue/10 px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/15"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            去求职看板
          </button>
        ) : null}
      </div>

      {linked && !changing ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              {linked.company || '未命名公司'} · {linked.position || '岗位'}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {linked.city ? `${linked.city} · ` : ''}{STAGE_LABELS[linked.stage] ?? linked.stage}
            </div>
            <div className="mt-2 text-xs text-text-secondary">
              这场复盘的弱项和低分题会同步到该岗位的待办里。
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={binding}
              onClick={() => setChanging(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-accent-blue/25 bg-accent-blue/10 px-3 py-2 text-xs font-medium text-accent-blue hover:bg-accent-blue/15 disabled:opacity-60"
            >
              <Link2 className="h-3.5 w-3.5" />
              改绑
            </button>
            <button
              type="button"
              disabled={binding}
              onClick={() => onBind(null)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/15 disabled:opacity-60"
            >
              <Unlink className="h-3.5 w-3.5" />
              解绑
            </button>
          </div>
        </div>
      ) : null}

      {selecting && (
        <div className="space-y-3">
          {linked ? (
            <div className="flex items-center justify-between rounded-lg border border-bg-hover bg-bg-tertiary/25 px-3 py-2 text-xs text-text-muted">
              <span>当前关联：{linked.company || '未命名公司'} · {linked.position || '岗位'}</span>
              <button type="button" onClick={() => setChanging(false)} className="text-accent-blue hover:underline">取消改绑</button>
            </div>
          ) : null}
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="搜索公司、岗位、城市后绑定..."
            className="w-full rounded-lg border border-bg-hover bg-bg-tertiary/45 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue/50 focus:outline-none"
          />
          <div className="grid gap-2 md:grid-cols-2">
            {applications.map((app) => (
              <button
                key={app.id}
                type="button"
                disabled={binding}
                onClick={() => {
                  setChanging(false)
                  onBind(app.id)
                }}
                className="rounded-lg border border-bg-hover bg-bg-tertiary/30 px-3 py-2 text-left hover:border-accent-blue/35 hover:bg-accent-blue/5 disabled:opacity-60"
              >
                <div className="text-sm font-semibold text-text-primary">{app.company || '未命名公司'}</div>
                <div className="mt-1 text-xs text-text-muted">
                  {app.position || '岗位'}{app.city ? ` · ${app.city}` : ''} · {STAGE_LABELS[app.stage] ?? app.stage}
                </div>
              </button>
            ))}
          </div>
          {applications.length === 0 ? (
            <div className="rounded-lg border border-bg-hover bg-bg-tertiary/25 px-3 py-4 text-center text-xs text-text-muted">
              暂无可绑定的求职记录，请先在求职看板新增一条。
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function DetailMetric({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  hint: string
  tone: 'blue' | 'green' | 'amber' | 'red' | 'neutral'
}) {
  const toneClass = {
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-500',
    green: 'border-green-500/20 bg-green-500/10 text-green-500',
    amber: 'border-yellow-500/20 bg-yellow-500/10 text-yellow-500',
    red: 'border-red-500/20 bg-red-500/10 text-red-500',
    neutral: 'border-bg-hover bg-bg-tertiary text-text-secondary',
  }[tone]

  return (
    <div className="rounded-lg border border-bg-hover/70 bg-bg-secondary/45 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div>
        </div>
        <div className={`rounded-md border p-2 ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 text-xs text-text-muted">{hint}</div>
    </div>
  )
}

function getTurnAvgScore(turn: ReviewTurn): number | null {
  if (!turn.scorecard || Object.keys(turn.scorecard).length === 0) return null
  const values = Object.values(turn.scorecard)
  return values.reduce((a, b) => a + b, 0) / values.length
}

function scoreTone(score: number | null | undefined): 'blue' | 'green' | 'amber' | 'red' | 'neutral' {
  if (score == null) return 'neutral'
  if (score >= 8) return 'green'
  if (score >= 6) return 'blue'
  if (score >= 4) return 'amber'
  return 'red'
}

function buildScoreDimensions(detail: ReviewSessionDetail) {
  const byName = new Map<string, { total: number; count: number }>()
  for (const turn of detail.turns ?? []) {
    for (const [name, rawScore] of Object.entries(turn.scorecard ?? {})) {
      const score = Number(rawScore)
      if (!Number.isFinite(score)) continue
      const current = byName.get(name) ?? { total: 0, count: 0 }
      current.total += score
      current.count += 1
      byName.set(name, current)
    }
  }
  return [...byName.entries()]
    .map(([name, value]) => ({ name, avg: value.total / value.count, count: value.count }))
    .sort((a, b) => a.avg - b.avg)
}

function buildFollowUpDrills(detail: ReviewSessionDetail) {
  const drills: { seq: number; question: string; advice: string; tags: string[] }[] = []
  for (const turn of detail.turns ?? []) {
    const evidence = turn.evidence ?? {}
    const followUps = getStringList(evidence.follow_up_questions)
    const advice = getStringValue(evidence.improvement_advice)
    const tags = getStringList(evidence.tags).slice(0, 3)
    const fallbackNeeded = getTurnAvgScore(turn) !== null && Number(getTurnAvgScore(turn)) < 6
    const questions = followUps.length > 0
      ? followUps
      : fallbackNeeded
        ? [`请重新回答第 ${turn.seq} 题，并补充一个可落地的项目例子。`]
        : []
    for (const question of questions) {
      if (drills.length >= 6) return drills
      drills.push({
        seq: turn.seq,
        question,
        advice,
        tags,
      })
    }
  }
  return drills
}

function getStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function dimensionTone(score: number) {
  if (score >= 8) return 'text-green-500'
  if (score >= 6) return 'text-blue-500'
  if (score >= 4) return 'text-yellow-500'
  return 'text-red-500'
}

function dimensionBarTone(score: number) {
  if (score >= 8) return 'bg-green-500'
  if (score >= 6) return 'bg-blue-500'
  if (score >= 4) return 'bg-yellow-500'
  return 'bg-red-500'
}

function buildNextActions(detail: ReviewSessionDetail): string[] {
  const actions: string[] = []
  for (const point of detail.weak_points ?? []) {
    if (actions.length >= 4) break
    actions.push(point)
  }
  const lowTurns = [...(detail.turns ?? [])]
    .map((turn) => ({ turn, avg: getTurnAvgScore(turn) }))
    .filter((item): item is { turn: ReviewTurn; avg: number } => item.avg !== null && item.avg < 6)
    .sort((a, b) => a.avg - b.avg)
  for (const item of lowTurns) {
    if (actions.length >= 4) break
    actions.push(`复练第 ${item.turn.seq} 题：${item.turn.question_text.slice(0, 42)}${item.turn.question_text.length > 42 ? '...' : ''}`)
  }
  return actions
}
