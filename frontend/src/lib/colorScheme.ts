/** 参考 VS Code 的配色方案 id（与 index.css / data-theme 一致） */
export const COLOR_SCHEME_IDS = [
  'vscode-light-plus',
  'vscode-dark-plus',
  'vscode-dark-hc',
  'nord',
  'editorial-glass',
  'solarized-dark',
] as const

export type ColorSchemeId = typeof COLOR_SCHEME_IDS[number]

/** localStorage key，与 index.html 内联脚本一致 */
export const COLOR_SCHEME_STORAGE_KEY = 'ia-color-scheme'
export const DEFAULT_COLOR_SCHEME_ID: ColorSchemeId = 'vscode-light-plus'

export const COLOR_SCHEME_OPTIONS: { id: ColorSchemeId; label: string; hint: string }[] = [
  { id: 'vscode-light-plus', label: 'Light+', hint: '默认浅色，接近 VS Code Light+，日间作答首选' },
  { id: 'vscode-dark-plus', label: 'Dark+', hint: 'VS Code Dark+ 深色，经典程序员配色' },
  { id: 'vscode-dark-hc', label: 'Dark 高对比', hint: '黑底高对比，低视力 / 强光场景' },
  { id: 'nord', label: 'Nord', hint: '北欧冷灰蓝，低饱和长时间作答不累眼' },
  { id: 'editorial-glass', label: 'Editorial Glass', hint: '纸感留白与玻璃层次，适合阅读' },
  { id: 'solarized-dark', label: 'Solarized Dark', hint: '经典暖黄护眼深色，弱蓝光夜间友好' },
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
