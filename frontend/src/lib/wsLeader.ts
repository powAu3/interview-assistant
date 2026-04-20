/**
 * 多标签 WebSocket 主控选举(BroadcastChannel)。
 *
 * 目标:同一域名下打开多个 tab 时,只允许一个 tab 真正连接后端 WS,
 * 避免「同一条 answer_chunk 在两个 tab 各 append 一次」的状态污染。
 *
 * 选举规则:
 *  - 每个 tab 启动时生成 16 字节十六进制随机 id。
 *  - 收到他人 announce/heartbeat 时取较小者作为 leader。
 *  - leader 每 2s 广播一次 heartbeat,follower 在 5s 内未见 leader 则触发重新选举。
 *  - leader 关闭时主动 broadcast leaving,follower 立即触发重新选举。
 *
 * 当浏览器不支持 BroadcastChannel(老 Safari 等)时直接退化为单标签 leader。
 */

const CHANNEL_NAME = 'ia-ws-leader-v1'
const HEARTBEAT_INTERVAL = 2000
const LEADER_TIMEOUT = 5000

type RoleChangeHandler = (isLeader: boolean) => void

function genTabId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(8)
    crypto.getRandomValues(buf)
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const TAB_ID = genTabId()

interface BcMessage {
  type: 'announce' | 'heartbeat' | 'leaving' | 'takeover'
  id: string
}

let channel: BroadcastChannel | null = null
let leaderId: string = TAB_ID
let leaderSeenAt = Date.now()
let currentlyLeader = true
let initialized = false
let timer: number | null = null
const handlers = new Set<RoleChangeHandler>()

function notify(): void {
  for (const h of handlers) {
    try {
      h(currentlyLeader)
    } catch {
      /* ignore */
    }
  }
}

function setLeader(id: string, broadcast: boolean): void {
  const prevLeader = currentlyLeader
  leaderId = id
  leaderSeenAt = Date.now()
  currentlyLeader = id === TAB_ID
  if (prevLeader !== currentlyLeader) notify()
  if (broadcast && currentlyLeader && channel) {
    channel.postMessage({ type: 'announce', id: TAB_ID } satisfies BcMessage)
  }
}

function tick(): void {
  if (currentlyLeader) {
    channel?.postMessage({ type: 'heartbeat', id: TAB_ID } satisfies BcMessage)
    return
  }
  if (Date.now() - leaderSeenAt > LEADER_TIMEOUT) {
    setLeader(TAB_ID, true)
  }
}

/**
 * markStandalone — 适配 Electron 多 BrowserWindow 场景。
 *
 * 背景：main 窗口和 overlay 窗口同 origin (http://127.0.0.1:18080)，
 * BroadcastChannel 跨 BrowserWindow 互通，会让两者抢 leader，
 * 落选的窗口完全断 WS → 无法收到 question/answer/transcription 推送。
 *
 * Overlay 是「只读副屏」，与 main 各自维护独立 store，**互不污染**：
 * 它必须独立连 WS，但不参与选举（不发 announce / 不收消息），
 * 这样 main 也察觉不到它的存在，main 仍维持唯一 leader 地位。
 *
 * 必须在任何 subscribeLeader / isLeaderTab 调用之前同步执行。
 */
export function markStandalone(): void {
  if (initialized) return
  initialized = true
  currentlyLeader = true
  leaderId = TAB_ID
  leaderSeenAt = Date.now()
}

function init(): void {
  if (initialized) return
  initialized = true
  if (typeof window === 'undefined') return
  if (typeof BroadcastChannel === 'undefined') {
    setLeader(TAB_ID, false)
    return
  }
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent<BcMessage>) => {
    const m = event.data
    if (!m || typeof m.id !== 'string' || m.id === TAB_ID) return
    if (m.type === 'announce' || m.type === 'heartbeat') {
      if (m.id < leaderId || (!currentlyLeader && m.id === leaderId)) {
        setLeader(m.id, false)
      } else if (currentlyLeader && m.id < TAB_ID) {
        setLeader(m.id, false)
      }
      if (m.type === 'announce' && currentlyLeader) {
        channel?.postMessage({ type: 'heartbeat', id: TAB_ID } satisfies BcMessage)
      }
    } else if (m.type === 'leaving') {
      if (m.id === leaderId && !currentlyLeader) {
        setLeader(TAB_ID, true)
      }
    } else if (m.type === 'takeover') {
      // 别的 tab 主动接管:无条件让位,立刻同步角色,避免双 leader 同时持 WS
      if (m.id !== TAB_ID && currentlyLeader) {
        setLeader(m.id, false)
      } else if (m.id !== TAB_ID) {
        leaderId = m.id
        leaderSeenAt = Date.now()
      }
    }
  }
  channel.postMessage({ type: 'announce', id: TAB_ID } satisfies BcMessage)
  // 假定自己是 leader,直到见到更小 id;同时启动心跳
  setLeader(TAB_ID, false)
  timer = window.setInterval(tick, HEARTBEAT_INTERVAL)
  window.addEventListener('beforeunload', () => {
    try {
      channel?.postMessage({ type: 'leaving', id: TAB_ID } satisfies BcMessage)
      channel?.close()
    } catch {
      /* ignore */
    }
  })
}

export function subscribeLeader(handler: RoleChangeHandler): () => void {
  init()
  handlers.add(handler)
  // 立即同步一次当前角色
  try {
    handler(currentlyLeader)
  } catch {
    /* ignore */
  }
  return () => {
    handlers.delete(handler)
  }
}

export function isLeaderTab(): boolean {
  init()
  return currentlyLeader
}

export function requestTakeover(): void {
  init()
  if (currentlyLeader) return
  // 先广播 takeover 通知旧 leader 让位,然后用微任务推迟本 tab 自我晋升:
  //   * 微任务只保证「本 tab 当前调用栈结束后才晋升」,给 BroadcastChannel
  //     向其他 tab 派送 + 旧 leader teardown WS 留出最小窗口,
  //     避免本函数返回的同步路径里立刻打开第二条 WS。
  //   * 跨 tab 的事件循环顺序由浏览器决定,本机制 *无法* 保证旧 leader 一定
  //     先于新 leader 完成 teardown -- 仍可能存在短暂双连接窗口。
  //     如需严格无重叠,需要补 takeover_ack 二段握手(目前业务可接受软切换)。
  channel?.postMessage({ type: 'takeover', id: TAB_ID } satisfies BcMessage)
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(() => setLeader(TAB_ID, true))
  } else {
    Promise.resolve().then(() => setLeader(TAB_ID, true))
  }
}

export function getTabId(): string {
  return TAB_ID
}

export function shutdownLeader(): void {
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
  try {
    channel?.postMessage({ type: 'leaving', id: TAB_ID } satisfies BcMessage)
    channel?.close()
  } catch {
    /* ignore */
  }
  channel = null
  initialized = false
}
