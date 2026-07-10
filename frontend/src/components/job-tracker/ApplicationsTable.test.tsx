import { act, fireEvent, render, screen } from '@testing-library/react'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ApplicationsTable', () => {
  it('ignores rapid duplicate progress saves while a patch is pending', async () => {
    const patch = deferred<boolean>()
    const onPatch = vi.fn(() => patch.promise)

    render(
      <ApplicationsTable
        applications={[app()]}
        offerByAppId={new Map()}
        onPatch={onPatch}
        onDelete={vi.fn()}
        onOpenOffer={vi.fn()}
        onOpenReviews={vi.fn()}
        search=""
        selectedId={1}
        onSelect={vi.fn()}
        compactDetailLayout={false}
      />,
    )

    fireEvent.change(screen.getByLabelText('当前阶段'), { target: { value: 'interview2' } })

    const saveButton = screen.getByRole('button', { name: '保存进度' })
    act(() => {
      saveButton.click()
      saveButton.click()
    })

    expect(onPatch).toHaveBeenCalledTimes(1)
    expect(onPatch).toHaveBeenCalledWith(1, expect.objectContaining({ stage: 'interview2' }))
    for (const button of screen.getAllByRole('button', { name: '保存中...' })) {
      expect(button).toBeDisabled()
    }

    await act(async () => {
      patch.resolve(true)
      await patch.promise
    })

    expect(screen.getByText('已保存核心信息')).toBeInTheDocument()
  })

  it('shows an inline failure notice when a progress save is rejected by the parent', async () => {
    const onPatch = vi.fn().mockResolvedValue(false)

    render(
      <ApplicationsTable
        applications={[app()]}
        offerByAppId={new Map()}
        onPatch={onPatch}
        onDelete={vi.fn()}
        onOpenOffer={vi.fn()}
        onOpenReviews={vi.fn()}
        search=""
        selectedId={1}
        onSelect={vi.fn()}
        compactDetailLayout={false}
      />,
    )

    fireEvent.change(screen.getByLabelText('当前阶段'), { target: { value: 'interview2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存进度' }))

    expect(onPatch).toHaveBeenCalledWith(1, expect.objectContaining({ stage: 'interview2' }))
    expect(await screen.findByText('保存失败，请重试')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存进度' })).toBeEnabled()
  })

  it('shows thrown save errors inline near the active application', async () => {
    const onPatch = vi.fn().mockRejectedValue(new Error('后端保存失败'))

    render(
      <ApplicationsTable
        applications={[app()]}
        offerByAppId={new Map()}
        onPatch={onPatch}
        onDelete={vi.fn()}
        onOpenOffer={vi.fn()}
        onOpenReviews={vi.fn()}
        search=""
        selectedId={1}
        onSelect={vi.fn()}
        compactDetailLayout={false}
      />,
    )

    fireEvent.change(screen.getByLabelText('当前阶段'), { target: { value: 'interview2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存进度' }))

    expect(await screen.findByText('后端保存失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存进度' })).toBeEnabled()
  })

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
