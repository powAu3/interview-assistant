import { useState, useEffect } from 'react'
import type { ComponentType, ReactNode } from 'react'
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
import { STAGE_LABELS, isTerminalStage } from '../job-tracker/stageConfig'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

interface Props {
  sessionId: number
  onBack: () => void
}

type InlineNotice = {
  tone: 'success' | 'info' | 'warning' | 'error'
  message: string
}

const REVIEW_STATUS_META: Record<ReviewSessionDetail['status'], { label: string; className: string }> = {
  recording: {
    label: '录制中',
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
  },
  recorded: {
    label: '已记录',
    className: 'border-zinc-500/25 bg-bg-tertiary/70 text-text-secondary',
  },
  analyzing: {
    label: '分析中',
    className: 'border-blue-500/25 bg-blue-500/10 text-blue-500',
  },
  completed: {
    label: '已完成',
    className: 'border-green-500/25 bg-green-500/10 text-green-500',
  },
  partial_capture: {
    label: '采集不完整',
    className: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-500',
  },
  analysis_failed: {
    label: '分析失败',
    className: 'border-red-500/25 bg-red-500/10 text-red-500',
  },
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
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)
  const setJobTrackerDeepLink = useUiPrefsStore((s) => s.setJobTrackerDeepLink)

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

  useEffect(() => {
    if (!inlineNotice) return undefined
    const timer = window.setTimeout(() => setInlineNotice(null), 3600)
    return () => window.clearTimeout(timer)
  }, [inlineNotice])

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
      setInlineNotice({ tone: 'success', message: '已保存复盘标题与岗位信息' })
    } catch (err) {
      setInlineNotice({ tone: 'error', message: getErrorMessage(err, '保存失败') })
    }
  }

  const handleTriggerAnalysis = async () => {
    setTriggering(true)
    try {
      const result = await api.reviewTriggerAnalysis(sessionId)
      if (result.status === 'started' || result.status === 'pending') {
        setDetail((prev) => prev ? { ...prev, status: 'analyzing' } : prev)
        setInlineNotice({ tone: 'info', message: '复盘分析已开始，请稍后刷新查看结果' })
      } else if (result.status === 'done') {
        setInlineNotice({ tone: 'success', message: '复盘已完成' })
      }
    } catch (err) {
      setInlineNotice({ tone: 'error', message: getErrorMessage(err, '触发分析失败') })
    } finally {
      setTriggering(false)
    }
  }

  const handleBindApplication = async (applicationId: number | null) => {
    setBinding(true)
    try {
      const result = await api.reviewUpdateSession(sessionId, { application_id: applicationId }) as {
        auto_sync_eligible?: boolean
      }
      const data = await api.reviewSessionDetail(sessionId)
      setDetail(data)
      if (applicationId == null) {
        setInlineNotice({ tone: 'info', message: '已解除求职记录关联' })
      } else if (result?.auto_sync_eligible === false) {
        setInlineNotice({ tone: 'warning', message: '已关联求职记录；当前复盘少于 5 轮，暂不自动同步待办和复盘摘要' })
      } else {
        setInlineNotice({ tone: 'success', message: '已关联求职记录，并同步复盘待办' })
      }
    } catch (err) {
      setInlineNotice({ tone: 'error', message: getErrorMessage(err, '关联求职记录失败') })
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

  const avgScoreDisplay = detail.avg_score != null ? detail.avg_score.toFixed(1) : '—'

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
  const hasTakeaways = (detail.strong_points?.length ?? 0) > 0 || (detail.weak_points?.length ?? 0) > 0
  const summaryMissing = !detail.summary_markdown
  const autoExpandTurns = summaryMissing && detail.turns.length > 0 && detail.turns.length <= 3
  const applicationQuery = applicationSearch.trim().toLowerCase()
  const linkedApplicationSummary = detail.application
    ? applications.find((app) => app.id === detail.application?.id) ?? null
    : null
  const filteredApplications = applications
    .filter((app) => {
      if (!applicationQuery) return true
      return `${app.company} ${app.position} ${app.city}`.toLowerCase().includes(applicationQuery)
    })
    .slice(0, 8)
  const titleText = detail.title || (detail.company && detail.role
    ? `${detail.company} - ${detail.role}`
    : detail.company || detail.role || '面试详情')
  const detailIdentityText = `${detail.company ?? ''}${detail.company && detail.role ? ' - ' : ''}${detail.role ?? ''}`.trim()
  const subtitleText = detail.title && (detail.company || detail.role) && normalizeCompareText(detail.title) !== normalizeCompareText(detailIdentityText)
    ? detailIdentityText
    : null
  const reviewStatusMeta = REVIEW_STATUS_META[detail.status]
  const sessionDurationMinutes = detail.ended_at
    ? Math.max(1, Math.floor((detail.ended_at - detail.started_at) / 60))
    : null

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-[28px] border border-bg-hover/80 bg-bg-secondary/45 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 rounded-xl border border-bg-hover bg-bg-tertiary/30 p-2 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              title="返回列表"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge className={reviewStatusMeta.className}>
                  {reviewStatusMeta.label}
                </StatusBadge>
                <StatusBadge className={detail.application ? 'border-accent-blue/25 bg-accent-blue/10 text-accent-blue' : 'border-bg-hover bg-bg-tertiary/60 text-text-secondary'}>
                  {detail.application ? '已绑定求职记录' : '未绑定求职记录'}
                </StatusBadge>
                {detail.auto_sync_eligible === false ? (
                  <StatusBadge className="border-yellow-500/25 bg-yellow-500/10 text-yellow-500">
                    测试片段
                  </StatusBadge>
                ) : null}
              </div>

              <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.78fr)]">
                <div className="min-w-0">
                  {editing ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        placeholder="面试标题（可选）"
                        className="w-full rounded-xl border border-bg-hover bg-bg-secondary px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/15"
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input
                          type="text"
                          value={editForm.company}
                          onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                          placeholder="公司名称"
                          className="w-full rounded-xl border border-bg-hover bg-bg-secondary px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/15"
                        />
                        <input
                          type="text"
                          value={editForm.role}
                          onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                          placeholder="岗位名称"
                          className="w-full rounded-xl border border-bg-hover bg-bg-secondary px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/15"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          className="rounded-xl bg-accent-blue px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                        >
                          保存信息
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
                          className="rounded-xl border border-bg-hover px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                        复盘详情
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-bold tracking-tight text-text-primary md:text-[28px]">
                          {titleText}
                        </h2>
                        <button
                          type="button"
                          onClick={() => setEditing(true)}
                          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                          title="编辑信息"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                      {subtitleText ? (
                        <div className="mt-1 text-sm text-text-secondary">
                          {subtitleText}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
                        <span>{dayjs.unix(Math.floor(detail.started_at)).format('YYYY-MM-DD HH:mm')}</span>
                        {sessionDurationMinutes != null ? <span>时长 {sessionDurationMinutes} 分钟</span> : null}
                        <span>{detail.turn_count} 轮问答</span>
                        <span>{scoredTurns.length} 轮已评分</span>
                      </div>
                      {detail.auto_sync_eligible === false ? (
                        <div className="mt-3 rounded-2xl border border-yellow-500/25 bg-yellow-500/8 px-3 py-3">
                          <div className="text-sm font-semibold text-yellow-500">这场记录更像测试片段</div>
                          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                            当前只有 {detail.turn_count} 轮问答，默认不会自动把复盘摘要和待办推回求职看板，避免短样本污染主流程。
                          </p>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {!editing ? (
                  <div className="space-y-3">
                    <div className="flex w-full flex-wrap items-center gap-2 xl:justify-end">
                      {canTrigger && !isAnalyzing ? (
                        <button
                          type="button"
                          onClick={handleTriggerAnalysis}
                          disabled={triggering}
                          className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                            detail.status === 'analysis_failed'
                              ? 'bg-red-500/12 text-red-500 hover:bg-red-500/18 disabled:opacity-50'
                              : 'bg-accent-blue text-white hover:brightness-110 disabled:opacity-50'
                          }`}
                        >
                          {triggering ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              处理中
                            </>
                          ) : detail.status === 'analysis_failed' ? (
                            <>
                              <RotateCw className="h-4 w-4" />
                              重新生成复盘
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4" />
                              生成复盘
                            </>
                          )}
                        </button>
                      ) : null}
                      {isAnalyzing ? (
                        <div className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-500/10 px-4 py-3 text-sm font-medium text-blue-500">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          分析中
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <HeaderCompactMetric
                        label="评分"
                        value={avgScoreDisplay}
                        hint="平均分"
                        tone={detail.avg_score != null ? scoreBadgeClass(detail.avg_score) : 'border-bg-hover bg-bg-tertiary/50 text-text-primary'}
                      />
                      <HeaderCompactMetric
                        label="轮次"
                        value={String(detail.turn_count)}
                        hint={`${scoredTurns.length} 轮已评分`}
                        tone="border-accent-blue/20 bg-accent-blue/8 text-accent-blue"
                      />
                      <HeaderCompactMetric
                        label="纠错"
                        value={String(correctedCount)}
                        hint="ASR 修正"
                        tone={correctedCount > 0 ? 'border-blue-500/20 bg-blue-500/8 text-blue-500' : 'border-bg-hover bg-bg-tertiary/50 text-text-secondary'}
                      />
                      <HeaderCompactMetric
                        label="主线"
                        value={detail.application ? '已绑定' : '未绑定'}
                        hint={detail.application ? '可直接跳回岗位主线' : '还没挂到岗位时间线'}
                        tone={detail.application ? 'border-accent-blue/20 bg-accent-blue/8 text-accent-blue' : 'border-bg-hover bg-bg-tertiary/50 text-text-secondary'}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {inlineNotice ? (
          <InlineNoticeBanner notice={inlineNotice} />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_340px]">
          <div className="space-y-4">
            <SectionPanel
              title={summaryMissing ? '当前状态' : '整体评价'}
              subtitle={summaryMissing
                ? '先确认这场记录目前处在哪一步，再决定是生成复盘、绑定岗位，还是直接回看逐题。'
                : '先看总结和下一步，再决定是否需要下钻到逐题证据。'}
            >
              {detail.summary_markdown ? (
                <div className="prose prose-sm prose-invert max-w-none text-text-primary leading-relaxed">
                  <ReactMarkdown>{detail.summary_markdown}</ReactMarkdown>
                </div>
              ) : (
                <PendingSummaryWorkspace
                  detail={detail}
                  scoredTurnsCount={scoredTurns.length}
                  correctedCount={correctedCount}
                  canTrigger={canTrigger}
                  isAnalyzing={isAnalyzing}
                  autoExpandTurns={autoExpandTurns}
                />
              )}
            </SectionPanel>

            {nextActions.length > 0 ? (
              <SectionPanel
                title="下一轮补强"
                subtitle="默认只给最值得立刻练的几件事，不把整份复盘都压给你。"
              >
                <div className="grid gap-2 md:grid-cols-2">
                  {nextActions.map((item, idx) => (
                    <div key={`${item}-${idx}`} className="rounded-2xl border border-bg-hover bg-bg-tertiary/30 px-3 py-3 text-sm leading-relaxed text-text-primary">
                      {item}
                    </div>
                  ))}
                </div>
              </SectionPanel>
            ) : null}

            {detail.turns.length > 0 ? (
              <CollapsibleSection
                title={`逐题分析 · ${detail.turns.length} 题`}
                subtitle={autoExpandTurns
                  ? '这场记录比较短，已经直接展开原始问答，方便排错或快速回看。'
                  : '只有需要找具体证据、回答原文或逐题评分时再展开。'}
                defaultOpen={autoExpandTurns}
              >
                <div className="space-y-3">
                  {detail.turns.map((turn) => (
                    <TurnCard
                      key={turn.id}
                      turn={turn}
                      expanded={expandedTurns.has(turn.id)}
                      onToggle={() => toggleTurn(turn.id)}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            ) : (
              <SectionPanel
                title="逐题分析"
                subtitle="这场记录还没有可回看的问答内容。"
              >
                <div className="rounded-2xl border border-dashed border-bg-hover bg-bg-tertiary/20 px-4 py-6 text-sm leading-relaxed text-text-secondary">
                  等录到实际问答后，这里会保留逐题原文、ASR 纠错、评分和后续分析证据。
                </div>
              </SectionPanel>
            )}
          </div>

          <div className="space-y-4 xl:sticky xl:top-3 xl:self-start">
            <ApplicationLinkPanel
              detail={detail}
              linkedApplicationSummary={linkedApplicationSummary}
              applications={filteredApplications}
              search={applicationSearch}
              binding={binding}
              onSearch={setApplicationSearch}
              onBind={handleBindApplication}
              onGoJobTracker={(applicationId) => {
                setJobTrackerDeepLink({
                  applicationId,
                  openReviews: false,
                })
                setAppMode('job-tracker')
              }}
              onOpenReviewTimeline={(applicationId) => {
                setJobTrackerDeepLink({
                  applicationId,
                  openReviews: true,
                  highlightReviewId: sessionId,
                })
                setAppMode('job-tracker')
              }}
            />

            <SectionPanel
              title="本场速览"
              subtitle="先看这场的分数、低分题和纠错量，再决定要不要下钻到逐题。"
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <DetailMetric icon={BarChart3} label="综合评分" value={avgScoreDisplay} hint="满分 10.0" tone={scoreTone(detail.avg_score)} />
                <DetailMetric icon={ListTodo} label="问答轮次" value={String(detail.turn_count)} hint={`${scoredTurns.length} 轮已评分`} tone="blue" />
                <DetailMetric icon={ShieldCheck} label="低分题" value={String(lowScoreTurns)} hint="低于 6 分需优先补强" tone={lowScoreTurns > 0 ? 'amber' : 'green'} />
                <DetailMetric icon={MessageSquareQuote} label="ASR 纠错" value={String(correctedCount)} hint="保留原文可回看" tone={correctedCount > 0 ? 'blue' : 'neutral'} />
              </div>
            </SectionPanel>

            {hasTakeaways ? (
              <TakeawaysPanel
                strongPoints={detail.strong_points ?? []}
                weakPoints={detail.weak_points ?? []}
              />
            ) : null}

            {scoreDimensions.length > 0 ? (
              <CollapsibleSection
                title="能力维度"
                subtitle="更适合回头校准评分结构，默认先收起。"
              >
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
              </CollapsibleSection>
            ) : null}

            {followUpDrills.length > 0 ? (
              <CollapsibleSection
                title={`追问训练 · ${followUpDrills.length}`}
                subtitle="需要练答法时再展开，不占用默认阅读面。"
              >
                <div className="space-y-3">
                  {followUpDrills.map((item) => (
                    <div key={`${item.seq}-${item.question}`} className="rounded-2xl border border-bg-hover bg-bg-tertiary/30 p-3">
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
                      {item.advice ? (
                        <div className="mt-2 text-xs leading-relaxed text-text-muted">{item.advice}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionPanel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[24px] border border-bg-hover/80 bg-bg-secondary/45 p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm leading-relaxed text-text-secondary">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

function CollapsibleSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="rounded-[24px] border border-bg-hover/80 bg-bg-secondary/45 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm leading-relaxed text-text-secondary">{subtitle}</p> : null}
        </div>
        <span className="rounded-full border border-bg-hover p-2 text-text-muted">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {open ? <div className="border-t border-bg-hover/80 px-5 py-4">{children}</div> : null}
    </section>
  )
}

function TakeawaysPanel({
  strongPoints,
  weakPoints,
}: {
  strongPoints: string[]
  weakPoints: string[]
}) {
  return (
    <SectionPanel
      title="亮点与风险"
      subtitle="把“值得保留”与“最该修正”的信号放在一张卡里，不用来回切视线。"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
        {strongPoints.length > 0 ? (
          <div className="rounded-2xl border border-green-500/20 bg-green-500/6 p-4">
            <div className="text-sm font-semibold text-green-500">高频亮点</div>
            <ul className="mt-3 space-y-2">
              {strongPoints.map((point, idx) => (
                <li key={`${point}-${idx}`} className="flex items-start gap-2 text-sm leading-relaxed text-text-primary">
                  <span className="mt-1 text-green-500">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {weakPoints.length > 0 ? (
          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/6 p-4">
            <div className="text-sm font-semibold text-yellow-500">待改进点</div>
            <ul className="mt-3 space-y-2">
              {weakPoints.map((point, idx) => (
                <li key={`${point}-${idx}`} className="flex items-start gap-2 text-sm leading-relaxed text-text-primary">
                  <span className="mt-1 text-yellow-500">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionPanel>
  )
}

function StatusBadge({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  )
}

function HeaderCompactMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone: string
}) {
  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-75">{label}</div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-muted">{hint}</div>
        </div>
        <div className="shrink-0 text-lg font-semibold leading-none text-text-primary">{value}</div>
      </div>
    </div>
  )
}

function scoreBadgeClass(score: number): string {
  if (score >= 8) return 'border-green-500/25 bg-green-500/10 text-green-500'
  if (score >= 6) return 'border-blue-500/25 bg-blue-500/10 text-blue-500'
  if (score >= 4) return 'border-yellow-500/25 bg-yellow-500/10 text-yellow-500'
  return 'border-red-500/25 bg-red-500/10 text-red-500'
}

function normalizeCompareText(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function PendingSummaryWorkspace({
  detail,
  scoredTurnsCount,
  correctedCount,
  canTrigger,
  isAnalyzing,
  autoExpandTurns,
}: {
  detail: ReviewSessionDetail
  scoredTurnsCount: number
  correctedCount: number
  canTrigger: boolean
  isAnalyzing: boolean
  autoExpandTurns: boolean
}) {
  const linkedLabel = detail.application
    ? `${detail.application.company || '未命名公司'} · ${detail.application.position || '岗位'}`
    : '还没挂到岗位主线'

  const headline = isAnalyzing
    ? '这场记录正在整理成正式复盘'
    : detail.status === 'analysis_failed'
      ? '上一次复盘生成失败了'
      : detail.auto_sync_eligible === false
        ? '这场记录更适合当测试片段'
        : detail.status === 'recorded' || detail.status === 'recording' || detail.status === 'partial_capture'
          ? '这场记录还处在原始记录阶段'
          : '这场记录还没整理成正式复盘'

  const description = isAnalyzing
    ? `系统正在根据已记录的 ${detail.turn_count} 轮问答补出总结、低分题和补强项。现在可以先确认岗位绑定，或者直接往下回看逐题记录。`
    : detail.status === 'analysis_failed'
      ? '原始问答还在，重新生成一次通常就能补出总结、补强项和追问训练，不需要重新录制。'
      : detail.auto_sync_eligible === false
        ? `当前只有 ${detail.turn_count} 轮问答，默认不会自动把摘要和待办同步回求职看板，更适合用来排错、试录或验证链路。`
        : detail.turn_count <= 0
          ? '这场记录已经建立，但还没有足够内容生成有效总结。后面录到实际问答后，这里会自然变成正式复盘。'
          : `当前已保留 ${detail.turn_count} 轮问答${correctedCount > 0 ? `，以及 ${correctedCount} 处 ASR 纠错` : ''}。你可以先把它挂到岗位主线，再决定要不要生成结构化复盘。`

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)]">
      <div className="rounded-2xl border border-bg-hover bg-bg-tertiary/24 p-4">
        <div className="text-sm font-semibold text-text-primary">{headline}</div>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          {description}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <SummaryFactPill label="问答" value={`${detail.turn_count} 轮`} />
          <SummaryFactPill label="已评分" value={`${scoredTurnsCount} 轮`} />
          <SummaryFactPill label="岗位主线" value={detail.application ? '已绑定' : '未绑定'} />
          {detail.auto_sync_eligible === false ? (
            <SummaryFactPill label="自动回写" value="关闭" accent="warning" />
          ) : null}
        </div>
      </div>

      <div className="grid gap-3">
        <ReviewActionCard
          icon={<Sparkles className="h-4 w-4 text-accent-blue" />}
          title={isAnalyzing ? '复盘生成中' : detail.status === 'analysis_failed' ? '重新生成复盘' : '生成结构化复盘'}
          description={isAnalyzing
            ? '等结构化结果出来后，这里会补出总结、补强点和低分题。'
            : detail.auto_sync_eligible === false
              ? '就算只是测试片段，也可以先在这里生成一版本地复盘，不会污染求职看板。'
              : '把原始问答整理成更适合回看的总结、补强点和训练建议。'}
          footer={isAnalyzing ? '正在处理中' : canTrigger ? '右上角可以直接开始生成' : '这场记录已经具备结构化结果'}
        />
        <ReviewActionCard
          icon={<Link2 className="h-4 w-4 text-accent-blue" />}
          title={detail.application ? '岗位主线已接上' : '挂到岗位主线'}
          description={detail.application
            ? `当前已挂到 ${linkedLabel}，后续同岗位的新复盘会继续串在同一条时间线上。`
            : '右侧直接绑定后，这场记录就会并入同岗位时间线，不会散在复盘列表里。'}
          footer={detail.application ? '可以从右侧直接跳回岗位主线' : '绑定后更适合沿着同岗位回看多轮面试'}
        />
        <ReviewActionCard
          icon={<MessageSquareQuote className="h-4 w-4 text-accent-blue" />}
          title="回看逐题记录"
          description={detail.turn_count > 0
            ? `本场共记录 ${detail.turn_count} 题${autoExpandTurns ? '，下方已经直接展开原始问答。' : '，需要时再展开下方逐题区。'}`
            : '当前还没有逐题记录可回看，后面录到真实问答后会出现在这里。'}
          footer={detail.turn_count > 0 ? '排错、试录或短样本验证时，逐题原文通常最有价值' : '有实际问答后，这里会保留原文与分析证据'}
        />
      </div>
    </div>
  )
}

function ReviewActionCard({
  icon,
  title,
  description,
  footer,
}: {
  icon: ReactNode
  title: string
  description: string
  footer: string
}) {
  return (
    <div className="rounded-2xl border border-bg-hover bg-bg-secondary/55 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-accent-blue/15 bg-accent-blue/8">
          {icon}
        </span>
        <span>{title}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        {description}
      </p>
      <div className="mt-3 text-[11px] leading-relaxed text-text-muted">
        {footer}
      </div>
    </div>
  )
}

function SummaryFactPill({
  label,
  value,
  accent = 'neutral',
}: {
  label: string
  value: string
  accent?: 'neutral' | 'warning'
}) {
  const accentClass = accent === 'warning'
    ? 'border-yellow-500/20 bg-yellow-500/8 text-yellow-500'
    : 'border-bg-hover bg-bg-secondary/75 text-text-muted'

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${accentClass}`}>
      <span className="font-medium text-text-secondary">{label}</span>
      <span>{value}</span>
    </span>
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
  linkedApplicationSummary,
  applications,
  search,
  binding,
  onSearch,
  onBind,
  onGoJobTracker,
  onOpenReviewTimeline,
}: {
  detail: ReviewSessionDetail
  linkedApplicationSummary: Application | null
  applications: Application[]
  search: string
  binding: boolean
  onSearch: (value: string) => void
  onBind: (applicationId: number | null) => void
  onGoJobTracker: (applicationId: number) => void
  onOpenReviewTimeline: (applicationId: number) => void
}) {
  const linked = detail.application
  const [changing, setChanging] = useState(false)
  const selecting = !linked || changing
  const isClosedStage = linked ? isTerminalStage(linked.stage) : false
  const sessionMoment = detail.ended_at ?? detail.started_at
  const linkedReviewSummary = linkedApplicationSummary?.review_summary
  const linkedReviewCount = linkedReviewSummary?.review_count ?? 0
  const isLatestLinkedReview = linkedReviewSummary?.latest_review_id != null && linkedReviewSummary.latest_review_id === detail.id
  const linkedStageLabel = linked ? STAGE_LABELS[linked.stage] ?? linked.stage : ''
  const reviewRelationshipLabel = linkedReviewCount <= 1
    ? '当前只有这一场'
    : isLatestLinkedReview
      ? '当前这场是最近一场'
      : '当前这场是更早的一场'
  const reviewRelationshipHint = linkedReviewCount <= 1
    ? '后面同岗位的新复盘会继续往这条岗位时间线上挂。'
    : isLatestLinkedReview
      ? '后面如果还有下一轮面试，新复盘会继续接在这场后面。'
      : linkedReviewSummary?.latest_review_at != null
        ? `最近一场在 ${dayjs.unix(Math.floor(linkedReviewSummary.latest_review_at)).format('YYYY-MM-DD HH:mm')}。`
        : '最近一场会继续显示在这条岗位时间线的末尾。'
  const timelineHeadline = linkedReviewCount > 1
    ? `同岗位已串起 ${linkedReviewCount} 场复盘`
    : '当前这场已经挂回岗位主线'
  const timelineDescription = linkedReviewCount > 1
    ? (isLatestLinkedReview
        ? '这条岗位已经形成连续时间线，后面如果还有下一轮面试，新复盘会继续接在后面。'
        : '你现在看的这场会保留在更早位置，最近一场和后续新复盘会继续挂在同一条岗位主线上。')
    : (isClosedStage
        ? '虽然这条岗位已经结束，但这场复盘和后续补录内容都会继续保留在这条岗位主线上。'
        : '现在先把这场复盘挂到岗位主线，后面同岗位的新复盘就会自然接成时间线。')
  return (
    <section className="rounded-[24px] border border-bg-hover/80 bg-bg-secondary/45 p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Link2 className="h-4 w-4 text-accent-blue" />
            关联求职记录
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            挂回岗位主线后，同一岗位的多轮面试就会自然串成 1 条时间线。
          </p>
        </div>
        {linked ? (
          <button
            type="button"
            onClick={() => onGoJobTracker(linked.id)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent-blue/25 bg-accent-blue/10 px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/15"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            去求职看板
          </button>
        ) : null}
      </div>

      {linked && !changing ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-accent-blue/15 bg-accent-blue/[0.045] p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-blue">
                岗位时间线
              </span>
              <span className="text-sm font-semibold text-text-primary">
                {linked.company || '未命名公司'} · {linked.position || '岗位'}
              </span>
              <StatusBadge className="border-bg-hover bg-bg-secondary/70 text-text-secondary">
                {linkedStageLabel}
              </StatusBadge>
            </div>
            <div className="mt-2 text-[11px] text-text-muted">
              {linked.city ? `${linked.city} · ` : ''}{isClosedStage ? '这条岗位已经进入终态' : '这条岗位仍在主流程里推进'}
            </div>

            <div className="mt-3 rounded-2xl border border-bg-hover bg-white/[0.38] px-3.5 py-3">
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                    linkedReviewCount > 0 ? 'text-accent-blue' : 'text-text-muted'
                  }`}>
                    {linkedReviewCount > 1 ? '同岗位时间线' : '当前复盘位置'}
                  </div>
                  <span className="rounded-full border border-bg-hover bg-bg-tertiary/45 px-2.5 py-1 text-[10px] font-medium text-text-muted">
                    当前这场 · {reviewRelationshipLabel}
                  </span>
                </div>
                <div className="text-[15px] font-semibold text-text-primary">
                  {timelineHeadline}
                </div>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {timelineDescription}
                </p>
                <div className="flex flex-wrap gap-2">
                  {linkedReviewSummary && linkedReviewSummary.review_count > 0 ? (
                    <button
                      type="button"
                      disabled={binding}
                      onClick={() => onOpenReviewTimeline(linked.id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-accent-blue/20 bg-accent-blue/10 px-3 py-1.5 text-[11px] font-semibold text-accent-blue hover:bg-accent-blue/15 disabled:opacity-60"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      查看这条岗位的全部复盘
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={binding}
                    onClick={() => setChanging(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-bg-hover bg-bg-tertiary/35 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:text-text-primary disabled:opacity-60"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    改绑
                  </button>
                  <button
                    type="button"
                    disabled={binding}
                    onClick={() => onBind(null)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-400 hover:bg-red-500/15 disabled:opacity-60"
                  >
                    <Unlink className="h-3.5 w-3.5" />
                    解绑
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 lg:grid-cols-3 xl:grid-cols-1">
              <LinkInsightCard
                label="岗位阶段"
                value={linkedStageLabel}
                hint={isClosedStage ? '已结束，不再进入待跟进提醒。' : '这条岗位仍在主流程里继续推进。'}
              />
              <LinkInsightCard
                label="同岗位复盘"
                value={linkedReviewCount > 0 ? `${linkedReviewCount} 场` : '暂无'}
                hint={linkedReviewCount > 1 ? '一条岗位会自然串起多轮面试。' : '后续复盘会继续挂回这里。'}
              />
              <LinkInsightCard
                label="当前这场"
                value={reviewRelationshipLabel}
                hint={reviewRelationshipHint}
              />
            </div>
          </div>

          {(linked.applied_at != null || linked.next_followup_at != null || sessionMoment != null) && (
            <div className="flex flex-wrap gap-2 text-[10px] text-text-muted">
              {linked.applied_at != null ? (
                <span className="rounded-full border border-bg-hover bg-bg-tertiary/35 px-2.5 py-1">
                  投递 {dayjs.unix(Math.floor(linked.applied_at)).format('YYYY-MM-DD')}
                </span>
              ) : (
                <span className="rounded-full border border-bg-hover bg-bg-tertiary/35 px-2.5 py-1">
                  投递时间未记录
                </span>
              )}
              {sessionMoment != null ? (
                <span className="rounded-full border border-accent-blue/15 bg-accent-blue/6 px-2.5 py-1 text-accent-blue">
                  本场复盘 {dayjs.unix(Math.floor(sessionMoment)).format('YYYY-MM-DD HH:mm')}
                </span>
              ) : null}
              {isClosedStage ? (
                <span className="rounded-full border border-bg-hover bg-bg-tertiary/35 px-2.5 py-1">
                  结果 {STAGE_LABELS[linked.stage] ?? linked.stage}
                </span>
              ) : linked.next_followup_at != null ? (
                <span className="rounded-full border border-bg-hover bg-bg-tertiary/35 px-2.5 py-1">
                  跟进 {dayjs.unix(Math.floor(linked.next_followup_at)).format('YYYY-MM-DD HH:mm')}
                </span>
              ) : (
                <span className="rounded-full border border-bg-hover bg-bg-tertiary/35 px-2.5 py-1">
                  跟进时间未设置
                </span>
              )}
            </div>
          )}

          <div className="rounded-xl border border-bg-hover/80 bg-bg-tertiary/22 px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary">
            {detail.auto_sync_eligible === false
              ? '当前复盘少于 5 轮，已建立关联，但不会自动同步待办和复盘摘要，避免测试记录污染看板。'
              : isClosedStage
                ? `这条岗位当前已${linkedStageLabel}。复盘会继续保留，方便回看原因，但不会作为待跟进提醒。`
                : '这场复盘的弱项和低分题会同步到该岗位的待办里。'}
            {linkedReviewSummary && linkedReviewSummary.review_count > 0 ? (
              <span className="mt-2 block text-text-muted">
                这条岗位当前共 {linkedReviewSummary.review_count} 场复盘
                {linkedReviewSummary.latest_review_at != null
                  ? `，最近一次 ${dayjs.unix(Math.floor(linkedReviewSummary.latest_review_at)).format('YYYY-MM-DD HH:mm')}`
                  : ''}
                。
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {selecting && (
        <div className="space-y-3">
          {!linked ? (
            <div className="rounded-2xl border border-dashed border-accent-blue/25 bg-accent-blue/[0.04] px-3 py-3 text-xs leading-relaxed text-text-secondary">
              先把这场复盘挂到一个岗位上，后面同岗位的新复盘就会自然接成一条时间线。
            </div>
          ) : null}
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
    </section>
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

function LinkInsightCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-xl border border-bg-hover/80 bg-bg-tertiary/28 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</div>
        <div className="text-[12px] font-semibold text-text-primary">{value}</div>
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-text-secondary">{hint}</div>
    </div>
  )
}

function InlineNoticeBanner({ notice }: { notice: InlineNotice }) {
  const toneClass = {
    success: 'border-green-500/20 bg-green-500/8 text-green-500',
    info: 'border-accent-blue/20 bg-accent-blue/8 text-accent-blue',
    warning: 'border-yellow-500/20 bg-yellow-500/8 text-yellow-500',
    error: 'border-red-500/20 bg-red-500/8 text-red-500',
  }[notice.tone]

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>
      {notice.message}
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
