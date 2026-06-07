import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InterviewOverlay from './InterviewOverlay'
import { useInterviewStore } from '@/stores/configStore'
import { useShortcutsStore } from '@/stores/shortcutsStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

vi.mock('@/hooks/useInterviewWS', () => ({
  useInterviewWS: () => undefined,
}))

const qa = {
  id: 'qa-1',
  question: '给定 n 个非负整数，计算能接多少雨水。',
  answer: '双指针维护左右最大高度，一次遍历即可计算总雨水。',
  thinkContent: '',
  isThinking: false,
  timestamp: Date.now(),
}

beforeEach(() => {
  localStorage.clear()
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
  useShortcutsStore.getState().resetShortcuts()
  useInterviewStore.setState({
    qaPairs: [qa],
    streamingIds: [],
    isRecording: true,
    config: { written_exam_mode: false } as never,
  })
  useUiPrefsStore.setState({
    interviewOverlayEnabled: true,
    interviewOverlayOpacity: 0.88,
    interviewOverlayFontSize: 14,
    interviewOverlayFontColor: '#334155',
    interviewOverlayShowBg: true,
    interviewOverlayMode: 'glass',
    interviewOverlayFocusWidthPct: 96,
    interviewOverlayFocusHeightPct: 90,
    interviewOverlayMaxLines: 0,
  })
  localStorage.setItem('ia_overlay_enabled', '1')
  localStorage.setItem('ia_overlay_mode', 'glass')
  localStorage.setItem('ia_overlay_show_bg', '1')
})

