export {}

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
      syncOverlayWindow?: (payload: {
        enabled: boolean
        visible: boolean
        mode: 'panel' | 'lyrics'
        opacity: number
        lyricLines: number
        lyricFontSize: number
        lyricWidth: number
      }) => Promise<{ ok: boolean; visible: boolean }>
      getOverlayState?: () => Promise<{
        enabled: boolean
        visible: boolean
        mode: 'panel' | 'lyrics'
        opacity: number
        lyricLines: number
        lyricFontSize: number
        lyricWidth: number
      } | null>
      onOverlayState?: (callback: (payload: {
        enabled: boolean
        visible: boolean
        mode: 'panel' | 'lyrics'
        opacity: number
        lyricLines: number
        lyricFontSize: number
        lyricWidth: number
      }) => void) => void
      removeOverlayStateListener?: () => void
    }
  }
}
