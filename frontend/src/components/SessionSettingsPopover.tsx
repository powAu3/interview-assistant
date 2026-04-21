import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Sparkles,
  Briefcase,
  Languages,
  Coins,
  X,
  Pencil,
  Check,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useInterviewStore } from '@/stores/configStore'
import { updateConfigAndRefresh } from '@/lib/configSync'

interface SessionSettingsPopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export default function SessionSettingsPopover({
  open,
  onClose,
  anchorRef,
}: SessionSettingsPopoverProps) {
  const { config, options, tokenUsage } = useInterviewStore(
    useShallow((s) => ({
      config: s.config,
      options: s.options,
      tokenUsage: s.tokenUsage,
    })),
  )

  const popoverRef = useRef<HTMLDivElement>(null)
  const [editingPos, setEditingPos] = useState(false)
  const [editingLang, setEditingLang] = useState(false)
  const [posInput, setPosInput] = useState('')
  const [langInput, setLangInput] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  const thinkOn = !!config?.think_mode
  const handleThinkToggle = async () => {
    await updateConfigAndRefresh({ think_mode: !thinkOn })
  }
  const handlePos = async (val: string) => {
    const v = val.trim()
    if (v && v !== config?.position) await updateConfigAndRefresh({ position: v })
  }
  const handleLang = async (val: string) => {
    const v = val.trim()
    if (v && v !== config?.language) await updateConfigAndRefresh({ language: v })
  }

  const tokenByModel = Object.entries(tokenUsage.byModel || {})

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="会场设置"
      className="absolute right-0 top-full mt-2 w-[340px] glass border border-bg-hover/50 rounded-2xl shadow-2xl shadow-black/30 z-50 overflow-hidden animate-fade-up"
    >
      {/* 顶部 hairline 渐变,与玻璃面分隔 */}
      <div className="h-px bg-gradient-to-r from-transparent via-accent-blue/30 to-transparent" />

      <div className="px-3.5 pt-3 pb-2 flex items-center justify-between border-b border-bg-tertiary/40">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-text-primary uppercase">
          <span className="inline-block w-1 h-1 rounded-full bg-accent-blue" aria-hidden />
          会场设置
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary p-1 -mr-1 rounded-md hover:bg-bg-tertiary/50 transition-colors"
          aria-label="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3.5 py-3 space-y-3.5 max-h-[min(70vh,560px)] overflow-y-auto">
        {/* ── Think ── */}
        <section className="rounded-xl border border-bg-hover/40 bg-bg-tertiary/25 overflow-hidden">
          <button
            type="button"
            onClick={handleThinkToggle}
            className="w-full flex items-start gap-3 p-3 text-left hover:bg-bg-tertiary/40 transition-colors"
            aria-pressed={thinkOn}
          >
            <div className="mt-0.5 flex-shrink-0">
              <span
                className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${
                  thinkOn ? 'bg-accent-green shadow-[0_0_10px_-2px] shadow-accent-green/50' : 'bg-bg-hover'
                }`}
              >
                <span
                  className={`absolute top-[2px] left-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    thinkOn ? 'translate-x-4' : ''
                  }`}
                />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Sparkles className={`w-3.5 h-3.5 ${thinkOn ? 'text-accent-green' : 'text-text-muted'}`} />
                <span className="text-xs font-semibold text-text-primary">Think · 思考模式</span>
                <span
                  className={`ml-auto text-[10px] font-mono px-1.5 py-[1px] rounded-md tracking-wider ${
                    thinkOn
                      ? 'text-accent-green border border-accent-green/30 bg-accent-green/10'
                      : 'text-text-muted border border-bg-hover/60 bg-bg-tertiary/40'
                  }`}
                >
                  {thinkOn ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                让模型先「想一下」再答。开启后会看到独立的思考链流,准确度更高,但首字延迟与 token 消耗都会上升。
              </p>
            </div>
          </button>
          <div className="px-3 pb-3 -mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10.5px] text-text-muted">
            <div className="flex items-start gap-1.5">
              <span className="mt-1 inline-block w-1 h-1 rounded-full bg-accent-blue/70 flex-shrink-0" />
              <span><b className="text-text-secondary font-medium">建议开</b>:系统设计 · 算法 · 行为面深挖</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="mt-1 inline-block w-1 h-1 rounded-full bg-text-muted/40 flex-shrink-0" />
              <span><b className="text-text-secondary font-medium">建议关</b>:八股 · 项目讲述 · 抢答场景</span>
            </div>
            <div className="col-span-2 flex items-start gap-1.5">
              <span className="mt-1 inline-block w-1 h-1 rounded-full bg-accent-amber/70 flex-shrink-0" />
              <span>
                只对支持思考能力的模型生效(DeepSeek-R1 / Claude 3.7+ / o1 等);其它模型会自动忽略。
              </span>
            </div>
          </div>
        </section>

        {/* ── 岗位 ── */}
        <section>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-text-muted uppercase mb-1.5">
            <Briefcase className="w-3 h-3" />
            目标岗位
          </label>
          {editingPos ? (
            <div className="flex items-center gap-1.5">
              <input
                value={posInput}
                onChange={(e) => setPosInput(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (posInput.trim()) void handlePos(posInput.trim())
                    setEditingPos(false)
                  }
                  if (e.key === 'Escape') setEditingPos(false)
                }}
                placeholder="输入自定义岗位"
                className="flex-1 bg-bg-tertiary/60 text-text-primary text-xs rounded-lg px-2.5 py-2 border border-accent-blue/60 focus:outline-none focus:border-accent-blue"
              />
              <button
                type="button"
                onClick={() => {
                  if (posInput.trim()) void handlePos(posInput.trim())
                  setEditingPos(false)
                }}
                className="p-2 rounded-lg bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 transition-colors"
                aria-label="确认"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <select
                value={config?.position ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setPosInput('')
                    setEditingPos(true)
                  } else void handlePos(e.target.value)
                }}
                className="flex-1 bg-bg-tertiary/60 text-text-primary text-xs rounded-lg px-2.5 py-2 border border-bg-hover/50 focus:outline-none focus:border-accent-blue/60 transition-colors"
              >
                {(options?.positions ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                {config?.position && !(options?.positions ?? []).includes(config.position) && (
                  <option value={config.position}>{config.position}</option>
                )}
                <option value="__custom__">自定义...</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setPosInput(config?.position ?? '')
                  setEditingPos(true)
                }}
                title="自定义岗位"
                className="p-2 rounded-lg text-text-muted hover:text-accent-blue hover:bg-bg-tertiary/50 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </section>

        {/* ── 语言 ── */}
        <section>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-text-muted uppercase mb-1.5">
            <Languages className="w-3 h-3" />
            目标语言
          </label>
          {editingLang ? (
            <div className="flex items-center gap-1.5">
              <input
                value={langInput}
                onChange={(e) => setLangInput(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (langInput.trim()) void handleLang(langInput.trim())
                    setEditingLang(false)
                  }
                  if (e.key === 'Escape') setEditingLang(false)
                }}
                placeholder="输入自定义语言"
                className="flex-1 bg-bg-tertiary/60 text-text-primary text-xs rounded-lg px-2.5 py-2 border border-accent-blue/60 focus:outline-none focus:border-accent-blue"
              />
              <button
                type="button"
                onClick={() => {
                  if (langInput.trim()) void handleLang(langInput.trim())
                  setEditingLang(false)
                }}
                className="p-2 rounded-lg bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 transition-colors"
                aria-label="确认"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <select
                value={config?.language ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setLangInput('')
                    setEditingLang(true)
                  } else void handleLang(e.target.value)
                }}
                className="flex-1 bg-bg-tertiary/60 text-text-primary text-xs rounded-lg px-2.5 py-2 border border-bg-hover/50 focus:outline-none focus:border-accent-blue/60 transition-colors"
              >
                {(options?.languages ?? []).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
                {config?.language && !(options?.languages ?? []).includes(config.language) && (
                  <option value={config.language}>{config.language}</option>
                )}
                <option value="__custom__">自定义...</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setLangInput(config?.language ?? '')
                  setEditingLang(true)
                }}
                title="自定义语言"
                className="p-2 rounded-lg text-text-muted hover:text-accent-blue hover:bg-bg-tertiary/50 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </section>

        {/* ── Token 用量 ── */}
        <section className="rounded-xl border border-bg-hover/40 bg-bg-tertiary/25 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
              <Coins className="w-3 h-3" />
              Token 用量
            </div>
            <span className="text-[11px] font-mono font-medium text-accent-blue tabular-nums">
              {formatTokens(tokenUsage.total)}
            </span>
          </div>
          {tokenUsage.total > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                <div className="flex items-center justify-between rounded-md bg-bg-secondary/40 px-2 py-1">
                  <span className="text-text-muted">Prompt</span>
                  <span className="font-mono tabular-nums text-text-secondary">
                    {formatTokens(tokenUsage.prompt)}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-bg-secondary/40 px-2 py-1">
                  <span className="text-text-muted">Completion</span>
                  <span className="font-mono tabular-nums text-text-secondary">
                    {formatTokens(tokenUsage.completion)}
                  </span>
                </div>
              </div>
              {tokenByModel.length > 0 && (
                <div className="mt-2 space-y-1">
                  {tokenByModel.map(([name, v]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between text-[10.5px] px-1"
                    >
                      <span className="truncate text-text-muted" title={name}>
                        {name}
                      </span>
                      <span className="font-mono tabular-nums text-text-secondary flex-shrink-0 ml-2">
                        P {formatTokens(v.prompt)} · C {formatTokens(v.completion)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-[10.5px] text-text-muted py-1">本次会话尚未消耗 Token</div>
          )}
        </section>
      </div>

      {/* 底部跳转入口 */}
      <div className="px-3.5 py-2 border-t border-bg-tertiary/40 flex items-center justify-between bg-bg-tertiary/20">
        <span className="text-[10px] text-text-muted">需要 VAD / 并发 / 模型参数?</span>
        <button
          type="button"
          onClick={() => {
            useInterviewStore.getState().openConfigDrawer()
            onClose()
          }}
          className="inline-flex items-center gap-1 text-[10.5px] font-medium text-accent-blue hover:text-accent-blue/80 transition-colors"
        >
          高级参数
          <ChevronDown className="w-3 h-3 -rotate-90" />
        </button>
      </div>
    </div>
  )
}
