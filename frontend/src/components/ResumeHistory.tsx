import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Loader2, CheckCircle2, AlertTriangle, FileText } from 'lucide-react'
import { api, type ResumeHistoryDetail, type ResumeHistoryItem } from '@/lib/api'
import { useInterviewStore } from '@/stores/configStore'

function formatShort(ts: number) {
  try {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function ResumeHistoryDetailModal({
  entryId,
  onClose,
  onSaved,
}: {
  entryId: number | null
  onClose: () => void
  onSaved?: () => void
}) {
  const [detail, setDetail] = useState<ResumeHistoryDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)
  const setConfig = useInterviewStore((s) => s.setConfig)

  useEffect(() => {
    if (entryId == null) {
      setDetail(null)
      setEditing(false)
      setText('')
      return
    }
    let cancelled = false
    setLoading(true)
    setEditing(false)
    api
      .resumeHistoryDetail(entryId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d)
          setText(d.summary || '')
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setToastMessage(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entryId, setToastMessage])

  const handleSave = async () => {
    if (entryId == null) return
    setSaving(true)
    try {
      await api.resumeHistoryUpdate(entryId, text)
      setToastMessage('已保存')
      setEditing(false)
      setDetail((d) => (d ? { ...d, summary: text } : d))
      onSaved?.()
      setConfig(await api.getConfig())
    } catch (e: unknown) {
      setToastMessage(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (entryId == null) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-detail-title"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="bg-bg-secondary border border-bg-tertiary rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-tertiary gap-2">
          <h3 id="resume-detail-title" className="text-sm font-semibold text-text-primary truncate min-w-0">
            {detail?.original_filename ?? '简历摘要'}
          </h3>
          <button
            type="button"
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary shrink-0"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="p-3 flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-accent-blue" />
            </div>
          ) : (
            <>
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  type="button"
                  disabled={editing}
                  onClick={() => setEditing(true)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 disabled:opacity-40"
                >
                  编辑
                </button>
                {editing && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false)
                        setText(detail?.summary ?? '')
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-bg-hover text-text-secondary hover:bg-bg-tertiary"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSave()}
                      className="text-xs px-3 py-1.5 rounded-lg bg-accent-green/20 text-accent-green hover:bg-accent-green/30 disabled:opacity-50"
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                  </>
                )}
              </div>
              <p className="text-[10px] text-text-muted">
                以下为写入系统的简历摘要（用于面试上下文）。解析失败时可能仅有片段；编辑保存后若该条为「当前」简历会同步到答题上下文。
              </p>
              {detail?.parsed_ok && detail.summary_is_full === false && (
                <p className="text-[10px] text-accent-amber/90">
                  当前为节选预览。点击列表中「选用」成功一次后，会写入完整摘要，此处即可显示与编辑全文。
                </p>
              )}
              <textarea
                readOnly={!editing}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={`flex-1 min-h-[220px] w-full rounded-lg border border-bg-hover bg-bg-tertiary px-3 py-2 text-xs text-text-primary leading-relaxed resize-y ${
                  editing ? 'ring-1 ring-accent-blue/30' : 'cursor-default opacity-95'
                }`}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface ListProps {
  items: ResumeHistoryItem[]
  loading: boolean
  busyId: number | null
  max: number
  onApply: (id: number) => void
  onDelete: (id: number, e: React.MouseEvent) => void
  onOpenDetail?: (id: number) => void
  emptyHint?: string
}

function ResumeHistoryListBody({
  items,
  loading,
  busyId,
  max,
  onApply,
  onDelete,
  onOpenDetail,
  emptyHint = '暂无上传记录',
}: ListProps) {
  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (items.length === 0) {
    return <p className="text-[11px] text-text-muted text-center py-4">{emptyHint}</p>
  }
  return (
    <ul className="space-y-1">
      {items.map((rec) => (
        <li
          key={rec.id}
          className={`flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
            rec.is_active
              ? 'border-accent-green/40 bg-accent-green/5'
              : 'border-bg-tertiary bg-bg-tertiary/40 hover:bg-bg-tertiary/70'
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] text-text-primary truncate max-w-[160px]" title={rec.original_filename}>
                {rec.original_filename}
              </span>
              {rec.is_active && (
                <span className="text-[9px] px-1 rounded bg-accent-green/20 text-accent-green shrink-0">当前</span>
              )}
              <span title={rec.parsed_ok ? '已解析' : '解析失败'} className="shrink-0 inline-flex">
                {rec.parsed_ok ? (
                  <CheckCircle2 className="w-3 h-3 text-accent-green" aria-hidden />
                ) : (
                  <AlertTriangle className="w-3 h-3 text-accent-amber" aria-hidden />
                )}
              </span>
            </div>
            <div className="text-[9px] text-text-muted mt-0.5">
              {formatSize(rec.file_size)} · {formatShort(rec.last_used_at)}
            </div>
            {!rec.parsed_ok && rec.parse_error && (
              <p className="text-[9px] text-accent-amber/90 mt-1 line-clamp-2">{rec.parse_error}</p>
            )}
          </div>
          <div className="flex flex-col gap-0.5 shrink-0">
            {onOpenDetail && (
              <button
                type="button"
                disabled={busyId !== null}
                title="预览 / 编辑摘要"
                onClick={() => onOpenDetail(rec.id)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover/80 text-text-secondary hover:text-accent-blue flex items-center justify-center gap-0.5 disabled:opacity-40"
              >
                <FileText className="w-3 h-3" />
                预览
              </button>
            )}
            <button
              type="button"
              disabled={busyId !== null}
              title={rec.parsed_ok ? '选用为当前简历' : '从已存文件重新解析并选用'}
              onClick={() => onApply(rec.id)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busyId === rec.id ? '…' : '选用'}
            </button>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={(e) => onDelete(rec.id, e)}
              className="text-[10px] px-1.5 py-0.5 rounded text-text-muted hover:text-accent-red hover:bg-accent-red/10"
            >
              删除
            </button>
          </div>
        </li>
      ))}
      <p className="text-[9px] text-text-muted pt-1 px-0.5">最多 {max} 条；越靠下为最近上传或选用。</p>
    </ul>
  )
}

/** 底栏：简历旁小三角展开上传记录（向上弹出） */
export function ResumeHistoryPopover({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [items, setItems] = useState<ResumeHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [maxN, setMaxN] = useState(10)
  const wrapRef = useRef<HTMLDivElement>(null)
  const setConfig = useInterviewStore((s) => s.setConfig)
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.resumeHistory()
      setItems(res.items || [])
      setMaxN(res.max ?? 10)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    refresh()
  }, [open, refresh])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!open) return
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onApply = async (id: number) => {
    setBusyId(id)
    try {
      await api.resumeHistoryApply(id)
      setConfig(await api.getConfig())
      setToastMessage('已选用该简历')
      await refresh()
      setOpen(false)
    } catch (e: unknown) {
      setToastMessage(e instanceof Error ? e.message : '选用失败')
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('从历史中删除该文件？不可恢复。')) return
    setBusyId(id)
    try {
      await api.resumeHistoryDelete(id)
      setConfig(await api.getConfig())
      setToastMessage('已删除')
      await refresh()
    } catch (e: unknown) {
      setToastMessage(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div ref={wrapRef} className={`relative flex items-stretch self-stretch ${className}`}>
      <ResumeHistoryDetailModal
        entryId={detailId}
        onClose={() => setDetailId(null)}
        onSaved={() => void refresh()}
      />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="上传记录"
        title="上传记录"
        className={`flex items-center justify-center min-w-[1.375rem] px-0.5 rounded-r-lg text-text-muted hover:text-text-primary hover:bg-bg-hover/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue/50 ${
          open ? 'text-accent-blue bg-accent-blue/15' : ''
        }`}
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center pointer-events-auto">
          <div
            className="w-[min(16.5rem,calc(100vw-1rem))] max-h-[min(17rem,45vh)] overflow-y-auto rounded-xl border border-bg-tertiary bg-bg-secondary shadow-lg shadow-black/25 p-2"
          >
            <div className="text-[10px] text-text-muted px-1 pb-1.5 border-b border-bg-tertiary mb-1.5">
              上传记录（最多 {maxN} 条，最近使用的在下方）
            </div>
            <ResumeHistoryListBody
              items={items}
              loading={loading}
              busyId={busyId}
              max={maxN}
              onApply={onApply}
              onDelete={onDelete}
              onOpenDetail={(id) => setDetailId(id)}
            />
          </div>
          {/* 指向下三角，视觉上贴近小箭头 */}
          <div
            className="h-0 w-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-bg-secondary -mt-px drop-shadow-sm"
            aria-hidden
          />
        </div>
      )}
    </div>
  )
}

/** 简历优化页：内联展示历史 */
export function ResumeHistoryPanel() {
  const [detailId, setDetailId] = useState<number | null>(null)
  const [items, setItems] = useState<ResumeHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [maxN, setMaxN] = useState(10)
  const setConfig = useInterviewStore((s) => s.setConfig)
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.resumeHistory()
      setItems(res.items || [])
      setMaxN(res.max ?? 10)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onApply = async (id: number) => {
    setBusyId(id)
    try {
      await api.resumeHistoryApply(id)
      setConfig(await api.getConfig())
      setToastMessage('已选用该简历')
      await refresh()
    } catch (e: unknown) {
      setToastMessage(e instanceof Error ? e.message : '选用失败')
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('从历史中删除该文件？不可恢复。')) return
    setBusyId(id)
    try {
      await api.resumeHistoryDelete(id)
      setConfig(await api.getConfig())
      setToastMessage('已删除')
      await refresh()
    } catch (e: unknown) {
      setToastMessage(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rounded-lg border border-bg-tertiary bg-bg-tertiary/30 p-2 space-y-2">
      <ResumeHistoryDetailModal
        entryId={detailId}
        onClose={() => setDetailId(null)}
        onSaved={() => void refresh()}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-muted">上传历史（最多 {maxN} 条，最近在上传或选用的在下方）</span>
        <button
          type="button"
          onClick={() => refresh()}
          className="text-[10px] text-accent-blue hover:underline"
        >
          刷新
        </button>
      </div>
      <ResumeHistoryListBody
        items={items}
        loading={loading}
        busyId={busyId}
        max={maxN}
        onApply={onApply}
        onDelete={onDelete}
        onOpenDetail={(id) => setDetailId(id)}
      />
    </div>
  )
}
