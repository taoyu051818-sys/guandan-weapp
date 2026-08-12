export type LobbySocketListener<T = unknown> = (payload: T) => void

export type NetworkRequestResult = {
  requestId: number
  requestType: string | null
  responseType: string
  ok: boolean
  code: string | null
  message: string | null
}

/** Transport boundary consumed by LobbyController. */
export interface LobbySocketClient {
  connect(endpoint: string): Promise<void>
  on<T>(type: string, listener: LobbySocketListener<T>): () => void
  send(type: string, payload?: unknown): number
  close(): void
}