describe('InterviewOverlay', () => {
  it('renders the existing glass overlay mode', () => {
    render(<InterviewOverlay />)

    expect(screen.getByText(/双指针维护左右最大高度/)).toBeInTheDocument()
    expect(document.querySelector('.ov-shell--bg')).toBeInTheDocument()
  })

  it('renders the existing prompt overlay mode', () => {
    useUiPrefsStore.setState({ interviewOverlayMode: 'prompt', interviewOverlayShowBg: false })
    localStorage.setItem('ia_overlay_mode', 'prompt')
    localStorage.setItem('ia_overlay_show_bg', '0')

    render(<InterviewOverlay />)

    expect(screen.getByText(/双指针维护左右最大高度/)).toBeInTheDocument()
    expect(document.querySelector('.ov-shell--nobg')).toBeInTheDocument()
  })

  it('keeps following streamed prompt overlay content while the user is near the bottom', () => {
    useUiPrefsStore.setState({ interviewOverlayMode: 'prompt', interviewOverlayShowBg: false })
    useInterviewStore.setState({
      qaPairs: [{ ...qa, answer: '正在生成第一段。', status: 'streaming' }],
      streamingIds: ['qa-1'],
    })
    const { rerender } = render(<InterviewOverlay />)
    const scroller = document.querySelector('.ov-answer') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true })
    scroller.scrollTop = 790
    fireEvent.scroll(scroller)

    act(() => {
      useInterviewStore.setState({
        qaPairs: [{ ...qa, answer: '正在生成第一段。\n继续生成第二段。', status: 'streaming' }],
        streamingIds: ['qa-1'],
      })
    })
    rerender(<InterviewOverlay />)

    expect(scroller.scrollTop).toBe(1000)
  })

  it('pauses prompt overlay auto-follow when the user scrolls up during streaming', () => {
    useUiPrefsStore.setState({ interviewOverlayMode: 'prompt', interviewOverlayShowBg: false })
    useInterviewStore.setState({
      qaPairs: [{ ...qa, answer: '正在生成第一段。', status: 'streaming' }],
      streamingIds: ['qa-1'],
    })
    const { rerender } = render(<InterviewOverlay />)
    const scroller = document.querySelector('.ov-answer') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true })
    scroller.scrollTop = 120
    fireEvent.scroll(scroller)

    act(() => {
      useInterviewStore.setState({
        qaPairs: [{ ...qa, answer: '正在生成第一段。\n继续生成第二段。', status: 'streaming' }],
        streamingIds: ['qa-1'],
      })
    })
    rerender(<InterviewOverlay />)

    expect(scroller.scrollTop).toBe(120)
  })

  it('resumes auto-follow after switching focus tabs during streaming', () => {
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 解题思路\n先说思路。\n\n## 代码解决方案\n正在写代码。',
        status: 'streaming',
      }],
      streamingIds: ['qa-1'],
    })
    const { rerender } = render(<InterviewOverlay />)
    const scroller = document.querySelector('.ov-focus-content') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true })
    scroller.scrollTop = 120
    fireEvent.scroll(scroller)

    fireEvent.click(screen.getAllByText('解题思路')[0])

    act(() => {
      useInterviewStore.setState({
        qaPairs: [{
          ...qa,
          answer: '## 解题思路\n先说思路。\n\n## 代码解决方案\n正在写代码。\n继续生成。',
          status: 'streaming',
        }],
        streamingIds: ['qa-1'],
      })
    })
    rerender(<InterviewOverlay />)

    expect(scroller.scrollTop).toBe(1000)
  })

  it('formats markdown in the regular overlay modes', () => {
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 回答要点\n- 使用双指针\n\n```ts\nconst total = 0\n```',
      }],
    })

    render(<InterviewOverlay />)

    expect(screen.getByRole('heading', { name: '回答要点' })).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('使用双指针')
    expect(screen.getByText('const total = 0')).toBeInTheDocument()
    expect(screen.queryByText(/## 回答要点/)).not.toBeInTheDocument()
  })

  it('marks overlay code blocks for soft wrapping in prompt mode', () => {
    const longLine = `const result = ${'veryLongIdentifier'.repeat(16)}`
    useUiPrefsStore.setState({ interviewOverlayMode: 'prompt', interviewOverlayShowBg: false })
    localStorage.setItem('ia_overlay_mode', 'prompt')
    localStorage.setItem('ia_overlay_show_bg', '0')
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: `\`\`\`ts\n${longLine}\n\`\`\``,
      }],
    })

    render(<InterviewOverlay />)

    const codeBlock = document.querySelector('.ov-code-block')
    expect(codeBlock).toBeInTheDocument()
    expect(codeBlock).toHaveTextContent(longLine)
    expect(codeBlock?.querySelector('.ov-code.language-ts')).toBeInTheDocument()
  })

  it('renders focus overlay mode with visual toolbar and tabs', () => {
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(screen.getByText('截图审题')).toBeInTheDocument()
    expect(screen.getByText('取消生成')).toBeInTheDocument()
    expect(screen.getAllByText('结论').length).toBeGreaterThan(0)
    expect(screen.getByText('切换分区')).toBeInTheDocument()
    expect(screen.getByText('切换题目')).toBeInTheDocument()
    expect(screen.getByText(/双指针维护左右最大高度/)).toBeInTheDocument()
    expect(document.querySelector('.ov-shell--focus')).toBeInTheDocument()
  })

  it('uses a readable dark text color in focus mode regardless of the regular overlay font color', () => {
    useInterviewStore.setState({
      qaPairs: [{ ...qa, answer: '## 结论\n浅色用户字体不应该影响专注面板。' }],
    })
    useUiPrefsStore.setState({
      interviewOverlayMode: 'focus',
      interviewOverlayShowBg: true,
      interviewOverlayFontColor: '#e2e8f0',
    })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')
    localStorage.setItem('ia_overlay_max_lines', '2')

    render(<InterviewOverlay />)

    expect(document.querySelector('.ov-focus-content')).toHaveStyle({ color: '#263241' })
  })

  it('renders model-provided markdown sections as dynamic focus tabs', () => {
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        question: 'CAP 理论怎么回答？',
        answer: '## 多元答案\n可以从一致性和可用性两条线回答。\n\n## 识别修正\n如果 ASR 把 CAP 识别成 cache，需要切回分布式理论。',
      }],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(screen.getAllByText('多元答案').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('识别修正')[0])
    expect(screen.getByRole('heading', { name: '识别修正' })).toBeInTheDocument()
    expect(screen.getByText(/ASR 把 CAP 识别成 cache/)).toBeInTheDocument()
  })

  it('uses model-provided self introduction tabs instead of forcing code buckets', () => {
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        question: '请介绍一下自己',
        answer: '## 核心背景\n我是后端开发方向。\n\n## 项目亮点\n最近做过推荐系统改造。\n\n## 追问准备\n可以展开讲性能优化。',
      }],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(screen.getAllByText('核心背景').length).toBeGreaterThan(0)
    expect(screen.getByText('项目亮点')).toBeInTheDocument()
    expect(screen.getByText('追问准备')).toBeInTheDocument()
    expect(screen.queryByText('代码')).not.toBeInTheDocument()
    expect(screen.queryByText('复杂度')).not.toBeInTheDocument()
  })

  it('keeps the model preamble before the first markdown section', () => {
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '先给结论：用双指针一次遍历。\n\n## 解题思路\n维护左右最大值。',
      }],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(screen.getAllByText('结论').length).toBeGreaterThan(0)
    expect(screen.getByText(/先给结论/)).toBeInTheDocument()
  })

  it('switches dynamic focus tabs from the Electron focus-tab command', async () => {
    let tabListener: ((direction: 'prev' | 'next') => void) | null = null
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      onFocusTabCommand: (listener: (direction: 'prev' | 'next') => void) => {
        tabListener = listener
        return vi.fn()
      },
    }
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 解题思路\n双指针。\n\n## 代码解决方案\n```python\nreturn 0\n```',
      }],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(screen.getByText(/双指针/)).toBeInTheDocument()
    act(() => { tabListener?.('next') })
    expect(await screen.findByText(/return 0/)).toBeInTheDocument()
  })

  it('keeps the active focus tab stable when a streaming heading label changes', async () => {
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 解题思路\n先说思路。\n\n## 代码\nreturn 1',
      }],
      streamingIds: ['qa-1'],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    const { rerender } = render(<InterviewOverlay />)

    fireEvent.click(screen.getAllByText('代码')[0])
    expect(screen.getByText(/return 1/)).toBeInTheDocument()

    act(() => {
      useInterviewStore.setState({
        qaPairs: [{
          ...qa,
          answer: '## 解题思路\n先说思路。\n\n## 代码解决方案\nreturn 1\nreturn 2',
        }],
        streamingIds: ['qa-1'],
      })
    })
    rerender(<InterviewOverlay />)

    expect(await screen.findByRole('heading', { name: '代码解决方案' })).toBeInTheDocument()
    expect(screen.getByText(/return 2/)).toBeInTheDocument()
    expect(screen.queryByText(/先说思路/)).not.toBeInTheDocument()
  })

  it('reviews previous and next questions from the overlay question command without changing generation', async () => {
    let questionListener: ((direction: 'prev' | 'next') => void) | null = null
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      onOverlayQuestionCommand: (listener: (direction: 'prev' | 'next') => void) => {
        questionListener = listener
        return vi.fn()
      },
    }
    useInterviewStore.setState({
      qaPairs: [
        { ...qa, id: 'qa-1', question: '第一题', answer: '第一题答案。' },
        { ...qa, id: 'qa-2', question: '第二题', answer: '第二题正在生成。', status: 'streaming' },
      ],
      streamingIds: ['qa-2'],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'glass', interviewOverlayShowBg: true })

    render(<InterviewOverlay />)

    expect(screen.getByText(/第二题正在生成/)).toBeInTheDocument()
    act(() => { questionListener?.('prev') })
    expect(await screen.findByText(/第一题答案/)).toBeInTheDocument()
    expect(useInterviewStore.getState().streamingIds).toEqual(['qa-2'])
    act(() => { questionListener?.('next') })
    expect(await screen.findByText(/第二题正在生成/)).toBeInTheDocument()
  })

  it('keeps the streaming question focus tab isolated while reviewing history', async () => {
    let questionListener: ((direction: 'prev' | 'next') => void) | null = null
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      onOverlayQuestionCommand: (listener: (direction: 'prev' | 'next') => void) => {
        questionListener = listener
        return vi.fn()
      },
    }
    useInterviewStore.setState({
      qaPairs: [
        {
          ...qa,
          id: 'qa-1',
          question: '第一题',
          answer: '## 多元答案\n历史回答。\n\n## 识别修正\n历史纠错。',
        },
        {
          ...qa,
          id: 'qa-2',
          question: '第二题代码',
          answer: '## 解题思路\n当前思路。\n\n## 代码解决方案\n正在写代码。',
          status: 'streaming',
        },
      ],
      streamingIds: ['qa-2'],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(screen.getByText(/正在写代码/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('解题思路')[0])
    expect(screen.getByText(/当前思路/)).toBeInTheDocument()

    act(() => { questionListener?.('prev') })
    expect(await screen.findByText(/历史回答/)).toBeInTheDocument()
    expect(screen.getByText('新答案生成中')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('识别修正')[0])
    expect(screen.getByText(/历史纠错/)).toBeInTheDocument()

    act(() => { questionListener?.('next') })
    expect(await screen.findByText(/当前思路/)).toBeInTheDocument()
    expect(useInterviewStore.getState().streamingIds).toEqual(['qa-2'])
  })

  it('keeps tab state for older questions that are still generating in parallel', async () => {
    let questionListener: ((direction: 'prev' | 'next') => void) | null = null
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      onOverlayQuestionCommand: (listener: (direction: 'prev' | 'next') => void) => {
        questionListener = listener
        return vi.fn()
      },
    }
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        id: 'qa-1',
        question: '第一题代码',
        answer: '## 解题思路\n旧题思路。\n\n## 代码解决方案\nreturn 1\n\n## 复杂度与测试\nO(n)',
        status: 'streaming',
      }],
      streamingIds: ['qa-1'],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    const { rerender } = render(<InterviewOverlay />)
    fireEvent.click(screen.getAllByText('代码解决方案')[0])
    expect(screen.getByText(/return 1/)).toBeInTheDocument()

    const manyQaPairs = [
      useInterviewStore.getState().qaPairs[0],
      ...Array.from({ length: 24 }, (_, index) => ({
        ...qa,
        id: `qa-${index + 2}`,
        question: `第 ${index + 2} 题`,
        answer: index === 23 ? '最新题正在生成。' : `第 ${index + 2} 题答案。`,
        status: index === 23 ? 'streaming' as const : 'done' as const,
      })),
    ]
    useInterviewStore.setState({
      qaPairs: manyQaPairs,
      streamingIds: ['qa-1', 'qa-25'],
    })
    rerender(<InterviewOverlay />)
    expect(screen.getByText(/return 1/)).toBeInTheDocument()
    expect(screen.queryByText(/最新题正在生成/)).not.toBeInTheDocument()

    act(() => {
      for (let i = 0; i < 24; i += 1) questionListener?.('next')
    })
    expect(await screen.findByText(/最新题正在生成/)).toBeInTheDocument()

    act(() => {
      for (let i = 0; i < 24; i += 1) questionListener?.('prev')
    })

    expect(await screen.findByText(/return 1/)).toBeInTheDocument()
    expect(screen.queryByText(/^O\(n\)$/)).not.toBeInTheDocument()
  })

  it('marks the latest streamed tab as forming while the model is still generating', () => {
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 解题思路\n正在分析。\n\n## 代码解决方案\n',
      }],
      streamingIds: ['qa-1'],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(document.querySelector('.ov-focus-tab--forming')).toBeInTheDocument()
  })

  it('shows an omission hint when focus content is limited by max lines', () => {
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 详细说明\n第一行\n第二行\n第三行\n第四行',
      }],
    })
    useUiPrefsStore.setState({
      interviewOverlayMode: 'focus',
      interviewOverlayShowBg: true,
      interviewOverlayMaxLines: 2,
    })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')
    localStorage.setItem('ia_overlay_max_lines', '2')

    render(<InterviewOverlay />)

    expect(screen.getByText('…以上内容已省略')).toBeInTheDocument()
    expect(screen.queryByText('第一行')).not.toBeInTheDocument()
    expect(screen.getByText(/第三行/)).toBeInTheDocument()
    expect(screen.getByText(/第四行/)).toBeInTheDocument()
  })

  it('auto-follows the latest streamed tab until the user manually pins a tab', () => {
    const { rerender } = render(<InterviewOverlay />)
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 解题思路\n先说思路。\n\n## 代码解决方案\n正在写代码。',
      }],
      streamingIds: ['qa-1'],
    })

    rerender(<InterviewOverlay />)

    expect(screen.getByText(/正在写代码/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('解题思路')[0])
    expect(screen.getByText(/先说思路/)).toBeInTheDocument()

    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 解题思路\n先说思路。\n\n## 代码解决方案\n正在写代码。\n\n## 复杂度与测试\n继续生成。',
      }],
      streamingIds: ['qa-1'],
    })
    rerender(<InterviewOverlay />)

    expect(screen.getByText(/先说思路/)).toBeInTheDocument()
  })

  it('loads user shortcut settings in the overlay window before rendering shortcut hints', async () => {
    let shortcutsListener: ((payload: Record<string, Record<string, unknown>>) => void) | null = null
    const getShortcuts = vi.fn().mockResolvedValue({
      askFromServerScreen: { key: 'CommandOrControl+Shift+9' },
      cancelAnswer: { key: 'CommandOrControl+Escape' },
      hardClearSession: { key: 'CommandOrControl+Shift+8' },
      toggleInterviewOverlay: { key: 'CommandOrControl+Shift+7' },
      focusPrevTab: { key: 'CommandOrControl+Shift+[' },
      focusNextTab: { key: 'CommandOrControl+Shift+]' },
      overlayPrevQuestion: { key: 'CommandOrControl+Shift+Up' },
      overlayNextQuestion: { key: 'CommandOrControl+Shift+Down' },
    })
    const onShortcuts = vi.fn((listener: (payload: Record<string, Record<string, unknown>>) => void) => {
      shortcutsListener = listener
      return vi.fn()
    })
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { getShortcuts, onShortcuts }
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    await waitFor(() => expect(getShortcuts).toHaveBeenCalled())
    await waitFor(() => {
      expect(useShortcutsStore.getState().shortcuts.askFromServerScreen.key).toBe('CommandOrControl+Shift+9')
    })
    expect(await screen.findByText((text, element) => element?.tagName.toLowerCase() === 'kbd' && /9$/.test(text))).toBeInTheDocument()
    expect(screen.getByText((text, element) => element?.tagName.toLowerCase() === 'kbd' && text === 'Ctrl+Esc')).toBeInTheDocument()
    expect(screen.getByText((text, element) => element?.tagName.toLowerCase() === 'kbd' && text === 'Ctrl+Shift+[')).toBeInTheDocument()
    expect(screen.getByText((text, element) => element?.tagName.toLowerCase() === 'kbd' && text === 'Ctrl+Shift+]')).toBeInTheDocument()
    expect(screen.getByText((text, element) => element?.tagName.toLowerCase() === 'kbd' && text === 'Ctrl+Shift+↑')).toBeInTheDocument()
    expect(screen.getByText((text, element) => element?.tagName.toLowerCase() === 'kbd' && text === 'Ctrl+Shift+↓')).toBeInTheDocument()
    expect(onShortcuts).toHaveBeenCalled()

    act(() => {
      shortcutsListener?.({ askFromServerScreen: { key: 'CommandOrControl+Shift+6' } })
    })
    expect(await screen.findByText((text, element) => element?.tagName.toLowerCase() === 'kbd' && /6$/.test(text))).toBeInTheDocument()
  })
})
