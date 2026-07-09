import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KbFilesPanel from './KbFilesPanel'
import { useKbStore } from '@/stores/kbStore'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  kbUpload: vi.fn(),
  kbDelete: vi.fn(),
  kbReindex: vi.fn(),
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

function renderPanel(onChanged = vi.fn().mockResolvedValue(undefined)) {
  render(<KbFilesPanel onChanged={onChanged} />)
  return { onChanged }
}

describe('KbFilesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.kbUpload.mockResolvedValue({ path: 'notes.md', size: 12 })
    apiMock.kbDelete.mockResolvedValue({ ok: true })
    apiMock.kbReindex.mockResolvedValue({ docs_indexed: 1, docs_deleted: 0 })
    useKbStore.setState({
      docs: [
        {
          id: 'notes.md',
          path: 'notes.md',
          size: 12,
          mtime: 1710000000,
          loader: 'text',
          chunk_count: 2,
          status: 'ok',
        },
      ],
    } as any)
    useInterviewStore.setState({
      toastMessage: null,
      toasts: [],
    } as any)
    window.confirm = vi.fn(() => true)
  })

  it('ignores duplicate file selections while an upload is pending', async () => {
    const upload = deferred<{ path: string; size: number }>()
    apiMock.kbUpload.mockReturnValueOnce(upload.promise)
    const { onChanged } = renderPanel()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' })

    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(input, { target: { files: [file] } })

    expect(apiMock.kbUpload).toHaveBeenCalledTimes(1)

    await act(async () => {
      upload.resolve({ path: 'notes.md', size: 12 })
      await upload.promise
    })

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })

  it('ignores duplicate reindex requests while the first one is pending', async () => {
    const reindex = deferred<Record<string, unknown>>()
    apiMock.kbReindex.mockReturnValueOnce(reindex.promise)
    renderPanel()

    const button = screen.getByRole('button', { name: /重建索引/ })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(apiMock.kbReindex).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()

    await act(async () => {
      reindex.resolve({ docs_indexed: 1, docs_deleted: 0 })
      await reindex.promise
    })

    await waitFor(() => expect(button).toBeEnabled())
  })

  it('ignores duplicate delete requests while the first one is pending', async () => {
    const deleteCall = deferred<{ ok: boolean }>()
    apiMock.kbDelete.mockReturnValueOnce(deleteCall.promise)
    renderPanel()

    const button = screen.getByRole('button', { name: '删除 notes.md' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(apiMock.kbDelete).toHaveBeenCalledTimes(1)

    await act(async () => {
      deleteCall.resolve({ ok: true })
      await deleteCall.promise
    })

    await waitFor(() => expect(button).toBeEnabled())
  })
})
