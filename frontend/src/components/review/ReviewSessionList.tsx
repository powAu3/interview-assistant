import { useState, useEffect, useCallback } from 'react'
import type { ComponentType } from 'react'
import dayjs from 'dayjs'
import {
  Eye,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  Settings,
  Brain,
  Power,
  Sparkles,
  RotateCw,
  Loader2,
  FileText,
  Upload,
  Target,
  TrendingUp,
  ListChecks,
  RefreshCw,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useInterviewStore } from '../../stores/configStore'
import type { ReviewSession, ReviewSessionsResponse } from './types'

const STATUS_LABELS: Record<ReviewSession['status'], string> = {
  recording: '录制中',
  recorded: '待生成',
  analyzing: '分析中',
  completed: '已完成',
  partial_capture: '部分录制',
  analysis_failed: '分析失败',
}

const STATUS_ICONS: Record<ReviewSession['status'], ComponentType<{ className?: string }>> = {
  recording: Clock,
  recorded: Sparkles,
  analyzing: Loader2,
  completed: CheckCircle,
  partial_capture: AlertCircle,
  analysis_failed: XCircle,
}

const STATUS_COLORS: Record<ReviewSession['status'], string> = {
  recording: 'text-blue-500',
  recorded: 'text-amber-500',
  analyzing: 'text-blue-500',
  completed: 'text-green-500',
  partial_capture: 'text-yellow-500',
  analysis_failed: 'text-red-500',
}

const FIELD_CLASS = 'w-full rounded-lg border border-bg-hover bg-bg-tertiary px-3 py-2 text-xs text-text-primary placeholder-text-muted outline-none transition focus:border-accent-blue/60 focus:ring-2 focus:ring-accent-blue/10 disabled:cursor-not-allowed disabled:opacity-50'

type AsrSelfTestResult = {
  ok: boolean
  model_name: string
  model: string
  original: string
  corrected: string
  changed: boolean
  detail?: string
}

interface Props {
  onViewDetail: (sessionId: number) => void
}

