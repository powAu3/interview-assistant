import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WrittenExamTest from './WrittenExamTest'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  examPreflightRun: vi.fn(),
  examPreflightStatus: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/lib/backendUrl', () => ({ buildWsUrl: () => 'ws://example.test/ws' }))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  close() {
    this.closed = true
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('WrittenExamTest', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.clearAllMocks()
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    useInterviewStore.setState({
      config: {
        model_name: 'GPT-4.1 Vision',
        models: [{ name: 'GPT-4.1 Vision', supports_vision: true, supports_think: true, enabled: true }],
        active_model: 0,
      },
    } as any)
    apiMock.examPreflightRun.mockResolvedValue({ ok: true })
    apiMock.examPreflightStatus.mockResolvedValue({
      question: '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。',
      steps: {},
    })
  })

  it('starts fixed screenshot code preflight and renders answer result', async () => {
    apiMock.examPreflightStatus
      .mockResolvedValueOnce({
        question: '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。',
        steps: {},
      })
      .mockResolvedValueOnce({
        running: false,
        question: '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。',
        steps: {
          screenshot: { status: 'pass', detail: '已生成固定截图代码题' },
          submit: { status: 'pass', detail: '已提交到笔试截图答题链路', model_name: 'GPT-4.1 Vision' },
          llm: {
            status: 'pass',
            detail: '首 token 120ms · 完整 880ms',
            question: '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。',
            answer: '```python\n# 哈希表一次遍历 O(n)\ndef two_sum(nums, target):\n    return []\n```',
            first_token_ms: 120,
            total_ms: 880,
            model_name: 'GPT-4.1 Vision',
          },
          ws: { status: 'pass', detail: 'WebSocket 实时推送正常' },
          ui: { status: 'pass', detail: '检测结果已推送到页面展示' },
          done: { status: 'done', detail: '笔试链路检测完成' },
        },
      })
    render(<WrittenExamTest />)

    fireEvent.click(screen.getByRole('button', { name: '开始检测' }))
    expect(apiMock.examPreflightRun).toHaveBeenCalledTimes(1)

    const ws = FakeWebSocket.instances[0]
    await act(async () => {
      ws.emit({ type: 'exam_preflight_step', step: 'screenshot', status: 'pass', detail: '已生成固定截图代码题' })
      ws.emit({ type: 'exam_preflight_step', step: 'submit', status: 'pass', detail: '已提交到笔试截图答题链路', model_name: 'GPT-4.1 Vision' })
      ws.emit({
        type: 'exam_preflight_step',
        step: 'llm',
        status: 'pass',
        detail: '首 token 120ms · 完整 880ms',
        question: '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。',
        answer: '```python\n# 哈希表一次遍历 O(n)\ndef two_sum(nums, target):\n    return []\n```',
        first_token_ms: 120,
        total_ms: 880,
        model_name: 'GPT-4.1 Vision',
      })
      ws.emit({ type: 'exam_preflight_step', step: 'ws', status: 'pass', detail: 'WebSocket 实时推送正常' })
      ws.emit({ type: 'exam_preflight_step', step: 'ui', status: 'pass', detail: '检测结果已推送到页面展示' })
      ws.emit({ type: 'exam_preflight_step', step: 'done', status: 'done', detail: '完成' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('已生成固定截图代码题')).toBeInTheDocument()
    })
    expect(screen.getByText(/def two_sum/)).toBeInTheDocument()
    expect(screen.getAllByText(/首 token 120ms/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/完整 880ms/).length).toBeGreaterThan(0)
    expect(screen.getByText('笔试链路畅通，可以开始了！')).toBeInTheDocument()
    expect(apiMock.examPreflightStatus).toHaveBeenCalledTimes(2)
  })

  it('hydrates a completed preflight result on mount', async () => {
    apiMock.examPreflightStatus.mockResolvedValueOnce({
      running: false,
      finished_at: 1710000000,
      question: '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。',
      steps: {
        screenshot: { status: 'pass', detail: '已生成固定截图代码题' },
        submit: { status: 'pass', detail: '已提交到笔试截图答题链路', model_name: 'GPT-4.1 Vision' },
        llm: {
          status: 'pass',
          detail: '首 token 120ms · 完整 880ms',
          question: '代码题：给定整数数组 nums 和目标值 target，返回两数之和的下标。',
          answer: '```python\ndef two_sum(nums, target):\n    return []\n```',
          first_token_ms: 120,
          total_ms: 880,
          model_name: 'GPT-4.1 Vision',
        },
        ws: { status: 'pass', detail: 'WebSocket 实时推送正常' },
        ui: { status: 'pass', detail: '检测结果已推送到页面展示' },
        done: { status: 'done', detail: '笔试链路检测完成' },
      },
    })

    render(<WrittenExamTest />)

    await waitFor(() => {
      expect(screen.getByText('已生成固定截图代码题')).toBeInTheDocument()
    })
    expect(screen.getByText(/def two_sum/)).toBeInTheDocument()
    expect(screen.getByText('笔试链路畅通，可以开始了！')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新' })).toBeEnabled()
  })

  it('keeps one websocket while filtering stale preflight streams', async () => {
    render(<WrittenExamTest />)

    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]

    await act(async () => {
      ws.emit({
        type: 'answer_start',
        exam_preflight_id: 'preflight-current',
        model_name: 'GPT-4.1 Vision',
      })
      await Promise.resolve()
    })

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(ws.closed).toBe(false)
    expect(screen.getByText('真实答题 worker 已开始流式回答')).toBeInTheDocument()

    await act(async () => {
      ws.emit({
        type: 'exam_preflight_step',
        preflight_id: 'preflight-old',
        step: 'screenshot',
        status: 'pass',
        detail: 'stale screenshot should also be ignored',
      })
      ws.emit({
        type: 'answer_done',
        exam_preflight_id: 'preflight-old',
        answer: 'stale answer should be ignored',
        first_token_ms: 9,
        total_ms: 10,
        model_name: 'GPT-4.1 Vision',
      })
      await Promise.resolve()
    })

    expect(screen.queryByText('stale answer should be ignored')).not.toBeInTheDocument()

    await act(async () => {
      ws.emit({
        type: 'answer_done',
        exam_preflight_id: 'preflight-current',
        answer: 'current answer is rendered',
        first_token_ms: 120,
        total_ms: 880,
        model_name: 'GPT-4.1 Vision',
      })
      await Promise.resolve()
    })

    expect(screen.getByText('current answer is rendered')).toBeInTheDocument()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('marks answer errors on the LLM and UI preflight steps', async () => {
    render(<WrittenExamTest />)

    const ws = FakeWebSocket.instances[0]
    await act(async () => {
      ws.emit({
        type: 'answer_start',
        exam_preflight_id: 'preflight-error',
        model_name: 'GPT-4.1 Vision',
      })
      ws.emit({
        type: 'answer_error',
        exam_preflight_id: 'preflight-error',
        message: '模型调用超时',
      })
      await Promise.resolve()
    })

    expect(screen.getAllByText('模型调用超时').length).toBeGreaterThan(0)
    expect(screen.getByText('已收到真实答题错误事件')).toBeInTheDocument()
    expect(screen.getByText('未收到可展示的笔试答案')).toBeInTheDocument()
    expect(screen.getByText('部分环节异常，请检查配置后重试')).toBeInTheDocument()
  })

  it('marks startup request failures as failed preflight steps', async () => {
    apiMock.examPreflightRun.mockRejectedValueOnce(new Error('笔试链路检测已在运行中'))
    render(<WrittenExamTest />)

    fireEvent.click(screen.getByRole('button', { name: '开始检测' }))

    await waitFor(() => {
      expect(screen.getAllByText('笔试链路检测已在运行中').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('未收到可展示的笔试答案')).toBeInTheDocument()
    expect(screen.getByText('部分环节异常，请检查配置后重试')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新' })).toBeEnabled()
  })

  it('ignores stale stream events while waiting for the new preflight id', async () => {
    render(<WrittenExamTest />)

    const ws = FakeWebSocket.instances[0]
    await act(async () => {
      ws.emit({
        type: 'answer_start',
        exam_preflight_id: 'preflight-old',
        model_name: 'GPT-4.1 Vision',
      })
      ws.emit({
        type: 'answer_done',
        exam_preflight_id: 'preflight-old',
        answer: 'old answer is rendered',
        first_token_ms: 100,
        total_ms: 500,
        model_name: 'GPT-4.1 Vision',
      })
      await Promise.resolve()
    })

    expect(screen.getByText('old answer is rendered')).toBeInTheDocument()

    const pendingRun = deferred<{ ok: boolean; preflight_id: string }>()
    apiMock.examPreflightRun.mockReturnValueOnce(pendingRun.promise)
    fireEvent.click(screen.getByRole('button', { name: '重新' }))

    await act(async () => {
      ws.emit({
        type: 'answer_done',
        exam_preflight_id: 'preflight-old',
        answer: 'stale answer should still be ignored',
        first_token_ms: 9,
        total_ms: 10,
        model_name: 'GPT-4.1 Vision',
      })
      await Promise.resolve()
    })

    expect(screen.queryByText('stale screenshot should also be ignored')).not.toBeInTheDocument()
    expect(screen.queryByText('stale answer should still be ignored')).not.toBeInTheDocument()

    await act(async () => {
      pendingRun.resolve({ ok: true, preflight_id: 'preflight-next' })
      await Promise.resolve()
    })
    await act(async () => {
      ws.emit({
        type: 'answer_done',
        exam_preflight_id: 'preflight-next',
        answer: 'next answer is rendered',
        first_token_ms: 120,
        total_ms: 880,
        model_name: 'GPT-4.1 Vision',
      })
      await Promise.resolve()
    })

    expect(screen.getByText('next answer is rendered')).toBeInTheDocument()
    expect(screen.queryByText('old answer is rendered')).not.toBeInTheDocument()
  })

  it('hydrates failed preflight status into visible failed steps', async () => {
    apiMock.examPreflightStatus.mockResolvedValueOnce({
      running: false,
      error: '检测异常: 模型回答为空',
      preflight_id: 'preflight-failed',
      steps: {
        screenshot: { status: 'pass', detail: '已生成固定截图代码题' },
        submit: { status: 'pass', detail: '已进入真实截图答题 worker' },
        error: { status: 'fail', detail: '检测异常: 模型回答为空' },
      },
    })

    render(<WrittenExamTest />)

    expect((await screen.findAllByText('检测异常: 模型回答为空')).length).toBeGreaterThan(0)
    expect(screen.getByText('未收到可展示的笔试答案')).toBeInTheDocument()
    expect(screen.getByText('部分环节异常，请检查配置后重试')).toBeInTheDocument()
  })

  it('warns when no vision model is configured', () => {
    useInterviewStore.setState({
      config: {
        model_name: 'Text Model',
        models: [{ name: 'Text Model', supports_vision: false, supports_think: false, enabled: true }],
        active_model: 0,
      },
    } as any)

    render(<WrittenExamTest />)

    expect(screen.getByText('固定截图代码题需要支持视觉的模型。')).toBeInTheDocument()
  })
})
