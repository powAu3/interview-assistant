import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KbSearchTestPanel from './KbSearchTestPanel'

const apiMock = vi.hoisted(() => ({
  kbSearch: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function hit(path: string, excerpt: string) {
  return {
    path,
    section_path: 'Redis',
    origin: 'text',
    score: 0.82,
    excerpt,
  }
}

describe('KbSearchTestPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.kbSearch.mockResolvedValue({ hits: [] })
  })

  it('ignores duplicate submits while a search is pending', async () => {
    const search = deferred<{ hits: ReturnType<typeof hit>[] }>()
    apiMock.kbSearch.mockReturnValueOnce(search.promise)

    const { container } = render(<KbSearchTestPanel />)
    fireEvent.change(screen.getByPlaceholderText('输入关键词测试 KB 检索…'), { target: { value: 'redis' } })

    const form = container.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(apiMock.kbSearch).toHaveBeenCalledTimes(1)
    expect(apiMock.kbSearch).toHaveBeenCalledWith('redis', 4, 0)
    expect(screen.getByRole('button', { name: /搜索中/ })).toBeDisabled()

    await act(async () => {
      search.resolve({ hits: [hit('redis.md', 'AOF 和 RDB')] })
      await search.promise
    })

    await waitFor(() => expect(screen.getByText('AOF 和 RDB')).toBeInTheDocument())
  })

  it('ignores stale search responses after the query changes', async () => {
    const search = deferred<{ hits: ReturnType<typeof hit>[] }>()
    apiMock.kbSearch.mockReturnValueOnce(search.promise)

    const { container } = render(<KbSearchTestPanel />)
    const input = screen.getByPlaceholderText('输入关键词测试 KB 检索…')
    fireEvent.change(input, { target: { value: 'redis' } })
    fireEvent.submit(container.querySelector('form')!)
    fireEvent.change(input, { target: { value: 'mysql' } })

    await act(async () => {
      search.resolve({ hits: [hit('redis.md', '旧 Redis 命中不该出现')] })
      await search.promise
    })

    await waitFor(() => expect(screen.getByRole('button', { name: '搜索' })).toBeEnabled())
    expect(screen.queryByText('旧 Redis 命中不该出现')).not.toBeInTheDocument()
    expect(screen.queryByText(/条命中/)).not.toBeInTheDocument()
  })
})
