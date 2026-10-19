import type { AppMessage, HostMessage } from './vendor/obsidian-protocol'
import {
  createError,
  OBSIDIAN_PROTOCOL,
  parseAppMessage,
  peerProtocolOf,
  PROTOCOL_MISMATCH_CODE,
} from './vendor/obsidian-protocol'

type MessageListener = (event: MessageEvent) => void

export interface MessageTarget {
  addEventListener: (type: `message`, listener: MessageListener) => void
  removeEventListener: (type: `message`, listener: MessageListener) => void
}

export interface FrameWindow {
  postMessage: (message: unknown, targetOrigin: string) => void
}

export interface HostBridgeOptions {
  target: MessageTarget
  getFrame: () => FrameWindow | null
  /** 只接受这个来源的消息，发送时也用它做 targetOrigin */
  expectedOrigin: string
  onMessage: (message: AppMessage) => void
  /** 来自本 iframe 但来源不符时回调，联调时用来看真实来源 */
  onRejected?: (origin: string) => void
}

export interface HostBridge {
  send: (message: HostMessage) => boolean
  /** 在另一个窗口（例如弹出窗口）上也监听 message；已挂过或已 dispose 时为空操作 */
  addTarget: (target: MessageTarget) => void
  dispose: () => void
}

export function createHostBridge(options: HostBridgeOptions): HostBridge {
  const listener: MessageListener = (event) => {
    const frame = options.getFrame()
    if (!frame || event.source !== frame)
      return
    if (event.origin !== options.expectedOrigin) {
      options.onRejected?.(event.origin)
      return
    }
    const message = parseAppMessage(event.data)
    if (message) {
      options.onMessage(message)
      return
    }
    const peer = peerProtocolOf(event.data)
    if (peer !== null)
      options.onMessage(createError(PROTOCOL_MISMATCH_CODE, `墨笔使用协议 ${peer}，插件使用协议 ${OBSIDIAN_PROTOCOL}`))
  }
  const targets = new Set<MessageTarget>()
  let disposed = false
  const attach = (target: MessageTarget) => {
    if (disposed || targets.has(target))
      return
    targets.add(target)
    target.addEventListener(`message`, listener)
  }
  attach(options.target)
  return {
    send(message) {
      if (disposed)
        return false
      const frame = options.getFrame()
      if (!frame)
        return false
      frame.postMessage(message, options.expectedOrigin)
      return true
    },
    addTarget: attach,
    dispose() {
      disposed = true
      targets.forEach(target => target.removeEventListener(`message`, listener))
      targets.clear()
    },
  }
}
