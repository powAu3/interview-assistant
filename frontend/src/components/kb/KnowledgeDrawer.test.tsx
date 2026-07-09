import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeDrawer from './KnowledgeDrawer'
import { useKbStore } from '@/stores/kbStore'

const apiMock = vi.hoisted(() => ({
  kbStatus: vi.fn(),
  kbDocs: vi.fn(),
  kbHitsRecent: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('./KbStatusHeader', () => ({ default: () => <div>status-header</div> }))
vi.mock('./KbSearchTestPanel', () => ({ default: () => <div>search-panel</div> }))
vi.mock('./KbRecentHitsPanel', () => ({ default: () => <div>recent-panel</div> }))
vi.mock('./KbFilesPanel', () => ({
  default: ({ onChanged }: { onChanged: () => void | Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        void onChanged()
        void onChanged()
      }}
    >
      child refresh
    </button>
  ),
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

const status = {
  enabled: true,
  total_docs: 1,
  total_chunks: 2,
  deadline_ms: 150,
  asr_deadline_ms: 80,
  deps: { docx: true, pdf: true, ocr: false, vision: false },
}

describe('KnowledgeDrawer refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useKbStore.setState({
      drawerOpen: true,
      status: null,
      docs: [],
      recentHits: [],
    })
    apiMock.kbStatus.mockResolvedValue(status)
    apiMock.kbDocs.mockResolvedValue({ items: [] })
    apiMock.kbHitsRecent.mockResolvedValue({ items: [] })
  })

  it('queues child refreshes once while the drawer refresh is already pending', async () => {
    const firstStatus = deferred<typeof status>()
    const firstDocs = deferred<{ items: any[] }>()
    const firstHits = deferred<{ items: any[] }>()
    apiMock.kbStatus
      .mockReturnValueOnce(firstStatus.promise)
      .mockResolvedValue(status)
    apiMock.kbDocs
      .mockReturnValueOnce(firstDocs.promise)
      .mockResolvedValue({ items: [{ id: 'fresh', path: 'fresh.md', chunk_count: 1 }] })
    apiMock.kbHitsRecent
      .mockReturnValueOnce(firstHits.promise)
      .mockResolvedValue({
        items: [{
          ts: 1710000000,
          query: 'fresh query',
          mode: 'manual_text',
          hit_count: 1,
          latency_ms: 12,
          top_section_paths: ['Redis'],
        }],
      })

    render(<KnowledgeDrawer />)

    await waitFor(() => expect(apiMock.kbStatus).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'child refresh' }))

    expect(apiMock.kbStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstStatus.resolve(status)
      firstDocs.resolve({ items: [{ id: 'old', path: 'old.md', chunk_count: 1 }] })
      firstHits.resolve({ items: [] })
      await Promise.all([firstStatus.promise, firstDocs.promise, firstHits.promise])
    })

    await waitFor(() => expect(apiMock.kbStatus).toHaveBeenCalledTimes(2))
    expect(apiMock.kbDocs).toHaveBeenCalledTimes(2)
    expect(apiMock.kbHitsRecent).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(useKbStore.getState().docs[0]?.path).toBe('fresh.md')
      expect(useKbStore.getState().recentHits[0]?.query).toBe('fresh query')
    })
  })
})
