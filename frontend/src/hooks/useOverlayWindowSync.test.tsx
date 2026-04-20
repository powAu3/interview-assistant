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
  it('initial sync sends style prefs only (no enabled/visible when off)', () => {
    const api = setupElectronAPI()
    render(<Harness isRecording={false} appMode="assist" />)
    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ opacity: 0.88 }),
    )
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ enabled: expect.anything(), visible: expect.anything() }),
    )
  })

  it('toggling enabled ON only syncs style prefs (no visible: true)', async () => {
    const api = setupElectronAPI()
    render(<Harness isRecording={false} appMode="assist" />)
    api.syncOverlayWindow.mockClear()

    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayEnabled(true)
    })

    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ opacity: expect.any(Number) }),
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
      expect.objectContaining({ opacity: 0.5 }),
    )
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ enabled: expect.anything(), visible: expect.anything() }),
    )
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
