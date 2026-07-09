import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PreferencesTab from './PreferencesTab'
import { updateConfigAndRefresh } from '@/lib/configSync'
import { prepareExamOverlayPrompt } from '@/lib/examOverlay'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

vi.mock('@/lib/configSync', () => ({
  updateConfigAndRefresh: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/examOverlay', () => ({
  prepareExamOverlayPrompt: vi.fn(),
}))

describe('PreferencesTab', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    localStorage.clear()
    vi.mocked(updateConfigAndRefresh).mockReset()
    vi.mocked(updateConfigAndRefresh).mockResolvedValue({ ok: true } as any)
    vi.mocked(prepareExamOverlayPrompt).mockClear()
    useInterviewStore.setState({
      config: {
        stt_provider: 'whisper',
        screen_capture_region: 'left_half',
        screen_capture_max_long_edge: 1600,
        multi_screen_capture_idle_sec: 10,
        written_exam_mode: false,
        written_exam_think: false,
        kb_top_k: 4,
      },
      options: {
        screen_capture_regions: ['full', 'left_half', 'right_half'],
      },
      platformInfo: null,
      sttLoaded: true,
      sttLoading: false,
      sttActiveProvider: 'whisper',
      sttFallbackLoaded: false,
    } as any)
    useUiPrefsStore.setState({
      interviewOverlayEnabled: false,
      interviewOverlayMode: 'glass',
      interviewOverlayShowBg: true,
      interviewOverlayPromptMaxWidth: 900,
      interviewOverlayPromptAutoFollow: false,
    })
  })

  it('exposes the screen capture long-edge limit', async () => {
    render(<PreferencesTab />)

    expect(screen.getByText('自动保存')).toBeInTheDocument()
    fireEvent.click(screen.getByText('工作模式'))
    expect(screen.getByText('截图最长边: 1600px')).toBeInTheDocument()
    const input = screen.getByDisplayValue('1600')

    fireEvent.change(input, { target: { value: '2400' } })

    await waitFor(() => {
      expect(updateConfigAndRefresh).toHaveBeenCalledWith({ screen_capture_max_long_edge: 2400 })
    })
  })

  it('saves answer length choices immediately from common preferences', async () => {
    render(<PreferencesTab />)

    fireEvent.click(screen.getByRole('button', { name: /简短回答/ }))

    await waitFor(() => {
      expect(updateConfigAndRefresh).toHaveBeenCalledWith({ assist_high_churn_short_answer: true })
    })
  })

  it('allows zero to disable screen capture scaling', async () => {
    render(<PreferencesTab />)

    fireEvent.click(screen.getByText('工作模式'))
    fireEvent.change(screen.getByDisplayValue('1600'), { target: { value: '0' } })

    await waitFor(() => {
      expect(updateConfigAndRefresh).toHaveBeenCalledWith({ screen_capture_max_long_edge: 0 })
    })
  })

  it('merges multiple debounced preference edits into one save payload', async () => {
    vi.useFakeTimers()
    render(<PreferencesTab />)

    fireEvent.click(screen.getByText('工作模式'))
    fireEvent.change(screen.getByDisplayValue('1600'), { target: { value: '2400' } })
    fireEvent.click(screen.getByText('知识库与引用'))
    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '6' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(updateConfigAndRefresh).toHaveBeenCalledWith({
      screen_capture_max_long_edge: 2400,
      kb_top_k: 6,
    })
    expect(updateConfigAndRefresh).toHaveBeenCalledTimes(1)
  })

  it('auto-saves knowledge retrieval deadlines from preferences', async () => {
    vi.useFakeTimers()
    render(<PreferencesTab />)

    fireEvent.click(screen.getByText('知识库与引用'))
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '220' } })
    fireEvent.change(screen.getByDisplayValue('80'), { target: { value: '60' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(updateConfigAndRefresh).toHaveBeenCalledWith({
      kb_deadline_ms: 220,
      kb_asr_deadline_ms: 60,
    })
  })

  it('serializes immediate auto-save writes so older requests cannot finish last', async () => {
    let resolveFirst: ((value: unknown) => void) | null = null
    const firstSave = new Promise((resolve) => {
      resolveFirst = resolve
    })
    vi.mocked(updateConfigAndRefresh)
      .mockImplementationOnce(() => firstSave as any)
      .mockResolvedValue({ ok: true } as any)

    render(<PreferencesTab />)

    fireEvent.click(screen.getByRole('button', { name: /简短回答/ }))
    await waitFor(() => {
      expect(updateConfigAndRefresh).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: /详细回答/ }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(updateConfigAndRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      if (!resolveFirst) throw new Error('first save resolver was not captured')
      resolveFirst({ ok: true })
      await firstSave
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(updateConfigAndRefresh).toHaveBeenCalledTimes(2)
    })
    expect(updateConfigAndRefresh).toHaveBeenLastCalledWith({ assist_high_churn_short_answer: false })
  })

  it('flushes pending auto-save edits when unmounted before debounce fires', async () => {
    vi.useFakeTimers()
    const { unmount } = render(<PreferencesTab />)

    fireEvent.click(screen.getByText('工作模式'))
    fireEvent.change(screen.getByDisplayValue('1600'), { target: { value: '2400' } })
    unmount()

    await act(async () => {
      await Promise.resolve()
    })

    expect(updateConfigAndRefresh).toHaveBeenCalledWith({ screen_capture_max_long_edge: 2400 })
  })

  it('does not prepare exam overlay prompt when enabling exam mode save fails', async () => {
    vi.mocked(updateConfigAndRefresh).mockRejectedValueOnce(new Error('save failed'))
    render(<PreferencesTab />)

    fireEvent.click(screen.getByText('工作模式'))
    fireEvent.click(screen.getAllByText('笔试模式')[0])

    await waitFor(() => {
      expect(updateConfigAndRefresh).toHaveBeenCalledWith({ written_exam_mode: true })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(prepareExamOverlayPrompt).not.toHaveBeenCalled()
  })

  it('lets prompt mode opt into auto-follow from local overlay preferences', () => {
    useUiPrefsStore.setState({
      interviewOverlayEnabled: true,
      interviewOverlayMode: 'prompt',
      interviewOverlayShowBg: false,
      interviewOverlayPromptAutoFollow: false,
    })
    render(<PreferencesTab />)

    fireEvent.click(screen.getByText('工作模式'))
    const toggle = screen.getByLabelText('靠近底部时自动跟随最新内容') as HTMLInputElement
    expect(toggle.checked).toBe(false)

    fireEvent.click(toggle)

    expect(useUiPrefsStore.getState().interviewOverlayPromptAutoFollow).toBe(true)
    expect(localStorage.getItem('ia_overlay_prompt_auto_follow')).toBe('1')
  })
})
