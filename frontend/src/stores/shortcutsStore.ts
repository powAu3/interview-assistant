import { create } from 'zustand'
import {
  defaultShortcuts,
  mergeShortcutConfigs,
  type ShortcutAction,
  type ShortcutConfig,
} from '@/lib/shortcuts'

type ShortcutsState = {
  shortcuts: Record<ShortcutAction, ShortcutConfig>
  setShortcuts: (shortcuts: Record<string, Record<string, unknown>> | undefined) => void
  updateShortcut: (action: ShortcutAction, shortcut: ShortcutConfig) => void
  resetShortcuts: () => void
}

export const useShortcutsStore = create<ShortcutsState>((set) => ({
  shortcuts: defaultShortcuts,
  setShortcuts: (shortcuts) => set({ shortcuts: mergeShortcutConfigs(shortcuts) }),
  updateShortcut: (action, shortcut) =>
    set((state) => ({
      shortcuts: {
        ...state.shortcuts,
        [action]: shortcut,
      },
    })),
  resetShortcuts: () => set({ shortcuts: defaultShortcuts }),
}))
