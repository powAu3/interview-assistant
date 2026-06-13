import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { prepareExamOverlayPrompt, showExamOverlayPrompt } from './examOverlay'

describe('examOverlay', () => {
  beforeEach(() => {
    localStorage.clear()
    ;(window as any).electronAPI = {
      syncOverlayWindow: vi.fn().mockResolvedValue(undefined),
    }
    useUiPrefsStore.setState({
      interviewOverlayEnabled: false,
      interviewOverlayMode: 'glass',
      interviewOverlayShowBg: true,
      interviewOverlayOpacity: 0.88,
      interviewOverlayFontSize: 14,
      interviewOverlayFontColor: '#e2e8f0',
      interviewOverlayFocusWidthPct: 96,
      interviewOverlayFocusHeightPct: 90,
      interviewOverlayMaxLines: 0,
    })
  })

  it('prepares written exam overlay prefs without showing the window', () => {
    prepareExamOverlayPrompt()

    expect(useUiPrefsStore.getState().interviewOverlayEnabled).toBe(true)
    expect(useUiPrefsStore.getState().interviewOverlayMode).toBe('prompt')
    expect(window.electronAPI?.syncOverlayWindow).not.toHaveBeenCalled()
  })

  it('shows the prompt overlay when written exam actually starts', () => {
    showExamOverlayPrompt()

    expect(window.electronAPI?.syncOverlayWindow).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      visible: true,
      mode: 'prompt',
      showBg: false,
    }))
  })
})
