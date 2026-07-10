import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OfferEditModal from './OfferEditModal'
import type { Application } from './types'

function application(): Application {
  return {
    id: 1,
    company: 'ByteDance',
    position: 'Frontend Engineer',
    city: 'Shanghai',
    stage: 'offer',
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
    },
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

describe('OfferEditModal', () => {
  it('ignores rapid duplicate saves while the offer request is pending', async () => {
    const save = deferred<void>()
    const onSave = vi.fn(() => save.promise)
    const onClose = vi.fn()

    render(
      <OfferEditModal
        open
        application={application()}
        offer={null}
        onSave={onSave}
        onClose={onClose}
      />,
    )

    const saveButton = screen.getByRole('button', { name: '保存' })
    act(() => {
      saveButton.click()
      saveButton.click()
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()

    await act(async () => {
      save.resolve()
      await save.promise
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows offer save errors instead of closing the modal', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new Error('offer save down'))

    render(
      <OfferEditModal
        open
        application={application()}
        offer={null}
        onSave={onSave}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('offer save down')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })
})
