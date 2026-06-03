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
  probeModelCapabilities: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))


describe('ModelsTab state sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      think_effort: 'off',
    })
    apiMock.checkSingleModelHealth.mockResolvedValue({ ok: true })
    apiMock.checkModelsHealth.mockResolvedValue({ ok: true })
    apiMock.probeModelCapabilities.mockResolvedValue({
      ok: true,
      latency_ms: 123,
      supports_vision: false,
      supports_think: false,
      think_style: '',
      think_params: {},
      think_disabled_params: {},
      vision_detail: '未检测到',
      think_detail: '未检测到',
      think_disabled_detail: '关闭 Think 无需额外参数',
    })

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
        api_key_set: false,
        has_resume: false,
        max_parallel_answers: 1,
      },
      modelHealth: { 0: 'ok' },
      modelHealthDetail: {},
      modelHealthLatency: {},
      toastMessage: null,
    } as any)
  })

  it('persists enabled changes from the ordering section when saving models', async () => {
    render(<ModelsTab />)

    await screen.findByText('保存模型队列')

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])
    fireEvent.click(screen.getByText('保存模型队列'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalled()
    })

    const payload = apiMock.updateConfig.mock.calls[0][0]
    expect(payload.models[0].enabled).toBe(false)
  })

  it('shows model health detail as a tooltip in the model list', async () => {
    apiMock.getModelsHealth.mockResolvedValue({
      health: { 0: 'error' },
      detail: { 0: '401 unauthorized' },
      latency: { 0: 0 },
    })

    render(<ModelsTab />)

    expect(await screen.findByText('不可用')).toBeInTheDocument()
    expect(screen.getByTitle('模型连接详情：401 unauthorized')).toBeInTheDocument()
  })

  it('collapses an opened new model after saving without reloading the list', async () => {
    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('添加'))
    const nameInputs = screen.getAllByPlaceholderText('如：GPT-4o、DeepSeek-V3')
    fireEvent.change(nameInputs[nameInputs.length - 1], { target: { value: 'Backup Model' } })
    fireEvent.click(screen.getByText('保存模型队列'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalled()
    })

    expect(apiMock.getModelsFull).toHaveBeenCalledTimes(1)
    const savedNameInput = screen
      .getAllByPlaceholderText('如：GPT-4o、DeepSeek-V3')
      .find((input) => (input as HTMLInputElement).value === 'Backup Model')
    expect(savedNameInput?.closest('[aria-hidden="true"]')).toBeInTheDocument()
    expect(screen.getByText('Backup Model')).toBeInTheDocument()
  })

  it('auto-checks probed vision and think capabilities when testing a model', async () => {
    apiMock.probeModelCapabilities.mockResolvedValue({
      ok: true,
      latency_ms: 98,
      supports_vision: true,
      supports_think: true,
      think_style: 'gpt_reasoning_effort',
      think_params: { reasoning_effort: 'low' },
      think_disabled_params: {},
      vision_detail: '识图请求成功',
      think_detail: 'Think 参数已接受',
      think_disabled_detail: '关闭 Think 无需额外参数',
    })

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    fireEvent.click(screen.getByText('测试连接'))

    await waitFor(() => {
      expect(apiMock.probeModelCapabilities).toHaveBeenCalledWith(0)
    })
    await waitFor(() => {
      expect(screen.getByText('自动探测')).toBeInTheDocument()
    })

    expect(screen.getByText('Think gpt_reasoning_effort')).toBeInTheDocument()
    expect(screen.getByText('识图 支持')).toBeInTheDocument()
    const updateCalls = apiMock.updateConfig.mock.calls
    const lastPayload = updateCalls[updateCalls.length - 1][0]
    expect(lastPayload.models[0].supports_vision).toBe(true)
    expect(lastPayload.models[0].supports_think).toBe(true)
  })
})
