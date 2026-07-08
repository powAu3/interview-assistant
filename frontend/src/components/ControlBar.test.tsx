import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ControlBar from './ControlBar'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'


const apiMock = vi.hoisted(() => ({
  ask: vi.fn(),
  getDevices: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  clear: vi.fn(),
  cancelAsk: vi.fn(),
  audioOutputTest: vi.fn(),
  audioInputTest: vi.fn(),
  audioInputMonitorStart: vi.fn(),
  audioInputMonitorStatus: vi.fn(),
  audioInputMonitorStop: vi.fn(),
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
    localStorage.clear()
    vi.stubGlobal('FileReader', MockFileReader as any)
    ;(window as any).electronAPI = {
      syncOverlayWindow: vi.fn().mockResolvedValue(undefined),
    }
    apiMock.ask.mockResolvedValue({ ok: true })
    apiMock.getDevices.mockResolvedValue({ devices: [], platform: null })
    apiMock.start.mockResolvedValue({ ok: true })
    apiMock.stop.mockResolvedValue({ ok: true })
    apiMock.pause.mockResolvedValue({ ok: true })
    apiMock.resume.mockResolvedValue({ ok: true })
    apiMock.clear.mockResolvedValue({ ok: true })
    apiMock.cancelAsk.mockResolvedValue({ ok: true })
    apiMock.audioOutputTest.mockResolvedValue({ ok: true, elapsed_sec: 1.0 })
    apiMock.audioInputTest.mockResolvedValue({
      ok: true,
      device_id: 11,
      elapsed_sec: 1.2,
      rms: 0.02,
      peak: 0.1,
      has_signal: true,
      detail: '已捕获输入信号',
    })
    apiMock.audioInputMonitorStart.mockResolvedValue({
      running: true,
      device_id: 11,
      rms: 0.02,
      peak: 0.1,
      level_pct: 50,
      has_signal: true,
      error: null,
    })
    apiMock.audioInputMonitorStatus.mockResolvedValue({
      running: true,
      device_id: 11,
      rms: 0.02,
      peak: 0.1,
      level_pct: 50,
      has_signal: true,
      error: null,
    })
    apiMock.audioInputMonitorStop.mockResolvedValue({ running: false })
    useInterviewStore.setState({
      config: {
        models: [{ name: 'TextOnly', supports_think: false, supports_vision: false, enabled: true }],
        active_model: 0,
        model_name: 'TextOnly',
        temperature: 0.5,
        max_tokens: 4096,
        think_mode: false,
        think_effort: 'off',
        stt_provider: 'whisper',
        whisper_model: 'base',
        whisper_language: 'auto',
        doubao_stt_app_id: '',
        doubao_stt_access_token: '',
        doubao_stt_api_key: '',
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
      modelHealthDetail: {},
      modelHealthLatency: {},
      sttLoaded: true,
      sttLoading: false,
      sttActiveProvider: '',
      sttFallbackLoaded: false,
      isRecording: false,
      isPaused: false,
      lastWSError: null,
      toastMessage: null,
    } as any)
    useUiPrefsStore.setState({
      interviewOverlayEnabled: false,
      interviewOverlayMode: 'glass',
      interviewOverlayShowBg: true,
      interviewOverlayOpacity: 0.88,
      interviewOverlayFontSize: 14,
      interviewOverlayFontColor: '#e2e8f0',
      interviewOverlayFocusWidthPct: 96,
      interviewOverlayFocusHeightPct: 90,
      interviewOverlayMaxLines: 0,
    })
  })

  it('blocks pasted screenshots when no enabled model supports vision', async () => {
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
    expect(screen.getByText('请先在设置中启用至少一个带 👁 的识图模型，再粘贴截图')).toBeInTheDocument()
  })

  it('allows pasted screenshots to fall back to an enabled vision model', async () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        models: [
          { name: 'TextOnly', supports_think: false, supports_vision: false, enabled: true },
          { name: 'VisionBackup', supports_think: false, supports_vision: true, enabled: true },
        ],
      },
      modelHealth: { 0: 'ok', 1: 'ok' },
    } as any)

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

    expect(screen.getByText(/自动使用「VisionBackup」/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }))

    await waitFor(() => {
      expect(apiMock.ask).toHaveBeenCalledWith('', 'data:image/png;base64,xxx')
    })
  })

  it('forces the prompt overlay on when starting written exam mode', async () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        written_exam_mode: true,
      },
    } as any)

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: /开始笔试/ }))

    await waitFor(() => expect(apiMock.start).toHaveBeenCalledWith(null, null))
    expect(window.electronAPI?.syncOverlayWindow).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      visible: true,
      mode: 'prompt',
      showBg: false,
    }))
    expect(useUiPrefsStore.getState().interviewOverlayEnabled).toBe(true)
    expect(useUiPrefsStore.getState().interviewOverlayMode).toBe('prompt')
  })

  it('hides the resume mount in written exam mode', () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        written_exam_mode: true,
      },
    } as any)

    render(<ControlBar />)

    expect(screen.queryByTestId('resume-mount-inline')).not.toBeInTheDocument()
  })

  it('keeps the resume mount available in interview mode', () => {
    render(<ControlBar />)

    expect(screen.getByTestId('resume-mount-inline')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: '选择会议音频设备' }))

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

    fireEvent.click(screen.getByRole('button', { name: '选择会议音频设备' }))
    fireEvent.click(screen.getByRole('button', { name: /显示全部设备/ }))
    fireEvent.click(screen.getByText('ZoomAudioDevice'))

    expect(screen.getByRole('button', { name: '选择会议音频设备' })).toHaveTextContent('当前：ZoomAudioDevice')
  })

  it('refreshes audio devices from the picker', async () => {
    apiMock.getDevices.mockResolvedValue({
      devices: [
        { id: 9, name: 'USB Headset Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
      platform: { platform: 'Darwin', needs_virtual_device: false, instructions: '' },
    })

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '选择会议音频设备' }))
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

  it('uses fresh written-exam stop copy after mode changes while recording', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    apiMock.stop.mockRejectedValue(new Error('stop down'))
    useInterviewStore.setState({ isRecording: true, isPaused: false } as any)

    render(<ControlBar />)

    act(() => {
      useInterviewStore.setState({
        config: {
          ...(useInterviewStore.getState().config as object),
          written_exam_mode: true,
        },
      } as any)
    })
    fireEvent.click(screen.getByRole('button', { name: /^结束$/ }))

    expect(confirmSpy).toHaveBeenCalledWith('结束本次笔试？当前答案会保留在页面上。')
    expect(await screen.findByText('结束笔试失败：stop down')).toBeInTheDocument()
  })

  it('surfaces cancel-generation failures instead of swallowing them', async () => {
    apiMock.cancelAsk.mockRejectedValue(new Error('cancel down'))
    useInterviewStore.setState({ streamingIds: ['qa-1'] } as any)

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '取消正在生成的回答' }))

    expect(await screen.findByText('取消生成失败：cancel down')).toBeInTheDocument()
  })

  it('starts assist mode with meeting audio and candidate microphone devices', async () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        candidate_asr_enabled: true,
      },
      devices: [
        { id: 10, name: 'System Loopback', channels: 2, is_loopback: true, host_api: 'Core Audio' },
        { id: 11, name: 'USB Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
    } as any)

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '开始面试' }))

    await waitFor(() => {
      expect(apiMock.start).toHaveBeenCalledWith(10, 11)
    })
  })

  it('prefers a candidate microphone different from the meeting audio device', async () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        candidate_asr_enabled: true,
      },
      devices: [
        { id: 11, name: 'Built-in Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
        { id: 12, name: 'USB Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
    } as any)

    render(<ControlBar />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择我的麦克风' })).toHaveTextContent('当前：USB Mic')
    })

    fireEvent.click(screen.getByRole('button', { name: '开始面试' }))

    await waitFor(() => {
      expect(apiMock.start).toHaveBeenCalledWith(11, 12)
    })
  })

  it('warns and skips candidate ASR when candidate microphone matches meeting audio', async () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        candidate_asr_enabled: true,
      },
      devices: [
        { id: 11, name: 'USB Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
    } as any)

    render(<ControlBar />)

    expect(await screen.findByText(/本次不会单独记录你的回答/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }))

    await waitFor(() => {
      expect(apiMock.start).toHaveBeenCalledWith(11, null)
    })
  })

  it('does not pass candidate microphone when candidate ASR is disabled', async () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        candidate_asr_enabled: false,
      },
      devices: [
        { id: 10, name: 'System Loopback', channels: 2, is_loopback: true, host_api: 'Core Audio' },
        { id: 11, name: 'USB Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
    } as any)

    render(<ControlBar />)

    expect(screen.getByRole('status', { name: '我的回答记录状态' })).toHaveTextContent('我的回答记录已关闭')
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }))

    await waitFor(() => {
      expect(apiMock.start).toHaveBeenCalledWith(10, null)
    })
  })

  it('labels the candidate microphone as answer recording when candidate ASR is enabled', () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        candidate_asr_enabled: true,
      },
      devices: [
        { id: 10, name: 'System Loopback', channels: 2, is_loopback: true, host_api: 'Core Audio' },
        { id: 11, name: 'USB Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
    } as any)

    render(<ControlBar />)

    expect(screen.getByText('我的麦克风 · 记录我的回答')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择我的麦克风' })).toBeInTheDocument()
  })

  it('plays a speaker test sound from the meeting audio picker', async () => {
    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '测试音频输出' }))

    await waitFor(() => {
      expect(apiMock.audioOutputTest).toHaveBeenCalledTimes(1)
    })
  })

  it('opens a live candidate microphone meter and renders the input level', async () => {
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as object),
        candidate_asr_enabled: true,
      },
      devices: [
        { id: 10, name: 'System Loopback', channels: 2, is_loopback: true, host_api: 'Core Audio' },
        { id: 11, name: 'USB Mic', channels: 1, is_loopback: false, host_api: 'Core Audio' },
      ],
    } as any)

    render(<ControlBar />)

    fireEvent.click(screen.getByRole('button', { name: '测试麦克风输入' }))

    await waitFor(() => {
      expect(apiMock.audioInputMonitorStart).toHaveBeenCalledWith(11)
    })
    expect(await screen.findByText('50%')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '麦克风输入测试' })).toBeInTheDocument()
  })
})
