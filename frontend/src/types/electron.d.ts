import type { OverlayStatePayload } from '@/lib/interviewOverlay'

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
      syncOverlayWindow?: (payload: Partial<OverlayStatePayload>) => Promise<{ ok: boolean; visible: boolean }>
      moveOverlayWindow?: (dx: number, dy: number) => Promise<void>
      overlayDragStart?: () => void
      overlayDragEnd?: () => void
      getOverlayState?: () => Promise<(OverlayStatePayload & { visible: boolean }) | null>
      onOverlayState?: (callback: (payload: OverlayStatePayload) => void) => (() => void)
      removeOverlayStateListener?: (listener?: (...args: unknown[]) => void) => void
    }
  }
}
