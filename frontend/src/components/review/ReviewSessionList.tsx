import { useState, useEffect, useCallback, useMemo } from 'react'
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
  TrendingUp,
  ListChecks,
  RefreshCw,
  Link2,
} from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useInterviewStore } from '../../stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { STAGE_LABELS, StageBadge, isRejectedStage } from '@/components/job-tracker/stageConfig'
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
  subtitle: string
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
  const completedSessions = sessions.filter((session) => session.status === 'completed' && hasGeneratedAnalysis(session))
  const activeCount = sessions.filter((session) => session.status === 'analyzing' || session.status === 'recording').length
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
  const hasSessions = total > 0
  const linkedReviewCount = sessions.filter((session) => session.application?.id != null).length
  const linkedApplicationCount = new Set(
    sessions
      .map((session) => session.application?.id ?? null)
      .filter((applicationId): applicationId is number => applicationId != null),
  ).size
  const linkedReviewCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const session of sessions) {
      const applicationId = session.application?.id
      if (applicationId == null) continue
      counts.set(applicationId, (counts.get(applicationId) ?? 0) + 1)
    }
    return counts
  }, [sessions])
  const timelineApplicationCount = useMemo(
    () => [...linkedReviewCounts.values()].filter((count) => count > 1).length,
    [linkedReviewCounts],
  )
  const terminalLinkedApplicationCount = useMemo(
    () => new Set(
      sessions
        .filter((session) => {
          const stage = session.application?.stage
          return stage != null && (stage === 'withdrawn' || isRejectedStage(stage))
        })
        .map((session) => session.application?.id)
        .filter((applicationId): applicationId is number => applicationId != null),
    ).size,
    [sessions],
  )
  const manualSessionCount = sessions.filter((session) => session.source === 'manual').length
  const liveSessionCount = sessions.length - manualSessionCount
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
    { key: 'all' as ReviewListFocus, label: '全部', count: sessions.length, hint: '按时间查看全部复盘' },
    {
      key: 'attention' as ReviewListFocus,
      label: '先处理',
      count: groups.find((group) => group.key === 'attention')?.items.length ?? 0,
      hint: '失败、短样本和待生成',
    },
    {
      key: 'active' as ReviewListFocus,
      label: '进行中',
      count: groups.find((group) => group.key === 'active')?.items.length ?? 0,
      hint: '还在录制或后台分析',
    },
    {
      key: 'done' as ReviewListFocus,
      label: '已完成',
      count: groups.find((group) => group.key === 'done')?.items.length ?? 0,
      hint: '可回看并跳回岗位',
    },
  ].filter((item) => item.key === 'all' || item.count > 0 || item.key === focusFilter)
  const currentFocusOption = focusOptions.find((item) => item.key === focusFilter) ?? focusOptions[0]
  const focusLens = describeFocusLens({
    focusFilter,
    actionRequiredCount,
    activeCount,
    completedCount: completedSessions.length,
    total,
    latest,
    timelineApplicationCount,
  })
  const focusEntryGroup = useMemo(() => {
    if (focusFilter === 'all') {
      return groups.find((group) => group.items.length > 0) ?? null
    }
    return groups.find((group) => group.key === focusFilter) ?? null
  }, [focusFilter, groups])
  const focusEntrySession = focusEntryGroup?.items[0] ?? latest ?? null
  const focusEntryMeta = describeFocusEntry({
    focusFilter,
    groupKey: focusEntryGroup?.key ?? null,
    session: focusEntrySession,
  })
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
    ? 'border-bg-hover/80 bg-white/95 shadow-[0_18px_52px_rgba(148,163,184,0.12)]'
    : 'border-white/[0.08] bg-bg-secondary/42 shadow-[0_18px_52px_rgba(0,0,0,0.28)]'
  const reviewWorkspaceDividerClass = isLight ? 'border-bg-hover/80' : 'border-white/[0.08]'
  const reviewSurfaceClass = isLight ? 'border-bg-hover/75 bg-bg-secondary/32' : 'border-white/[0.08] bg-black/12'

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
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-text-primary">面试复盘</h2>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] ${
                reviewEnabled
                  ? 'border-green-500/25 bg-green-500/10 text-green-500'
                  : 'border-bg-hover bg-bg-tertiary text-text-muted'
              }`}>
                {reviewEnabled ? '自动记录已启用' : '自动记录未启用'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              从真实回答里提取薄弱点、纠错痕迹和下一轮补强重点。{hasSessions ? ` 当前共 ${total} 场，已绑定 ${linkedApplicationCount} 个岗位，形成 ${timelineApplicationCount} 条多轮时间线。` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadSessions(page)}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-bg-hover bg-bg-secondary px-3 text-xs font-medium text-text-secondary hover:bg-bg-hover"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <button
              type="button"
              onClick={() => setShowManualImport((prev) => !prev)}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-accent-blue/30 bg-accent-blue/10 px-3 text-xs font-medium text-accent-blue hover:bg-accent-blue/15"
            >
              <Upload className="h-3.5 w-3.5" />
              手动复盘
            </button>
            <button
              type="button"
              onClick={() => setShowSettings((prev) => !prev)}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-bg-hover bg-bg-secondary px-3 text-xs font-medium text-text-primary hover:bg-bg-hover"
            >
              <Settings className="h-3.5 w-3.5" />
              配置
            </button>
          </div>
        </header>

        {hasSessions ? (
          <div className={`grid gap-0 rounded-[28px] border ${reviewWorkspaceShellClass} xl:grid-cols-[minmax(0,1fr)_272px]`}>
            <div className="min-w-0 space-y-4 p-4 lg:p-5">
              <section className={`rounded-[24px] border p-3.5 ${reviewSurfaceClass}`}>
                <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-text-primary">复盘队列</h3>
                      <span className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-2.5 py-1 text-[11px] font-medium text-accent-blue">
                        {currentFocusOption.label}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {latest ? `最近一场 ${formatRelativeDate(latest.started_at)}` : '暂无记录'}{hasSessions ? ` · 已绑定 ${linkedApplicationCount} 个岗位` : ''}
                      </span>
                    </div>
                    <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-secondary">
                      {focusLens.detail}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:max-w-[420px] lg:justify-end">
                    {focusOptions.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setFocusFilter(item.key)}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          focusFilter === item.key
                            ? 'border-accent-blue/25 bg-accent-blue/10 text-accent-blue'
                            : 'border-bg-hover bg-bg-secondary/50 text-text-secondary hover:bg-bg-hover'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                            focusFilter === item.key ? 'bg-accent-blue/10 text-accent-blue' : 'bg-bg-tertiary text-text-muted'
                          }`}
                        >
                          {item.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-text-muted">
                  <span>{currentFocusOption.hint}</span>
                  <span className="hidden sm:inline">同岗位多轮复盘会继续挂回一条主线。</span>
                </div>
                <section className="mt-3 grid grid-cols-2 gap-2 xl:hidden">
                  <SummaryStatPill
                    icon={FileText}
                    label="复盘"
                    value={`${total} 场`}
                    hint={latest ? `最近一场 ${formatRelativeDate(latest.started_at)}` : '暂无记录'}
                    tone="blue"
                  />
                  <SummaryStatPill
                    icon={Link2}
                    label="已绑定岗位"
                    value={`${linkedApplicationCount} 个`}
                    hint={linkedReviewCount > 0 ? `${linkedReviewCount} 场复盘已挂到岗位时间线` : '还没有关联岗位'}
                    tone={linkedReviewCount > 0 ? 'green' : 'neutral'}
                  />
                  <SummaryStatPill
                    icon={ListChecks}
                    label="先处理"
                    value={`${actionRequiredCount} 场`}
                    hint={actionRequiredCount > 0 ? '失败、待生成和短样本会优先堆在前面' : '当前没有需要优先处理的记录'}
                    tone={actionRequiredCount > 0 ? 'amber' : 'green'}
                  />
                  <SummaryStatPill
                    icon={TrendingUp}
                    label="均分 / 队列"
                    value={avgScore == null ? '--' : avgScore.toFixed(1)}
                    hint={activeCount > 0 ? `另有 ${activeCount} 场还在进行中` : `${completedSessions.length} 场已出复盘`}
                    tone={avgScore != null && avgScore >= 7 ? 'green' : avgScore == null ? 'neutral' : 'amber'}
                  />
                </section>
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

            <ReviewWorkspaceSidebar
              embedded
              isLight={isLight}
              dividerClass={reviewWorkspaceDividerClass}
              surfaceClass={reviewSurfaceClass}
              focusLabel={currentFocusOption.label}
              focusTitle={focusLens.title}
              focusDetail={focusLens.detail}
              latest={latest ?? null}
              total={total}
              focusEntrySession={focusEntrySession}
              focusEntryMeta={focusEntryMeta}
              linkedApplicationCount={linkedApplicationCount}
              linkedReviewCount={linkedReviewCount}
              timelineApplicationCount={timelineApplicationCount}
              terminalLinkedApplicationCount={terminalLinkedApplicationCount}
              actionRequiredCount={actionRequiredCount}
              avgScore={avgScore}
              activeCount={activeCount}
              completedCount={completedSessions.length}
              manualSessionCount={manualSessionCount}
              liveSessionCount={liveSessionCount}
              onViewDetail={onViewDetail}
              onOpenApplication={handleOpenApplication}
            />
          </div>
        ) : (
          <ReviewZeroState
            reviewEnabled={reviewEnabled}
            showManualImport={showManualImport}
            showSettings={showSettings}
            onManual={() => setShowManualImport(true)}
            onSettings={() => setShowSettings(true)}
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
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
      <div className="rounded-[28px] border border-bg-hover/70 bg-bg-secondary/50 p-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent-blue/20 bg-accent-blue/10 px-3 py-1 text-xs font-medium text-accent-blue">
          先留下面试，再开始复盘
        </div>
        <h3 className="mt-4 text-2xl font-bold tracking-tight text-text-primary">复盘的目标不是堆信息，而是快速提炼下一轮动作</h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
          自动记录适合真实面试过程，手动复盘适合你把已有逐字稿直接丢进来。先把记录建立起来，后面再补分析和求职看板绑定。
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onManual}
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-accent-blue px-4 text-sm font-semibold text-white hover:bg-accent-blue/90"
          >
            <Upload className="h-4 w-4" />
            开始手动复盘
          </button>
          <button
            type="button"
            onClick={onSettings}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-bg-hover bg-bg-secondary px-4 text-sm font-medium text-text-primary hover:bg-bg-hover"
          >
            <Settings className="h-4 w-4" />
            调整自动记录
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <div className="rounded-2xl border border-bg-hover/70 bg-bg-secondary/45 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Power className={`h-4 w-4 ${reviewEnabled ? 'text-green-500' : 'text-text-muted'}`} />
            自动记录
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {reviewEnabled
              ? '当前已启用。面试结束后会把记录送进复盘队列。'
              : '当前未启用。适合先手动导入已有逐字稿，后面再决定是否全程自动记录。'}
          </p>
        </div>
        <div className="rounded-2xl border border-bg-hover/70 bg-bg-secondary/45 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Link2 className="h-4 w-4 text-accent-blue" />
            后续联动
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            复盘完成后可以回绑求职看板，把弱项和低分题同步成下一轮待办。
          </p>
        </div>
        {(showManualImport || showSettings) && (
          <div className="rounded-2xl border border-accent-blue/20 bg-accent-blue/5 p-4 text-xs leading-relaxed text-text-secondary sm:col-span-2 lg:col-span-1">
            当前已展开下方配置区，你可以直接继续填写，不需要再跳走。
          </div>
        )}
      </div>
    </section>
  )
}

