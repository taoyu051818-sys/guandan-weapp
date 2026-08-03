type Listener<T = unknown> = (payload: T) => void

type WireMessage = {
  type: string
  requestId?: number
  payload?: unknown
  [key: string]: unknown
}

/**
 * A minimal game-client protocol adapter for server/weapp-ws.js.
 * The server remains authoritative: this class only sends intents and receives
 * redacted snapshots.  It intentionally contains no scene/UI dependency.
 */
export class CocosSocketClient {
  private socket: WebSocket | null = null
  private readonly listeners = new Map<string, Set<Listener>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false
  private reconnectAttempt = 0
  private sequence = 0

  public connect (url: string): Promise<void> {
    this.closedByUser = false
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      this.socket = socket
      socket.onopen = () => {
        this.reconnectAttempt = 0
        this.emit('connected', undefined)
        resolve()
      }
      socket.onmessage = event => this.receive(event.data)
      socket.onerror = () => reject(new Error('无法连接游戏服务器'))
      socket.onclose = () => {
        this.emit('disconnected', undefined)
        if (!this.closedByUser) this.scheduleReconnect(url)
      }
    })
  }

  public on<T> (type: string, listener: Listener<T>): () => void {
    const group = this.listeners.get(type) ?? new Set<Listener>()
    group.add(listener as Listener)
    this.listeners.set(type, group)
    return () => group.delete(listener as Listener)
  }

  public send (type: string, payload?: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('网络未连接')
    this.socket.send(JSON.stringify({ type, requestId: ++this.sequence, payload } satisfies WireMessage))
  }

  public close (): void {
    this.closedByUser = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.socket?.close()
    this.socket = null
  }

  private receive (raw: unknown): void {
    try {
      const message = JSON.parse(String(raw)) as WireMessage
      // server/weapp-ws.js sends `{ type, state, rooms, ... }`, matching the
      // existing native-mini-program adapter rather than a nested payload.
      if (message.type) this.emit(message.type, message)
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
}
