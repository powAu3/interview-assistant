import { useCallback, useEffect, useRef, useState } from 'react'
import { Zap } from 'lucide-react'

interface QuickPromptsRowProps {
  prompts: string[]
  onPick: (prompt: string) => void
  recentSet?: Set<string>
}

export function QuickPromptsRow({ prompts, onPick, recentSet }: QuickPromptsRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [fadeLeft, setFadeLeft] = useState(false)
  const [fadeRight, setFadeRight] = useState(false)

  const recalc = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    const overflowing = el.scrollWidth - el.clientWidth > 1
    setFadeLeft(overflowing && el.scrollLeft > 2)
    setFadeRight(overflowing && el.scrollLeft < el.scrollWidth - el.clientWidth - 2)
  }, [])

  useEffect(() => {
    recalc()
    const el = rowRef.current
    if (!el) return
    el.addEventListener('scroll', recalc, { passive: true })
    const ro = new ResizeObserver(recalc)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', recalc)
      ro.disconnect()
    }
  }, [recalc, prompts.length])

  return (
    <div className="relative">
      <div
        ref={rowRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5"
        title="快捷提示词 · 点击填入下方输入框 (可在 设置 → 偏好 → 快捷提示词 中编辑)"
      >
        <Zap
          className="w-3 h-3 text-accent-amber flex-shrink-0"
          aria-label="快捷提示词"
        />
        {prompts.map((prompt, i) => {
          const isRecent = recentSet?.has(prompt) ?? false
          return (
            <button
              key={`${i}-${prompt}`}
              onClick={() => onPick(prompt)}
              title={isRecent ? `最近使用过 · 填入「${prompt}」到输入框` : `填入「${prompt}」到输入框`}
              className={`prompt-pill inline-flex items-center gap-1 min-h-[28px] px-2.5 py-1 text-[11px] rounded-lg font-medium whitespace-nowrap flex-shrink-0${
                isRecent ? ' ring-1 ring-accent-blue/40 text-accent-blue' : ''
              }`}
            >
              {isRecent && (
                <span
                  className="inline-flex w-1 h-1 rounded-full bg-accent-blue/80"
                  aria-hidden
                />
              )}
              {prompt}
            </button>
          )
        })}
      </div>
      {fadeLeft && (
        <div
          className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-bg-primary to-transparent"
          aria-hidden
        />
      )}
      {fadeRight && (
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-bg-primary to-transparent"
          aria-hidden
        />
      )}
    </div>
  )
}
