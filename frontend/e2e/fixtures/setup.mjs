/**
 * Helpers shared across E2E specs: applies API + WebSocket mocking and
 * navigates to the app. Keep callers thin so tests stay focused on UI behavior.
 */
import { resolveApiPayload } from './sample-data.mjs'
import { mockWsInitScript } from './mock-ws.mjs'

/**
 * @typedef {{
 *   messages?: Array<Record<string, unknown>>;
 *   localStorage?: Record<string, string>;
 *   apiOverrides?: Record<string, unknown> | ((pathname: string, method: string, request: import('@playwright/test').Request) => unknown | Promise<unknown>);
 * }} MockOptions
 */

/**
 * Install JSON mocks for every /api/** call and a deterministic mock WebSocket.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {MockOptions} [options]
 */
export async function installMocks(context, options = {}) {
  const messages = options.messages ?? []
  const localStorageEntries = Object.entries(options.localStorage ?? {})

  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    let override
    if (typeof options.apiOverrides === 'function') {
      override = await options.apiOverrides(url.pathname, method, route.request())
    } else if (options.apiOverrides) {
      override = options.apiOverrides[`${method} ${url.pathname}`]
      if (override === undefined) override = options.apiOverrides[url.pathname]
    }
    const payload = override === undefined ? resolveApiPayload(url.pathname, method) : override
    const status = payload && payload.detail === 'Not found' ? 404 : 200
    await route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(payload ?? {}),
    })
  })

  await context.addInitScript(mockWsInitScript, { messages })

  if (localStorageEntries.length > 0) {
    await context.addInitScript((entries) => {
      for (const [k, v] of entries) {
        try {
          localStorage.setItem(k, v)
        } catch {
          /* noop */
        }
      }
    }, localStorageEntries)
  }
}

/**
 * Common WS init burst: tells UI that STT is loaded + 3 model health states.
 */
export const COMMON_WS_BOOTSTRAP = [
  { type: 'stt_status', loaded: true, loading: false, delay: 20 },
  { type: 'model_health', index: 0, status: 'ok', delay: 30 },
  { type: 'model_health', index: 1, status: 'ok', delay: 35 },
  { type: 'model_health', index: 2, status: 'error', delay: 40 },
]
