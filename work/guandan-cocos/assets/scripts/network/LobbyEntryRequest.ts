import type { LobbyRoomStatus, PendingRoomEntry, RoomSnapshotWire } from './LobbyModels'

type Send = (type: string, payload: unknown, retryRequestId?: number) => number | null

export const isExpectedRoomEntry = (
  message: RoomSnapshotWire, pending: PendingRoomEntry | null, generation: number, status: LobbyRoomStatus,
): pending is PendingRoomEntry => Boolean(
  pending && pending.generation === generation && message.requestId === pending.requestId &&
  message.type === pending.responseType && message.roomId === pending.roomId &&
  (!pending.expectedPlayerId || message.myPlayerId === pending.expectedPlayerId || (message.entryKind === 'friend' && Boolean(message.roomRole))) &&
  status === (pending.requestType === 'rejoinRoom' ? 'rejoining' : 'joining'),
)

/** Owns the immutable wire identity of an entry until success or abandonment. */
export class LobbyEntryRequest {
  private retained: { type: string, body: string, requestId: number } | null = null

  public send (type: string, payload: unknown, retryable: boolean, send: Send): number | null {
    const body = JSON.stringify(payload)
    const previous = this.retained
    if (retryable && previous && (previous.type !== type || previous.body !== body)) {
      throw new Error('恢复中的入桌请求不能改变内容')
    }
    const requestId = send(type, JSON.parse(body), retryable ? previous?.requestId : undefined)
    if (retryable && requestId !== null) this.retained = { type, body, requestId }
    return requestId
  }

  public clear (): void { this.retained = null }
}
