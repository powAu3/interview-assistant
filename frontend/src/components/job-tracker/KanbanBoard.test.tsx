import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import KanbanBoard from './KanbanBoard'
import type { Application } from './types'

function app(id: number, stage: string): Application {
  return {
    id,
    company: `Company ${id}`,
    position: 'Frontend',
    city: 'Shanghai',
    notes: '',
    stage,
    updated_at: 1710000000 + id,
    created_at: 1710000000 + id,
    applied_at: null,
    next_followup_at: null,
    interviewer_info: '',
    feedback: '',
    todos: [],
    sort_order: id,
    review_summary: {
      review_count: 0,
      latest_review_id: null,
      latest_avg_score: null,
      latest_review_at: null,
      latest_status: null,
    },
  }
}

describe('KanbanBoard', () => {
  it('maps vertical wheel movement to horizontal board scrolling', () => {
    const { container } = render(
      <KanbanBoard
        applications={[
          app(1, 'applied'),
          app(2, 'written'),
          app(3, 'interview1'),
          app(4, 'interview2'),
        ]}
        onStageChange={vi.fn()}
        onReorderInStage={vi.fn()}
        search=""
        showTerminalStages={false}
        onShowTerminalStagesChange={vi.fn()}
        terminalApplicationsCount={0}
      />,
    )

    const board = container.querySelector('[data-kanban-board-scroll]') as HTMLDivElement
    expect(board).not.toBeNull()

    Object.defineProperty(board, 'clientWidth', { configurable: true, value: 320 })
    Object.defineProperty(board, 'scrollWidth', { configurable: true, value: 960 })
    board.scrollLeft = 0

    fireEvent.wheel(board, { deltaY: 180, deltaX: 0 })

    expect(board.scrollLeft).toBe(180)
  })

  it('shows short linked reviews on cards without a formal review count', () => {
    render(
      <KanbanBoard
        applications={[
          {
            ...app(1, 'interview1'),
            review_summary: {
              review_count: 0,
              latest_review_id: null,
              latest_avg_score: null,
              latest_review_at: null,
              latest_status: null,
              linked_review_count: 1,
              latest_linked_review_id: 12,
              latest_linked_avg_score: null,
              latest_linked_review_at: 1710003600,
              latest_linked_status: 'completed',
            },
          },
        ]}
        onStageChange={vi.fn()}
        onReorderInStage={vi.fn()}
        search=""
        showTerminalStages={false}
        onShowTerminalStagesChange={vi.fn()}
        terminalApplicationsCount={0}
      />,
    )

    expect(screen.getByText('复盘 短样本')).toBeInTheDocument()
  })
})
