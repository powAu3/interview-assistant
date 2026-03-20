/** 参考 VS Code 的配色方案 id（与 index.css / data-theme 一致） */
export type ColorSchemeId = 'vscode-dark-plus' | 'vscode-light-plus' | 'vscode-dark-hc'

/** localStorage key，与 index.html 内联脚本一致 */
export const COLOR_SCHEME_STORAGE_KEY = 'ia-color-scheme'

export const COLOR_SCHEME_OPTIONS: { id: ColorSchemeId; label: string; hint: string }[] = [
  { id: 'vscode-dark-plus', label: 'Dark+', hint: '默认深色，接近 VS Code Dark+' },
  { id: 'vscode-light-plus', label: 'Light+', hint: '浅色背景，接近 VS Code Light+' },
  { id: 'vscode-dark-hc', label: 'Dark 高对比', hint: '黑底高对比，易读' },
]

export function readStoredColorScheme(): ColorSchemeId {
  try {
    const v = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)
    if (v === 'vscode-dark-plus' || v === 'vscode-light-plus' || v === 'vscode-dark-hc') return v
  } catch {
    /* ignore */
  }
  return 'vscode-dark-plus'
}

export function applyColorSchemeToDocument(id: ColorSchemeId) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', id)
}

export function isLightColorScheme(id: ColorSchemeId): boolean {
  return id === 'vscode-light-plus'
}
