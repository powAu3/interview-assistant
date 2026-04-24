import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResumeMountInline, ResumeMountPanel } from './ResumeMount'
import { useInterviewStore } from '@/stores/configStore'

const apiMock = vi.hoisted(() => ({
  uploadResume: vi.fn(),
  deleteResume: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

const refreshConfigMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/configSync', () => ({
  refreshConfig: refreshConfigMock,
}))

vi.mock('@/components/ResumeHistory', () => ({
  ResumeHistoryPanel: () => <div>resume-history-panel</div>,
  ResumeHistoryPopover: () => <div>resume-history-popover</div>,
}))

describe('ResumeMount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useInterviewStore.setState({
      config: {
        has_resume: false,
        resume_active_filename: null,
        resume_active_history_id: null,
      },
      setToastMessage: useInterviewStore.getState().setToastMessage,
    } as any)
  })

  it('renders the empty panel state', () => {
    render(
      <ResumeMountPanel
        title="当前挂载简历"
        description="所有模块共用同一份简历。"
        sharedNote="这里和主流程共用同一份简历历史与当前挂载记录。"
      />,
    )

    expect(screen.getByText('当前没有挂载简历')).toBeInTheDocument()
    expect(screen.getByText('resume-history-panel')).toBeInTheDocument()
  })

  it('renders the active filename in inline mode', () => {
    useInterviewStore.setState({
      config: {
        has_resume: true,
        resume_active_filename: '张三_后端开发.pdf',
        resume_active_history_id: 3,
      },
    } as any)

    render(<ResumeMountInline />)

    expect(screen.getByText('张三_后端开发.pdf')).toBeInTheDocument()
    expect(screen.getByText('resume-history-popover')).toBeInTheDocument()
  })

  it('uploads through the shared handler and refreshes config', async () => {
    apiMock.uploadResume.mockResolvedValue({ parsed: true })

    render(
      <ResumeMountPanel
        title="当前挂载简历"
        description="所有模块共用同一份简历。"
      />,
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['resume'], 'resume.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(apiMock.uploadResume).toHaveBeenCalledWith(file)
      expect(refreshConfigMock).toHaveBeenCalled()
    })
  })

  it('removes the mounted resume through the shared handler', async () => {
    apiMock.deleteResume.mockResolvedValue({ ok: true })
    useInterviewStore.setState({
      config: {
        has_resume: true,
        resume_active_filename: '张三_后端开发.pdf',
        resume_active_history_id: 3,
      },
    } as any)

    render(
      <ResumeMountPanel
        title="当前挂载简历"
        description="所有模块共用同一份简历。"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '取消挂载' }))

    await waitFor(() => {
      expect(apiMock.deleteResume).toHaveBeenCalled()
      expect(refreshConfigMock).toHaveBeenCalled()
    })
  })
})
