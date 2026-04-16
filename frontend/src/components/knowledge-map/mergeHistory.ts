export const ASSIST_MERGE_GAP_SEC = 100

export interface HistoryRecord {
  id: number
  session_type: string
  question: string
  answer: string
  score: number | null
  tags: string[]
  created_at: number
}

export interface DisplayHistoryRecord extends HistoryRecord {
  mergedCount?: number
}

export function mergeHistoryByTimeGap(records: HistoryRecord[]): DisplayHistoryRecord[] {
  if (records.length === 0) return []
  const chronological = [...records].sort((a, b) => a.created_at - b.created_at)
  const groups: HistoryRecord[][] = []
  let buf: HistoryRecord[] = []

  const flush = () => {
    if (buf.length === 0) return
    groups.push(buf)
    buf = []
  }

  for (const rec of chronological) {
    if (buf.length === 0) {
      buf.push(rec)
      continue
    }
    const last = buf[buf.length - 1]
    const sameSession = rec.session_type === last.session_type
    const gapOk = rec.created_at - last.created_at <= ASSIST_MERGE_GAP_SEC
    if (sameSession && gapOk) {
      buf.push(rec)
    } else {
      flush()
      buf.push(rec)
    }
  }
  flush()

  const merged: DisplayHistoryRecord[] = groups.map((g) => {
    if (g.length === 1) {
      return { ...g[0] }
    }
    const questions = g.map((r) => r.question.trim()).filter(Boolean)
    const qJoined =
      questions.reduce((acc, q) => {
        if (!acc) return q
        const needSpace = /[a-zA-Z0-9]$/.test(acc) && /^[a-zA-Z0-9]/.test(q)
        return needSpace ? `${acc} ${q}` : `${acc}${q}`
      }, '') || g[g.length - 1].question
    const answers = g.map((r) => (r.answer || '').trim()).filter(Boolean)
    const tagSet = new Set<string>()
    g.forEach((r) => r.tags?.forEach((t) => tagSet.add(t)))
    const scores = g.map((r) => r.score).filter((s): s is number => s != null && !Number.isNaN(s))
    const avgScore =
      scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null
    return {
      id: g[0].id,
      session_type: g[0].session_type,
      question: qJoined,
      answer: answers.join('\n\n———\n\n'),
      score: avgScore,
      tags: [...tagSet],
      created_at: g[g.length - 1].created_at,
      mergedCount: g.length,
    }
  })
  merged.sort((a, b) => b.created_at - a.created_at)
  return merged
}
