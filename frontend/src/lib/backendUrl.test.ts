import { describe, expect, it } from 'vitest'
import { buildApiUrlForBase, buildWsUrlForBase } from './backendUrl'

describe('backend URL helpers', () => {
  const locationInfo: Pick<Location, 'protocol' | 'host'> = {
    protocol: 'http:',
    host: 'frontend.example.test',
  }

  it('supports absolute API base URLs with /api suffix', () => {
    expect(buildApiUrlForBase('/api/config', 'https://api.example.test:9443/api/')).toBe(
      'https://api.example.test:9443/api/config',
    )
    expect(buildWsUrlForBase('/ws', 'https://api.example.test:9443/api/', locationInfo)).toBe(
      'wss://api.example.test:9443/ws',
    )
  })

  it('keeps relative API base behavior for proxied deployments', () => {
    expect(buildApiUrlForBase('/api/config', '/backend/api')).toBe('/backend/api/config')
  })
})
