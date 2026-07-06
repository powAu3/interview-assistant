import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ComponentType } from 'react'
import dayjs from 'dayjs'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  Settings,
  Sparkles,
  RotateCw,
  Loader2,
  Upload,
  RefreshCw,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useInterviewStore } from '../../stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { StageBadge } from '@/components/job-tracker/stageConfig'
import { isLightColorScheme } from '@/lib/colorScheme'
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

type ReviewListFocus = 'all' | 'attention' | 'active' | 'done'

type SessionGroup = {
  key: Exclude<ReviewListFocus, 'all'>
  title: string
  items: ReviewSession[]
}

type SessionCluster = {
  key: string
  application: ReviewSession['application'] | null
  items: ReviewSession[]
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
  const [focusFilter, setFocusFilter] = useState<ReviewListFocus>('all')
  const pageSize = 20

  const config = useInterviewStore((s) => s.config)
  const setConfig = useInterviewStore((s) => s.setConfig)
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)
  const setJobTrackerDeepLink = useUiPrefsStore((s) => s.setJobTrackerDeepLink)
  const isLight = isLightColorScheme(colorScheme)

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

  const toggleManualImport = useCallback(() => {
    setShowManualImport((prev) => {
      const next = !prev
      if (next) setShowSettings(false)
      return next
    })
  }, [])

  const toggleSettings = useCallback(() => {
    setShowSettings((prev) => {
      const next = !prev
      if (next) setShowManualImport(false)
      return next
    })
  }, [])

  const handleToggleReview = async (enabled: boolean) => {
    try {
      const updated = await api.updateConfig({ review_enabled: enabled })
      setConfig(updated)
      setToastMessage(enabled ? '已开启自动记录' : '已关闭自动记录')
    } catch (err) {
      setToastMessage(getErrorMessage(err, '开关切换失败'))
    }
  }

  const handleChangeModel = async (modelIndex: number) => {
    try {
      const updated = await api.updateConfig({ review_model_index: modelIndex })
      setConfig(updated)
      const modelName = updated.models?.[modelIndex]?.name ?? models[modelIndex]?.name ?? '当前模型'
      setToastMessage(`已切换复盘模型为 ${modelName}`)
    } catch (err) {
      setToastMessage(getErrorMessage(err, '模型切换失败'))
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
        setToastMessage('已加入复盘生成队列')
      }
    } catch (err) {
      setToastMessage(getErrorMessage(err, '触发分析失败'))
    } finally {
      setTriggeringIds(prev => {
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
  }

  const handleOpenApplication = useCallback((session: ReviewSession) => {
    if (!session.application?.id) return
    setJobTrackerDeepLink({
      applicationId: session.application.id,
      openReviews: true,
      highlightReviewId: session.id,
    })
    setAppMode('job-tracker')
  }, [setAppMode, setJobTrackerDeepLink])

  const sessions = data?.items ?? []
  const total = data?.total ?? 0
  const groups = useMemo(() => buildSessionGroups(sessions, hasGeneratedAnalysis), [sessions])
  const hasSessions = total > 0
  const linkedReviewCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const session of sessions) {
      const applicationId = session.application?.id
      if (applicationId == null) continue
      counts.set(applicationId, (counts.get(applicationId) ?? 0) + 1)
    }
    return counts
  }, [sessions])
  const linkedTimelineLabels = useMemo(() => {
    const grouped = new Map<number, ReviewSession[]>()
    for (const session of sessions) {
      const applicationId = session.application?.id
      if (applicationId == null) continue
      const current = grouped.get(applicationId) ?? []
      current.push(session)
      grouped.set(applicationId, current)
    }
    const labels = new Map<number, string>()
    for (const appSessions of grouped.values()) {
      appSessions.forEach((session, index) => {
        labels.set(session.id, describeTimelinePosition(index, appSessions.length))
      })
    }
    return labels
  }, [sessions])
  const focusOptions = [
    { key: 'all' as ReviewListFocus, label: '全部', count: sessions.length },
    {
      key: 'attention' as ReviewListFocus,
      label: '先处理',
      count: groups.find((group) => group.key === 'attention')?.items.length ?? 0,
    },
    {
      key: 'active' as ReviewListFocus,
      label: '进行中',
      count: groups.find((group) => group.key === 'active')?.items.length ?? 0,
    },
    {
      key: 'done' as ReviewListFocus,
      label: '已完成',
      count: groups.find((group) => group.key === 'done')?.items.length ?? 0,
    },
  ].filter((item) => item.key === 'all' || item.count > 0 || item.key === focusFilter)
  const currentFocusOption = focusOptions.find((item) => item.key === focusFilter) ?? focusOptions[0]
  const configPanels = (showManualImport || showSettings) ? (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      {showManualImport && (
        <ManualImportPanel
          onCreated={(sessionId) => {
            setShowManualImport(false)
            void loadSessions(1)
            setPage(1)
            onViewDetail(sessionId)
          }}
          onToast={setToastMessage}
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
  ) : null
  const reviewWorkspaceShellClass = isLight
    ? 'border-bg-hover bg-white'
    : 'border-white/[0.08] bg-bg-secondary/42'

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-5 lg:p-6">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl font-semibold text-text-primary">面试复盘</h2>
              <span className="text-xs text-text-muted">
                {reviewEnabled ? '自动记录已启用' : '自动记录未启用'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadSessions(page)}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-bg-hover bg-bg-secondary px-3 text-xs font-medium text-text-secondary hover:bg-bg-hover"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <button
              type="button"
              onClick={toggleManualImport}
              aria-expanded={showManualImport}
              className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors ${
                showManualImport
                  ? 'border-bg-hover bg-transparent text-accent-blue hover:bg-bg-hover'
                  : 'border-bg-hover bg-bg-secondary text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              {showManualImport ? '收起导入' : '手动复盘'}
            </button>
            <button
              type="button"
              onClick={toggleSettings}
              aria-expanded={showSettings}
              className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors ${
                showSettings
                  ? 'border-bg-hover bg-transparent text-accent-blue hover:bg-bg-hover'
                  : 'border-bg-hover bg-bg-secondary text-text-primary hover:bg-bg-hover'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              {showSettings ? '收起配置' : '配置'}
            </button>
          </div>
        </header>

        {hasSessions ? (
          <div className={`rounded-lg border ${reviewWorkspaceShellClass}`}>
            <div className="min-w-0 space-y-3 p-3 lg:p-4">
              <section className="border-b border-bg-hover/80 px-1 pb-3">
                <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-sm font-semibold text-text-primary">复盘队列</h3>
                      <span className="text-[11px] text-text-muted">
                        {currentFocusOption.label} · {total} 场
                      </span>
                    </div>
                  </div>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:max-w-[420px] lg:justify-end lg:overflow-visible lg:px-0 lg:pb-0">
                    {focusOptions.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setFocusFilter(item.key)}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          focusFilter === item.key
                            ? 'border-bg-hover bg-transparent text-accent-blue'
                            : 'border-bg-hover bg-bg-secondary/50 text-text-secondary hover:bg-bg-hover'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className={`text-[10px] ${focusFilter === item.key ? 'text-accent-blue' : 'text-text-muted'}`}>
                          {item.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {configPanels}

              <SessionTable
                sessions={sessions}
                focusFilter={focusFilter}
                linkedReviewCounts={linkedReviewCounts}
                linkedTimelineLabels={linkedTimelineLabels}
                triggeringIds={triggeringIds}
                onViewDetail={onViewDetail}
                onOpenApplication={handleOpenApplication}
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
            </div>
          </div>
        ) : (
          <ReviewZeroState
            reviewEnabled={reviewEnabled}
            showManualImport={showManualImport}
            showSettings={showSettings}
            onManual={toggleManualImport}
            onSettings={toggleSettings}
          />
        )}
        {!hasSessions ? configPanels : null}

      </div>
    </div>
  )
}

function ReviewZeroState({
  reviewEnabled,
  showManualImport,
  showSettings,
  onManual,
  onSettings,
}: {
  reviewEnabled: boolean
  showManualImport: boolean
  showSettings: boolean
  onManual: () => void
  onSettings: () => void
}) {
  return (
    <section className="border-l border-bg-hover/80 py-2 pl-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">暂无复盘记录</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span>自动记录 {reviewEnabled ? '已启用' : '未启用'}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onManual}
            aria-expanded={showManualImport}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-semibold transition-colors ${
              showManualImport
                ? 'border border-bg-hover bg-transparent text-accent-blue hover:bg-bg-hover'
                : 'bg-accent-blue text-white hover:bg-accent-blue/90'
            }`}
          >
            <Upload className="h-4 w-4" />
            {showManualImport ? '收起导入' : '手动复盘'}
          </button>
          <button
            type="button"
            onClick={onSettings}
            aria-expanded={showSettings}
            className={`inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-sm font-medium transition-colors ${
              showSettings
                ? 'border-bg-hover bg-transparent text-accent-blue hover:bg-bg-hover'
                : 'border-bg-hover bg-bg-secondary text-text-primary hover:bg-bg-hover'
            }`}
          >
            <Settings className="h-4 w-4" />
            {showSettings ? '收起配置' : '配置'}
          </button>
        </div>
      </div>
    </section>
  )
}

function ManualImportPanel({
  onCreated,
  onToast,
}: {
  onCreated: (sessionId: number) => void
  onToast: (message: string | null) => void
}) {
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
      onToast('已创建手动复盘，并开始分析')
      onCreated(result.session_id)
    } catch (err) {
      onToast(getErrorMessage(err, '创建手动复盘失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-bg-hover bg-bg-secondary/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">手动复盘导入</h3>
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
      <div className="mt-3 flex justify-end">
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
    <div className="rounded-lg border border-bg-hover bg-bg-secondary/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-text-primary">复盘配置</h3>
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
      <label className="mb-2 block text-xs font-medium text-text-secondary">
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
      <div className="mt-3 border-t border-bg-hover/80 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-primary">ASR 纠错自检</div>
          </div>
          <button
            type="button"
            onClick={handleSelfTest}
            disabled={testing}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-bg-hover bg-transparent px-3 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
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
  focusFilter,
  linkedReviewCounts,
  linkedTimelineLabels,
  triggeringIds,
  onViewDetail,
  onOpenApplication,
  onTriggerAnalysis,
  hasGeneratedAnalysis,
}: {
  sessions: ReviewSession[]
  focusFilter: ReviewListFocus
  linkedReviewCounts: Map<number, number>
  linkedTimelineLabels: Map<number, string>
  triggeringIds: Set<number>
  onViewDetail: (sessionId: number) => void
  onOpenApplication: (session: ReviewSession) => void
  onTriggerAnalysis: (sessionId: number) => void
  hasGeneratedAnalysis: (session: ReviewSession) => boolean
}) {
  const groups = buildSessionGroups(sessions, hasGeneratedAnalysis)
  const visibleGroups = groups.filter((group) => focusFilter === 'all' || group.key === focusFilter)

  if (visibleGroups.length === 0) {
    return (
      <div className="px-1 py-6 text-sm text-text-muted">
        没有复盘记录
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {visibleGroups.map((group) => (
        <section key={group.key} className="space-y-2">
          <div className="flex items-start justify-between gap-3 px-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">{group.title}</h3>
              <span className="text-[11px] text-text-muted">{group.items.length} 场</span>
            </div>
          </div>
          <div className="divide-y divide-bg-hover/70 border-y border-bg-hover/70">
            {buildSessionClusters(group.items).map((cluster) => (
              <ReviewTimelineCluster
                key={cluster.key}
                cluster={cluster}
                linkedReviewCounts={linkedReviewCounts}
                linkedTimelineLabels={linkedTimelineLabels}
                triggeringIds={triggeringIds}
                hasGeneratedAnalysis={hasGeneratedAnalysis}
                onViewDetail={onViewDetail}
                onOpenApplication={onOpenApplication}
                onTriggerAnalysis={onTriggerAnalysis}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ReviewTimelineCluster({
  cluster,
  linkedReviewCounts,
  linkedTimelineLabels,
  triggeringIds,
  hasGeneratedAnalysis,
  onViewDetail,
  onOpenApplication,
  onTriggerAnalysis,
}: {
  cluster: SessionCluster
  linkedReviewCounts: Map<number, number>
  linkedTimelineLabels: Map<number, string>
  triggeringIds: Set<number>
  hasGeneratedAnalysis: (session: ReviewSession) => boolean
  onViewDetail: (sessionId: number) => void
  onOpenApplication: (session: ReviewSession) => void
  onTriggerAnalysis: (sessionId: number) => void
}) {
  const timelineCount = cluster.application?.id != null ? linkedReviewCounts.get(cluster.application.id) ?? cluster.items.length : cluster.items.length
  const showTimelineHeader = Boolean(cluster.application?.id) && cluster.items.length > 1

  return (
    <section>
      {showTimelineHeader ? (
        <div className="border-b border-bg-hover px-3 py-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-text-primary">
                  {cluster.application?.company || '未命名公司'} · {cluster.application?.position || '岗位未填写'}
                </h4>
                <StageBadge stage={cluster.application?.stage || 'applied'} />
                <span className="text-[11px] text-text-muted">
                  同岗位 {timelineCount} 场复盘
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="divide-y divide-bg-hover/70">
        {cluster.items.map((session, index) => {
          const { statusColor, StatusIcon, isTriggering, showTriggerButton } = getSessionUiState(session, triggeringIds, hasGeneratedAnalysis)
          return (
            <ReviewQueueRow
              key={session.id}
              session={session}
              linkedReviewCount={session.application?.id != null ? linkedReviewCounts.get(session.application.id) ?? 1 : null}
              statusColor={statusColor}
              StatusIcon={StatusIcon}
              isTriggering={isTriggering}
              showTriggerButton={showTriggerButton}
              timelineLabel={linkedTimelineLabels.get(session.id) ?? (showTimelineHeader ? describeTimelinePosition(index, cluster.items.length) : null)}
              compactLinkedApplication={showTimelineHeader}
              onViewDetail={onViewDetail}
              onOpenApplication={onOpenApplication}
              onTriggerAnalysis={onTriggerAnalysis}
            />
          )
        })}
      </div>
    </section>
  )
}

function ReviewQueueRow({
  session,
  linkedReviewCount,
  statusColor,
  StatusIcon,
  isTriggering,
  showTriggerButton,
  timelineLabel,
  compactLinkedApplication,
  onViewDetail,
  onOpenApplication,
  onTriggerAnalysis,
}: {
  session: ReviewSession
  linkedReviewCount: number | null
  statusColor: string
  StatusIcon: ComponentType<{ className?: string }>
  isTriggering: boolean
  showTriggerButton: boolean
  timelineLabel: string | null
  compactLinkedApplication: boolean
  onViewDetail: (sessionId: number) => void
  onOpenApplication: (session: ReviewSession) => void
  onTriggerAnalysis: (sessionId: number) => void
}) {
  const showLinkedApplication = Boolean(session.application)
  const showScore = session.avg_score != null
  const title = session.title || session.company || '未命名复盘'
  const roleText = session.role || '岗位未填写'
  const timeText = dayjs.unix(Math.floor(session.started_at)).format('MM-DD HH:mm')
  const turnsText = `${session.turn_count}轮`
  const summary = sessionSummary(session)
  const hasPrimaryTrigger = showTriggerButton
  const linkedApplicationName = `${session.application?.company || '未命名公司'} · ${session.application?.position || '岗位'}`
  const metaParts = [
    showScore ? `${session.avg_score?.toFixed(1)}分` : '未出分',
    timeText,
    turnsText,
    session.auto_sync_eligible === false ? '短样本' : null,
  ].filter((item): item is string => Boolean(item))

  return (
    <article
      onClick={() => onViewDetail(session.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onViewDetail(session.id)
        }
      }}
      role="button"
      tabIndex={0}
      className={`cursor-pointer px-3 py-2 outline-none transition-colors hover:bg-bg-tertiary/18 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue/30 ${sessionRowTone(session.status)}`}
      aria-label={`打开 ${title} 复盘详情`}
    >
      <div className="flex gap-2.5">
        <div className={`hidden w-1 shrink-0 rounded-sm md:block ${sessionRailTone(session.status)}`} />
        <div className="min-w-0 flex-1">
          <div className={`grid gap-2 ${hasPrimaryTrigger ? 'xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start' : ''}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h4 className="text-sm font-semibold tracking-tight text-text-primary">{title}</h4>
                <span className="text-xs text-text-secondary">{roleText}</span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-text-muted">
                <span className={`inline-flex items-center gap-1 font-medium ${statusTextTone(session.status)}`}>
                  <StatusIcon className={`h-3.5 w-3.5 ${session.status === 'analyzing' ? 'animate-spin' : ''} ${statusColor}`} />
                  {STATUS_LABELS[session.status]}
                </span>
                {metaParts.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </div>
              {showLinkedApplication ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                  <span className="font-medium text-accent-blue">{compactLinkedApplication ? '同岗位' : '岗位'}</span>
                  <span className="font-medium text-text-primary">{linkedApplicationName}</span>
                  <StageBadge stage={session.application?.stage || 'applied'} />
                  {linkedReviewCount != null && linkedReviewCount > 1 ? (
                    <span className="font-medium text-text-muted">
                      {linkedReviewCount} 场
                    </span>
                  ) : null}
                  {timelineLabel ? (
                    <span className="font-medium text-accent-blue">
                      {timelineLabel}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenApplication(session)
                    }}
                    className="text-[11px] font-medium text-accent-blue hover:underline"
                  >
                    查看岗位
                  </button>
                </div>
              ) : null}

              {summary ? (
                <p className={`text-xs leading-relaxed text-text-secondary ${showLinkedApplication ? 'mt-2 line-clamp-2' : 'mt-1 line-clamp-2'}`}>
                  {summary}
                </p>
              ) : null}
            </div>

            {hasPrimaryTrigger ? (
              <div className="flex flex-wrap items-center gap-2 xl:min-w-[188px] xl:flex-col xl:items-end xl:justify-start">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onTriggerAnalysis(session.id)
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium ${
                    session.status === 'analysis_failed'
                      ? 'border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/15'
                      : 'border-green-500/20 bg-green-500/10 text-green-500 hover:bg-green-500/15'
                  }`}
                >
                  {session.status === 'analysis_failed' ? <RotateCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {session.status === 'analysis_failed' ? '重试生成' : '生成复盘'}
                </button>

                {isTriggering ? (
                  <span className="inline-flex h-9 items-center gap-1.5 px-2 text-xs text-text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    提交中
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

function getSessionUiState(
  session: ReviewSession,
  triggeringIds: Set<number>,
  hasGeneratedAnalysis: (session: ReviewSession) => boolean,
) {
  const StatusIcon = STATUS_ICONS[session.status]
  const statusColor = STATUS_COLORS[session.status]
  const isTriggering = triggeringIds.has(session.id)
  const canTrigger = session.status === 'analysis_failed' ||
    session.status === 'partial_capture' ||
    session.status === 'recorded' ||
    session.status === 'recording' ||
    (session.status === 'completed' && !hasGeneratedAnalysis(session))
  const showTriggerButton = canTrigger && !isTriggering
  return {
    StatusIcon,
    statusColor,
    isTriggering,
    showTriggerButton,
  }
}

function statusTextTone(status: ReviewSession['status']) {
  switch (status) {
    case 'analysis_failed':
      return 'text-red-500'
    case 'partial_capture':
      return 'text-yellow-500'
    case 'recorded':
      return 'text-amber-500'
    case 'analyzing':
    case 'recording':
      return 'text-blue-500'
    case 'completed':
      return 'text-green-500'
    default:
      return 'text-text-secondary'
  }
}

function sessionRailTone(status: ReviewSession['status']) {
  switch (status) {
    case 'analysis_failed':
      return 'bg-red-500'
    case 'partial_capture':
    case 'recorded':
      return 'bg-yellow-500'
    case 'analyzing':
    case 'recording':
      return 'bg-blue-500'
    case 'completed':
      return 'bg-emerald-500'
    default:
      return 'bg-zinc-400'
  }
}

function sessionRowTone(status: ReviewSession['status']) {
  return ''
}

function sessionSummary(session: ReviewSession): string | null {
  const normalized = String(session.summary_markdown ?? '')
    .replace(/[#>*`_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized) return normalized
  if (session.status === 'analysis_failed') {
    return '生成失败'
  }
  if (session.status === 'partial_capture') {
    return '采集不完整'
  }
  if (session.status === 'recorded') {
    return session.auto_sync_eligible === false
      ? '短样本'
      : '待生成'
  }
  if (session.status === 'analyzing') {
    return '整理中'
  }
  if (session.status === 'recording') {
    return '录制中'
  }
  return null
}

function buildSessionClusters(sessions: ReviewSession[]): SessionCluster[] {
  const ordered: SessionCluster[] = []
  const clusterByApplicationId = new Map<number, SessionCluster>()

  for (const session of sessions) {
    const applicationId = session.application?.id
    if (applicationId == null) {
      ordered.push({
        key: `session-${session.id}`,
        application: null,
        items: [session],
      })
      continue
    }

    const existing = clusterByApplicationId.get(applicationId)
    if (existing) {
      existing.items.push(session)
      continue
    }

    const nextCluster: SessionCluster = {
      key: `application-${applicationId}`,
      application: session.application ?? null,
      items: [session],
    }
    clusterByApplicationId.set(applicationId, nextCluster)
    ordered.push(nextCluster)
  }

  return ordered
}

function describeTimelinePosition(index: number, total: number) {
  if (total <= 1) return '唯一一场'
  if (index === 0) return '最近一场'
  if (index === total - 1) return '更早一场'
  return '中间场'
}

function formatRelativeDate(ts: number) {
  const diffDays = Math.floor((Date.now() / 1000 - ts) / 86400)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  return `${diffDays} 天前`
}

function buildSessionGroups(
  sessions: ReviewSession[],
  hasGeneratedAnalysis: (session: ReviewSession) => boolean,
): SessionGroup[] {
  return [
    {
      key: 'attention' as const,
      title: '先处理',
      items: sessions.filter((session) =>
        session.status === 'analysis_failed' ||
        session.status === 'partial_capture' ||
        session.status === 'recorded' ||
        (session.status === 'completed' && !hasGeneratedAnalysis(session)),
      ),
    },
    {
      key: 'active' as const,
      title: '进行中',
      items: sessions.filter((session) =>
        session.status === 'analyzing' || session.status === 'recording',
      ),
    },
    {
      key: 'done' as const,
      title: '已完成',
      items: sessions.filter((session) =>
        session.status === 'completed' && hasGeneratedAnalysis(session),
      ),
    },
  ].filter((group) => group.items.length > 0)
}
