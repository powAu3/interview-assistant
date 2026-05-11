import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelsTab from './ModelsTab'
import { useInterviewStore } from '@/stores/configStore'


const apiMock = vi.hoisted(() => ({
  getModelsFull: vi.fn(),
  getModelsHealth: vi.fn(),
  updateConfig: vi.fn(),
  getConfig: vi.fn(),
  checkSingleModelHealth: vi.fn(),
  checkModelsHealth: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))


describe('ModelsTab state sync', () => {
  beforeEach(() => {
    apiMock.getModelsFull.mockResolvedValue({
      models: [
        {
          name: 'Main Model',
          api_base_url: 'https://api.openai.com/v1',
          api_key: '',
          model: 'gpt-4o-mini',
          supports_think: false,
          supports_vision: false,
          enabled: true,
          has_key: false,
        },
      ],
    })
    apiMock.getModelsHealth.mockResolvedValue({ health: { 0: 'ok' } })
    apiMock.updateConfig.mockResolvedValue({ ok: true })
    apiMock.getConfig.mockResolvedValue({
      models: [
        {
          name: 'Main Model',
          supports_think: false,
          supports_vision: false,
          enabled: false,
        },
      ],
      active_model: 0,
      max_parallel_answers: 1,
      temperature: 0.5,
      max_tokens: 4096,
      think_mode: false,
    })
    apiMock.checkSingleModelHealth.mockResolvedValue({ ok: true })
    apiMock.checkModelsHealth.mockResolvedValue({ ok: true })

    useInterviewStore.setState({
      config: {
        models: [
          {
            name: 'Main Model',
            supports_think: false,
            supports_vision: false,
            enabled: true,
          },
        ],
        active_model: 0,
        model_name: 'Main Model',
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
        api_key_set: false,
        has_resume: false,
        max_parallel_answers: 1,
      },
      modelHealth: { 0: 'ok' },
      toastMessage: null,
    } as any)
  })

  it('persists enabled changes from the ordering section when saving models', async () => {
    render(<ModelsTab />)

    await screen.findByText('保存模型列表')

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])
    fireEvent.click(screen.getByText('保存模型列表'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalled()
    })

    const payload = apiMock.updateConfig.mock.calls[0][0]
    expect(payload.models[0].enabled).toBe(false)
  })
})
