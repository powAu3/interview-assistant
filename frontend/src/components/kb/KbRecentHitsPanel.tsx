import { useKbStore } from '@/stores/kbStore'

function fmtTs(ts: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleTimeString()
}

const MODE_LABEL: Record<string, string> = {
  asr_realtime: '实时',
  manual_text: '手动',
  written_exam: '笔试',
}

export default function KbRecentHitsPanel() {
  const items = useKbStore((s) => s.recentHits)

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted text-xs">
        还没有命中记录。开启 KB 后,每次问答都会在这里出现。
      </div>
    )
  }

  return (
    <ul className="space-y-1.5">
      {items.map((h, i) => (
        <li
          key={`${h.ts}-${i}`}
          className="px-2.5 py-1.5 rounded-lg border border-bg-hover/30 bg-bg-tertiary/30"
        >
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-text-muted">{fmtTs(h.ts)}</span>
              <span className="text-[10px] px-1 py-0 rounded border border-bg-hover/40 bg-bg-tertiary/60 text-text-muted">
                {MODE_LABEL[h.mode] ?? h.mode}
              </span>
              {h.timed_out && (
                <span className="text-[10px] px-1 py-0 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400">
                  超时
                </span>
              )}
              {h.error && (
                <span
                  title={h.error}
                  className="text-[10px] px-1 py-0 rounded border border-accent-red/40 bg-accent-red/10 text-accent-red"
                >
                  错误
                </span>
              )}
            </div>
            <div className="text-[10px] text-text-muted whitespace-nowrap">
              {h.hit_count} 命中 · {h.latency_ms}ms
            </div>
          </div>
          <div className="text-xs text-text-primary truncate" title={h.query}>
            {h.query}
          </div>
          {h.top_section_paths.length > 0 && (
            <div className="text-[10px] text-text-muted truncate mt-0.5">
              → {h.top_section_paths.join(' · ')}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
