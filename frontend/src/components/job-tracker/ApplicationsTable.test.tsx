import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ApplicationsTable from './ApplicationsTable'
import type { Application } from './types'

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: 1,
    company: 'ByteDance',
    position: 'Frontend Engineer',
    city: 'Shanghai',
    stage: 'interview1',
    applied_at: 1710000000,
    next_followup_at: null,
    interviewer_info: '',
    feedback: '',
    todos: [],
    notes: '',
    created_at: 1710000000,
    updated_at: 1710000000,
    sort_order: 0,
    review_summary: {
      review_count: 0,
      latest_review_id: null,
      latest_avg_score: null,
      latest_review_at: null,
      latest_status: null,
      linked_review_count: 0,
      latest_linked_review_id: null,
      latest_linked_avg_score: null,
      latest_linked_review_at: null,
      latest_linked_status: null,
    },
    ...overrides,
  }
}

describe('ApplicationsTable', () => {
  it('keeps short linked reviews reachable without promoting them to formal summaries', () => {
    const item = app({
      review_summary: {
        review_count: 0,
        latest_review_id: null,
        latest_avg_score: null,
        latest_review_at: null,
        latest_status: null,
        linked_review_count: 1,
        latest_linked_review_id: 42,
        latest_linked_avg_score: null,
        latest_linked_review_at: 1710003600,
        latest_linked_status: 'completed',
      },
    })
    const openReviews = vi.fn()

    render(
      <ApplicationsTable
        applications={[item]}
        offerByAppId={new Map()}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
        onOpenOffer={vi.fn()}
        onOpenReviews={openReviews}
        search=""
        selectedId={1}
        onSelect={vi.fn()}
        compactDetailLayout={false}
      />,
    )

    expect(screen.getAllByText('短样本').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '查看 ByteDance 的 1 场关联复盘' }))

    expect(openReviews).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })
})
