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

  it('renders focus overlay mode with visual toolbar and tabs', () => {
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(screen.getByText('截图审题')).toBeInTheDocument()
    expect(screen.getByText('取消生成')).toBeInTheDocument()
    expect(screen.getAllByText('结论').length).toBeGreaterThan(0)
    expect(screen.getByText(/双指针维护左右最大高度/)).toBeInTheDocument()
    expect(document.querySelector('.ov-shell--focus')).toBeInTheDocument()
  })

  it('renders model-provided markdown sections as dynamic focus tabs', () => {
    useInterviewStore.setState({
      qaPairs: [{
        ...qa,
        answer: '## 多元答案\n可以从一致性和可用性两条线回答。\n\n## 识别修正\n如果 ASR 把 CAP 识别成 cache，需要切回分布式理论。',
      }],
    })
    useUiPrefsStore.setState({ interviewOverlayMode: 'focus', interviewOverlayShowBg: true })
    localStorage.setItem('ia_overlay_mode', 'focus')
    localStorage.setItem('ia_overlay_show_bg', '1')

    render(<InterviewOverlay />)

    expect(screen.getAllByText('多元答案').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('识别修正')[0])
    expect(screen.getByText(/ASR 把 CAP 识别成 cache/)).toBeInTheDocument()
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

    expect(screen.getByText('双指针。')).toBeInTheDocument()
    act(() => { tabListener?.('next') })
    expect(await screen.findByText(/return 0/)).toBeInTheDocument()
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
      hardClearSession: { key: 'CommandOrControl+Shift+8' },
      toggleInterviewOverlay: { key: 'CommandOrControl+Shift+7' },
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
    expect(onShortcuts).toHaveBeenCalled()

    act(() => {
      shortcutsListener?.({ askFromServerScreen: { key: 'CommandOrControl+Shift+6' } })
    })
    expect(await screen.findByText((text, element) => element?.tagName.toLowerCase() === 'kbd' && /6$/.test(text))).toBeInTheDocument()
  })
})
