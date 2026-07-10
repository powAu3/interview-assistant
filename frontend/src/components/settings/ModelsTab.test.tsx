import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  listRemoteModels: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('ModelsTab state sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
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
    apiMock.listRemoteModels.mockResolvedValue({ models: [] })
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

  it('ignores rapid duplicate model queue saves while saving is pending', async () => {
    const save = createDeferred<{ ok: boolean }>()
    apiMock.updateConfig.mockReturnValueOnce(save.promise)

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')

    const saveButton = screen.getByRole('button', { name: '保存模型队列' })
    act(() => {
      saveButton.click()
      saveButton.click()
    })

    expect(apiMock.updateConfig).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '检测' })).toBeDisabled()

    await act(async () => {
      save.resolve({ ok: true })
      await save.promise
    })
  })

  it('shows model queue dirty state after editing a model field', async () => {
    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    fireEvent.change(screen.getByPlaceholderText('如：gpt-4o、ep-xxxxx'), { target: { value: 'gpt-4o' } })

    expect(screen.getByText('有未保存更改')).toBeInTheDocument()
  })

  it('keeps an existing saved API key when the key field is left blank', async () => {
    apiMock.getModelsFull.mockResolvedValueOnce({
      models: [
        {
          name: 'Main Model',
          api_base_url: 'https://api.openai.com/v1',
          api_key: '',
          model: 'gpt-4o-mini',
          supports_think: false,
          supports_vision: false,
          enabled: true,
          has_key: true,
        },
      ],
    })

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    expect(screen.getByPlaceholderText('已保存，留空则保留现有 API Key')).toHaveValue('')
    fireEvent.click(screen.getByText('保存模型队列'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalled()
    })
    const payload = apiMock.updateConfig.mock.calls[0][0]
    expect(payload.models[0].api_key).toBe('__IA_KEEP_EXISTING_API_KEY__')
  })

  it('keeps saved API keys tied to the original model when rows are reordered', async () => {
    apiMock.getModelsFull.mockResolvedValueOnce({
      models: [
        {
          name: 'First Model',
          api_base_url: 'https://api.openai.com/v1',
          api_key: '',
          model: 'gpt-4o-mini',
          supports_think: false,
          supports_vision: false,
          enabled: true,
          has_key: true,
        },
        {
          name: 'Second Model',
          api_base_url: 'https://api.openai.com/v1',
          api_key: '',
          model: 'gpt-4o',
          supports_think: false,
          supports_vision: false,
          enabled: true,
          has_key: true,
        },
      ],
    })

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Second Model'))
    fireEvent.click(screen.getAllByTitle('置顶')[1])
    fireEvent.click(screen.getByText('保存模型队列'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalled()
    })
    const payload = apiMock.updateConfig.mock.calls[0][0]
    expect(payload.models[0]).toEqual(expect.objectContaining({
      name: 'Second Model',
      api_key: '__IA_KEEP_EXISTING_API_KEY__',
      model_original_index: 1,
    }))
    expect(payload.models[1]).toEqual(expect.objectContaining({
      name: 'First Model',
      api_key: '__IA_KEEP_EXISTING_API_KEY__',
      model_original_index: 0,
    }))
  })

  it('fetches remote models and fills name plus model id from the dropdown', async () => {
    apiMock.listRemoteModels.mockResolvedValueOnce({
      models: [
        { id: 'deepseek-chat', owned_by: 'deepseek' },
        { id: 'gpt-4o', owned_by: 'openai' },
        { id: 'gpt-4o-mini', owned_by: 'openai' },
      ],
    })

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    fireEvent.change(screen.getByPlaceholderText('填入你的 API Key'), { target: { value: 'sk-test' } })
    fireEvent.click(screen.getByText('获取模型'))

    const select = await screen.findByRole('combobox', { name: '选择远端模型' })
    expect(screen.getByRole('group', { name: 'deepseek' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'openai' })).toBeInTheDocument()
    expect(apiMock.listRemoteModels).toHaveBeenCalledWith({
      api_base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
      model_index: 0,
    })

    fireEvent.change(select, { target: { value: 'gpt-4o-mini' } })

    expect(screen.getByPlaceholderText('如：GPT-4o、DeepSeek-V3')).toHaveValue('gpt-4o-mini')
    expect(screen.getByPlaceholderText('如：gpt-4o、ep-xxxxx')).toHaveValue('gpt-4o-mini')
    expect(screen.getByText('有未保存更改')).toBeInTheDocument()
  })

  it('ignores rapid duplicate remote model fetches for the same connection settings', async () => {
    const remoteModels = createDeferred<{ models: { id: string }[] }>()
    apiMock.listRemoteModels.mockReturnValueOnce(remoteModels.promise)

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    fireEvent.change(screen.getByPlaceholderText('填入你的 API Key'), { target: { value: 'sk-test' } })

    const fetchButton = screen.getByRole('button', { name: '获取模型' })
    act(() => {
      fetchButton.click()
      fetchButton.click()
    })

    expect(apiMock.listRemoteModels).toHaveBeenCalledTimes(1)
    expect(apiMock.listRemoteModels).toHaveBeenCalledWith({
      api_base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
      model_index: 0,
    })
    expect(screen.getByRole('button', { name: '获取中…' })).toBeDisabled()

    await act(async () => {
      remoteModels.resolve({ models: [{ id: 'gpt-4o-mini' }] })
      await remoteModels.promise
    })

    expect(await screen.findByRole('combobox', { name: '选择远端模型' })).toBeInTheDocument()
  })

  it('shows remote model fetch failures without overwriting existing fields', async () => {
    apiMock.listRemoteModels.mockRejectedValueOnce(new Error('请求失败 (502): upstream 401'))

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    fireEvent.change(screen.getByPlaceholderText('填入你的 API Key'), { target: { value: 'sk-test' } })
    fireEvent.click(screen.getByText('获取模型'))

    expect(await screen.findByRole('alert')).toHaveTextContent('认证失败：请检查 API Key')
    expect(screen.getByRole('alert')).toHaveTextContent('请求失败 (502): upstream 401')
    expect(screen.getByPlaceholderText('如：GPT-4o、DeepSeek-V3')).toHaveValue('Main Model')
    expect(screen.getByPlaceholderText('如：gpt-4o、ep-xxxxx')).toHaveValue('gpt-4o-mini')
  })

  it('clears fetched remote model choices when the connection fields change', async () => {
    apiMock.listRemoteModels.mockResolvedValueOnce({
      models: [{ id: 'gpt-4o-mini' }],
    })

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    fireEvent.change(screen.getByPlaceholderText('填入你的 API Key'), { target: { value: 'sk-test' } })
    fireEvent.click(screen.getByText('获取模型'))

    expect(await screen.findByRole('combobox', { name: '选择远端模型' })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('https://api.openai.com/v1'), {
      target: { value: 'https://api.example.com/v1' },
    })

    expect(screen.queryByRole('combobox', { name: '选择远端模型' })).not.toBeInTheDocument()
  })

  it('ignores stale remote model responses after connection fields change', async () => {
    let resolveRemoteModels: ((value: { models: { id: string }[] }) => void) | null = null
    const remoteModelsPromise = new Promise<{ models: { id: string }[] }>((resolve) => {
      resolveRemoteModels = resolve
    })
    apiMock.listRemoteModels.mockReturnValueOnce(remoteModelsPromise)

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    const apiKeyInput = screen.getByPlaceholderText('填入你的 API Key')
    fireEvent.change(apiKeyInput, { target: { value: 'sk-old' } })
    fireEvent.click(screen.getByText('获取模型'))

    await waitFor(() => {
      expect(apiMock.listRemoteModels).toHaveBeenCalledWith({
        api_base_url: 'https://api.openai.com/v1',
        api_key: 'sk-old',
        model_index: 0,
      })
    })

    fireEvent.change(apiKeyInput, { target: { value: 'sk-new' } })
    await act(async () => {
      if (!resolveRemoteModels) throw new Error('remote model resolver was not captured')
      resolveRemoteModels({ models: [{ id: 'stale-model' }] })
      await remoteModelsPromise
      await Promise.resolve()
    })

    expect(apiKeyInput).toHaveValue('sk-new')
    expect(screen.queryByRole('combobox', { name: '选择远端模型' })).not.toBeInTheDocument()
    expect(screen.queryByText('stale-model')).not.toBeInTheDocument()
  })

  it('hydrates parallel answer count without marking the queue dirty on first load', async () => {
    const models = ['Main Model', 'Backup Model', 'Vision Model'].map((name, index) => ({
      name,
      api_base_url: 'https://api.openai.com/v1',
      api_key: '',
      model: index === 0 ? 'gpt-4o-mini' : `gpt-4.1-mini-${index}`,
      supports_think: false,
      supports_vision: false,
      enabled: true,
      has_key: false,
    }))
    apiMock.getModelsFull.mockResolvedValueOnce({ models })
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as any),
        models,
        active_model: 1,
        max_parallel_answers: 3,
      },
    } as any)

    render(<ModelsTab />)

    await screen.findByText('Vision Model')

    expect(screen.queryByText('有未保存更改')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3' })).toHaveClass('bg-accent-blue')
  })

  it('does not overwrite unsaved generation params when saving the model queue refreshes config', async () => {
    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.change(screen.getByDisplayValue('0.5'), { target: { value: '0.8' } })
    expect(screen.getByText('有未保存更改')).toBeInTheDocument()

    fireEvent.click(screen.getByText('保存模型队列'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalled()
    })
    expect(screen.getByDisplayValue('0.8')).toBeInTheDocument()
    expect(screen.getByText('有未保存更改')).toBeInTheDocument()
  })

  it('normalizes invalid generation params from config before saving', async () => {
    useInterviewStore.setState((state) => ({
      config: {
        ...(state.config as any),
        temperature: 'not-a-number',
        max_tokens: 999999,
      },
    }) as any)

    render(<ModelsTab />)

    await screen.findByText('保存生成参数')

    expect(screen.queryByDisplayValue('NaN')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('0.5')).toBeInTheDocument()
    expect(screen.getByDisplayValue('32768')).toBeInTheDocument()

    fireEvent.click(screen.getByText('保存生成参数'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
        temperature: 0.5,
        max_tokens: 32768,
      }))
    })
  })

  it('clamps edited generation params before saving', async () => {
    render(<ModelsTab />)

    await screen.findByText('保存生成参数')
    const [temperatureInput, maxTokensInput] = screen.getAllByRole('spinbutton')

    fireEvent.change(temperatureInput, { target: { value: '9' } })
    fireEvent.change(maxTokensInput, { target: { value: '100' } })
    fireEvent.click(screen.getByText('保存生成参数'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
        temperature: 2,
        max_tokens: 256,
      }))
    })
  })

  it('ignores rapid duplicate generation parameter saves while saving is pending', async () => {
    const save = createDeferred<{ ok: boolean }>()
    apiMock.updateConfig.mockReturnValueOnce(save.promise)

    render(<ModelsTab />)

    await screen.findByText('保存生成参数')
    const saveButton = screen.getByRole('button', { name: '保存生成参数' })

    act(() => {
      saveButton.click()
      saveButton.click()
    })

    expect(apiMock.updateConfig).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()

    await act(async () => {
      save.resolve({ ok: true })
      await save.promise
    })
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
    await waitFor(() => {
      expect(nameInputs[nameInputs.length - 1]).toHaveFocus()
    })
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

  it('shows probe failure detail inside the expanded model card', async () => {
    apiMock.probeModelCapabilities.mockResolvedValue({
      ok: false,
      detail: 'HTTP 401 unauthorized',
      latency_ms: 0,
      supports_vision: false,
      supports_think: false,
      think_style: '',
      think_params: {},
      think_disabled_params: {},
      vision_detail: '',
      think_detail: '',
      think_disabled_detail: '',
    })

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    expect(screen.getByText('测试会先保存当前模型配置')).toBeInTheDocument()
    fireEvent.click(screen.getByText('保存并测试'))

    expect(await screen.findByRole('alert')).toHaveTextContent('测试失败：HTTP 401 unauthorized')
    expect(apiMock.updateConfig.mock.invocationCallOrder[0]).toBeLessThan(
      apiMock.probeModelCapabilities.mock.invocationCallOrder[0],
    )
  })

  it('ignores rapid duplicate model tests while the save-and-test flow is pending', async () => {
    const save = createDeferred<{ ok: boolean }>()
    apiMock.updateConfig.mockReturnValueOnce(save.promise)

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))

    const testButton = screen.getByRole('button', { name: '保存并测试' })
    act(() => {
      testButton.click()
      testButton.click()
    })

    expect(apiMock.updateConfig).toHaveBeenCalledTimes(1)
    expect(apiMock.probeModelCapabilities).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '测试中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()

    await act(async () => {
      save.resolve({ ok: true })
      await save.promise
    })

    await waitFor(() => {
      expect(apiMock.probeModelCapabilities).toHaveBeenCalledTimes(1)
    })
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
    fireEvent.click(screen.getByText('保存并测试'))

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

  it('shows unconfirmed think-disable status when probe cannot verify closing params', async () => {
    apiMock.probeModelCapabilities.mockResolvedValue({
      ok: true,
      latency_ms: 98,
      supports_vision: false,
      supports_think: true,
      think_style: 'gpt_reasoning_effort',
      think_params: { reasoning_effort: 'low' },
      think_disabled_params: {},
      vision_detail: '识图未检测到',
      think_detail: 'Think 参数已接受',
      think_disabled_detail: '未检测到可靠的显式关闭 Think 参数',
    })

    render(<ModelsTab />)

    await screen.findByText('保存模型队列')
    fireEvent.click(screen.getByText('Main Model'))
    fireEvent.click(screen.getByText('保存并测试'))

    expect(await screen.findByText('关 未确认')).toBeInTheDocument()
    expect(screen.getByText('重新探测')).toBeInTheDocument()
  })

  it('clears dirty state after saving a reordered queue with a moved active model', async () => {
    apiMock.getModelsFull.mockResolvedValueOnce({
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
        {
          name: 'Backup Model',
          api_base_url: 'https://api.openai.com/v1',
          api_key: '',
          model: 'gpt-4.1-mini',
          supports_think: false,
          supports_vision: false,
          enabled: true,
          has_key: false,
        },
      ],
    })
    apiMock.getConfig.mockResolvedValueOnce({
      models: [
        {
          name: 'Backup Model',
          supports_think: false,
          supports_vision: false,
          enabled: true,
        },
        {
          name: 'Main Model',
          supports_think: false,
          supports_vision: false,
          enabled: true,
        },
      ],
      active_model: 1,
      max_parallel_answers: 1,
      temperature: 0.5,
      max_tokens: 4096,
      think_mode: false,
      think_effort: 'off',
    })
    useInterviewStore.setState({
      config: {
        ...(useInterviewStore.getState().config as any),
        models: [
          {
            name: 'Main Model',
            supports_think: false,
            supports_vision: false,
            enabled: true,
          },
          {
            name: 'Backup Model',
            supports_think: false,
            supports_vision: false,
            enabled: true,
          },
        ],
        active_model: 0,
      },
    } as any)

    render(<ModelsTab />)

    await screen.findByText('Backup Model')
    fireEvent.click(screen.getAllByTitle('置底')[0])

    expect(screen.getByText('有未保存更改')).toBeInTheDocument()
    fireEvent.click(screen.getByText('保存模型队列'))

    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalled()
    })
    expect(screen.queryByText('有未保存更改')).not.toBeInTheDocument()
  })
})
