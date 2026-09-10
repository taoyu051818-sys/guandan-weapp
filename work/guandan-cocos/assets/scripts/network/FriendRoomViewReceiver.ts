import type { ForcedNetworkRecoveryReason } from '../effects/NetworkEffectSyncPolicy'
import type { LobbySnapshot, RoomSnapshotWire } from './LobbyModels'

export const roomViewMetadata = (message: RoomSnapshotWire): Partial<LobbySnapshot> => ({
  roomRole: message.roomRole, myPlayerId: message.myPlayerId,
  seatedPlayerId: message.seatedPlayerId, viewPlayerId: message.viewPlayerId, isRoomHost: message.isRoomHost,
  hostPlayerId: message.hostPlayerId, observers: message.observers ?? [], observerWaiting: Boolean(message.observerWaiting),
  observerClockAt: message.observerClockAt, ...(message.memberPlayerIds ? { members: message.memberPlayerIds } : {}), error: null,
})

/** Room-local viewpoint changes use recovery snapshots, never historical animation playback. */
export class FriendRoomViewReceiver {
  public constructor (private readonly dependencies: {
    snapshot: () => LobbySnapshot,
    acceptsRoom: (roomId: unknown) => boolean,
    reset: () => void,
    applySnapshot: (message: RoomSnapshotWire, reason: ForcedNetworkRecoveryReason) => void,
  }) {}

  public apply (message: RoomSnapshotWire): void {
    const current = this.dependencies.snapshot()
    if (!this.dependencies.acceptsRoom(message.roomId) || !['player', 'observer'].includes(message.roomRole ?? '') || !['p1', 'p2', 'p3', 'p4'].includes(message.myPlayerId)) return
    const switched = current.roomRole !== message.roomRole || current.myPlayerId !== message.myPlayerId
      || current.duplicate?.watching !== message.duplicate?.watching || current.duplicate?.mySeat !== message.duplicate?.mySeat
    if (switched || current.observerWaiting && !message.observerWaiting) this.dependencies.reset()
    this.dependencies.applySnapshot(message, 'reconnect')
  }
}
