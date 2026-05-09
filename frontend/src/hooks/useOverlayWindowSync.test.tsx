import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverlayWindowSync } from './useOverlayWindowSync'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

const noopAsync = () => Promise.resolve()

function setupElectronAPI() {
  const syncOverlayWindow = vi.fn(noopAsync)
  const hideWindow = vi.fn(noopAsync)
  const showWindow = vi.fn(noopAsync)
  const getWindowState = vi.fn(() => Promise.resolve({ visible: false, alwaysOnTop: false, contentProtection: true }))
  const onOverlayState = vi.fn(() => () => {})

  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    syncOverlayWindow,
    hideWindow,
    showWindow,
    getWindowState,
    onOverlayState,
  }

  return { syncOverlayWindow, hideWindow, showWindow, getWindowState, onOverlayState }
}

function Harness({ isRecording, appMode }: { isRecording: boolean; appMode: string }) {
  useOverlayWindowSync(isRecording, appMode)
  return null
}

beforeEach(() => {
  localStorage.clear()
  useUiPrefsStore.setState({
    interviewOverlayEnabled: false,
    interviewOverlayOpacity: 0.88,
    interviewOverlayFontSize: 14,
    interviewOverlayFontColor: '#e2e8f0',
    interviewOverlayShowBg: true,
    interviewOverlayMaxLines: 0,
  })
})

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
  vi.restoreAllMocks()
})

describe('useOverlayWindowSync', () => {
  it('initial sync sends style prefs and persisted enabled=false without visible', () => {
    const api = setupElectronAPI()
    render(<Harness isRecording={false} appMode="assist" />)
    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, opacity: 0.88 }),
    )
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ visible: expect.anything() }),
    )
  })

  it('toggling enabled ON syncs enabled=true and style prefs without visible=true', async () => {
    const api = setupElectronAPI()
    render(<Harness isRecording={false} appMode="assist" />)
    api.syncOverlayWindow.mockClear()

    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayEnabled(true)
    })

    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, opacity: expect.any(Number) }),
    )
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ visible: expect.anything() }),
    )
  })

  it('toggling enabled OFF sends enabled=false visible=false to hide overlay', async () => {
    const api = setupElectronAPI()
    useUiPrefsStore.setState({ interviewOverlayEnabled: true })
    render(<Harness isRecording={false} appMode="assist" />)
    api.syncOverlayWindow.mockClear()

    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayEnabled(false)
    })

    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, visible: false }),
    )
  })

  it('style-only updates (e.g. opacity) sync without enabled/visible', async () => {
    const api = setupElectronAPI()
    useUiPrefsStore.setState({ interviewOverlayEnabled: true })
    render(<Harness isRecording={false} appMode="assist" />)
    api.syncOverlayWindow.mockClear()

    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayOpacity(0.5)
    })

    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, opacity: 0.5 }),
    )
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ visible: expect.anything() }),
    )
  })

  it('applying Electron overlay state persists enabled and valid style prefs without dispatching local sync events', () => {
    const eventSpy = vi.fn()
    window.addEventListener('interview-overlay-prefs-updated', eventSpy)

    act(() => {
      useUiPrefsStore.getState().applyInterviewOverlayState({
        initialized: true,
        enabled: true,
        opacity: 0.42,
        fontSize: 19.6,
        fontColor: '#abcdef',
        showBg: false,
        maxLines: 7.4,
      })
    })

    expect(useUiPrefsStore.getState()).toMatchObject({
      interviewOverlayEnabled: true,
      interviewOverlayOpacity: 0.42,
      interviewOverlayFontSize: 20,
      interviewOverlayFontColor: '#abcdef',
      interviewOverlayShowBg: false,
      interviewOverlayMaxLines: 7,
    })
    expect(localStorage.getItem('ia_overlay_enabled')).toBe('1')
    expect(localStorage.getItem('ia_overlay_opacity')).toBe('0.42')
    expect(localStorage.getItem('ia_overlay_font_size')).toBe('20')
    expect(localStorage.getItem('ia_overlay_font_color')).toBe('#abcdef')
    expect(localStorage.getItem('ia_overlay_show_bg')).toBe('0')
    expect(localStorage.getItem('ia_overlay_max_lines')).toBe('7')
    expect(eventSpy).not.toHaveBeenCalled()

    window.removeEventListener('interview-overlay-prefs-updated', eventSpy)
  })

  it('applying invalid Electron style fields leaves current prefs and storage untouched', () => {
    localStorage.setItem('ia_overlay_font_color', '#123456')
    useUiPrefsStore.setState({ interviewOverlayFontColor: '#123456', interviewOverlayOpacity: 0.7 })

    act(() => {
      useUiPrefsStore.getState().applyInterviewOverlayState({
        initialized: true,
        enabled: true,
        opacity: Number.NaN,
        fontSize: Number.POSITIVE_INFINITY,
        fontColor: 'red',
        showBg: false,
        maxLines: Number.NaN,
      })
    })

    expect(useUiPrefsStore.getState()).toMatchObject({
      interviewOverlayEnabled: true,
      interviewOverlayOpacity: 0.7,
      interviewOverlayFontColor: '#123456',
      interviewOverlayShowBg: false,
    })
    expect(localStorage.getItem('ia_overlay_font_color')).toBe('#123456')
    expect(localStorage.getItem('ia_overlay_opacity')).toBeNull()
  })

  it('syncInterviewOverlayPrefs restores persisted enabled with style prefs', () => {
    localStorage.setItem('ia_overlay_enabled', '1')
    localStorage.setItem('ia_overlay_opacity', '0.61')
    useUiPrefsStore.setState({ interviewOverlayEnabled: false, interviewOverlayOpacity: 0.88 })

    act(() => {
      useUiPrefsStore.getState().syncInterviewOverlayPrefs()
    })

    expect(useUiPrefsStore.getState()).toMatchObject({
      interviewOverlayEnabled: true,
      interviewOverlayOpacity: 0.61,
    })
  })

  it('前端 hook 不再 fire hideWindow/showWindow IPC', async () => {
    const api = setupElectronAPI()
    const { rerender } = render(<Harness isRecording={false} appMode="assist" />)
    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayEnabled(true)
    })
    rerender(<Harness isRecording={true} appMode="assist" />)
    await act(async () => {})

    expect(api.hideWindow).not.toHaveBeenCalled()

    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayEnabled(false)
    })
    rerender(<Harness isRecording={false} appMode="assist" />)
    await act(async () => {})

    expect(api.showWindow).not.toHaveBeenCalled()
  })
})
