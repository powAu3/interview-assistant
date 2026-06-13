import { Loader2, CheckCircle2, XCircle, AlertCircle, Clock3 } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * 设置抽屉顶部搜索框的 query,注入到每个 Section/Collapsible.
 * 为空时视为不过滤.
 */
export const SettingsSearchContext = createContext<string>('')

export function useSettingsSearch(): string {
  return useContext(SettingsSearchContext)
}

/**
 * 判断一个 section 的 title + 关键词是否命中当前搜索 query.
 * query 为空时永远 true.
 */
export function matchSettingsSearch(
  titleText: string | undefined,
  keywords: string | undefined,
  query: string,
): boolean {
  if (!query) return true
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = `${titleText ?? ''} ${keywords ?? ''}`.toLowerCase()
  return hay.includes(q)
}

export function Section({ title, icon, keywords, children }: { title: React.ReactNode; icon?: React.ReactNode; keywords?: string; children: React.ReactNode }) {
  const query = useSettingsSearch()
  const titleText = typeof title === 'string' ? title : ''
  if (!matchSettingsSearch(titleText, keywords, query)) return null
  return (
    <section className="rounded-xl border border-bg-hover/60 bg-bg-primary/35 overflow-hidden" data-search-title={titleText}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-bg-hover/50">
        {icon && <span className="text-text-muted flex-shrink-0">{icon}</span>}
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="px-4 py-4 space-y-3">
        {children}
      </div>
    </section>
  )
}

export function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-text-muted leading-relaxed">{hint}</p>}
    </div>
  )
}

export function GradientCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-bg-hover/60 bg-bg-tertiary/25 ${className}`}>
      {children}
    </div>
  )
}

export function StatusBadge({
  status,
  label,
  title,
}: {
  status: 'ok' | 'error' | 'checking' | 'idle'
  label: string
  title?: string
}) {
  const styles = {
    ok: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    error: 'bg-red-500/15 text-red-400 border-red-500/20',
    checking: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    idle: 'bg-bg-hover text-text-muted border-bg-hover',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border ${styles[status]}`}
      title={title}
    >
      {status === 'checking' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {status === 'ok' && <CheckCircle2 className="w-2.5 h-2.5" />}
      {status === 'error' && <XCircle className="w-2.5 h-2.5" />}
      {label}
    </span>
  )
}

export type SaveMode = 'auto' | 'explicit'
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export function SaveStateBadge({
  mode,
  state,
  error,
  label,
}: {
  mode: SaveMode
  state: SaveState
  error?: string | null
  label?: string
}) {
  const normalizedError = error?.trim()
  const text = label ?? (
    state === 'saving'
      ? '保存中…'
      : state === 'saved'
        ? '已保存'
        : state === 'error'
          ? `保存失败${normalizedError ? `：${normalizedError}` : ''}`
          : state === 'dirty'
            ? '有未保存更改'
            : mode === 'auto'
              ? '自动保存'
              : '保存后生效'
  )
  const styles: Record<SaveState, string> = {
    idle: mode === 'auto'
      ? 'bg-bg-hover/70 text-text-secondary border-bg-hover'
      : 'bg-accent-blue/12 text-accent-blue border-accent-blue/35',
    dirty: 'bg-accent-amber/15 text-accent-amber border-accent-amber/45',
    saving: 'bg-accent-blue/15 text-accent-blue border-accent-blue/40',
    saved: 'bg-accent-green/15 text-accent-green border-accent-green/40',
    error: 'bg-accent-red/15 text-accent-red border-accent-red/40',
  }
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4 ${styles[state]}`}
      title={normalizedError || text}
      aria-live={state === 'error' || state === 'saving' ? 'polite' : undefined}
    >
      {state === 'saving' && <Loader2 className="h-2.5 w-2.5 animate-spin flex-shrink-0" />}
      {state === 'saved' && <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0" />}
      {state === 'error' && <XCircle className="h-2.5 w-2.5 flex-shrink-0" />}
      {state === 'dirty' && <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />}
      {state === 'idle' && mode === 'explicit' && <Clock3 className="h-2.5 w-2.5 flex-shrink-0" />}
      <span className="min-w-0 truncate">{text}</span>
    </span>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '保存失败'
}

export function useAutoSaveSetting<T extends Record<string, unknown>>(
  updateFn: (data: T) => Promise<unknown>,
  delayMs = 500,
) {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef<T | null>(null)
  const sequenceRef = useRef(0)
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const mountedRef = useRef(true)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const mergePending = useCallback((data: T) => {
    return pendingRef.current ? ({ ...pendingRef.current, ...data } as T) : data
  }, [])

  const runQueuedSave = useCallback((data: T, sequence: number, updateUi: boolean) => {
    const task = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await updateFn(data)
          if (updateUi && mountedRef.current && sequence === sequenceRef.current) {
            setState('saved')
          }
          return true
        } catch (e) {
          if (updateUi && mountedRef.current && sequence === sequenceRef.current) {
            setError(errorMessage(e))
            setState('error')
          }
          return false
        }
      })
    saveChainRef.current = task
    return task
  }, [updateFn])

  const saveNow = useCallback(async (data: T) => {
    const sequence = ++sequenceRef.current
    const mergedData = mergePending(data)
    clearTimer()
    pendingRef.current = null
    setState('saving')
    setError(null)
    return runQueuedSave(mergedData, sequence, true)
  }, [clearTimer, mergePending, runQueuedSave])

  const saveDebounced = useCallback((data: T) => {
    pendingRef.current = mergePending(data)
    setState('saving')
    setError(null)
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      const pending = pendingRef.current
      if (pending) void saveNow(pending)
    }, delayMs)
  }, [clearTimer, delayMs, mergePending, saveNow])

  const flush = useCallback((data?: T) => {
    const pending = data ? mergePending(data) : pendingRef.current
    if (!pending) return Promise.resolve(true)
    return saveNow(pending)
  }, [mergePending, saveNow])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      const pending = pendingRef.current
      mountedRef.current = false
      clearTimer()
      pendingRef.current = null
      if (pending) {
        void runQueuedSave(pending, sequenceRef.current, false)
      }
    }
  }, [clearTimer, runQueuedSave])

  return { state, error, saveNow, saveDebounced, flush }
}

function stableSnapshot(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function useDirtySnapshot<T>(value: T) {
  const [baseline, setBaseline] = useState(() => stableSnapshot(value))
  const current = stableSnapshot(value)
  const dirty = current !== baseline
  const resetBaseline = useCallback((nextValue: T) => {
    setBaseline(stableSnapshot(nextValue))
  }, [])
  const markSaved = useCallback((nextValue?: T) => {
    setBaseline(stableSnapshot(nextValue ?? value))
  }, [value])
  return { dirty, markSaved, resetBaseline }
}

export function useSettingsDirtyRegistration(key: string, dirty: boolean) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('settings-dirty-change', { detail: { key, dirty } }))
    return () => {
      window.dispatchEvent(new CustomEvent('settings-dirty-change', { detail: { key, dirty: false } }))
    }
  }, [dirty, key])
}

export const INPUT_FIELD_STYLE = `
  .input-field {
    width: 100%;
    background: rgb(var(--c-bg-tertiary));
    color: rgb(var(--c-text-primary));
    font-size: 0.75rem;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid rgb(var(--c-bg-hover));
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .input-field:focus {
    border-color: rgb(var(--c-accent-blue));
    box-shadow: 0 0 0 2px rgb(var(--c-accent-blue) / 0.1);
  }
`
