/**
 * LAN 鉴权 token 客户端管理:
 * - 启动时若 URL 带 `?t=<token>` 或 `#t=<token>`,提取并写入 sessionStorage,
 *   随后 history.replaceState 把 token 从地址栏抹掉,避免被复制泄露。
 * - 提供 getAuthToken() 给 fetch/WS 使用;不存在时返回 null,环回场景后端会放行。
 */
const STORAGE_KEY = 'ia_auth_token'

function consumeUrlToken(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const fromQuery = url.searchParams.get('t')
    let fromHash: string | null = null
    if (url.hash) {
      const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
      const params = new URLSearchParams(hash)
      fromHash = params.get('t')
    }
    const token = fromQuery || fromHash
    if (!token) return
    sessionStorage.setItem(STORAGE_KEY, token)
    if (fromQuery) url.searchParams.delete('t')
    if (fromHash) {
      const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
      const params = new URLSearchParams(hash)
      params.delete('t')
      const rest = params.toString()
      url.hash = rest ? `#${rest}` : ''
    }
    window.history.replaceState({}, document.title, url.toString())
  } catch {
    /* ignore */
  }
}

consumeUrlToken()

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setAuthToken(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
  } catch {
    /* ignore */
  }
}

export function clearAuthToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
