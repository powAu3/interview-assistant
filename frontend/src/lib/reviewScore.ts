export function parseReviewScore(value: unknown): number | null {
  if (value == null) return null
  let score: number | null = null
  if (typeof value === 'number' && Number.isFinite(value)) {
    score = value
  } else if (typeof value === 'string') {
    const match = value.trim().match(/-?\d+(?:\.\d+)?/)
    if (match) {
      const parsed = Number(match[0])
      if (Number.isFinite(parsed)) score = parsed
    }
  }
  if (score === null || score < 0 || score > 10) return null
  return score
}
