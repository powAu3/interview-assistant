import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ControlBar from './ControlBar'
import { useInterviewStore } from '@/stores/configStore'


const apiMock = vi.hoisted(() => ({
  ask: vi.fn(),
  getDevices: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  clear: vi.fn(),
  cancelAsk: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    ...apiMock,
  },
  getErrorMessage: (error: unknown, fallback = '操作失败') =>
    error instanceof Error ? error.message : fallback,
}))

vi.mock('@/components/ResumeHistory', () => ({
  ResumeHistoryPopover: () => <div>resume-history</div>,
}))

class MockFileReader {
  result: string | null = 'data:image/png;base64,xxx'
  onload: ((event: { target: { result: string } }) => void) | null = null

  readAsDataURL() {
    this.onload?.({ target: { result: this.result! } })
  }
}

describe('ControlBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('FileReader', MockFileReader as any)
    apiMock.ask.mockResolvedValue({ ok: true })
    apiMock.getDevices.mockResolvedValue({ devices: [], platform: null })
    apiMock.start.mockResolvedValue({ ok: true })
    apiMock.stop.mockResolvedValue({ ok: true })
    apiMock.pause.mockResolvedValue({ ok: true })
    apiMock.resume.mockResolvedValue({ ok: true })
    apiMock.clear.mockResolvedValue({ ok: true })
    apiMock.cancelAsk.mockResolvedValue({ ok: true })
    useInterviewStore.setState({
      config: {
        models: [{ name: 'TextOnly', supports_think: false, supports_vision: false, enabled: true }],
        active_model: 0,
        model_name: 'TextOnly',
        temperature: 0.5,
        max_tokens: 4096,
        think_mode: false,
        stt_provider: 'whisper',
        whisper_model: 'base',
        whisper_language: 'auto',
        doubao_stt_app_id: '',
        doubao_stt_access_token: '',
        doubao_stt_resource_id: '',
        doubao_stt_boosting_table_id: '',
        generic_stt_api_base_url: '',
        generic_stt_api_key: '',
        generic_stt_model: '',
        position: '后端开发',
        language: 'Python',
        auto_detect: true,
        silence_threshold: 0.01,
        silence_duration: 1.2,
        api_key_set: true,
        has_resume: false,
      },
      devices: [{ id: 1, name: 'loopback', channels: 2, is_loopback: true, host_api: 'Core Audio' }],
      platformInfo: null,
      streamingIds: [],
      qaPairs: [],
      transcriptions: [],
      wsConnected: true,
      modelHealth: { 0: 'ok' },
      isRecording: false,
      isPaused: false,
      lastWSError: null,
      toastMessage: null,
    } as any)
  })

  it('blocks sending a pasted screenshot when the active model has no vision support', async () => {
    render(<ControlBar />)

    const input = screen.getByPlaceholderText('输入问题，Enter 发送…')
    const file = new File(['fake'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(input, {
      clipboardData: {
        items: [
          {
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '发送问题' }))

    expect(apiMock.ask).not.toHaveBeenCalled()
    expect(screen.getByText(/当前模型「TextOnly」不支持图片识别/)).toBeInTheDocument()
  })

  it('hides noisy software audio devices by default with a show all escape hatch', () => {
    useInterviewStore.setState({
      devices: [
        { id: 1, name: 'BlackHole 2ch', channels: 2, is_loopback: true, host_api: 'Core Audio' },
        { id: 2, name: 'ZoomAudioDevice', channels: 2, is_loopback: false, host_api: 'Core Audio' },
        { id: 3, name: 'Microsoft Teams Audio', channels: 2, is_loopback: false, host_api: 'Core Audio' },
        { id: 4, name: 'MacBook Pro Microphone', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
    } as any)

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '选择音频输入设备' }))

    expect(screen.getAllByText(/BlackHole 2ch/).length).toBeGreaterThan(0)
    expect(screen.getByText('MacBook Pro Microphone')).toBeInTheDocument()
    expect(screen.queryByText('ZoomAudioDevice')).not.toBeInTheDocument()
    expect(screen.queryByText('Microsoft Teams Audio')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /显示全部设备/ }))

    expect(screen.getByText('ZoomAudioDevice')).toBeInTheDocument()
    expect(screen.getByText('Microsoft Teams Audio')).toBeInTheDocument()
  })

  it('allows selecting a hidden audio device after showing all devices', () => {
    useInterviewStore.setState({
      devices: [
        { id: 1, name: 'MacBook Pro Microphone', channels: 1, is_loopback: false, host_api: 'Core Audio' },
        { id: 2, name: 'ZoomAudioDevice', channels: 2, is_loopback: false, host_api: 'Core Audio' },
      ],
    } as any)

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '选择音频输入设备' }))
    fireEvent.click(screen.getByRole('button', { name: /显示全部设备/ }))
    fireEvent.click(screen.getByText('ZoomAudioDevice'))

    expect(screen.getByRole('button', { name: '选择音频输入设备' })).toHaveTextContent('当前: ZoomAudioDevice')
  })

  it('refreshes audio devices from the picker', async () => {
    apiMock.getDevices.mockResolvedValue({
      devices: [
        { id: 9, name: 'USB Headset Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
      platform: { platform: 'Darwin', needs_virtual_device: false, instructions: '' },
    })

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '选择音频输入设备' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新设备列表' }))

    expect(apiMock.getDevices).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('USB Headset Mic')).toBeInTheDocument()
  })

  it('warns when no model is enabled', () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        models: [
          { name: 'Disabled A', supports_think: false, supports_vision: false, enabled: false },
          { name: 'Disabled B', supports_think: false, supports_vision: false, enabled: false },
        ],
      },
      modelHealth: { 0: 'error', 1: 'error' },
    } as any)

    render(<ControlBar />)

    expect(screen.getByText('未启用任何模型，请在设置中开启至少一个模型。')).toBeInTheDocument()
  })

  it('blocks manual questions when no answer model is enabled', () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        models: [
          { name: 'Disabled A', supports_think: false, supports_vision: false, enabled: false },
        ],
      },
      modelHealth: { 0: 'error' },
    } as any)

    render(<ControlBar />)

    fireEvent.change(screen.getByPlaceholderText('输入问题，Enter 发送…'), {
      target: { value: '解释一下 B 树和 B+ 树' },
    })

    const send = screen.getByRole('button', { name: '发送问题' })
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('title', '请先在设置中启用至少一个模型')
    fireEvent.click(send)
    expect(apiMock.ask).not.toHaveBeenCalled()
  })

  it('surfaces stop failures instead of swallowing them', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    apiMock.stop.mockRejectedValue(new Error('stop down'))
    useInterviewStore.setState({ isRecording: true, isPaused: false } as any)

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: /结束面试/ }))

    expect(await screen.findByText('结束面试失败：stop down')).toBeInTheDocument()
  })

  it('surfaces cancel-generation failures instead of swallowing them', async () => {
    apiMock.cancelAsk.mockRejectedValue(new Error('cancel down'))
    useInterviewStore.setState({ streamingIds: ['qa-1'] } as any)

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '取消正在生成的回答' }))

    expect(await screen.findByText('取消生成失败：cancel down')).toBeInTheDocument()
  })
})
