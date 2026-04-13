import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useInterviewStore } from '@/stores/configStore'


const apiMock = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getDevices: vi.fn(),
  getOptions: vi.fn(),
  checkModelsHealth: vi.fn(),
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
    apiMock.getConfig.mockRejectedValue(new Error('backend down'))
    apiMock.getDevices.mockResolvedValue({ devices: [], platform: null })
    apiMock.getOptions.mockResolvedValue({ positions: [], languages: [] })
    apiMock.checkModelsHealth.mockResolvedValue(undefined)
  })

  it('renders the init error view when bootstrap fails', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('连接后端失败')).toBeInTheDocument()
    })
    expect(screen.getByText('backend down')).toBeInTheDocument()
  })
})
