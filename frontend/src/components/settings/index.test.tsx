import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsDrawer from './index'
import { useInterviewStore } from '@/stores/configStore'

describe('SettingsDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 120,
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 32,
    })
    HTMLElement.prototype.getClientRects = vi.fn(() => [{ width: 120, height: 32 }] as any)

    useInterviewStore.setState({
      settingsOpen: true,
      settingsDrawerTab: 'config',
      config: {
        stt_provider: 'whisper',
        whisper_model: 'base',
        whisper_language: 'auto',
        whisper_preload: false,
        doubao_stt_app_id: '',
        doubao_stt_access_token: '',
        doubao_stt_api_key: '',
        doubao_stt_resource_id: '',
        doubao_stt_boosting_table_id: '',
        generic_stt_api_base_url: '',
        generic_stt_api_key: '',
        generic_stt_model: '',
        generic_stt_custom_headers: '',
        candidate_asr_enabled: false,
        candidate_stt_provider: 'whisper',
        candidate_whisper_model: '',
        candidate_whisper_language: '',
        candidate_remote_stt_enabled: false,
        candidate_context_enabled: true,
        candidate_context_wait_ms: 200,
        candidate_context_max_chars: 900,
        candidate_context_min_chars: 6,
        candidate_streaming_asr_enabled: true,
        candidate_streaming_asr_interval_ms: 1500,
        candidate_mic_compatibility_mode: true,
        practice_tts_provider: 'edge_tts',
        edge_tts_voice_female: 'zh-CN-XiaoxiaoNeural',
        edge_tts_voice_male: 'zh-CN-YunxiNeural',
        edge_tts_rate: '+0%',
        edge_tts_pitch: '+0Hz',
        volcengine_tts_appkey: '',
        volcengine_tts_token: '',
        practice_tts_speaker_female: 'zh_female_qingxin',
        practice_tts_speaker_male: 'zh_male_chunhou',
        silence_threshold: 0.01,
        silence_duration: 1.2,
        transcription_min_sig_chars: 2,
        assist_transcription_merge_gap_sec: 2,
        assist_transcription_merge_max_sec: 12,
        assist_high_churn_short_answer: false,
        auto_detect: true,
        edge_tts_available: true,
        edge_tts_status_detail: 'ok',
      },
      options: {
        stt_providers: ['whisper', 'doubao', 'generic'],
        practice_tts_providers: ['edge_tts', 'local', 'volcengine'],
        whisper_models: ['tiny', 'base'],
      },
    } as any)
  })

  it('keeps focus on the active field when dirty state changes', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.textContent = 'outside'
    document.body.appendChild(outsideButton)
    outsideButton.focus()

    render(<SettingsDrawer />)

    const modelSelect = await screen.findByDisplayValue('base')
    modelSelect.focus()
    fireEvent.change(modelSelect, { target: { value: 'tiny' } })

    await waitFor(() => {
      expect(screen.getAllByText('有未保存更改').length).toBeGreaterThan(0)
    })
    expect(document.activeElement).not.toBe(outsideButton)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    outsideButton.remove()
  })

  it('restores focus to the opener after dirty state changes and close is confirmed', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.textContent = 'outside'
    document.body.appendChild(outsideButton)
    outsideButton.focus()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<SettingsDrawer />)

    const modelSelect = await screen.findByDisplayValue('base')
    fireEvent.change(modelSelect, { target: { value: 'tiny' } })
    await waitFor(() => {
      expect(screen.getAllByText('有未保存更改').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    await waitFor(() => {
      expect(document.activeElement).toBe(outsideButton)
    })
    outsideButton.remove()
  })

  it('asks before switching tabs with unsaved explicit settings', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SettingsDrawer />)

    const modelSelect = await screen.findByDisplayValue('base')
    fireEvent.change(modelSelect, { target: { value: 'tiny' } })
    await waitFor(() => {
      expect(screen.getAllByText('有未保存更改').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: /模型/ }))

    expect(confirmSpy).toHaveBeenCalledWith('有未保存更改，切换后会丢失。')
    expect(screen.getByText('语音链路')).toBeInTheDocument()
  })

  it('shows explicit unsaved sections in the drawer header', async () => {
    render(<SettingsDrawer />)

    const modelSelect = await screen.findByDisplayValue('base')
    fireEvent.change(modelSelect, { target: { value: 'tiny' } })

    expect(await screen.findByText('未保存：语音配置')).toBeInTheDocument()
  })
})
