import { getAuthToken } from './auth'

const RAW_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''

function normalizeBase(base: string): string {
  const trimmed = base.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '')
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '')
}

const API_BASE = normalizeBase(RAW_BASE)
const BACKEND_ROOT = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function toWsBase(root: string, protocol: string, host: string): string {
  if (isAbsoluteHttpUrl(root)) {
    return root.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
  }
  const proto = protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${host}${root}`
}

export function buildApiUrlForBase(path: string, rawBase: string): string {
  const apiBase = normalizeBase(rawBase)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (apiBase.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${apiBase}${normalizedPath.slice(4)}`
  }
  if (apiBase.endsWith('/api') && normalizedPath === '/api') {
    return apiBase
  }
  return `${apiBase}${normalizedPath}`
}

export function buildWsUrlForBase(
  path: string,
  rawBase: string,
  locationInfo: Pick<Location, 'protocol' | 'host'>,
  token: string | null = null,
): string {
  const apiBase = normalizeBase(rawBase)
  const backendRoot = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const base = `${toWsBase(backendRoot, locationInfo.protocol, locationInfo.host)}${normalizedPath}`
  if (!token) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}token=${encodeURIComponent(token)}`
}

export function buildApiUrl(path: string): string {
  return buildApiUrlForBase(path, API_BASE)
}

export function buildWsUrl(path: string): string {
  return buildWsUrlForBase(path, BACKEND_ROOT, window.location, getAuthToken())
}
