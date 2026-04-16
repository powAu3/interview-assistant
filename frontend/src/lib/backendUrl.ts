const RAW_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''

function normalizeBase(base: string): string {
  const trimmed = base.trim()
  if (!trimmed) return ''
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '')
}

const API_BASE = normalizeBase(RAW_BASE)
const BACKEND_ROOT = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (API_BASE.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${API_BASE}${normalizedPath.slice(4)}`
  }
  if (API_BASE.endsWith('/api') && normalizedPath === '/api') {
    return API_BASE
  }
  return `${API_BASE}${normalizedPath}`
}

export function buildWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${proto}//${window.location.host}${BACKEND_ROOT}${normalizedPath}`
}
