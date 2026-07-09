import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import KbReferenceBanner from './KbReferenceBanner'
import { useKbStore } from '@/stores/kbStore'

describe('KbReferenceBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    useKbStore.setState({
      hitsByQaId: {},
      drawerOpen: false,
      status: null,
      docs: [],
      recentHits: [],
    })
  })

  it('renders KB hits expanded by default and lets the user collapse them', () => {
    useKbStore.getState().appendHits({
      qa_id: 'qa-1',
      latency_ms: 18,
      degraded: false,
      hit_count: 1,
      hits: [
        {
          path: 'notes/redis.md',
          section_path: 'Redis 持久化',
          origin: 'text',
          score: 0.9,
          excerpt: 'AOF 和 RDB 可以组合使用。',
        },
      ],
    })

    render(<KbReferenceBanner qaId="qa-1" />)

    expect(screen.getByText('引用 1 条本地笔记')).toBeInTheDocument()
    expect(screen.queryByText(/BETA/i)).not.toBeInTheDocument()
    expect(screen.getByText('Redis 持久化')).toBeInTheDocument()
    expect(screen.getByText('AOF 和 RDB 可以组合使用。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /引用 1 条本地笔记/ }))

    expect(screen.queryByText('AOF 和 RDB 可以组合使用。')).not.toBeInTheDocument()
  })
})
