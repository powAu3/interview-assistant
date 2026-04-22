import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ResumeOptimizer from './ResumeOptimizer'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  uploadResume: vi.fn(),
  deleteResume: vi.fn(),
  resumeOptimize: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

vi.mock('@/lib/configSync', () => ({
  refreshConfig: vi.fn(),
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}))

vi.mock('@/components/ResumeHistory', () => ({
  ResumeHistoryPanel: () => <div>resume-history</div>,
}))

const JD_STORAGE_KEY = 'ia-resume-opt-jd-draft'

describe('ResumeOptimizer', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    window.localStorage.clear()
    vi.clearAllMocks()
    useInterviewStore.setState({
      config: {
        has_resume: false,
        position: '后端开发',
        language: 'Python',
      },
      resumeOptStreaming: '',
      resumeOptResult: '',
      resumeOptLoading: false,
      setToastMessage: useInterviewStore.getState().setToastMessage,
      resetResumeOpt: useInterviewStore.getState().resetResumeOpt,
    } as any)
  })

  it('restores the JD draft from localStorage', async () => {
    window.localStorage.setItem(JD_STORAGE_KEY, '负责后端服务、数据库设计和系统稳定性建设。')

    render(<ResumeOptimizer />)

    expect(await screen.findByPlaceholderText('将招聘 JD 粘贴到这里...')).toHaveValue(
      '负责后端服务、数据库设计和系统稳定性建设。',
    )
  })

  it('blocks analysis when no resume is mounted', async () => {
    render(<ResumeOptimizer />)
    fireEvent.change(screen.getByPlaceholderText('将招聘 JD 粘贴到这里...'), {
      target: { value: '负责后端服务、数据库设计和系统稳定性建设。' },
    })
    expect(screen.getByRole('button', { name: '开始分析' })).toBeDisabled()
    expect(apiMock.resumeOptimize).not.toHaveBeenCalled()
  })

  it('copies the generated analysis result', async () => {
    useInterviewStore.setState({
      config: {
        has_resume: true,
        position: '后端开发',
        language: 'Python',
        resume_active_filename: '张三_后端开发.pdf',
        resume_active_history_id: 3,
      },
      resumeOptResult: '### 综合建议\n- 强化项目 impact 描述',
    } as any)

    render(<ResumeOptimizer />)

    expect(screen.getByText('张三_后端开发.pdf')).toBeInTheDocument()
    expect(screen.getByText('和主流程、模拟练习共用同一份简历历史与当前挂载记录。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('### 综合建议\n- 强化项目 impact 描述')
    })
  })
})
