import { useState, useEffect, useCallback } from 'react'
import dayjs from 'dayjs'
import { Eye, AlertCircle, CheckCircle, Clock, XCircle, Settings, Brain, Power } from 'lucide-react'
import { api } from '../../lib/api'
import { useInterviewStore } from '../../stores/configStore'
import type { ReviewSession, ReviewSessionsResponse } from './types'

const STATUS_LABELS: Record<ReviewSession['status'], string> = {
  recording: '录制中',
  analyzing: '分析中',
  completed: '已完成',
  partial_capture: '部分录制',
  analysis_failed: '分析失败',
}

const STATUS_ICONS: Record<ReviewSession['status'], React.ComponentType<{ className?: string }>> = {
  recording: Clock,
  analyzing: Clock,
  completed: CheckCircle,
  partial_capture: AlertCircle,
  analysis_failed: XCircle,
}

interface Props {
  onViewDetail: (sessionId: number) => void
}

export default function ReviewSessionList({ onViewDetail }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ReviewSessionsResponse | null>(null)
  const [page, setPage] = useState(1)
  const [showSettings, setShowSettings] = useState(false)
  const pageSize = 20

  const config = useInterviewStore((s) => s.config)
  const setConfig = useInterviewStore((s) => s.setConfig)

  const reviewEnabled = config?.review_enabled ?? false
  const reviewModelIndex = config?.review_model_index ?? 0
  const models = config?.models ?? []

  const handleToggleReview = async (enabled: boolean) => {
    try {
      const updated = await api.updateConfig({ review_enabled: enabled })
      setConfig(updated)
    } catch (err) {
      console.error('Failed to update review_enabled:', err)
    }
  }

  const handleChangeModel = async (modelIndex: number) => {
    try {
      const updated = await api.updateConfig({ review_model_index: modelIndex })
      setConfig(updated)
    } catch (err) {
      console.error('Failed to update review_model_index:', err)
    }
  }

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

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm">加载中...</div>
      </div>
    )
  }

  const sessions = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <div className="flex-1 flex flex-col gap-4 p-6 overflow-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">面试复盘</h2>
          <p className="text-sm text-text-muted mt-1">
            共 {total} 场面试记录
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-primary text-sm font-medium transition-colors"
        >
          <Settings className="w-4 h-4" />
          配置
        </button>
      </div>

      {showSettings && (
        <div className="rounded-xl border border-bg-hover/60 bg-bg-primary/35 overflow-hidden">
          <div className="px-4 py-3 border-b border-bg-hover/50">
            <h3 className="text-sm font-semibold text-text-primary">面试复盘配置</h3>
            <p className="text-xs text-text-muted mt-1">
              配置自动记录和分析设置
            </p>
          </div>
          <div className="p-4 space-y-4">
            {/* 启用开关 */}
            <div className="rounded-xl border border-bg-hover/60 bg-bg-tertiary/25 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    reviewEnabled ? 'bg-accent-green/15' : 'bg-bg-hover'
                  }`}>
                    <Power className={`w-4 h-4 ${reviewEnabled ? 'text-accent-green' : 'text-text-muted'}`} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-text-primary">启用面试复盘</div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      实时辅助时自动录制并分析
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleReview(!reviewEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    reviewEnabled ? 'bg-accent-green' : 'bg-bg-hover'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                      reviewEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* 模型选择 */}
            <div className="rounded-xl border border-bg-hover/60 bg-bg-tertiary/25 p-3">
              <div className="flex items-start gap-2.5 mb-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  reviewEnabled ? 'bg-accent-blue/15' : 'bg-bg-hover'
                }`}>
                  <Brain className={`w-4 h-4 ${reviewEnabled ? 'text-accent-blue' : 'text-text-muted'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-text-primary">复盘分析模型</div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    建议使用长文本模型以获得更准确的分析
                  </div>
                </div>
              </div>
              <select
                value={reviewModelIndex}
                onChange={(e) => handleChangeModel(Number(e.target.value))}
                disabled={!reviewEnabled}
                className="w-full px-3 py-2 rounded-lg bg-bg-secondary border border-bg-hover text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent-blue/50 focus:border-accent-blue/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {models.map((model, idx) => (
                  <option key={idx} value={idx} disabled={!model.enabled}>
                    {model.name} {!model.enabled ? '(未启用)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* 说明信息 */}
            {!reviewEnabled && (
              <div className="rounded-lg bg-bg-hover/40 px-3 py-2 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-text-muted flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-text-muted leading-relaxed">
                  启用后，在实时辅助中同时开启面试官和候选人音频时，将自动创建复盘记录
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-text-muted text-sm">暂无面试记录</p>
            <p className="text-text-muted/70 text-xs">
              {reviewEnabled
                ? '在实时辅助中同时开启面试官和候选人音频，即可自动记录'
                : '请先在上方启用面试复盘功能'}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto">
            <div className="rounded-xl border border-bg-hover/80 bg-bg-secondary/40 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-bg-tertiary shadow-sm border-b border-bg-hover">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      状态
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      时间
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      公司 / 岗位
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted text-center">
                      轮次
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted text-center">
                      平均分
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-text-muted text-center">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const StatusIcon = STATUS_ICONS[session.status]
                    const statusColor =
                      session.status === 'completed'
                        ? 'text-green-500'
                        : session.status === 'recording' || session.status === 'analyzing'
                          ? 'text-blue-500'
                          : 'text-yellow-500'
                    return (
                      <tr
                        key={session.id}
                        className="border-b border-bg-tertiary/50 hover:bg-bg-tertiary/25 transition-colors"
                      >
                        <td className="px-4 py-3 bg-bg-secondary/30">
                          <div className="flex items-center gap-2">
                            <StatusIcon className={`w-4 h-4 ${statusColor}`} />
                            <span className="text-xs text-text-primary">
                              {STATUS_LABELS[session.status]}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 bg-bg-secondary/30">
                          <div className="text-xs text-text-primary">
                            {dayjs.unix(Math.floor(session.started_at)).format('YYYY-MM-DD HH:mm')}
                          </div>
                          {session.ended_at && (
                            <div className="text-[10px] text-text-muted mt-0.5">
                              时长 {Math.floor((session.ended_at - session.started_at) / 60)} 分钟
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 bg-bg-secondary/30">
                          {session.company || session.role ? (
                            <div>
                              <div className="text-sm text-text-primary">
                                {session.company || '未知公司'}
                              </div>
                              {session.role && (
                                <div className="text-xs text-text-muted mt-0.5">{session.role}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-text-muted">未填写</span>
                          )}
                        </td>
                        <td className="px-4 py-3 bg-bg-secondary/30 text-center">
                          <span className="text-sm text-text-primary font-medium">
                            {session.turn_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 bg-bg-secondary/30 text-center">
                          {session.avg_score != null ? (
                            <span className="text-sm text-text-primary font-medium">
                              {session.avg_score.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 bg-bg-secondary/30 text-center">
                          <button
                            type="button"
                            onClick={() => onViewDetail(session.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-accent-blue hover:bg-accent-blue/10 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            查看详情
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {total > pageSize && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                className="px-4 py-2 text-sm rounded-lg bg-bg-tertiary text-text-primary disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-hover transition-colors"
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
                className="px-4 py-2 text-sm rounded-lg bg-bg-tertiary text-text-primary disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-hover transition-colors"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
