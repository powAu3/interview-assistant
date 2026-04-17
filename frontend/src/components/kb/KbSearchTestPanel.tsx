import { useState } from 'react'
import { Search } from 'lucide-react'
import { api, type KBHit } from '@/lib/api'

const ORIGIN_LABEL: Record<string, string> = {
  text: '原文',
  ocr: 'OCR',
  vision: 'Vision',
  mixed: 'Mixed',
}

const ORIGIN_COLOR: Record<string, string> = {
  text: 'border-bg-hover/60 bg-bg-tertiary/60 text-text-muted',
  ocr: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  vision: 'border-purple-500/40 bg-purple-500/10 text-purple-400',
  mixed: 'border-blue-500/40 bg-blue-500/10 text-blue-400',
}

export default function KbSearchTestPanel() {
  const [q, setQ] = useState('')
  const [k, setK] = useState(4)
  const [hits, setHits] = useState<KBHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latency, setLatency] = useState<number | null>(null)

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    const t0 = performance.now()
    try {
      const res = await api.kbSearch(q.trim(), k, 0)
      setHits(res.hits)
      setLatency(Math.round(performance.now() - t0))
    } catch (err) {
      setError(err instanceof Error ? err.message : '检索失败')
      setHits([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={run} className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入关键词测试 KB 检索…"
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-bg-tertiary/60 border border-bg-hover/40 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-amber-500/60"
        />
        <input
          type="number"
          value={k}
          onChange={(e) => setK(Math.max(1, Math.min(20, Number(e.target.value) || 4)))}
          min={1}
          max={20}
          title="返回 top_k"
          className="w-14 px-2 py-1.5 rounded-lg bg-bg-tertiary/60 border border-bg-hover/40 text-xs text-text-primary text-center focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !q.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
        >
          <Search className="w-3.5 h-3.5" />
          {loading ? '搜索中' : '搜索'}
        </button>
      </form>

      {error && (
        <div className="px-2 py-1.5 rounded-lg border border-accent-red/30 bg-accent-red/10 text-[11px] text-accent-red">
          {error}
        </div>
      )}

      {latency !== null && !error && (
        <div className="text-[10px] text-text-muted">
          {hits.length} 条命中 · 端到端 {latency}ms
        </div>
      )}

      {hits.length === 0 && !loading && !error && latency === null && (
        <div className="text-center py-8 text-text-muted text-xs">输入关键词并点搜索。</div>
      )}

      <ul className="space-y-2">
        {hits.map((h, i) => (
          <li
            key={`${h.path}-${i}`}
            className="px-2.5 py-2 rounded-lg border border-bg-hover/30 bg-bg-tertiary/30"
          >
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[10px] font-mono text-text-muted">[{i + 1}]</span>
              <span className="text-xs text-amber-300 font-medium truncate">
                {h.section_path || '(无小节)'}
              </span>
              <span
                className={`text-[9px] px-1 py-0 rounded border ${
                  ORIGIN_COLOR[h.origin] ?? ORIGIN_COLOR.text
                }`}
              >
                {ORIGIN_LABEL[h.origin] ?? h.origin}
              </span>
              <span className="text-[10px] text-text-muted">score {h.score.toFixed(2)}</span>
            </div>
            <div className="text-[10px] text-text-muted truncate mb-1">
              {h.path}
              {h.page ? ` · 第 ${h.page} 页` : ''}
            </div>
            <div className="text-[11px] text-text-secondary leading-snug whitespace-pre-wrap">
              {h.excerpt}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
