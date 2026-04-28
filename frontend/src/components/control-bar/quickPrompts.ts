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

export function getQuickPrompts(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  return DEFAULT_QUICK_PROMPTS
}

export function saveQuickPrompts(prompts: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts))
}

export function readQuickPromptRecent(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    if (parsed && typeof parsed === 'object') return parsed
  } catch {}
  return {}
}

export function bumpQuickPromptRecent(prompt: string): Record<string, number> {
  const now = Date.now()
  const current = readQuickPromptRecent()
  current[prompt] = now
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
  const seen = new Set<string>()
  const withTs = prompts
    .filter((p) => recent[p] != null)
    .sort((a, b) => (recent[b] ?? 0) - (recent[a] ?? 0))
  const result: string[] = []
  for (const p of withTs) {
    if (seen.has(p)) continue
    seen.add(p)
    result.push(p)
  }
  for (const p of prompts) {
    if (seen.has(p)) continue
    seen.add(p)
    result.push(p)
  }
  return result
}
