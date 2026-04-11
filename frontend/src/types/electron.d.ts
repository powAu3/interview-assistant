export {}

interface OverlayPayload {
  enabled: boolean
  visible: boolean
  mode: 'panel' | 'lyrics'
  opacity: number
  panelFontSize: number
  panelWidth: number
  panelShowBg: boolean
  panelFontColor: string
  panelHeight: number
  lyricLines: number
  lyricFontSize: number
  lyricWidth: number
  lyricColor: string
}

declare global {
  interface Window {
    electronAPI?: {
      hideWindow: () => Promise<void>
      showWindow: () => Promise<void>
      getShortcuts: () => Promise<Record<string, { action: string; key: string; defaultKey: string; label: string; category: string; status?: string }>>
      updateShortcuts: (shortcuts: Array<{ action: string; key: string }>) => Promise<{ ok: boolean; error?: string; shortcuts: Record<string, unknown> }>
      resetShortcuts: () => Promise<{ ok: boolean; error?: string; shortcuts: Record<string, unknown> }>
      toggleAlwaysOnTop: () => Promise<boolean>
      toggleContentProtection: () => Promise<boolean>
      getWindowState: () => Promise<{ alwaysOnTop: boolean; contentProtection: boolean; visible: boolean }>
      syncOverlayWindow?: (payload: OverlayPayload) => Promise<{ ok: boolean; visible: boolean }>
      getOverlayState?: () => Promise<OverlayPayload | null>
      onOverlayState?: (callback: (payload: OverlayPayload) => void) => void
      removeOverlayStateListener?: () => void
    }
  }
}
