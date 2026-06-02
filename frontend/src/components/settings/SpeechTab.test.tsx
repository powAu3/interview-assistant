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

  it('shows candidate microphone ASR defaults as local whisper', () => {
    render(<SpeechTab />)

    expect(screen.getByText('实时辅助语音链路')).toBeInTheDocument()
    expect(screen.getByText('主链路 ASR（面试官 / 会议音频）')).toBeInTheDocument()
    expect(screen.getByText('可选辅助 ASR（我的回答）')).toBeInTheDocument()
    expect(screen.getByTitle('我的麦克风 ASR — Beta')).toBeInTheDocument()
    expect(screen.getByText('我的回答上下文（麦克风）')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '我的回答上下文（麦克风）' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getAllByText(/不会触发自动答题/).length).toBeGreaterThan(0)
    expect(screen.getByText('麦克风兼容模式')).toBeInTheDocument()
    expect(screen.getByText('共享兼容优先')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Whisper（本地，免费）')).toBeInTheDocument()
    expect(screen.getByText(/高级设置：Whisper 模型与追问上下文/)).toBeInTheDocument()
    expect(screen.getByText(/生成下一轮答案时会携带上一轮/)).toBeInTheDocument()
    expect(screen.getByText('边听边写')).toBeInTheDocument()
    expect(screen.getByText('兜底等最后一句 (ms)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('200')).toBeInTheDocument()
  })
})
