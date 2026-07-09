export const DEFAULT_QUICK_PROMPTS = [
  '写代码实现',
  '给SQL',
  '时间复杂度',
  '举个例子',
  '更详细',
  '对比区别',
  '优缺点',
  '应用场景',
  '简短回答',
]

export const STORAGE_KEY = 'quick_prompts'
export const RECENT_KEY = 'quick_prompts_recent_v1'

const RECENT_MAX = 16

function normalizePrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const prompt = value.trim()
  return prompt ? prompt : null
}

export function sanitizeQuickPrompts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const prompts: string[] = []
  for (const item of value) {
    const prompt = normalizePrompt(item)
    if (!prompt || seen.has(prompt)) continue
    seen.add(prompt)
    prompts.push(prompt)
  }
  return prompts
}

export function getQuickPrompts(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      const sanitized = sanitizeQuickPrompts(parsed)
      if (sanitized.length > 0) return sanitized
    }
  } catch {}
  return DEFAULT_QUICK_PROMPTS
}

export function saveQuickPrompts(prompts: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeQuickPrompts(prompts)))
}

export function readQuickPromptRecent(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const sanitized: Record<string, number> = {}
      for (const [rawPrompt, timestamp] of Object.entries(parsed)) {
        const prompt = normalizePrompt(rawPrompt)
        if (!prompt || !Number.isFinite(timestamp)) continue
        sanitized[prompt] = Math.max(sanitized[prompt] ?? 0, timestamp)
      }
      return Object.fromEntries(
        Object.entries(sanitized)
          .sort((a, b) => b[1] - a[1])
          .slice(0, RECENT_MAX),
      )
    }
  } catch {}
  return {}
}

export function bumpQuickPromptRecent(prompt: string): Record<string, number> {
  const normalized = normalizePrompt(prompt)
  if (!normalized) return readQuickPromptRecent()
  const now = Date.now()
  const current = readQuickPromptRecent()
  current[normalized] = now
  const entries = Object.entries(current)
  if (entries.length > RECENT_MAX) {
    entries.sort((a, b) => b[1] - a[1])
    const kept = Object.fromEntries(entries.slice(0, RECENT_MAX))
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(kept))
    } catch {}
    return kept
  }
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(current))
  } catch {}
  return current
}

export function orderByRecent(
  prompts: string[],
  recent: Record<string, number>,
): string[] {
  const cleanPrompts = sanitizeQuickPrompts(prompts)
  const seen = new Set<string>()
  const withTs = cleanPrompts
    .filter((p) => recent[p] != null)
    .sort((a, b) => (recent[b] ?? 0) - (recent[a] ?? 0))
  const result: string[] = []
  for (const p of withTs) {
    if (seen.has(p)) continue
    seen.add(p)
    result.push(p)
  }
  for (const p of cleanPrompts) {
    if (seen.has(p)) continue
    seen.add(p)
    result.push(p)
  }
  return result
}
