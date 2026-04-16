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

describe('SoundTest', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
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
      ws.emit({ type: 'done', step: 'done', status: 'done', detail: '完成' })
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText('识别匹配')).toBeInTheDocument())
    expect(screen.getAllByText('请介绍一下你最近做过的项目').length).toBeGreaterThan(0)
  })
})
