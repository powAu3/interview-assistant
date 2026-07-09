import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AnswerMarkdownContent from './AnswerMarkdownContent'

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

describe('AnswerMarkdownContent copy button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClipboard(vi.fn().mockResolvedValue(undefined))
  })

  it('waits for clipboard success before showing the copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    mockClipboard(writeText)

    render(
      <AnswerMarkdownContent
        answer={'```python\nprint("ok")\n```'}
        colorScheme="vscode-dark-plus"
        stream={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    expect(screen.getByRole('button', { name: '复制中…' })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith('print("ok")')
  })

  it('surfaces clipboard failures instead of reporting a false success', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'))
    mockClipboard(writeText)

    render(
      <AnswerMarkdownContent
        answer={'```ts\nconst ok = true\n```'}
        colorScheme="vscode-dark-plus"
        stream={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '复制失败' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '复制失败' })).toHaveAttribute('title', '复制失败，请检查浏览器权限')
  })
})
