/** 参考 VS Code 的配色方案 id（与 index.css / data-theme 一致） */
export const COLOR_SCHEME_IDS = [
  'vscode-dark-plus',
  'vscode-light-plus',
  'vscode-dark-hc',
  'command-center',
  'editorial-glass',
  'stealth-cyber',
] as const

export type ColorSchemeId = typeof COLOR_SCHEME_IDS[number]

/** localStorage key，与 index.html 内联脚本一致 */
export const COLOR_SCHEME_STORAGE_KEY = 'ia-color-scheme'
export const DEFAULT_COLOR_SCHEME_ID: ColorSchemeId = 'vscode-dark-plus'

export const COLOR_SCHEME_OPTIONS: { id: ColorSchemeId; label: string; hint: string }[] = [
  { id: 'vscode-dark-plus', label: 'Dark+', hint: '默认深色，接近 VS Code Dark+' },
  { id: 'vscode-light-plus', label: 'Light+', hint: '浅色背景，接近 VS Code Light+' },
  { id: 'vscode-dark-hc', label: 'Dark 高对比', hint: '黑底高对比，易读' },
  { id: 'command-center', label: 'Command Center', hint: '冷调指挥台，强调监控与聚焦' },
  { id: 'editorial-glass', label: 'Editorial Glass', hint: '纸感留白与玻璃层次，适合阅读' },
  { id: 'stealth-cyber', label: 'Stealth Cyber', hint: '低饱和霓虹暗色，适合夜间作答' },
]

export function isColorSchemeId(value: unknown): value is ColorSchemeId {
  return typeof value === 'string' && (COLOR_SCHEME_IDS as readonly string[]).includes(value)
}

export function resolveColorSchemeId(value: unknown): ColorSchemeId {
  return isColorSchemeId(value) ? value : DEFAULT_COLOR_SCHEME_ID
}

export function readStoredColorScheme(): ColorSchemeId {
  try {
    return resolveColorSchemeId(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY))
  } catch {
    return DEFAULT_COLOR_SCHEME_ID
  }
}

export function applyColorSchemeToDocument(id: ColorSchemeId) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', id)
}

export function applyStoredColorSchemeToDocument(): ColorSchemeId {
  const id = readStoredColorScheme()
  applyColorSchemeToDocument(id)
  return id
}

export function isLightColorScheme(id: ColorSchemeId): boolean {
  return id === 'vscode-light-plus' || id === 'editorial-glass'
}
