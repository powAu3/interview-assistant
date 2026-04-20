import { afterEach, describe, expect, it, vi } from 'vitest'

// 通过动态 import 重新加载模块，让每个用例看到独立的模块状态。
async function freshModule() {
  vi.resetModules()
  return await import('./wsLeader')
}

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('wsLeader.markStandalone', () => {
  it('立即把当前 tab 标记为 leader, 后续 init 不再注册 BroadcastChannel', async () => {
    // 监控 BroadcastChannel: 必须确保 markStandalone 之后没有人 new 它。
    const ChannelSpy = vi.fn()
    vi.stubGlobal('BroadcastChannel', ChannelSpy as unknown as typeof BroadcastChannel)

    const mod = await freshModule()
    mod.markStandalone()

    expect(mod.isLeaderTab()).toBe(true)
    expect(ChannelSpy).not.toHaveBeenCalled()

    // subscribeLeader 在 standalone 模式下应同步告知 isLeader=true，
    // 这是 useInterviewWS 在 overlay 窗口里立刻 connect WS 的前提。
    const handler = vi.fn()
    const unsubscribe = mod.subscribeLeader(handler)
    expect(handler).toHaveBeenCalledWith(true)
    unsubscribe()
  })

  it('未调用 markStandalone 时 init 仍会创建 BroadcastChannel (main 窗口路径)', async () => {
    // ctor 必须可 new — 这里用 class 而不是 vi.fn() 实现
    const calls: string[] = []
    class FakeChannel {
      postMessage = vi.fn()
      close = vi.fn()
      onmessage: ((ev: MessageEvent) => void) | null = null
      constructor(name: string) {
        calls.push(name)
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel)

    const mod = await freshModule()
    mod.subscribeLeader(() => {})

    expect(calls).toEqual(['ia-ws-leader-v1'])
    mod.shutdownLeader()
  })
})
