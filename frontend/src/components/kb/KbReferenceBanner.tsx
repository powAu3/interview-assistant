import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { useKbStore } from '@/stores/kbStore'
import BetaBadge from './BetaBadge'

interface Props {
  qaId: string | null | undefined
}

const ORIGIN_TAG: Record<string, string> = {
  ocr: 'OCR',
  vision: 'Vision',
  mixed: 'Mixed',
}

/**
 * 当次问答的 KB 引用面板。
 * - 没有 qaId 或没命中则不渲染。
 * - degraded=true 时显示降级提示 (超时 / 异常)。
 */
export default function KbReferenceBanner({ qaId }: Props) {
  const payload = useKbStore((s) => (qaId ? s.hitsByQaId[qaId] : undefined))
  const [open, setOpen] = useState(false)
  const userToggled = useRef(false)

  // 首次有命中时自动展开 — 否则正文里的 [1][2] 角标用户找不到来源会困惑。
  // 用 ref 记录是否用户主动 toggle 过, 避免后续 payload 更新覆盖用户折叠意图。
  useEffect(() => {
    if (!userToggled.current && payload && payload.hit_count > 0) {
      setOpen(true)
    }
  }, [payload])

  if (!payload) return null
  if (payload.hit_count === 0 && !payload.degraded) return null

  const handleToggle = () => {
    userToggled.current = true
    setOpen((v) => !v)
  }

  return (
    <div className="mb-2 rounded-xl border border-amber-500/25 bg-amber-500/5 overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-amber-500/10 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        )}
        <BookOpen className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        <span className="text-xs font-medium text-amber-300">
          引用 {payload.hit_count} 条本地笔记
        </span>
        <BetaBadge className="flex-shrink-0" />
        <span className="text-[10px] text-text-muted ml-auto whitespace-nowrap">
          {payload.latency_ms}ms
          {payload.degraded && ' · 降级'}
        </span>
      </button>

      {open && (
        <div className="border-t border-amber-500/20 p-2 space-y-1.5">
          {payload.degraded && payload.hit_count === 0 && (
            <div className="text-[11px] text-amber-300/80">
              KB 检索超时或失败,本次未注入参考资料。
            </div>
          )}
          {payload.hits.map((h, i) => (
            <div
              key={`${h.path}-${i}`}
              className="group px-2 py-1.5 rounded-lg bg-bg-tertiary/40 border border-bg-hover/30 hover:border-amber-500/40 hover:bg-bg-tertiary/60 transition-colors"
            >
              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                <span className="text-[10px] font-mono px-1 py-[1px] rounded bg-amber-500/15 text-amber-300 tabular-nums">
                  [{i + 1}]
                </span>
                <span className="text-[11px] text-amber-300 font-medium truncate">
                  {h.section_path || '(无小节)'}
                </span>
                {ORIGIN_TAG[h.origin] && (
                  <span className="text-[9px] px-1 py-0 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
                    {ORIGIN_TAG[h.origin]}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-text-muted truncate" title={h.path}>
                {h.path}
                {h.page ? ` · 第 ${h.page} 页` : ''}
              </div>
              <div className="text-[11px] text-text-secondary leading-snug mt-0.5 line-clamp-3">
                {h.excerpt}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
