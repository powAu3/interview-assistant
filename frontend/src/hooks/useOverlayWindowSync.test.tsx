import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverlayWindowSync } from './useOverlayWindowSync'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

// 防止 isRecording / appMode 变化触发的主窗口 hide/show 调用对断言造成噪音。
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
  // 重置 zustand store: 关键是 enabled 默认 false (本测试要观察 false → true 的迁移)
  useUiPrefsStore.setState({
    interviewOverlayEnabled: false,
    interviewOverlayMode: 'panel',
    interviewOverlayOpacity: 0.82,
    interviewOverlayPanelFontSize: 13,
    interviewOverlayPanelWidth: 420,
    interviewOverlayPanelShowBg: true,
    interviewOverlayPanelFontColor: '#ffffff',
    interviewOverlayPanelHeight: 0,
    interviewOverlayLyricLines: 2,
    interviewOverlayLyricFontSize: 23,
    interviewOverlayLyricWidth: 760,
    interviewOverlayLyricColor: '#ffffff',
  })
})

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
  vi.restoreAllMocks()
})

describe('useOverlayWindowSync', () => {
  it('initial sync passes the enabled / visible flags to main process', () => {
    const api = setupElectronAPI()
    render(<Harness isRecording={false} appMode="assist" />)
    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    // 修复前回归：payload 完全没有 enabled 字段，导致 main 始终视为 disabled。
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, visible: false, mode: 'panel' }),
    )
  })

  it('toggling enabled re-syncs to main with enabled=true (regression: 71ad03d)', async () => {
    const api = setupElectronAPI()
    render(<Harness isRecording={false} appMode="assist" />)
    api.syncOverlayWindow.mockClear()

    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayEnabled(true)
    })

    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    // 关键回归断言：用户在 Preferences UI toggle on 时，必须把 enabled=true 送到 main，
    // 否则 overlay 窗口永远不会被创建 (当前 bug：main 用 lastOverlayState.enabled 默认 false)。
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, visible: true }),
    )
  })

  it('style-only updates (e.g. opacity) still sync, carrying current enabled', async () => {
    const api = setupElectronAPI()
    useUiPrefsStore.setState({ interviewOverlayEnabled: true })
    render(<Harness isRecording={false} appMode="assist" />)
    api.syncOverlayWindow.mockClear()

    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayOpacity(0.5)
    })

    expect(api.syncOverlayWindow).toHaveBeenCalledTimes(1)
    expect(api.syncOverlayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ opacity: 0.5, enabled: true }),
    )
  })

  it('does NOT auto-hide / restore main window — Cmd+O and Cmd+B are orthogonal (2026-04-17 decoupled)', async () => {
    const api = setupElectronAPI()
    // 模拟「正在录制 + assist 模式 + overlay 启用」三件齐备 — 这就是修复前会触发 hideWindow 的全部条件。
    const { rerender } = render(<Harness isRecording={false} appMode="assist" />)
    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayEnabled(true)
    })
    rerender(<Harness isRecording={true} appMode="assist" />)
    // 多 tick 等待任何潜在的 promise 链
    await act(async () => {})

    // 关键：拆耦之后，main 窗口的显隐归 Cmd+B 管，overlay 启用绝对不能动 main 窗口。
    expect(api.hideWindow).not.toHaveBeenCalled()

    // 反向：disable overlay 也不能恢复 main（之前的 mainHiddenByOverlayRef 路径已删除）
    await act(async () => {
      useUiPrefsStore.getState().setInterviewOverlayEnabled(false)
    })
    rerender(<Harness isRecording={false} appMode="assist" />)
    await act(async () => {})

    expect(api.showWindow).not.toHaveBeenCalled()
  })
})
