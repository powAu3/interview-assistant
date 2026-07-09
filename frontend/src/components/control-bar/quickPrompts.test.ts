import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_QUICK_PROMPTS,
  RECENT_KEY,
  STORAGE_KEY,
  bumpQuickPromptRecent,
  getQuickPrompts,
  orderByRecent,
  readQuickPromptRecent,
  sanitizeQuickPrompts,
  saveQuickPrompts,
} from './quickPrompts'

describe('quickPrompts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('sanitizes stored prompt lists before they reach the main control bar', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([' 写代码实现 ', '', '写代码实现', { label: 'bad' }, 42, '给SQL']),
    )

    expect(getQuickPrompts()).toEqual(['写代码实现', '给SQL'])
  })

  it('falls back to defaults when stored prompts are invalid or empty after cleanup', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([' ', null, { label: 'bad' }]))

    expect(getQuickPrompts()).toEqual(DEFAULT_QUICK_PROMPTS)
  })

  it('saves a normalized unique prompt list', () => {
    saveQuickPrompts(['  举个例子  ', '举个例子', '', '更详细'])

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual(['举个例子', '更详细'])
  })

  it('keeps recent prompt data bounded and ignores invalid timestamps', () => {
    vi.setSystemTime(new Date('2026-07-09T01:00:00Z'))
    const recent: Record<string, unknown> = {
      写代码实现: 100,
      bad: 'later',
      空值: null,
      ' prompt-17 ': 90,
    }
    for (let i = 0; i < 18; i += 1) {
      recent[`prompt-${i}`] = i + 1
    }
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))

    const updated = bumpQuickPromptRecent('  新提示  ')

    expect(updated['新提示']).toBe(Date.now())
    expect(Object.keys(updated)).toHaveLength(16)
    expect(updated.bad).toBeUndefined()
    expect(updated[' prompt-17 ']).toBeUndefined()
    expect(updated['prompt-17']).toBe(90)
    expect(readQuickPromptRecent().bad).toBeUndefined()
  })

  it('orders sanitized prompts by recent usage without returning duplicates', () => {
    expect(
      orderByRecent([' A ', 'B', 'A', '', 'C'], {
        C: 3,
        A: 2,
      }),
    ).toEqual(['C', 'A', 'B'])
  })

  it('exposes the sanitizer for editor-side checks', () => {
    expect(sanitizeQuickPrompts(['x', ' x ', 'y', undefined])).toEqual(['x', 'y'])
  })
})
