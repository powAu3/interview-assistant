export type ShortcutAction =
  | 'hideOrShowWindow'
  | 'hardClearSession'
  | 'askFromServerScreen'
  | 'addMultiServerScreenShot'
  | 'toggleInterviewOverlay'
  | 'moveOverlayToMouse'
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
  addMultiServerScreenShot: {
    action: 'addMultiServerScreenShot',
    key: 'CommandOrControl+Shift+/',
    defaultKey: 'CommandOrControl+Shift+/',
    label: '多图截图判题',
    category: '实时辅助',
    status: 'available',
  },
  toggleInterviewOverlay: {
    action: 'toggleInterviewOverlay',
    key: 'CommandOrControl+O',
    defaultKey: 'CommandOrControl+O',
    label: '显示/隐藏悬浮窗',
    category: '实时辅助',
    status: 'available',
  },
  moveOverlayToMouse: {
    action: 'moveOverlayToMouse',
    key: 'CommandOrControl+M',
    defaultKey: 'CommandOrControl+M',
    label: '移动悬浮窗到鼠标位置',
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
  ['Enter', 'Enter'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
])

export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.platform)
}

export function getShortcutAccelerator(event: KeyboardEvent): string | null {
  if (!(event.metaKey || event.ctrlKey)) return null
  const key = supportedPhysicalKeys.get(event.code)
  if (!key) return null
  const parts: string[] = ['CommandOrControl']
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  parts.push(key)
  return parts.join('+')
}

const KEY_DISPLAY: Record<string, string> = {
  Enter: 'Enter',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
}

export function getShortcutDisplay(accelerator: string) {
  const parts = accelerator.split('+')
  const ctrl = isMacPlatform() ? '⌘' : 'Ctrl'
  const shiftSym = isMacPlatform() ? '⇧' : 'Shift'
  const altSym = isMacPlatform() ? '⌥' : 'Alt'
  const out: string[] = []
  for (const p of parts) {
    if (p === 'CommandOrControl') out.push(ctrl)
    else if (p === 'Shift') out.push(shiftSym)
    else if (p === 'Alt') out.push(altSym)
    else out.push(KEY_DISPLAY[p] ?? p)
  }
  return out.join(isMacPlatform() ? '' : '+')
}

const VALID_ACTIONS = new Set<string>(Object.keys(defaultShortcuts))
const SUPPORTED_KEY_RE = /^CommandOrControl(\+Shift)?(\+Alt)?\+[A-Za-z0-9./\\\- =;,'`\[\]\{\}]$/

export function mergeShortcutConfigs(
  input: Record<string, Partial<ShortcutConfig> | Record<string, unknown>> | undefined,
) {
  const merged = { ...defaultShortcuts }
  for (const [action, shortcut] of Object.entries(input || {})) {
    if (!(action in merged)) continue
    if (!shortcut || typeof shortcut !== 'object') continue
    const s = shortcut as Record<string, unknown>
    if (typeof s.key === 'string' && s.key.trim() && SUPPORTED_KEY_RE.test(s.key)) {
      merged[action as ShortcutAction] = {
        ...merged[action as ShortcutAction],
        key: s.key,
      }
    }
  }
  return merged
}
