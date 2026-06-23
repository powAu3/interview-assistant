import type { OverlayStatePayload } from '@/lib/interviewOverlay'

export {}

declare global {
  interface Window {
    electronAPI?: {
    hideWindow: () => Promise<void>
    minimizeWindow: () => Promise<void>
    quitApp: () => Promise<void>
    showWindow: () => Promise<void>
      getShortcuts: () => Promise<Record<string, { action: string; key: string; defaultKey: string; label: string; category: string; status?: string }>>
      updateShortcuts: (shortcuts: Array<{ action: string; key: string }>) => Promise<{ ok: boolean; error?: string; shortcuts: Record<string, unknown> }>
      resetShortcuts: () => Promise<{ ok: boolean; error?: string; shortcuts: Record<string, unknown> }>
      toggleAlwaysOnTop: () => Promise<boolean>
      toggleContentProtection: () => Promise<boolean>
      getWindowState: () => Promise<{ alwaysOnTop: boolean; contentProtection: boolean; visible: boolean }>
      syncOverlayWindow?: (payload: Partial<OverlayStatePayload> & { visible?: boolean }) => Promise<{ ok: boolean; visible: boolean }>
      resizeOverlayWindow?: (payload: { width?: number; height?: number }) => Promise<{ ok: boolean; width?: number; height?: number; skipped?: boolean }>
      destroyOverlay?: () => Promise<{ ok: boolean }>
      moveOverlayWindow?: (dx: number, dy: number) => Promise<void>
      overlayDragStart?: () => void
      overlayDragEnd?: () => void
      getOverlayState?: () => Promise<(OverlayStatePayload & { visible: boolean }) | null>
      onOverlayState?: (callback: (payload: OverlayStatePayload) => void) => (() => void)
      onShortcuts?: (callback: (payload: Record<string, Record<string, unknown>> | undefined) => void) => (() => void)
      onFocusTabCommand?: (callback: (direction: 'prev' | 'next') => void) => (() => void)
      onOverlayQuestionCommand?: (callback: (direction: 'prev' | 'next') => void) => (() => void)
      removeOverlayStateListener?: (listener?: (...args: unknown[]) => void) => void
    }
  }
}