function SummaryStatPill({
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
    blue: 'border-blue-500/15 bg-blue-500/[0.07] text-blue-500',
    green: 'border-green-500/15 bg-green-500/[0.07] text-green-500',
    amber: 'border-yellow-500/15 bg-yellow-500/[0.07] text-yellow-500',
    neutral: 'border-bg-hover bg-bg-tertiary/60 text-text-secondary',
  }[tone]

  return (
    <div className="min-w-0 rounded-xl border border-bg-hover/70 bg-bg-secondary/45 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className={`rounded-lg border p-1.5 ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{label}</div>
            <div className="text-sm font-semibold text-text-primary">{value}</div>
          </div>
          <div className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-text-muted">{hint}</div>
        </div>
      </div>
    </div>
  )
}

function ReviewWorkspaceSidebar({
  embedded = false,
  isLight,
  dividerClass,
  surfaceClass,
  focusLabel,
  focusTitle,
  focusDetail,
  latest,
  total,
  focusEntrySession,
  focusEntryMeta,
  linkedApplicationCount,
  linkedReviewCount,
  timelineApplicationCount,
  terminalLinkedApplicationCount,
  actionRequiredCount,
  avgScore,
  activeCount,
  completedCount,
  manualSessionCount,
  liveSessionCount,
  onViewDetail,
  onOpenApplication,
}: {
  embedded?: boolean
  isLight: boolean
  dividerClass: string
  surfaceClass: string
  focusLabel: string
  focusTitle: string
  focusDetail: string
  latest: ReviewSession | null
  total: number
  focusEntrySession: ReviewSession | null
  focusEntryMeta: { label: string; title: string; detail: string }
  linkedApplicationCount: number
  linkedReviewCount: number
  timelineApplicationCount: number
  terminalLinkedApplicationCount: number
  actionRequiredCount: number
  avgScore: number | null
  activeCount: number
  completedCount: number
  manualSessionCount: number
  liveSessionCount: number
  onViewDetail: (sessionId: number) => void
  onOpenApplication: (session: ReviewSession) => void
}) {
  const focusSession = focusEntrySession ?? latest
  const focusSessionStatusLabel = focusSession ? STATUS_LABELS[focusSession.status] : null
  const focusSessionTitle = focusSession?.title || focusSession?.company || '未命名复盘'
  const focusSessionHint = focusSession?.application
    ? describeApplicationMainlineHint(focusSession.application, null)
    : '还没有关联岗位主线，打开详情后可以补绑定。'
  const linkedApplicationHint = linkedReviewCount > 0
    ? `${linkedReviewCount} 场复盘已挂回岗位主线`
    : '还没有关联岗位'
  const sourceMixLabel = `${liveSessionCount} / ${manualSessionCount}`
  const statusQueueHint = activeCount > 0 ? `另有 ${activeCount} 场进行中` : `${completedCount} 场已出复盘`
  const compactFocusTitle = focusSession ? `${focusEntryMeta.title} · ${focusSessionTitle}` : focusTitle
  const workspaceInnerClass = embedded
    ? 'space-y-2.5 p-3.5'
    : `rounded-[24px] border p-4 ${surfaceClass}`
  const focusCardClass = isLight ? 'border-bg-hover/70 bg-white/62' : 'border-white/[0.08] bg-black/16'
  const mutedCardClass = isLight ? 'border-bg-hover/70 bg-bg-secondary/26' : 'border-white/[0.08] bg-black/10'

  return (
    <aside className={`hidden xl:block ${embedded ? `border-t ${dividerClass} xl:border-l xl:border-t-0` : ''}`}>
      <div className="sticky top-3">
        <section className={workspaceInnerClass}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-blue">
              复盘工作台
            </span>
            <span className="rounded-full border border-bg-hover bg-bg-tertiary/60 px-2.5 py-1 text-[11px] font-medium text-text-muted">
              {focusLabel}
            </span>
            <span className="rounded-full border border-bg-hover bg-bg-secondary px-2.5 py-1 text-[11px] font-medium text-text-muted">
              共 {total} 场
            </span>
          </div>
          <h3 className="mt-2 text-base font-semibold tracking-tight text-text-primary">{focusTitle}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
            {focusDetail}
          </p>

          {focusSession ? (
            <div className={`rounded-2xl border p-3 ${focusCardClass}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{focusEntryMeta.label}</div>
                  <span className="rounded-full border border-bg-hover bg-bg-secondary px-2 py-0.5 text-[10px] font-medium text-text-muted">
                    {dayjs.unix(Math.floor(focusSession.started_at)).format('MM-DD HH:mm')}
                  </span>
                </div>
                {focusSessionStatusLabel ? (
                  <span className="rounded-full border border-bg-hover bg-bg-secondary px-2 py-0.5 text-[10px] font-medium text-text-muted">
                    {focusSessionStatusLabel}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-sm font-semibold text-text-primary">
                {compactFocusTitle}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">
                {focusSession.application?.company ? `${focusSession.application.company} · ` : ''}{focusSession.application?.position ?? focusSession.role ?? '未绑定岗位'}
              </div>
              <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-text-secondary">
                {focusEntryMeta.detail}
              </p>
              <div className="mt-2 rounded-xl border border-bg-hover/70 bg-bg-secondary/55 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
                {focusSessionHint}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onViewDetail(focusSession.id)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-accent-blue/20 bg-accent-blue/10 px-3 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/15"
                >
                  <Eye className="h-3.5 w-3.5" />
                  打开复盘
                </button>
                {focusSession.application?.id ? (
                  <button
                    type="button"
                    onClick={() => onOpenApplication(focusSession)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-bg-hover bg-bg-secondary px-3 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    岗位时间线
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className={`rounded-2xl border px-3 py-3 ${mutedCardClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">岗位联动</div>
                <div className="mt-1 text-sm font-semibold text-text-primary">岗位和复盘保持 1 对多关系</div>
                <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                  同岗位多轮复盘会继续挂回一条主线，终态岗位也不会断。
                </p>
              </div>
              <span className="rounded-full border border-bg-hover bg-bg-secondary px-2.5 py-1 text-[11px] font-medium text-text-muted">
                {timelineApplicationCount} 条时间线
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              <SidebarInlineStat
                icon={Link2}
                label="已绑定岗位"
                value={`${linkedApplicationCount} 个`}
                detail={linkedApplicationHint}
                tone={linkedReviewCount > 0 ? 'green' : 'neutral'}
              />
              <SidebarInlineStat
                icon={ListChecks}
                label="先处理"
                value={`${actionRequiredCount} 场`}
                detail={actionRequiredCount > 0 ? '失败、待生成和短样本优先' : '当前没有明显阻塞项'}
                tone={actionRequiredCount > 0 ? 'amber' : 'green'}
              />
              <SidebarInlineStat
                icon={TrendingUp}
                label="均分 / 队列"
                value={avgScore == null ? '--' : avgScore.toFixed(1)}
                detail={statusQueueHint}
                tone={avgScore != null && avgScore >= 7 ? 'green' : avgScore == null ? 'neutral' : 'amber'}
              />
            </div>
            <div className="mt-3 rounded-xl border border-bg-hover/70 bg-bg-secondary/55 px-3 py-2.5 text-[11px] leading-relaxed text-text-muted">
              实时记录和手动导入共用同一条岗位主线。终态岗位 {terminalLinkedApplicationCount} 个 · 来源混合 {sourceMixLabel}。
            </div>
          </div>
        </section>
      </div>
    </aside>
  )
}

function SidebarInlineStat({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
  tone: 'blue' | 'green' | 'amber' | 'neutral'
}) {
  const toneClass = {
    blue: 'border-blue-500/15 bg-blue-500/[0.07] text-blue-500',
    green: 'border-green-500/15 bg-green-500/[0.07] text-green-500',
    amber: 'border-yellow-500/15 bg-yellow-500/[0.07] text-yellow-500',
    neutral: 'border-bg-hover bg-bg-tertiary/60 text-text-secondary',
  }[tone]

  return (
    <div className="min-w-0 rounded-xl border border-bg-hover/70 bg-bg-tertiary/18 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className={`rounded-full border p-1 ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-text-muted">{label}</span>
            <span className="font-semibold text-text-primary">{value}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-text-muted">{detail}</div>
        </div>
      </div>
    </div>
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
      <div className="rounded-2xl border border-dashed border-bg-hover bg-bg-secondary/30 px-4 py-6 text-sm text-text-muted">
        当前筛选下还没有复盘记录。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {visibleGroups.map((group) => (
        <section key={group.key} className="space-y-2">
          <div className="flex items-start justify-between gap-3 px-1">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{group.title}</h3>
              <p className="mt-0.5 text-[11px] text-text-muted">{group.subtitle}</p>
            </div>
            <div className="inline-flex min-w-[34px] items-center justify-center rounded-full border border-bg-hover bg-bg-secondary px-2 py-1 text-xs font-semibold text-text-secondary">
              {group.items.length}
            </div>
          </div>
          <div className="overflow-hidden rounded-[22px] border border-bg-hover/75 bg-bg-secondary/24">
            <div className="divide-y divide-bg-hover/70">
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
  const latestSession = cluster.items[0]
  const earliestSession = cluster.items[cluster.items.length - 1]

  return (
    <section className={showTimelineHeader ? 'bg-accent-blue/[0.012]' : ''}>
      {showTimelineHeader ? (
        <div className="border-b border-accent-blue/10 bg-accent-blue/[0.035] px-4 py-2.5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-blue">
                  岗位时间线
                </span>
                <h4 className="text-sm font-semibold text-text-primary">
                  {cluster.application?.company || '未命名公司'} · {cluster.application?.position || '岗位未填写'}
                </h4>
                <StageBadge stage={cluster.application?.stage || 'applied'} />
                <span className="rounded-full border border-bg-hover bg-bg-secondary/75 px-2 py-0.5 text-[10px] font-medium text-text-muted">
                  同岗位 {timelineCount} 场复盘
                </span>
              </div>
                <p className="mt-1 text-[11px] text-text-secondary">
                  最近一场 {formatSessionStamp(latestSession.started_at)}
                  {earliestSession.id !== latestSession.id ? ` · 更早一场 ${formatSessionStamp(earliestSession.started_at)}` : ''}
                  。后续同岗位复盘会继续挂回这条时间线。
                </p>
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
  const timeText = dayjs.unix(Math.floor(session.started_at)).format('YYYY-MM-DD HH:mm')
  const durationText = session.ended_at ? `${Math.max(0, Math.floor((session.ended_at - session.started_at) / 60))} 分钟` : null
  const turnsText = `${session.turn_count} 轮`
  const summary = sessionSummary(session)
  const hasPrimaryTrigger = showTriggerButton
  const linkedApplicationName = `${session.application?.company || '未命名公司'} · ${session.application?.position || '岗位'}`
  const applicationHint = showLinkedApplication
    ? describeApplicationMainlineHint(session.application ?? null, linkedReviewCount)
    : null

  return (
    <article className={`px-4 py-2.5 transition-colors hover:bg-bg-tertiary/18 ${sessionRowTone(session.status)}`}>
      <div className="flex gap-3">
        <div className={`hidden w-1.5 shrink-0 rounded-full md:block ${sessionRailTone(session.status)}`} />
        <div className="min-w-0 flex-1">
          <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(session.status)}`}>
                  <StatusIcon className={`h-3.5 w-3.5 ${session.status === 'analyzing' ? 'animate-spin' : ''} ${statusColor}`} />
                  {STATUS_LABELS[session.status]}
                </span>
                <span className="rounded-full border border-bg-hover bg-bg-tertiary/50 px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                  {session.source === 'manual' ? '手动导入' : '实时记录'}
                </span>
                {session.auto_sync_eligible === false ? (
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-500">
                    短样本
                  </span>
                ) : null}
                {showScore ? (
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${scoreTone(session.avg_score as number)}`}>
                    {session.avg_score?.toFixed(1)}
                  </span>
                ) : (
                  <span className="rounded-full border border-bg-hover px-2.5 py-1 text-[11px] text-text-muted">未出分</span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h4 className="text-base font-semibold tracking-tight text-text-primary">{title}</h4>
                <span className="text-sm text-text-secondary">{roleText}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                <span>{timeText}</span>
                {durationText ? <span>{durationText}</span> : null}
                <span>{turnsText}</span>
              </div>
              {showLinkedApplication ? (
                <div className="mt-2 rounded-xl border border-accent-blue/15 bg-accent-blue/[0.035] px-3 py-2 text-[11px] text-text-secondary">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-accent-blue">{compactLinkedApplication ? '同岗位主线' : '岗位主线'}</span>
                    <span className="font-medium text-text-primary">{linkedApplicationName}</span>
                    <StageBadge stage={session.application?.stage || 'applied'} />
                    {linkedReviewCount != null && linkedReviewCount > 1 ? (
                      <span className="rounded-full border border-bg-hover bg-bg-secondary/80 px-2 py-0.5 text-[10px] font-medium text-text-muted">
                        同岗位 {linkedReviewCount} 场复盘
                      </span>
                    ) : null}
                    {timelineLabel ? (
                      <span className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-2 py-0.5 text-[10px] font-medium text-accent-blue">
                        {timelineLabel}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onOpenApplication(session)}
                      className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-2 py-0.5 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/15"
                    >
                      岗位时间线
                    </button>
                  </div>
                  {applicationHint ? (
                    <p className="mt-1.5 line-clamp-1 text-[10px] leading-relaxed text-text-muted">
                      {applicationHint}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <p className={`text-sm leading-relaxed text-text-secondary ${showLinkedApplication ? 'mt-2 line-clamp-2' : 'mt-1 line-clamp-3'}`}>
                {summary}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:min-w-[208px] xl:flex-col xl:items-end xl:justify-start">
              {hasPrimaryTrigger ? (
                <button
                  type="button"
                  onClick={() => onTriggerAnalysis(session.id)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium ${
                    session.status === 'analysis_failed'
                      ? 'border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/15'
                      : 'border-green-500/20 bg-green-500/10 text-green-500 hover:bg-green-500/15'
                  }`}
                >
                  {session.status === 'analysis_failed' ? <RotateCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {session.status === 'analysis_failed' ? '重试生成' : '生成复盘'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onViewDetail(session.id)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-accent-blue/20 bg-accent-blue/10 px-3 text-xs font-medium text-accent-blue hover:bg-accent-blue/15"
                >
                  <Eye className="h-3.5 w-3.5" />
                  查看详情
                </button>
              )}

              {hasPrimaryTrigger ? (
                <button
                  type="button"
                  onClick={() => onViewDetail(session.id)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-accent-blue/20 bg-accent-blue/10 px-3 text-xs font-medium text-accent-blue hover:bg-accent-blue/15"
                >
                  <Eye className="h-3.5 w-3.5" />
                  查看详情
                </button>
              ) : null}

              {isTriggering ? (
                <span className="inline-flex h-9 items-center gap-1.5 px-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  提交中
                </span>
              ) : null}
            </div>
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

function scoreTone(score: number) {
  if (score >= 8) return 'bg-green-500/10 text-green-500'
  if (score >= 6) return 'bg-blue-500/10 text-blue-500'
  if (score >= 4) return 'bg-yellow-500/10 text-yellow-500'
  return 'bg-red-500/10 text-red-500'
}

function statusTone(status: ReviewSession['status']) {
  switch (status) {
    case 'analysis_failed':
      return 'border border-red-500/20 bg-red-500/10 text-red-500'
    case 'partial_capture':
      return 'border border-yellow-500/20 bg-yellow-500/10 text-yellow-500'
    case 'recorded':
      return 'border border-amber-500/20 bg-amber-500/10 text-amber-500'
    case 'analyzing':
    case 'recording':
      return 'border border-blue-500/20 bg-blue-500/10 text-blue-500'
    case 'completed':
      return 'border border-green-500/20 bg-green-500/10 text-green-500'
    default:
      return 'border border-bg-hover bg-bg-tertiary text-text-secondary'
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
  switch (status) {
    case 'analysis_failed':
      return 'bg-red-500/[0.015]'
    case 'partial_capture':
    case 'recorded':
      return 'bg-yellow-500/[0.015]'
    case 'analyzing':
    case 'recording':
      return 'bg-blue-500/[0.015]'
    default:
      return ''
  }
}

function sessionSummary(session: ReviewSession) {
  const normalized = String(session.summary_markdown ?? '')
    .replace(/[#>*`_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized) return normalized
  if (session.status === 'analysis_failed') {
    return '分析失败了，先重试生成；如果怀疑录制内容有问题，再打开详情核对问答。'
  }
  if (session.status === 'partial_capture') {
    return '采集不完整，先看原始内容，再决定是补录、重试，还是只保留这次记录。'
  }
  if (session.status === 'recorded') {
    return session.auto_sync_eligible === false
      ? '样本较短，默认不会自动回流到岗位看板；如果这场也重要，再手动生成后决定是否绑定岗位。'
      : '录制已经结束，还没生成复盘；现在就可以手动触发分析。'
  }
  if (session.status === 'analyzing') {
    return '后台正在整理摘要、评分和薄弱点，先处理前面的记录，稍后回来刷新。'
  }
  if (session.status === 'recording') {
    return '这场面试还在录制中，结束后会继续进入复盘流程。'
  }
  return '打开详情可以继续查看逐题记录、ASR 纠错痕迹，以及和岗位主线的联动。'
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

function describeApplicationMainlineHint(
  application: ReviewSession['application'] | null,
  linkedReviewCount: number | null,
) {
  if (!application) return null
  const stageLabel = STAGE_LABELS[application.stage] ?? application.stage
  if (application.stage === 'withdrawn') {
    return '这条岗位已经放弃，但历史复盘和后续补录仍会继续留在这条主线里。'
  }
  if (isRejectedStage(application.stage)) {
    return `这条岗位已${stageLabel}，复盘不会消失，后面补录也会继续挂回这条时间线。`
  }
  if ((linkedReviewCount ?? 0) > 1) {
    return '这条岗位已经形成连续时间线，后面的同岗位面试会继续接在后面。'
  }
  return '这条岗位还在主流程推进中，后续同岗位面试会继续挂回这条主线。'
}

function describeFocusEntry({
  focusFilter,
  groupKey,
  session,
}: {
  focusFilter: ReviewListFocus
  groupKey: SessionGroup['key'] | null
  session: ReviewSession | null
}) {
  if (!session) {
    return {
      label: '当前入口',
      title: '先从最新复盘开始',
      detail: '这里会优先指向当前最值得先打开的一场复盘。',
    }
  }
  switch (focusFilter) {
    case 'attention':
      return {
        label: '现在先处理',
        title: '这一场会影响后续联动',
        detail: session.auto_sync_eligible === false
          ? '这场当前被识别为测试片段，默认不会自动同步到岗位主线。'
          : '先把它补生成或确认结果，后面的岗位时间线和待办同步才会更干净。',
      }
    case 'active':
      return {
        label: '当前进行中',
        title: '后台还在推进这一场',
        detail: '不用一直盯着这里，等它出结果后再回来看逐题分析和岗位联动即可。',
      }
    case 'done':
      return {
        label: '现在回看',
        title: '从这场开始回看最顺',
        detail: session.application
          ? '如果是同岗位多轮面试，直接从这里跳回岗位时间线会比翻列表更省心。'
          : '这场已经有完整结论，适合直接打开详情回看答题和薄弱点。',
      }
    case 'all':
    default:
      if (groupKey === 'attention') {
        return {
          label: '当前入口',
          title: '先清掉前面的阻塞项',
          detail: '这场排在最前面，是因为它最容易卡住后面的岗位主线和待办联动。',
        }
      }
      if (groupKey === 'active') {
        return {
          label: '当前入口',
          title: '后台正在推进这一场',
          detail: '可以先去处理别的记录，等它分析完成后再回到这里。',
        }
      }
      return {
        label: '当前入口',
        title: '从这场开始回看复盘',
        detail: '当前没有明显阻塞项时，直接从最近的已完成复盘开始回顾最省心。',
      }
  }
}

function describeTimelinePosition(index: number, total: number) {
  if (total <= 1) return '当前这场'
  if (index === 0) return '当前这场是最近一场'
  if (index === total - 1) return '当前这场是更早一场'
  return '当前这场在中间'
}

function formatSessionStamp(ts: number) {
  return dayjs.unix(Math.floor(ts)).format('MM-DD HH:mm')
}

function formatRelativeDate(ts: number) {
  const diffDays = Math.floor((Date.now() / 1000 - ts) / 86400)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  return `${diffDays} 天前`
}

function describeFocusLens({
  focusFilter,
  actionRequiredCount,
  activeCount,
  completedCount,
  total,
  latest,
  timelineApplicationCount,
}: {
  focusFilter: ReviewListFocus
  actionRequiredCount: number
  activeCount: number
  completedCount: number
  total: number
  latest?: ReviewSession
  timelineApplicationCount: number
}) {
  switch (focusFilter) {
    case 'attention':
      return {
        title: actionRequiredCount > 0 ? '先把会卡住后续联动的记录清掉' : '需要优先处理的记录已经清空',
        detail: actionRequiredCount > 0
          ? `失败、短样本和待生成会先堆在这里。先把这 ${actionRequiredCount} 场清掉，后面的岗位时间线和待办同步才会更干净。`
          : '当前没有失败、短样本或待生成的复盘，继续保持即可。',
      }
    case 'active':
      return {
        title: activeCount > 0 ? '后台还在跑，不用一直盯着这页' : '进行中的复盘不多，可以随时切回全局',
        detail: activeCount > 0
          ? `现在有 ${activeCount} 场还在录制或分析。你可以先去处理前面的记录，等它们出结果后再回来看。`
          : '当前没有明显堆积的后台任务，复盘队列比较轻。',
      }
    case 'done':
      return {
        title: '已经出结论的，直接沿岗位主线回看',
        detail: timelineApplicationCount > 0
          ? `这页主要是已完成复盘。已经有 ${timelineApplicationCount} 条岗位时间线串起多场复盘，适合按轮次回看同一岗位。`
          : `这页主要是已完成复盘。当前共有 ${completedCount} 场已经出结论，可以按时间快速回顾。`,
      }
    case 'all':
    default:
      return {
        title: '把复盘当队列看，而不是当档案库',
        detail: total <= 0
          ? '先留下一场真实面试或手动导入逐字稿，复盘才会慢慢形成主线。'
          : `这页按时间汇总全部复盘${latest ? `，最近一场在 ${formatRelativeDate(latest.started_at)}` : ''}。优先清掉前面的阻塞项，再回看同岗位时间线会更省心。`,
      }
  }
}

function buildSessionGroups(
  sessions: ReviewSession[],
  hasGeneratedAnalysis: (session: ReviewSession) => boolean,
): SessionGroup[] {
  return [
    {
      key: 'attention' as const,
      title: '先处理',
      subtitle: '失败、部分录制、短样本和待生成的记录先放前面。',
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
      subtitle: '还在录制，或者后台正在分析。',
      items: sessions.filter((session) =>
        session.status === 'analyzing' || session.status === 'recording',
      ),
    },
    {
      key: 'done' as const,
      title: '已完成',
      subtitle: '已经生成结论，可直接回看或跳回岗位时间线。',
      items: sessions.filter((session) =>
        session.status === 'completed' && hasGeneratedAnalysis(session),
      ),
    },
  ].filter((group) => group.items.length > 0)
}
