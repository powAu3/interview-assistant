import { describe, expect, it } from 'vitest'

import {
  parseMarkdownFenceLanguage,
  resolvePrismLanguage,
} from './AnswerMarkdownContent'

describe('AnswerMarkdownContent language mapping', () => {
  it('parses fenced language names that include symbols and hyphens', () => {
    expect(parseMarkdownFenceLanguage('language-c++')).toBe('c++')
    expect(parseMarkdownFenceLanguage('language-shell-session')).toBe('shell-session')
    expect(parseMarkdownFenceLanguage('language-c#')).toBe('c#')
  })

  it('keeps common interview/code-review languages syntax-highlighted', () => {
    expect(resolvePrismLanguage('html')).toBe('html')
    expect(resolvePrismLanguage('css')).toBe('css')
    expect(resolvePrismLanguage('docker')).toBe('docker')
    expect(resolvePrismLanguage('diff')).toBe('diff')
    expect(resolvePrismLanguage('php')).toBe('php')
    expect(resolvePrismLanguage('ruby')).toBe('ruby')
    expect(resolvePrismLanguage('swift')).toBe('swift')
    expect(resolvePrismLanguage('kotlin')).toBe('kotlin')
    expect(resolvePrismLanguage('c++')).toBe('c++')
  })

  it('falls back to plain code blocks for unknown fenced languages', () => {
    expect(resolvePrismLanguage('brainfuck')).toBeNull()
  })
})
