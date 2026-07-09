import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SoundTest from './SoundTest'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  preflightScenarios: vi.fn(),
  preflightRun: vi.fn(),
  preflightStatus: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/lib/backendUrl', () => ({ buildWsUrl: () => 'ws://example.test/ws' }))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
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

describe('SoundTest', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.clearAllMocks()
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    useInterviewStore.setState({
      devices: [{ id: 1, name: 'Loopback', is_loopback: true }],
      config: { stt_provider: 'whisper', models: [{ name: 'demo' }], active_model: 0 },
    } as any)
    apiMock.preflightScenarios.mockResolvedValue({
      scenarios: [{ id: 'self_intro', label: '自我介绍', question: 'Q', recommended: true }],
    })
    apiMock.preflightRun.mockResolvedValue({ ok: true })
    apiMock.preflightStatus.mockResolvedValue({
      expected_phrase: '请介绍一下你最近做过的项目',
      captured_transcript: '请介绍一下你最近做过的项目',
      match_ok: true,
    })
  })

  it('starts real preflight and renders transcript result', async () => {
    render(<SoundTest />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '开始检测' }))
    expect(apiMock.preflightRun).toHaveBeenCalledWith('self_intro', 1)

    const ws = FakeWebSocket.instances[0]
    await act(async () => {
      ws.emit({ type: 'preflight_step', step: 'playback', status: 'pass', detail: '已播放测试音频' })
      ws.emit({ type: 'preflight_step', step: 'match', status: 'pass', detail: '识别匹配', transcript: '请介绍一下你最近做过的项目', expected_phrase: '请介绍一下你最近做过的项目' })
      ws.emit({ type: 'preflight_step', step: 'done', status: 'done', detail: '完成' })
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText('识别匹配')).toBeInTheDocument())
    expect(screen.getAllByText('请介绍一下你最近做过的项目').length).toBeGreaterThan(0)
  })

  it('starts another preflight when clicking retry after completion', async () => {
    render(<SoundTest />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '开始检测' }))

    const ws = FakeWebSocket.instances[0]
    await act(async () => {
      ws.emit({ type: 'preflight_step', step: 'playback', status: 'pass', detail: '已播放测试音频' })
      ws.emit({ type: 'preflight_step', step: 'done', status: 'done', detail: '完成' })
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByRole('button', { name: '重新' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '重新' }))

    expect(apiMock.preflightRun).toHaveBeenCalledTimes(2)
    expect(apiMock.preflightRun).toHaveBeenLastCalledWith('self_intro', 1)
  })

  it('ignores rapid duplicate preflight starts while the run request is pending', async () => {
    const pendingRun = deferred<{ ok: boolean }>()
    apiMock.preflightRun.mockReturnValueOnce(pendingRun.promise)

    render(<SoundTest />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument())

    const startButton = screen.getByRole('button', { name: '开始检测' })
    act(() => {
      startButton.click()
      startButton.click()
    })

    expect(apiMock.preflightRun).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '开始检测' })).toBeDisabled()

    await act(async () => {
      pendingRun.resolve({ ok: true })
      await pendingRun.promise
    })
    await act(async () => {
      FakeWebSocket.instances[0].emit({ type: 'preflight_step', step: 'done', status: 'done', detail: '完成' })
      await Promise.resolve()
    })

    const retryButton = await screen.findByRole('button', { name: '重新' })
    expect(retryButton).toBeEnabled()
    fireEvent.click(retryButton)
    expect(apiMock.preflightRun).toHaveBeenCalledTimes(2)
  })

  it('hydrates the generated llm answer from status after completion', async () => {
    apiMock.preflightStatus.mockResolvedValueOnce({
      expected_phrase: '请介绍一下你最近做过的项目',
      captured_transcript: '请介绍一下你最近做过的项目',
      match_ok: true,
      steps: {
        llm: {
          status: 'pass',
          detail: '首 token 420ms · 完整 1800ms',
          question: '请介绍一下你最近做过的项目',
          answer: '这是模型实时生成的自测回答，不是预设文案。',
          first_token_ms: 420,
          total_ms: 1800,
          model_name: 'demo-model',
        },
      },
    })

    render(<SoundTest />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '开始检测' }))

    const ws = FakeWebSocket.instances[0]
    await act(async () => {
      ws.emit({ type: 'preflight_step', step: 'done', status: 'done', detail: '完成' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('这是模型实时生成的自测回答，不是预设文案。')).toBeInTheDocument()
    })
    expect(screen.getAllByText(/首 token 420ms/).length).toBeGreaterThan(0)
    expect(screen.getByText(/完整 1.8s/)).toBeInTheDocument()
    expect(screen.getByText('模型：demo-model')).toBeInTheDocument()
  })

  it('ignores malformed status step payloads when hydrating after completion', async () => {
    apiMock.preflightStatus.mockResolvedValueOnce({
      expected_phrase: '请介绍一下你最近做过的项目',
      captured_transcript: '请介绍一下你最近做过的项目',
      match_ok: true,
      steps: {
        llm: 'bad-payload',
        ws: null,
      },
    })

    render(<SoundTest />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '开始检测' }))

    const ws = FakeWebSocket.instances[0]
    await act(async () => {
      ws.emit({ type: 'preflight_step', step: 'done', status: 'done', detail: '完成' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getAllByText('请介绍一下你最近做过的项目').length).toBeGreaterThan(0)
    })
  })
})
