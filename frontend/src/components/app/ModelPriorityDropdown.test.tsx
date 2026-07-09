import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelPriorityDropdown } from './ModelPriorityDropdown'
import { useInterviewStore, type AppConfig } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  checkModelsHealth: vi.fn(),
  getModelsHealth: vi.fn(),
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

function renderDropdown() {
  const config = {
    models: [
      { name: 'Primary Model', supports_think: true, supports_vision: false, enabled: true },
      { name: 'Disabled Model', supports_think: false, supports_vision: true, enabled: false },
    ],
    active_model: 0,
  } as AppConfig

  return render(
    <ModelPriorityDropdown
      config={config}
      modelHealth={useInterviewStore.getState().modelHealth}
      modelHealthDetail={useInterviewStore.getState().modelHealthDetail}
      modelHealthLatency={useInterviewStore.getState().modelHealthLatency}
      onModelChange={vi.fn()}
    />,
  )
}

describe('ModelPriorityDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.checkModelsHealth.mockResolvedValue({ ok: true })
    apiMock.getModelsHealth.mockResolvedValue({ health: {}, detail: {}, latency: {} })
    useInterviewStore.setState({
      modelHealth: {},
      modelHealthDetail: {},
      modelHealthLatency: {},
      toastMessage: null,
      toasts: [],
    } as any)
  })

  it('marks enabled models checking, ignores duplicate health checks, and applies the snapshot', async () => {
    const healthCheck = deferred<{ ok: boolean }>()
    apiMock.checkModelsHealth.mockReturnValueOnce(healthCheck.promise)
    apiMock.getModelsHealth.mockResolvedValueOnce({
      health: { 0: 'ok' },
      detail: { 0: '' },
      latency: { 0: 87 },
    })

    renderDropdown()

    fireEvent.click(screen.getByRole('button', { name: /优先答题模型 Primary Model/ }))
    const recheck = screen.getByRole('button', { name: '重新检查连接' })
    fireEvent.click(recheck)
    fireEvent.click(recheck)

    expect(apiMock.checkModelsHealth).toHaveBeenCalledTimes(1)
    expect(useInterviewStore.getState().modelHealth[0]).toBe('checking')
    expect(useInterviewStore.getState().modelHealth[1]).toBeUndefined()
    expect(screen.getByRole('button', { name: '检测中…' })).toBeDisabled()

    await act(async () => {
      healthCheck.resolve({ ok: true })
      await healthCheck.promise
    })

    await waitFor(() => expect(apiMock.getModelsHealth).toHaveBeenCalledTimes(1))
    expect(useInterviewStore.getState().modelHealth[0]).toBe('ok')
    expect(useInterviewStore.getState().modelHealthLatency[0]).toBe(87)
  })

  it('surfaces health check request failures instead of leaving the selector silent', async () => {
    apiMock.checkModelsHealth.mockRejectedValueOnce(new Error('queue busy'))

    renderDropdown()

    fireEvent.click(screen.getByRole('button', { name: /优先答题模型 Primary Model/ }))
    fireEvent.click(screen.getByRole('button', { name: '重新检查连接' }))

    await waitFor(() => {
      expect(useInterviewStore.getState().modelHealth[0]).toBe('error')
    })
    expect(useInterviewStore.getState().modelHealthDetail[0]).toBe('queue busy')
    expect(useInterviewStore.getState().toastMessage).toContain('queue busy')
    expect(apiMock.getModelsHealth).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '重新检查连接' })).toBeEnabled()
  })
})
