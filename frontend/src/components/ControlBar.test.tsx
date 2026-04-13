import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ControlBar from './ControlBar'
import { useInterviewStore } from '@/stores/configStore'


const apiMock = vi.hoisted(() => ({
  ask: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    ...apiMock,
  },
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

describe('ControlBar screenshot review flow', () => {
  beforeEach(() => {
    vi.stubGlobal('FileReader', MockFileReader as any)
    apiMock.ask.mockResolvedValue({ ok: true })
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
        iflytek_stt_app_id: '',
        iflytek_stt_api_key: '',
        iflytek_stt_api_secret: '',
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
})