export default function ReviewSessionList({ onViewDetail }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ReviewSessionsResponse | null>(null)
  const [page, setPage] = useState(1)
  const [showSettings, setShowSettings] = useState(false)
  const [showManualImport, setShowManualImport] = useState(false)
  const [triggeringIds, setTriggeringIds] = useState<Set<number>>(new Set())
  const pageSize = 20

  const config = useInterviewStore((s) => s.config)
  const setConfig = useInterviewStore((s) => s.setConfig)

  const reviewEnabled = config?.review_enabled ?? false
  const reviewModelIndex = config?.review_model_index ?? 0
  const models = config?.models ?? []

  const hasGeneratedAnalysis = (session: ReviewSession) =>
    Boolean(session.summary_markdown) || session.avg_score != null

  const loadSessions = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const resp = await api.reviewSessions(p, pageSize)
      setData(resp)
    } catch (err) {
      console.error('Failed to load review sessions:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSessions(page)
  }, [page, loadSessions])

  const handleToggleReview = async (enabled: boolean) => {
    try {
      const updated = await api.updateConfig({ review_enabled: enabled })
      setConfig(updated)
    } catch (err) {
      alert(getErrorMessage(err, '开关切换失败'))
    }
  }

  const handleChangeModel = async (modelIndex: number) => {
    try {
      const updated = await api.updateConfig({ review_model_index: modelIndex })
      setConfig(updated)
    } catch (err) {
      alert(getErrorMessage(err, '模型切换失败'))
    }
  }

  const handleTriggerAnalysis = async (sessionId: number) => {
    setTriggeringIds(prev => new Set(prev).add(sessionId))
    try {
      const result = await api.reviewTriggerAnalysis(sessionId)
      if (result.status === 'started' || result.status === 'pending') {
        setData(prev => {
          if (!prev) return prev
          return {
            ...prev,
            items: prev.items.map(s =>
              s.id === sessionId ? { ...s, status: 'analyzing' as const } : s
            ),
          }
        })
      }
    } catch (err) {
      alert(getErrorMessage(err, '触发分析失败'))
    } finally {
      setTriggeringIds(prev => {
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
  }

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm">加载中...</div>
      </div>
    )
  }

  const sessions = data?.items ?? []
  const total = data?.total ?? 0
  const completedSessions = sessions.filter((session) => session.status === 'completed' && hasGeneratedAnalysis(session))
  const analyzingCount = sessions.filter((session) => session.status === 'analyzing').length
  const actionRequiredCount = sessions.filter((session) =>
    session.status === 'recorded' ||
    session.status === 'analysis_failed' ||
    session.status === 'partial_capture' ||
    (session.status === 'completed' && !hasGeneratedAnalysis(session)),
  ).length
  const avgScore = completedSessions.length
    ? completedSessions.reduce((sum, session) => sum + (session.avg_score ?? 0), 0) / completedSessions.length
    : null
  const latest = sessions[0]

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-5 lg:p-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-text-primary">面试复盘</h2>
              <span className={`rounded-md border px-2 py-1 text-[11px] ${
                reviewEnabled
                  ? 'border-green-500/25 bg-green-500/10 text-green-500'
                  : 'border-bg-hover bg-bg-tertiary text-text-muted'
              }`}>
                {reviewEnabled ? '自动记录已启用' : '自动记录未启用'}
              </span>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              从真实回答里提取薄弱点、纠错痕迹和下一轮补强重点。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadSessions(page)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-bg-hover bg-bg-secondary px-3 text-xs font-medium text-text-secondary hover:bg-bg-hover"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <button
              type="button"
              onClick={() => setShowManualImport((prev) => !prev)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-3 text-xs font-medium text-accent-blue hover:bg-accent-blue/15"
            >
              <Upload className="h-3.5 w-3.5" />
              手动复盘
            </button>
            <button
              type="button"
              onClick={() => setShowSettings((prev) => !prev)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-bg-hover bg-bg-secondary px-3 text-xs font-medium text-text-primary hover:bg-bg-hover"
            >
              <Settings className="h-3.5 w-3.5" />
              配置
            </button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile icon={FileText} label="复盘记录" value={String(total)} hint={latest ? `最近 ${formatRelativeDate(latest.started_at)}` : '暂无记录'} tone="blue" />
          <MetricTile icon={TrendingUp} label="近期均分" value={avgScore == null ? '--' : avgScore.toFixed(1)} hint={`${completedSessions.length} 场已分析`} tone={avgScore != null && avgScore >= 7 ? 'green' : 'amber'} />
          <MetricTile icon={ListChecks} label="待处理" value={String(actionRequiredCount)} hint="可手动生成或重试" tone={actionRequiredCount > 0 ? 'amber' : 'green'} />
          <MetricTile icon={Clock} label="分析队列" value={String(analyzingCount)} hint="后台生成复盘" tone={analyzingCount > 0 ? 'blue' : 'neutral'} />
        </section>

        {(showManualImport || showSettings) && (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            {showManualImport && (
              <ManualImportPanel
                onCreated={(sessionId) => {
                  setShowManualImport(false)
                  void loadSessions(1)
                  setPage(1)
                  onViewDetail(sessionId)
                }}
              />
            )}
            {showSettings && (
              <ReviewSettingsPanel
                reviewEnabled={reviewEnabled}
                reviewModelIndex={reviewModelIndex}
                models={models}
                onToggle={handleToggleReview}
                onChangeModel={handleChangeModel}
              />
            )}
          </section>
        )}

        {sessions.length === 0 ? (
          <EmptyState reviewEnabled={reviewEnabled} onManual={() => setShowManualImport(true)} />
        ) : (
          <>
            <SessionTable
              sessions={sessions}
              triggeringIds={triggeringIds}
              onViewDetail={onViewDetail}
              onTriggerAnalysis={handleTriggerAnalysis}
              hasGeneratedAnalysis={hasGeneratedAnalysis}
            />

            {total > pageSize && (
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="h-9 rounded-lg border border-bg-hover bg-bg-secondary px-4 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50 hover:bg-bg-hover"
                >
                  上一页
                </button>
                <span className="text-sm text-text-muted">
                  {page} / {Math.ceil(total / pageSize)}
                </span>
                <button
                  type="button"
                  disabled={page >= Math.ceil(total / pageSize)}
                  onClick={() => setPage(page + 1)}
                  className="h-9 rounded-lg border border-bg-hover bg-bg-secondary px-4 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50 hover:bg-bg-hover"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MetricTile({
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
  tone: 'blue' | 'green' | 'amber' | 'neutral'
}) {
  const toneClass = {
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-500',
    green: 'border-green-500/20 bg-green-500/10 text-green-500',
    amber: 'border-yellow-500/20 bg-yellow-500/10 text-yellow-500',
    neutral: 'border-bg-hover bg-bg-secondary text-text-secondary',
  }[tone]

  return (
    <div className="rounded-lg border border-bg-hover/70 bg-bg-secondary/50 p-4">
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

function ManualImportPanel({ onCreated }: { onCreated: (sessionId: number) => void }) {
  const [form, setForm] = useState({
    title: '',
    company: '',
    role: '',
    transcript: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = form.transcript.trim().length >= 12

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const result = await api.reviewCreateManual({
        title: form.title || undefined,
        company: form.company || undefined,
        role: form.role || undefined,
        transcript: form.transcript,
        analyze: true,
      })
      onCreated(result.session_id)
    } catch (err) {
      alert(getErrorMessage(err, '创建手动复盘失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-accent-blue/25 bg-accent-blue/5 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-accent-blue/15 p-2 text-accent-blue">
          <Upload className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">手动复盘导入</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            支持 Q/A、问/答、面试官/候选人格式；提交后走同一套纠错和复盘分析。
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="标题"
          className={FIELD_CLASS}
        />
        <input
          value={form.company}
          onChange={(event) => setForm({ ...form, company: event.target.value })}
          placeholder="公司"
          className={FIELD_CLASS}
        />
        <input
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value })}
          placeholder="岗位"
          className={FIELD_CLASS}
        />
      </div>
      <textarea
        value={form.transcript}
        onChange={(event) => setForm({ ...form, transcript: event.target.value })}
        rows={8}
        placeholder={'面试官: 请介绍一下 Redis 缓存穿透。\n候选人: 我会用布隆过滤器和空值缓存...\nQ2: 讲讲索引失效场景。\nA2: ...'}
        className={`${FIELD_CLASS} mt-3 min-h-[180px] resize-y font-mono leading-relaxed`}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-[11px] text-text-muted">导入后会作为 manual 来源记录，不影响实时辅助。</div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent-blue px-4 text-xs font-medium text-white hover:bg-accent-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {submitting ? '创建中' : '创建并分析'}
        </button>
      </div>
    </div>
  )
}

function ReviewSettingsPanel({
  reviewEnabled,
  reviewModelIndex,
  models,
  onToggle,
  onChangeModel,
}: {
  reviewEnabled: boolean
  reviewModelIndex: number
  models: { name: string; enabled?: boolean }[]
  onToggle: (enabled: boolean) => void
  onChangeModel: (modelIndex: number) => void
}) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AsrSelfTestResult | null>(null)

  const handleSelfTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.reviewAsrCorrectionTest()
      setTestResult(result)
    } catch (err) {
      setTestResult({
        ok: false,
        model_name: models[reviewModelIndex]?.name ?? '复盘模型',
        model: '',
        original: '',
        corrected: '',
        changed: false,
        detail: getErrorMessage(err, '自检失败'),
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-lg border border-bg-hover/70 bg-bg-secondary/50 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className={`rounded-md p-2 ${reviewEnabled ? 'bg-green-500/15 text-green-500' : 'bg-bg-hover text-text-muted'}`}>
          <Power className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-primary">复盘配置</h3>
          <p className="mt-1 text-xs text-text-muted">自动记录和分析模型。</p>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!reviewEnabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            reviewEnabled ? 'bg-green-500' : 'bg-bg-hover'
          }`}
          role="switch"
          aria-checked={reviewEnabled}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              reviewEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      <label className="mb-2 flex items-center gap-2 text-xs font-medium text-text-secondary">
        <Brain className="h-3.5 w-3.5 text-accent-blue" />
        复盘分析模型
      </label>
      <select
        value={reviewModelIndex}
        onChange={(event) => onChangeModel(Number(event.target.value))}
        disabled={!reviewEnabled}
        className={FIELD_CLASS}
      >
        {models.map((model, idx) => (
          <option key={idx} value={idx} disabled={!model.enabled}>
            {model.name} {!model.enabled ? '(未启用)' : ''}
          </option>
        ))}
      </select>
      <div className="mt-4 rounded-lg border border-bg-hover bg-bg-tertiary/35 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-primary">ASR 纠错自检</div>
            <div className="mt-1 text-[11px] leading-relaxed text-text-muted">
              使用当前复盘模型跑一次样例纠错，快速定位权限或模型网关问题。
            </div>
          </div>
          <button
            type="button"
            onClick={handleSelfTest}
            disabled={testing}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-3 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {testing ? '检测中' : '检测'}
          </button>
        </div>
        {testResult && (
          <div className={`mt-3 rounded-lg border p-3 ${
            testResult.ok
              ? 'border-green-500/20 bg-green-500/10'
              : 'border-red-500/20 bg-red-500/10'
          }`}>
            <div className="flex items-center gap-2">
              {testResult.ok ? (
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className={`text-xs font-medium ${testResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                {testResult.ok ? (testResult.changed ? '纠错可用，样例已修正' : '模型可用，样例未变化') : '纠错不可用'}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-text-muted">
              {testResult.model_name}{testResult.model ? ` / ${testResult.model}` : ''}
            </div>
            {testResult.detail && (
              <div className="mt-1 break-words text-[11px] leading-relaxed text-text-secondary">{testResult.detail}</div>
            )}
            {testResult.ok && (
              <div className="mt-3 grid gap-2">
                <div className="rounded-md bg-bg-primary/40 p-2">
                  <div className="mb-1 text-[10px] font-medium text-text-muted">原始样例</div>
                  <div className="text-[11px] leading-relaxed text-text-secondary">{testResult.original}</div>
                </div>
                <div className="rounded-md bg-bg-primary/40 p-2">
                  <div className="mb-1 text-[10px] font-medium text-text-muted">纠错结果</div>
                  <div className="text-[11px] leading-relaxed text-text-primary">{testResult.corrected}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SessionTable({
  sessions,
  triggeringIds,
  onViewDetail,
  onTriggerAnalysis,
  hasGeneratedAnalysis,
}: {
  sessions: ReviewSession[]
  triggeringIds: Set<number>
  onViewDetail: (sessionId: number) => void
  onTriggerAnalysis: (sessionId: number) => void
  hasGeneratedAnalysis: (session: ReviewSession) => boolean
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-bg-hover/80 bg-bg-secondary/40">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-bg-hover bg-bg-tertiary/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">复盘队列</h3>
          <p className="mt-0.5 text-xs text-text-muted">优先处理失败、部分录制和未生成分析的记录。</p>
        </div>
        <Target className="h-4 w-4 text-text-muted" />
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead className="bg-bg-secondary">
            <tr>
              <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted">状态</th>
              <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted">时间</th>
              <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted">公司 / 岗位</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-text-muted">来源</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-text-muted">轮次</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-text-muted">平均分</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-text-muted">操作</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
              const StatusIcon = STATUS_ICONS[session.status]
              const statusColor = STATUS_COLORS[session.status]
              const isTriggering = triggeringIds.has(session.id)
              const canTrigger = session.status === 'analysis_failed' ||
                session.status === 'partial_capture' ||
                session.status === 'recorded' ||
                session.status === 'recording' ||
                (session.status === 'completed' && !hasGeneratedAnalysis(session))
              const showTriggerButton = canTrigger && !isTriggering

              return (
                <tr key={session.id} className="border-t border-bg-tertiary/70 hover:bg-bg-tertiary/25">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusIcon className={`h-4 w-4 ${statusColor} ${session.status === 'analyzing' ? 'animate-spin' : ''}`} />
                      <span className="text-xs text-text-primary">{STATUS_LABELS[session.status]}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-text-primary">{dayjs.unix(Math.floor(session.started_at)).format('YYYY-MM-DD HH:mm')}</div>
                    {session.ended_at && (
                      <div className="mt-0.5 text-[10px] text-text-muted">
                        {Math.max(0, Math.floor((session.ended_at - session.started_at) / 60))} 分钟
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-text-primary">{session.company || session.title || '未填写'}</div>
                    <div className="mt-0.5 text-xs text-text-muted">{session.role || '岗位未填写'}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-md border border-bg-hover bg-bg-tertiary px-2 py-1 text-[10px] text-text-secondary">
                      {session.source === 'manual' ? '手动' : '实时'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-sm font-medium text-text-primary">{session.turn_count}</td>
                  <td className="px-4 py-3 text-center">
                    {session.avg_score != null ? (
                      <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${scoreTone(session.avg_score)}`}>
                        {session.avg_score.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => onViewDetail(session.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-accent-blue hover:bg-accent-blue/10"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        查看
                      </button>
                      {showTriggerButton && (
                        <button
                          type="button"
                          onClick={() => onTriggerAnalysis(session.id)}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium ${
                            session.status === 'analysis_failed'
                              ? 'text-red-500 hover:bg-red-500/10'
                              : 'text-green-500 hover:bg-green-500/10'
                          }`}
                        >
                          {session.status === 'analysis_failed' ? <RotateCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {session.status === 'analysis_failed' ? '重试' : '生成'}
                        </button>
                      )}
                      {isTriggering && (
                        <span className="inline-flex h-8 items-center gap-1.5 px-3 text-xs text-text-muted">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          提交中
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmptyState({ reviewEnabled, onManual }: { reviewEnabled: boolean; onManual: () => void }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-bg-hover bg-bg-secondary/30">
      <div className="max-w-md px-6 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">
          <FileText className="h-5 w-5" />
        </div>
        <div className="text-sm font-semibold text-text-primary">暂无面试记录</div>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          {reviewEnabled
            ? '完成实时辅助后会自动进入复盘队列，也可以粘贴已有逐字稿开始分析。'
            : '启用自动记录，或直接粘贴已有逐字稿开始分析。'}
        </p>
        <button
          type="button"
          onClick={onManual}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-accent-blue px-4 text-xs font-medium text-white hover:bg-accent-blue/90"
        >
          <Upload className="h-3.5 w-3.5" />
          手动导入
        </button>
      </div>
    </div>
  )
}

function scoreTone(score: number) {
  if (score >= 8) return 'bg-green-500/10 text-green-500'
  if (score >= 6) return 'bg-blue-500/10 text-blue-500'
  if (score >= 4) return 'bg-yellow-500/10 text-yellow-500'
  return 'bg-red-500/10 text-red-500'
}

function formatRelativeDate(ts: number) {
  const diffDays = Math.floor((Date.now() / 1000 - ts) / 86400)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  return `${diffDays} 天前`
}
