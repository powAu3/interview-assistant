import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useInterviewStore } from '@/stores/configStore'


const apiMock = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getDevices: vi.fn(),
  getOptions: vi.fn(),
  checkModelsHealth: vi.fn(),
  kbStatus: vi.fn(),
  updateConfig: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('@/hooks/useInterviewWS', () => ({
  useInterviewWS: () => undefined,
}))

vi.mock('@/components/TranscriptionPanel', () => ({ default: () => <div>transcript</div> }))
vi.mock('@/components/AnswerPanel', () => ({ default: () => <div>answer</div> }))
vi.mock('@/components/ControlBar', () => ({ default: () => <div>controls</div> }))
vi.mock('@/components/SettingsDrawer', () => ({ default: () => null }))
vi.mock('@/components/PracticeMode', () => ({ default: () => <div>practice</div> }))
vi.mock('@/components/KnowledgeMap', () => ({ default: () => <div>knowledge</div> }))
vi.mock('@/components/ResumeOptimizer', () => ({ default: () => <div>resume</div> }))
vi.mock('@/components/JobTracker', () => ({ default: () => <div>jobs</div> }))


describe('App bootstrap', () => {
  beforeEach(() => {
    useInterviewStore.setState({
      config: null,
      devices: [],
      options: null,
      sttLoaded: false,
      sttLoading: true,
      modelHealth: {},
      tokenUsage: { prompt: 0, completion: 0, total: 0, byModel: {} },
      fallbackToast: null,
      toastMessage: null,
      settingsOpen: false,
      qaPairs: [],
      streamingIds: [],
      currentStreamingId: null,
      transcriptions: [],
      isPaused: false,
      wsConnected: true,
    } as any)
    apiMock.getConfig.mockResolvedValue({
      models: [{ name: 'demo', supports_vision: false }],
      active_model: 0,
      api_key_set: true,
      think_mode: false,
      think_effort: 'off',
      stt_provider: 'whisper',
    })
    apiMock.getDevices.mockResolvedValue({ devices: [], platform: null })
    apiMock.getOptions.mockResolvedValue({ positions: [], languages: [] })
    apiMock.checkModelsHealth.mockResolvedValue(undefined)
    apiMock.updateConfig.mockResolvedValue({ ok: true })
    apiMock.kbStatus.mockResolvedValue({
      enabled: false,
      total_docs: 0,
      total_chunks: 0,
      deadline_ms: 150,
      asr_deadline_ms: 80,
      deps: { docx: false, pdf: false, ocr: false, vision: false },
    })
  })

  it('renders the init error view when config bootstrap fails', async () => {
    apiMock.getConfig.mockRejectedValue(new Error('backend down'))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('连接后端失败')).toBeInTheDocument()
    })
    expect(screen.getByText('backend down')).toBeInTheDocument()
    expect(screen.getByText(/正在请求 \/api\/config/)).toBeInTheDocument()
    expect(screen.getByText(/确认后端服务已启动/)).toBeInTheDocument()
  })

  it('keeps rendering the app when non-critical bootstrap requests fail', async () => {
    apiMock.getDevices.mockRejectedValue(new Error('devices down'))
    apiMock.getOptions.mockRejectedValue(new Error('options down'))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '实时辅助' })).toBeInTheDocument()
    })

    expect(screen.queryByText('连接后端失败')).not.toBeInTheDocument()
  })

  it('does not allow disabled models to be picked as the priority answer model', async () => {
    apiMock.getConfig.mockResolvedValue({
      models: [
        { name: 'Enabled Model', supports_vision: false, enabled: true },
        { name: 'Disabled Model', supports_vision: true, enabled: false },
      ],
      active_model: 0,
      api_key_set: true,
      think_mode: false,
      think_effort: 'off',
      stt_provider: 'whisper',
    })

    render(<App />)

    const trigger = await screen.findByRole('button', { name: /优先答题模型 Enabled Model/ })
    fireEvent.click(trigger)

    const disabledOption = screen.getByRole('button', { name: /Disabled Model/ })
    expect(disabledOption).toBeDisabled()
    fireEvent.click(disabledOption)

    expect(apiMock.updateConfig).not.toHaveBeenCalled()
  })
})
