export type ShortcutAction = 'hideOrShowWindow' | 'hardClearSession' | 'askFromServerScreen'
export type ShortcutStatus = 'registered' | 'failed' | 'available'

export type ShortcutConfig = {
  action: ShortcutAction
  key: string
  defaultKey: string
  label: string
  category: string
  status?: ShortcutStatus
}

export const defaultShortcuts: Record<ShortcutAction, ShortcutConfig> = {
  hideOrShowWindow: {
    action: 'hideOrShowWindow',
    key: 'CommandOrControl+B',
    defaultKey: 'CommandOrControl+B',
    label: '隐藏/显示窗口',
    category: '窗口',
    status: 'available',
  },
  hardClearSession: {
    action: 'hardClearSession',
    key: 'CommandOrControl+.',
    defaultKey: 'CommandOrControl+.',
    label: '硬清空',
    category: '实时辅助',
    status: 'available',
  },
  askFromServerScreen: {
    action: 'askFromServerScreen',
    key: 'CommandOrControl+/',
    defaultKey: 'CommandOrControl+/',
    label: '服务端截图审题',
    category: '实时辅助',
    status: 'available',
  },
}

const supportedPhysicalKeys = new Map<string, string>([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((key) => [`Key${key}`, key] as const),
  ...'0123456789'.split('').map((digit) => [`Digit${digit}`, digit] as const),
  ['Period', '.'],
  ['Slash', '/'],
  ['Backslash', '\\'],
  ['Minus', '-'],
  ['Equal', '='],
  ['Comma', ','],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backquote', '`'],
])

export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.platform)
}

export function getShortcutAccelerator(event: KeyboardEvent): string | null {
  if (event.altKey || event.shiftKey) return null
  if (!(event.metaKey || event.ctrlKey)) return null
  const key = supportedPhysicalKeys.get(event.code)
  if (!key) return null
  return `CommandOrControl+${key}`
}

export function getShortcutDisplay(accelerator: string) {
  const parts = accelerator.split('+')
  const key = parts[parts.length - 1] || accelerator
  const ctrl = isMacPlatform() ? '⌘' : 'Ctrl'
  return `${ctrl}+${key}`
}

export function mergeShortcutConfigs(
  input: Record<string, Partial<ShortcutConfig> | Record<string, unknown>> | undefined,
) {
  const merged = { ...defaultShortcuts }
  for (const [action, shortcut] of Object.entries(input || {})) {
    if (!(action in merged)) continue
    merged[action as ShortcutAction] = {
      ...merged[action as ShortcutAction],
      ...(shortcut as Partial<ShortcutConfig>),
    }
  }
  return merged
}
