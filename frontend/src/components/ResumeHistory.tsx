import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { api, type ResumeHistoryItem } from '@/lib/api'
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

interface ListProps {
  items: ResumeHistoryItem[]
  loading: boolean
  busyId: number | null
  max: number
  onApply: (id: number) => void
  onDelete: (id: number, e: React.MouseEvent) => void
  emptyHint?: string
}

function ResumeHistoryListBody({
  items,
  loading,
  busyId,
  max,
  onApply,
  onDelete,
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
      />
    </div>
  )
}
