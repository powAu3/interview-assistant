/**
 * Mock WebSocket installer used by Playwright init scripts.
 *
 * Usage in a test:
 *   import { mockWsInitScript } from './fixtures/mock-ws'
 *   await context.addInitScript(mockWsInitScript, { messages: [...] })
 */

/**
 * @typedef {{ type: string; delay?: number; [key: string]: unknown }} MockWsMessage
 */

/**
 * Function body must be self-contained: it runs in the browser and cannot
 * reach module imports. Receives `{ messages }` as its single argument.
 *
 * @param {{ messages: MockWsMessage[] }} arg
 */
export function mockWsInitScript({ messages }) {
  const nativeWebSocket = window.WebSocket
  let socketCount = 0

  class MockWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    constructor(url) {
      this.url = url
      this.readyState = MockWebSocket.CONNECTING
      this.protocol = ''
      this.extensions = ''
      this.bufferedAmount = 0
      this.binaryType = 'blob'
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      this._id = ++socketCount

      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN
        if (typeof this.onopen === 'function') this.onopen(new Event('open'))

        if (this._id === 1 && this.url.includes('/ws')) {
          messages.forEach((message) => {
            const delay = typeof message.delay === 'number' ? message.delay : 0
            setTimeout(() => {
              if (this.readyState !== MockWebSocket.OPEN) return
              const event = new MessageEvent('message', {
                data: JSON.stringify(message),
              })
              if (typeof this.onmessage === 'function') this.onmessage(event)
            }, delay)
          })
        }
      }, 0)
    }

    send() {}

    close() {
      this.readyState = MockWebSocket.CLOSED
      if (typeof this.onclose === 'function') this.onclose(new CloseEvent('close'))
    }

    addEventListener(type, listener) {
      if (type === 'open') this.onopen = listener
      if (type === 'message') this.onmessage = listener
      if (type === 'close') this.onclose = listener
      if (type === 'error') this.onerror = listener
    }

    removeEventListener(type, listener) {
      if (type === 'open' && this.onopen === listener) this.onopen = null
      if (type === 'message' && this.onmessage === listener) this.onmessage = null
      if (type === 'close' && this.onclose === listener) this.onclose = null
      if (type === 'error' && this.onerror === listener) this.onerror = null
    }
  }

  Object.defineProperty(window, 'WebSocket', {
    configurable: true,
    writable: true,
    value: MockWebSocket,
  })
  window.__IA_NATIVE_WS__ = nativeWebSocket
}
