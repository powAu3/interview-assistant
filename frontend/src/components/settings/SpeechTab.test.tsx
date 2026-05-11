import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SpeechTab from './SpeechTab'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  sttTest: vi.fn(),
  practiceTts: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('@/lib/configSync', () => ({
  updateConfigAndRefresh: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/practiceTts', () => ({
  normalizePracticeTtsText: (text: string) => text,
  playBase64Audio: vi.fn(),
  speakWithBrowserTts: vi.fn().mockResolvedValue(true),
}))

describe('SpeechTab', () => {
  beforeEach(() => {
    apiMock.sttTest.mockResolvedValue({ ok: true, text: 'demo' })
    apiMock.practiceTts.mockResolvedValue({ audio_base64: '', content_type: 'audio/mpeg', speaker: 'demo' })

    useInterviewStore.setState({
      config: {
        stt_provider: 'iflytek',
        whisper_model: 'base',
        whisper_language: 'auto',
        doubao_stt_app_id: '',
        doubao_stt_access_token: '',
        doubao_stt_resource_id: '',
        doubao_stt_boosting_table_id: '',
        generic_stt_api_base_url: '',
        generic_stt_api_key: '',
        generic_stt_model: '',
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
        assist_transcription_merge_gap_sec: 2.0,
        assist_transcription_merge_max_sec: 12.0,
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
      toastMessage: null,
    } as any)
  })

  it('shows a warning when the saved provider is no longer supported', async () => {
    render(<SpeechTab />)

    expect(await screen.findByText(/该 provider 已不再受支持/)).toBeInTheDocument()
    expect(screen.getByText(/请切换到“通用 ASR”或“Whisper”/)).toBeInTheDocument()
  })
})
