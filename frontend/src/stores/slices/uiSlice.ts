import type { StateCreator } from 'zustand'
import type { RootState } from './rootState'
import type { SettingsDrawerTab, ToastItem, ToastLevel } from './types'

const TOAST_DEFAULT_TTL: Record<ToastLevel, number> = {
  info: 2200,
  success: 2200,
  warn: 3200,
  error: 4500,
}

/**
 * 根据消息文本启发式推断等级，让老代码 setToastMessage('xxx失败') 也能自动标红。
 * 词表偏保守：仅匹配明显的失败/成功信号，避免「不能」「无效」等中性词误伤。
 * 新代码建议直接用 pushToast(msg, level) 显式传等级。
 */
function inferToastLevel(msg: string): ToastLevel {
  const s = (msg || '').toLowerCase()
  if (/失败|错误|未配置|未连接|已中断|超时|error\b|\bfail(ed)?\b|denied|refused/.test(s)) return 'error'
  if (/警告|风险|注意|warn(ing)?/.test(s)) return 'warn'
  if (/已保存|已更新|成功|已恢复|已开启|已关闭|已切换|已解析|已连通|success/.test(s)) return 'success'
  return 'info'
}

export interface UiSliceState {
  settingsOpen: boolean
  /** 抽屉内标签：设置 = 常用；配置 = VAD/LLM 等；模型 = 模型 CRUD */
  settingsDrawerTab: SettingsDrawerTab
  fallbackToast: { from: string; to: string; reason: string } | null
  toastMessage: string | null
  /** 堆叠的 toast 列表；setToastMessage 会同步推入，便于并发多条提示不互相覆盖 */
  toasts: ToastItem[]
  lastWSError: string | null
  wsConnected: boolean
  wsIsLeader: boolean
}

export interface UiSliceActions {
  toggleSettings: () => void
  openConfigDrawer: () => void
  openModelsDrawer: () => void
  setSettingsDrawerTab: (tab: SettingsDrawerTab) => void
  setFallbackToast: (toast: { from: string; to: string; reason: string } | null) => void
  setToastMessage: (msg: string | null) => void
  /** 推入一条带分级的 toast；level 默认 info；ttlMs 默认由 level 决定（error 更长） */
  pushToast: (msg: string, level?: ToastLevel, ttlMs?: number) => string
  dismissToast: (id: string) => void
  setLastWSError: (msg: string | null) => void
  setWsConnected: (v: boolean) => void
  setWsIsLeader: (v: boolean) => void
}

export type UiSlice = UiSliceState & UiSliceActions

export const createUiSlice: StateCreator<RootState, [], [], UiSlice> = (set) => ({
  settingsOpen: false,
  settingsDrawerTab: 'general',
  fallbackToast: null,
  toastMessage: null,
  toasts: [],
  lastWSError: null,
  wsConnected: false,
  wsIsLeader: true,

  toggleSettings: () =>
    set((s) => {
      if (s.settingsOpen) return { settingsOpen: false }
      return { settingsOpen: true, settingsDrawerTab: 'general' }
    }),
  openConfigDrawer: () => set({ settingsOpen: true, settingsDrawerTab: 'config' }),
  openModelsDrawer: () => set({ settingsOpen: true, settingsDrawerTab: 'models' }),
  setSettingsDrawerTab: (tab) => set({ settingsDrawerTab: tab }),
  setFallbackToast: (toast) => set({ fallbackToast: toast }),

  setToastMessage: (msg) => {
    if (!msg) {
      set({ toastMessage: null, toasts: [] })
      return
    }
    const level = inferToastLevel(msg)
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((s) => {
      const next = [...s.toasts, { id, message: msg, level, ttlMs: TOAST_DEFAULT_TTL[level] }]
      return {
        toastMessage: msg,
        toasts: next.length > 5 ? next.slice(next.length - 5) : next,
      }
    })
  },

  pushToast: (msg, level = 'info', ttlMs) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((s) => {
      const next = [
        ...s.toasts,
        { id, message: msg, level, ttlMs: ttlMs ?? TOAST_DEFAULT_TTL[level] },
      ]
      return {
        toasts: next.length > 5 ? next.slice(next.length - 5) : next,
        toastMessage: msg,
      }
    })
    return id
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setLastWSError: (msg) => set({ lastWSError: msg }),
  setWsConnected: (v) => set({ wsConnected: v }),
  setWsIsLeader: (v) => set({ wsIsLeader: v }),
})
