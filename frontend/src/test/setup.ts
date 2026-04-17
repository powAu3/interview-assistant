import '@testing-library/jest-dom/vitest'

// jsdom 不实现 ResizeObserver — 部分组件 (QuickPromptsRow 等) 依赖它做布局监测,
// 在测试环境下 polyfill 一个空实现,避免 ReferenceError.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
}
