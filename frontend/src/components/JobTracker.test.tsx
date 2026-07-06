import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JobTracker from './JobTracker'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

const apiMock = vi.hoisted(() => ({
  jobTrackerApplications: vi.fn(),
  jobTrackerListOffers: vi.fn(),
  jobTrackerCreateApplication: vi.fn(),
  jobTrackerPatchApplication: vi.fn(),
  jobTrackerDeleteApplication: vi.fn(),
  jobTrackerApplicationReviews: vi.fn(),
  jobTrackerReorderStage: vi.fn(),
  jobTrackerCompare: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('./job-tracker/KanbanBoard', () => ({
  default: ({ applications, search }: any) => {
    const q = search.trim().toLowerCase()
    const visible = applications.filter((app: any) => {
      if (!q) return true
      return [app.company, app.position, app.city, app.notes]
        .some((value) => String(value).toLowerCase().includes(q))
    })
    return (
      <div>
        {visible.map((app: any) => (
          <div key={app.id}>{app.company}</div>
        ))}
      </div>
    )
  },
}))
vi.mock('./job-tracker/OfferCompareModal', () => ({ default: () => null }))
vi.mock('./job-tracker/OfferEditModal', () => ({ default: () => null }))

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

describe('JobTracker', () => {
  beforeEach(() => {
    setViewportWidth(1280)
    apiMock.jobTrackerApplications.mockReset()
    apiMock.jobTrackerListOffers.mockReset()
    apiMock.jobTrackerCreateApplication.mockReset()
    apiMock.jobTrackerPatchApplication.mockReset()
    apiMock.jobTrackerDeleteApplication.mockReset()
    apiMock.jobTrackerApplicationReviews.mockReset()
    apiMock.jobTrackerReorderStage.mockReset()
    apiMock.jobTrackerCompare.mockReset()
    useInterviewStore.setState({ toastMessage: null, setToastMessage: vi.fn() } as any)
    useUiPrefsStore.setState({
      appMode: 'job-tracker',
      jobTrackerDeepLink: null,
      reviewDeepLinkSessionId: null,
    } as any)
    apiMock.jobTrackerApplications.mockResolvedValue({
      items: [{
        id: 1,
        company: 'Acme',
        position: 'Frontend',
        city: 'Shanghai',
        notes: 'react focus',
        stage: 'applied',
        updated_at: 1710000000,
        created_at: 1710000000,
        applied_at: null,
        next_followup_at: null,
        interviewer_info: '',
        feedback: '',
        todos: [],
        sort_order: 0,
        review_summary: {
          review_count: 2,
          latest_review_id: 11,
          latest_avg_score: 7.1,
          latest_review_at: 1710003600,
          latest_status: 'completed',
        },
      }],
    })
    apiMock.jobTrackerListOffers.mockResolvedValue({ items: [] })
    apiMock.jobTrackerApplicationReviews.mockResolvedValue({
      items: [{
        id: 11,
        status: 'completed',
        started_at: 1710000000,
        ended_at: 1710003600,
        title: '系统设计复盘',
        company: 'Acme',
        role: 'Frontend',
        turn_count: 4,
        avg_score: 7.1,
        summary_preview: '缓存与限流回答不错，容量估算需要补强。',
        updated_at: 1710003600,
      }],
    })
    apiMock.jobTrackerCreateApplication.mockResolvedValue({
      id: 2,
      company: 'OpenAI',
      position: 'Research Engineer',
      city: 'Remote',
      notes: '',
      stage: 'applied',
      updated_at: 1710007200,
      created_at: 1710007200,
      applied_at: null,
      next_followup_at: null,
      interviewer_info: '',
      feedback: '',
      todos: [],
      sort_order: 0,
      review_summary: {
        review_count: 0,
        latest_review_id: null,
        latest_avg_score: null,
        latest_review_at: null,
        latest_status: null,
      },
    })
  })

  it('loads and renders application rows', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
  })

  it('lets desktop row body focus the application detail panel', async () => {
    apiMock.jobTrackerApplications.mockResolvedValueOnce({
      items: [
        {
          id: 1,
          company: 'Acme',
          position: 'Frontend',
          city: 'Shanghai',
          notes: '',
          stage: 'applied',
          updated_at: 1710000000,
          created_at: 1710000000,
          applied_at: null,
          next_followup_at: null,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 0,
            latest_review_id: null,
            latest_avg_score: null,
            latest_review_at: null,
            latest_status: null,
          },
        },
        {
          id: 2,
          company: 'MiniMax',
          position: 'AI Product Engineer',
          city: 'Shanghai',
          notes: '',
          stage: 'interview2',
          updated_at: 1710007200,
          created_at: 1710007200,
          applied_at: 1710007200,
          next_followup_at: 1710093600,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 2,
            latest_review_id: 16,
            latest_avg_score: 7.2,
            latest_review_at: 1710007200,
            latest_status: 'completed',
          },
        },
      ],
    })

    render(<JobTracker />)

    await waitFor(() => expect(screen.getAllByText('MiniMax').length).toBeGreaterThan(0))
    const row = screen.getAllByText('MiniMax')[0].closest('article')
    expect(row).not.toBeNull()

    fireEvent.keyDown(row as HTMLElement, { key: 'Enter' })

    const updatedRow = screen
      .getAllByText('MiniMax')
      .map((node) => node.closest('article'))
      .find((candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement &&
        within(candidate).queryByRole('button', { name: /查看 MiniMax 的 2 场复盘/ }) != null,
      )
    expect(updatedRow).not.toBeNull()
    await waitFor(() => {
      expect(within(updatedRow as HTMLElement).getByText('已定位')).toBeInTheDocument()
    })
  })

  it('keeps search consistent when switching to kanban', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    fireEvent.change(screen.getByPlaceholderText('搜索公司 / 岗位 / 城市'), { target: { value: 'react' } })
    expect(screen.getByRole('button', { name: '整理模式' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '整理模式' }))

    expect(screen.getByRole('button', { name: '返回表格' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument())
  })

  it('clears search with Escape', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    const searchInput = screen.getByPlaceholderText('搜索公司 / 岗位 / 城市')
    fireEvent.change(searchInput, { target: { value: 'missing company' } })
    expect(await screen.findByText('没有匹配记录。')).toBeInTheDocument()

    fireEvent.keyDown(searchInput, { key: 'Escape' })

    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
    expect(searchInput).toHaveValue('')
  })

  it('clears search from the visible clear button', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    const searchInput = screen.getByPlaceholderText('搜索公司 / 岗位 / 城市')
    fireEvent.change(searchInput, { target: { value: 'missing company' } })
    expect(await screen.findByText('没有匹配记录。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))

    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
    expect(searchInput).toHaveValue('')
    expect(screen.queryByRole('button', { name: '清空搜索' })).not.toBeInTheDocument()
  })

  it('shows review summary and opens linked reviews', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    fireEvent.click(screen.getAllByRole('button', { name: /查看 Acme 的 2 场复盘/ })[0])

    await waitFor(() => expect(apiMock.jobTrackerApplicationReviews).toHaveBeenCalledWith(1))
    expect(await screen.findByText('系统设计复盘')).toBeInTheDocument()
    expect(screen.getByText(/缓存与限流回答不错/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开复盘' }))
    expect(useUiPrefsStore.getState().appMode).toBe('review')
    expect(useUiPrefsStore.getState().reviewDeepLinkSessionId).toBe(11)
    expect((useInterviewStore.getState().setToastMessage as any)).toHaveBeenCalledWith('已打开 Acme · Frontend 的复盘详情')
  })

  it('surfaces review timeline access in the selected application summary', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    expect(screen.getByText('补下次跟进')).toBeInTheDocument()
    expect(screen.getAllByText(/2 场 · 7\.1/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '补时间' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /查看 Acme 的 2 场复盘/ }))

    await waitFor(() => expect(apiMock.jobTrackerApplicationReviews).toHaveBeenCalledWith(1))
    expect(await screen.findByText('系统设计复盘')).toBeInTheDocument()
  })

  it('lets users save supplemental notes and todos directly inside the extras area', async () => {
    apiMock.jobTrackerPatchApplication.mockResolvedValueOnce({
      id: 1,
      company: 'Acme',
      position: 'Frontend',
      city: 'Shanghai',
      notes: '优先准备 React 性能优化案例',
      stage: 'applied',
      updated_at: 1710007201,
      created_at: 1710000000,
      applied_at: null,
      next_followup_at: null,
      interviewer_info: '',
      feedback: '',
      todos: [
        { id: 'todo-1', title: '周五前跟进 recruiter', done: false },
      ],
      sort_order: 0,
      review_summary: {
        review_count: 2,
        latest_review_id: 11,
        latest_avg_score: 7.1,
        latest_review_at: 1710003600,
        latest_status: 'completed',
      },
    })

    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: '补 1 条待办' }))
    fireEvent.change(
      screen.getByLabelText('待办清单'),
      { target: { value: '周五前跟进 recruiter' } },
    )
    fireEvent.change(
      screen.getByLabelText('备注'),
      { target: { value: '优先准备 React 性能优化案例' } },
    )

    const extrasPanel = screen
      .getAllByRole('button', { name: '保存补充信息' })
      .map((button) => button.parentElement?.parentElement)
      .find((panel): panel is HTMLElement =>
        panel instanceof HTMLElement &&
        within(panel).queryByRole('button', { name: '撤销修改' }) != null,
      )
    expect(extrasPanel).not.toBeNull()
    const extrasScope = within(extrasPanel as HTMLElement)

    expect(extrasScope.getByRole('button', { name: '保存补充信息' })).toBeInTheDocument()
    expect(extrasScope.getByRole('button', { name: '撤销修改' })).toBeInTheDocument()

    fireEvent.click(extrasScope.getByRole('button', { name: '保存补充信息' }))

    await waitFor(() => expect(apiMock.jobTrackerPatchApplication).toHaveBeenCalledWith(1, expect.objectContaining({
      notes: '优先准备 React 性能优化案例',
      todos: [{ id: expect.any(String), title: '周五前跟进 recruiter', done: false, due: undefined }],
    })))
    await waitFor(() => expect(screen.queryByText('待保存')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '撤销修改' })).not.toBeInTheDocument()
  })

  it('shows a lightweight pending-save rail for core edits', async () => {
    apiMock.jobTrackerPatchApplication.mockResolvedValueOnce({
      id: 1,
      company: 'Acme Labs',
      position: 'Frontend',
      city: 'Shanghai',
      notes: 'react focus',
      stage: 'applied',
      updated_at: 1710007202,
      created_at: 1710000000,
      applied_at: null,
      next_followup_at: null,
      interviewer_info: '',
      feedback: '',
      todos: [],
      sort_order: 0,
      review_summary: {
        review_count: 2,
        latest_review_id: 11,
        latest_avg_score: 7.1,
        latest_review_at: 1710003600,
        latest_status: 'completed',
      },
    })

    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: '编辑核心信息' }))
    fireEvent.change(screen.getByLabelText('公司名称'), { target: { value: 'Acme Labs' } })

    expect(screen.getByText('待保存')).toBeInTheDocument()
    expect(screen.getByText('核心待保存')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '暂时无需保存' })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '保存核心信息' })[0])

    await waitFor(() => expect(apiMock.jobTrackerPatchApplication).toHaveBeenCalledWith(1, expect.objectContaining({
      company: 'Acme Labs',
    })))
    await waitFor(() => expect(screen.queryByText('待保存')).not.toBeInTheDocument())
  })

  it('lets desktop detail update stage and follow-up without opening full core edit', async () => {
    apiMock.jobTrackerPatchApplication.mockResolvedValueOnce({
      id: 1,
      company: 'Acme',
      position: 'Frontend',
      city: 'Shanghai',
      notes: 'react focus',
      stage: 'interview1',
      updated_at: 1710007203,
      created_at: 1710000000,
      applied_at: null,
      next_followup_at: 1710266400,
      interviewer_info: '',
      feedback: '',
      todos: [],
      sort_order: 0,
      review_summary: {
        review_count: 2,
        latest_review_id: 11,
        latest_avg_score: 7.1,
        latest_review_at: 1710003600,
        latest_status: 'completed',
      },
    })

    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    fireEvent.change(screen.getAllByLabelText('当前阶段')[0], { target: { value: 'interview1' } })
    fireEvent.change(screen.getByLabelText('下次跟进'), { target: { value: '2024-03-13' } })
    fireEvent.click(screen.getByRole('button', { name: '保存进度' }))

    await waitFor(() => expect(apiMock.jobTrackerPatchApplication).toHaveBeenCalledWith(1, expect.objectContaining({
      stage: 'interview1',
      next_followup_at: 1710259200,
    })))
    expect(screen.getAllByText('一面').length).toBeGreaterThan(0)
  })

  it('shows a focus banner when arriving from review and can auto-open the linked review timeline', async () => {
    useUiPrefsStore.setState({
      appMode: 'job-tracker',
      jobTrackerDeepLink: {
        applicationId: 1,
        openReviews: true,
        highlightReviewId: 11,
      },
      reviewDeepLinkSessionId: null,
    } as any)

    render(<JobTracker />)

    await waitFor(() => expect(apiMock.jobTrackerApplicationReviews).toHaveBeenCalledWith(1))
    expect(await screen.findByText('已定位到 Acme · Frontend')).toBeInTheDocument()
    expect(screen.getByText('已打开复盘时间线')).toBeInTheDocument()
    expect(await screen.findByText('系统设计复盘')).toBeInTheDocument()
  })

  it('creates a new application through the quick add panel and opens it in the detail area', async () => {
    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: '新增记录' }))
    fireEvent.change(screen.getByPlaceholderText('例如 OpenAI'), { target: { value: 'OpenAI' } })
    fireEvent.change(screen.getByPlaceholderText('例如 Frontend Engineer'), { target: { value: 'Research Engineer' } })
    fireEvent.change(screen.getByPlaceholderText('例如 上海 / Remote'), { target: { value: 'Remote' } })
    fireEvent.click(screen.getByRole('button', { name: '创建记录' }))

    await waitFor(() => expect(apiMock.jobTrackerCreateApplication).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: '补进度' })).toBeInTheDocument()
    expect(screen.getByText('补阶段/跟进')).toBeInTheDocument()
    expect(screen.getByText('已创建 OpenAI')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '补进度' }))
    expect(screen.getByText('进度已打开')).toBeInTheDocument()
    expect(screen.queryByText('已创建 OpenAI')).not.toBeInTheDocument()
  })

  it('allows quick add to capture rejected interview stages directly', async () => {
    apiMock.jobTrackerCreateApplication.mockResolvedValueOnce({
      id: 4,
      company: 'Interview Failed Co',
      position: 'Backend Engineer',
      city: 'Hangzhou',
      notes: '',
      stage: 'interview1_rejected',
      updated_at: 1710008200,
      created_at: 1710008200,
      applied_at: 1710007200,
      next_followup_at: null,
      interviewer_info: '',
      feedback: '',
      todos: [],
      sort_order: 0,
      review_summary: {
        review_count: 0,
        latest_review_id: null,
        latest_avg_score: null,
        latest_review_at: null,
        latest_status: null,
      },
    })

    render(<JobTracker />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: '新增记录' }))
    const quickAdd = screen.getByText('快速新增').closest('section')
    expect(quickAdd).not.toBeNull()
    const scoped = within(quickAdd as HTMLElement)

    fireEvent.change(scoped.getByPlaceholderText('例如 OpenAI'), { target: { value: 'Interview Failed Co' } })
    fireEvent.change(scoped.getByPlaceholderText('例如 Frontend Engineer'), { target: { value: 'Backend Engineer' } })
    fireEvent.change(scoped.getByPlaceholderText('例如 上海 / Remote'), { target: { value: 'Hangzhou' } })
    fireEvent.change(scoped.getByRole('combobox'), { target: { value: 'interview1_rejected' } })
    fireEvent.click(scoped.getByRole('button', { name: '创建记录' }))

    await waitFor(() => expect(apiMock.jobTrackerCreateApplication).toHaveBeenCalledWith(expect.objectContaining({
      company: 'Interview Failed Co',
      stage: 'interview1_rejected',
    })))
    await waitFor(() => expect(screen.getAllByText('Interview Failed Co').length).toBeGreaterThan(0))
    expect(screen.getByText('已归到“挂了”')).toBeInTheDocument()
    expect(screen.getAllByText('结果已记录').length).toBeGreaterThan(0)
    expect(screen.getAllByText('一面挂').length).toBeGreaterThan(0)
    expect(screen.getByText('流程已结束')).toBeInTheDocument()
  })

  it('treats round-specific rejected applications as closed and avoids follow-up wording in detail', async () => {
    apiMock.jobTrackerApplications.mockResolvedValueOnce({
      items: [{
        id: 3,
        company: 'Rejected Co',
        position: 'Backend',
        city: 'Beijing',
        notes: '',
        stage: 'interview2_rejected',
        updated_at: 1710000000,
        created_at: 1710000000,
        applied_at: null,
        next_followup_at: null,
        interviewer_info: '',
        feedback: '',
        todos: [],
        sort_order: 0,
        review_summary: {
          review_count: 1,
          latest_review_id: 12,
          latest_avg_score: 5.6,
          latest_review_at: 1710003600,
          latest_status: 'completed',
        },
      }],
    })

    render(<JobTracker />)

    await waitFor(() => expect(screen.getByRole('button', { name: '更多状态' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '更多状态' }))
    fireEvent.click(screen.getByRole('button', { name: /挂了 · 1/ }))
    await waitFor(() => expect(screen.getAllByText('Rejected Co').length).toBeGreaterThan(0))
    expect(screen.getAllByText('二面挂').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/不进入待跟进/).length).toBeGreaterThan(0)
    expect(screen.getByText('回看最后一场复盘')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '看复盘' })[0])
    expect(await screen.findByText('1 场复盘')).toBeInTheDocument()
  })

  it('keeps desktop primary filters compact and reveals terminal filters from more status', async () => {
    apiMock.jobTrackerApplications.mockResolvedValueOnce({
      items: [{
        id: 5,
        company: 'Offer Co',
        position: 'PM',
        city: 'Shanghai',
        notes: '',
        stage: 'offer',
        updated_at: 1710000000,
        created_at: 1710000000,
        applied_at: null,
        next_followup_at: null,
        interviewer_info: '',
        feedback: '',
        todos: [],
        sort_order: 0,
        review_summary: {
          review_count: 0,
          latest_review_id: null,
          latest_avg_score: null,
          latest_review_at: null,
          latest_status: null,
        },
      }],
    })

    render(<JobTracker />)

    await waitFor(() => expect(screen.getByRole('button', { name: '更多状态' })).toBeInTheDocument())
    expect(screen.queryByText('Offer Co')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Offer · 1/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更多状态' }))
    fireEvent.click(screen.getByRole('button', { name: /Offer · 1/ }))

    await waitFor(() => expect(screen.getAllByText('Offer Co').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: /Offer · 1/ })).toBeInTheDocument()
  })

  it('shows hidden terminal records in the desktop footer and can expand back to all', async () => {
    apiMock.jobTrackerApplications.mockResolvedValueOnce({
      items: [
        {
          id: 8,
          company: 'MiniMax',
          position: 'AI Product Engineer',
          city: 'Shanghai',
          notes: '',
          stage: 'interview2',
          updated_at: 1710007200,
          created_at: 1710007200,
          applied_at: 1710007200,
          next_followup_at: 1710093600,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 2,
            latest_review_id: 16,
            latest_avg_score: 7.2,
            latest_review_at: 1710007200,
            latest_status: 'completed',
          },
        },
        {
          id: 9,
          company: 'Moonshot AI',
          position: '后端工程师',
          city: '北京',
          notes: '',
          stage: 'interview2_rejected',
          updated_at: 1710000000,
          created_at: 1710000000,
          applied_at: null,
          next_followup_at: null,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 1,
            latest_review_id: 15,
            latest_avg_score: 6.3,
            latest_review_at: 1710003600,
            latest_status: 'completed',
          },
        },
        {
          id: 10,
          company: 'Teal',
          position: '运营',
          city: 'Remote',
          notes: '',
          stage: 'withdrawn',
          updated_at: 1710003600,
          created_at: 1710003600,
          applied_at: 1710003600,
          next_followup_at: null,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 0,
            latest_review_id: null,
            latest_avg_score: null,
            latest_review_at: null,
            latest_status: null,
          },
        },
      ],
    })

    render(<JobTracker />)

    await waitFor(() => expect(screen.getAllByText('MiniMax').length).toBeGreaterThan(0))
    expect(screen.getByText(/已隐藏 2 条/)).toBeInTheDocument()
    expect(screen.getByText('Moonshot AI')).toBeInTheDocument()
    expect(screen.getAllByText(/二面挂/).length).toBeGreaterThan(0)
    expect(screen.getByText('Teal')).toBeInTheDocument()
    expect(screen.getAllByText(/已放弃/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /全部 · 3/ })).toBeInTheDocument())
    expect(screen.getAllByText('Moonshot AI').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Teal').length).toBeGreaterThan(0)
  })

  it('surfaces rejected as a primary focus chip on compact layout', async () => {
    setViewportWidth(390)
    apiMock.jobTrackerApplications.mockResolvedValueOnce({
      items: [
        {
          id: 6,
          company: 'Rejected Co',
          position: 'Backend',
          city: 'Beijing',
          notes: '',
          stage: 'interview2_rejected',
          updated_at: 1710000000,
          created_at: 1710000000,
          applied_at: null,
          next_followup_at: null,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 1,
            latest_review_id: 15,
            latest_avg_score: 6.3,
            latest_review_at: 1710003600,
            latest_status: 'completed',
          },
        },
        {
          id: 7,
          company: 'MiniMax',
          position: 'AI Product Engineer',
          city: 'Shanghai',
          notes: '',
          stage: 'interview2',
          updated_at: 1710007200,
          created_at: 1710007200,
          applied_at: 1710007200,
          next_followup_at: 1710093600,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 2,
            latest_review_id: 16,
            latest_avg_score: 7.2,
            latest_review_at: 1710007200,
            latest_status: 'completed',
          },
        },
      ],
    })

    render(<JobTracker />)

    await waitFor(() => expect(screen.getByRole('button', { name: /挂了 · 1/ })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /全部 · 2/ })).toBeInTheDocument()
    expect(screen.queryByText('Rejected Co')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /挂了 · 1/ }))

    await waitFor(() => expect(screen.getAllByText('Rejected Co').length).toBeGreaterThan(0))
    expect(screen.getAllByText('二面挂').length).toBeGreaterThan(0)
  })

  it('shows explicit detail-open feedback on compact layout', async () => {
    setViewportWidth(390)

    render(<JobTracker />)

    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: '查看 Acme 详情' }))

    expect(await screen.findByRole('button', { name: '定位 Acme 详情' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起详情' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument()
  })

  it('focuses the compact list on the selected application while detail is open', async () => {
    setViewportWidth(390)
    apiMock.jobTrackerApplications.mockResolvedValueOnce({
      items: [
        {
          id: 1,
          company: 'Acme',
          position: 'Frontend',
          city: 'Shanghai',
          notes: '',
          stage: 'applied',
          updated_at: 1710000000,
          created_at: 1710000000,
          applied_at: null,
          next_followup_at: null,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 2,
            latest_review_id: 11,
            latest_avg_score: 7.1,
            latest_review_at: 1710003600,
            latest_status: 'completed',
          },
        },
        {
          id: 2,
          company: 'MiniMax',
          position: 'AI Product Engineer',
          city: 'Shanghai',
          notes: '',
          stage: 'interview2',
          updated_at: 1710007200,
          created_at: 1710007200,
          applied_at: 1710007200,
          next_followup_at: 1710093600,
          interviewer_info: '',
          feedback: '',
          todos: [],
          sort_order: 0,
          review_summary: {
            review_count: 2,
            latest_review_id: 16,
            latest_avg_score: 7.2,
            latest_review_at: 1710007200,
            latest_status: 'completed',
          },
        },
      ],
    })

    render(<JobTracker />)

    await waitFor(() => expect(screen.getAllByText('MiniMax').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: '查看 MiniMax 详情' }))

    expect(await screen.findByText('已聚焦 1 条 · 当前筛选 2 条')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看 Acme 详情' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返回列表' }))

    expect(await screen.findByRole('button', { name: '查看 Acme 详情' })).toBeInTheDocument()
  })
})
