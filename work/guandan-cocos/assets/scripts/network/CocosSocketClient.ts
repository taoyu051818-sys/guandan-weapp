import type { LobbySocketClient, LobbySocketListener, NetworkRequestResult } from './LobbySocketClient'
import { assertWechatTransportEndpoint } from '../services/WechatNetworkPolicy'

export type { NetworkRequestResult } from './LobbySocketClient'

type WireMessage = {
  type: string
  requestId?: number
  payload?: unknown
  [key: string]: unknown
}

export type SocketConnectionSnapshot = {
  connected: boolean
  endpoint: string
  reconnectAttempt: number
}

/**
 * A minimal game-client protocol adapter for server/weapp-ws.js.
 * The server remains authoritative: this class only sends intents and receives
 * redacted snapshots.  It intentionally contains no scene/UI dependency.
 */
export class CocosSocketClient implements LobbySocketClient {
  private socket: WebSocket | null = null
  private readonly listeners = new Map<string, Set<LobbySocketListener>>()
  private readonly pendingRequests = new Map<number, string>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false
  private reconnectAttempt = 0
  private sequence = 0
  private connectingUrl = ''
  private connectPromise: Promise<void> | null = null
  private connectReject: ((reason?: unknown) => void) | null = null
  private connectionGeneration = 0

  /** Read-only transport state for controllers and diagnostics; game state stays server-owned. */
  public get snapshot (): SocketConnectionSnapshot {
    return {
      connected: this.socket?.readyState === WebSocket.OPEN,
      endpoint: this.connectingUrl,
      reconnectAttempt: this.reconnectAttempt,
    }
  }

  public connect (url: string): Promise<void> {
    try { assertWechatTransportEndpoint(url, 'wss:') } catch (error) { return Promise.reject(error) }
    if (this.socket?.readyState === WebSocket.OPEN && this.connectingUrl === url) return Promise.resolve()
    if (this.connectPromise && this.connectingUrl === url) return this.connectPromise
    this.replaceConnection('连接地址已切换')
    this.closedByUser = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.connectingUrl = url
    const generation = ++this.connectionGeneration
    const promise = new Promise<void>((resolve, reject) => {
      let settled = false
      const resolveOnce = (): void => { if (!settled) { settled = true; resolve() } }
      const rejectOnce = (reason: unknown): void => { if (!settled) { settled = true; reject(reason) } }
      this.connectReject = rejectOnce
      const socket = new WebSocket(url)
      this.socket = socket
      let opened = false
      socket.onopen = () => {
        if (this.socket !== socket || generation !== this.connectionGeneration) {
          rejectOnce(new Error('连接已切换'))
          socket.close()
          return
        }
        opened = true
        this.reconnectAttempt = 0
        this.clearConnectAttempt(generation)
        this.emit('connected', undefined)
        resolveOnce()
      }
      socket.onmessage = event => { if (this.socket === socket && generation === this.connectionGeneration) this.receive(event.data) }
      socket.onerror = () => {
        if (this.socket !== socket || generation !== this.connectionGeneration) return
        const error = new Error('无法连接游戏服务器')
        if (opened) this.emit('error', { message: error.message })
        else {
          this.clearConnectAttempt(generation)
          rejectOnce(error)
          socket.close()
        }
      }
      socket.onclose = () => {
        if (this.socket !== socket || generation !== this.connectionGeneration) return
        this.socket = null
        this.clearConnectAttempt(generation)
        if (!opened) rejectOnce(new Error('无法连接游戏服务器'))
        this.pendingRequests.clear()
        this.emit('disconnected', undefined)
        if (!this.closedByUser) this.scheduleReconnect(url)
      }
    })
    this.connectPromise = promise
    return promise
  }

  public on<T> (type: string, listener: LobbySocketListener<T>): () => void {
    const group = this.listeners.get(type) ?? new Set<LobbySocketListener>()
    group.add(listener as LobbySocketListener)
    this.listeners.set(type, group)
    return () => group.delete(listener as LobbySocketListener)
  }

  public send (type: string, payload?: unknown, retryRequestId?: number): number {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('网络未连接')
    if (retryRequestId !== undefined && (!Number.isSafeInteger(retryRequestId) || retryRequestId < 1 || retryRequestId > this.sequence)) {
      throw new Error('重试请求编号无效')
    }
    const requestId = retryRequestId ?? ++this.sequence
    this.pendingRequests.set(requestId, type)
    // The authoritative server only returns a requestId for direct replies and
    // rejects. State broadcasts are the acknowledgement for play/pass intents,
    // so keep this diagnostic lookup deliberately bounded.
    if (this.pendingRequests.size > 64) {
      const oldest = this.pendingRequests.keys().next().value as number | undefined
      if (oldest !== undefined) this.pendingRequests.delete(oldest)
    }
    try {
      this.socket.send(JSON.stringify({ type, requestId, payload } satisfies WireMessage))
    } catch (error) {
      this.pendingRequests.delete(requestId)
      throw error
    }
    return requestId
  }

  public close (): void {
    this.closedByUser = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.connectingUrl = ''
    this.replaceConnection('连接已关闭')
  }

  private receive (raw: unknown): void {
    try {
      const message = JSON.parse(String(raw)) as WireMessage
      // server/weapp-ws.js sends `{ type, state, rooms, ... }`, matching the
      // existing native-mini-program adapter rather than a nested payload.
      if (message.type) {
        if (typeof message.requestId === 'number') {
          const requestType = this.pendingRequests.get(message.requestId) ?? null
          this.pendingRequests.delete(message.requestId)
          this.emit('requestResult', {
            requestId: message.requestId,
            requestType,
            responseType: message.type,
            ok: message.type !== 'error',
            code: message.type === 'error' && typeof message.code === 'string' ? message.code : null,
            message: message.type === 'error' && typeof message.message === 'string' ? message.message : null,
          } satisfies NetworkRequestResult)
        }
        this.emit(message.type, message)
      }
    } catch {
      this.emit('error', { message: '服务器消息格式错误' })
    }
  }

  private emit (type: string, payload: unknown): void {
    this.listeners.get(type)?.forEach(listener => listener(payload))
  }

  private scheduleReconnect (url: string): void {
    if (this.reconnectTimer) return
    const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect(url).catch(() => undefined)
    }, delay)
  }

  private replaceConnection (reason: string): void {
    const socket = this.socket
    const reject = this.connectReject
    this.connectionGeneration += 1
    this.socket = null
    this.connectPromise = null
    this.connectReject = null
    this.pendingRequests.clear()
    reject?.(new Error(reason))
    socket?.close()
  }

  private clearConnectAttempt (generation: number): void {
    if (generation !== this.connectionGeneration) return
    this.connectPromise = null
    this.connectReject = null
  }
}
