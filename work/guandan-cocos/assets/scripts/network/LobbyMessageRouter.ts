import type { EngineState, PlayerId, SettlementResult, TributeState } from '../core/generated'
import type { ForcedNetworkRecoveryReason, NetworkEffectSync } from '../effects/NetworkEffectSyncPolicy'
import {
  createEmptyTrustees,
  protocolVersion,
  projectLobbyLiveMetadata,
  type LiveMetadataWire,
  type LobbySnapshot,
  type LobbyWire,
  type NetworkDeadlineAction,
  type NetworkMatchEnded,
  type NetworkRoom,
  type NetworkRoundEndedPacket,
  type NetworkRoundPacket,
  type NetworkStatePacket,
  type NetworkViewerRoundStats,
  type RoomSnapshotWire,
} from './LobbyModels'
import type { LobbySocketListener, NetworkRequestResult } from './LobbySocketClient'
import { LobbySyncTracker } from './LobbySyncTracker'
import { FriendRoomViewReceiver, roomViewMetadata } from './FriendRoomViewReceiver'
type RouterDependencies = Readonly<{
  listen: <T>(type: string, listener: LobbySocketListener<T>) => void
  snapshot: () => LobbySnapshot
  patch: (next: Partial<LobbySnapshot>) => void
  emit: (type: string, ...args: any[]) => void
  isRoomCleaning: (roomId: string) => boolean
  handleRequestResult: (result: NetworkRequestResult) => void
  applyRoomEntry: (message: RoomSnapshotWire, members: PlayerId[]) => void
  closeRoom: (message: string) => void
  reportError: (message: string) => void
}>

/** Owns live-message envelopes, version gates, snapshot projection and domain events. */
export class LobbyMessageRouter {
  private readonly sync = new LobbySyncTracker()
  private readonly roomViews = new FriendRoomViewReceiver({
    snapshot: () => this.dependencies.snapshot(), acceptsRoom: roomId => this.acceptRoomMessage(roomId),
    reset: () => this.sync.reset(), applySnapshot: (message, reason) => this.applyEntrySnapshot(message, reason),
  })
  public constructor (private readonly dependencies: RouterDependencies) {}

  public bind (): void {
    const listen = this.dependencies.listen
    listen('roomView', (message: RoomSnapshotWire) => this.roomViews.apply(message))
    listen('requestResult', (result: NetworkRequestResult) => this.dependencies.handleRequestResult(result))
    listen('error', (message: LobbyWire<{ message?: string }>) => {
      if (typeof message.requestId !== 'number') this.dependencies.reportError(message.message ?? '网络错误')
    })
    listen('roomList', (message: LobbyWire<{ rooms?: NetworkRoom[] }>) => this.dependencies.patch({ rooms: message.rooms ?? [] }))
    listen('roomCreated', (message: RoomSnapshotWire) => this.dependencies.applyRoomEntry(message, message.memberPlayerIds ?? ['p1']))
    listen('roomJoined', (message: RoomSnapshotWire) => this.dependencies.applyRoomEntry(message, message.memberPlayerIds ?? this.dependencies.snapshot().members))
    listen('roomRejoined', (message: RoomSnapshotWire) => this.dependencies.applyRoomEntry(message, message.memberPlayerIds ?? this.dependencies.snapshot().members))
    listen('roomMembers', (message: LiveMetadataWire & { memberPlayerIds?: PlayerId[] }) => {
      if (this.applyLiveMetadata('room-members', message)) this.dependencies.patch({ members: message.memberPlayerIds ?? [] })
    })
    listen('lobbyReadyUpdated', (message: LiveMetadataWire) => {
      if (this.applyLiveMetadata('lobby-ready', message)) this.dependencies.emit('guandan:lobby-ready', this.dependencies.snapshot().lobbyReadyPlayerIds ?? [])
    })
    listen('gameStartPending', (message: LiveMetadataWire & { message?: string }) => {
      if (this.applyLiveMetadata('game-start-pending', message)) this.dependencies.patch({ gameStartPending: true, error: null })
    })
    listen('matchEnded', (message: LiveMetadataWire) => { this.applyLiveMetadata('match-ended-metadata', message) })
    listen('turnDeadline', (message: LiveMetadataWire) => {
      if (!this.applyLiveMetadata('turn-deadline', message)) return
      const snapshot = this.dependencies.snapshot()
      this.dependencies.emit('guandan:turn-deadline', {
        currentTurn: message.currentTurn ?? null,
        turnDeadlineAt: snapshot.turnDeadlineAt ?? null,
        deadlinePlayerId: snapshot.deadlinePlayerId ?? null,
        deadlineAction: snapshot.deadlineAction ?? null,
      })
    })
    listen('trusteeUpdated', (message: LiveMetadataWire) => {
      if (this.applyLiveMetadata('trustee-updated', message)) this.dependencies.emit('guandan:trustee', this.dependencies.snapshot().trustees ?? createEmptyTrustees())
    })
    listen('roundReadyUpdated', (message: LiveMetadataWire) => {
      if (this.applyLiveMetadata('round-ready', message)) this.dependencies.emit('guandan:round-ready', this.dependencies.snapshot().roundReadyPlayerIds ?? [])
    })
    listen('dissolveVoteUpdated', (message: LiveMetadataWire) => {
      if (this.applyLiveMetadata('dissolve-vote', message)) this.dependencies.emit('guandan:dissolve-vote', { vote: this.dependencies.snapshot().dissolveVote ?? null, outcome: message.outcome ?? null })
    })
    listen('turnTimedOut', (message: LiveMetadataWire & { playerId?: PlayerId, action?: NetworkDeadlineAction, enteredTrustee?: boolean }) => {
      if (this.applyLiveMetadata('turn-timeout', message)) this.dependencies.emit('guandan:turn-timeout', { playerId: message.playerId ?? null, action: message.action ?? null, enteredTrustee: Boolean(message.enteredTrustee) })
    })
    listen('gameState', (message: LiveMetadataWire & { state?: EngineState }) => {
      if (!message.state || !this.acceptStateEnvelope(message)) return
      // A server game state also clears stale pending state from older servers.
      this.applyLiveMetadata('game-state-metadata', { ...message, gameStartPending: false })
      if (!this.sync.acceptVersion('game-state', message.version)) return
      this.dependencies.patch({ error: null })
      const packet = this.statePacket(message.state, message.roomId, message.version, message.gameVersion)
      if (packet) this.dependencies.emit('guandan:network-state', packet)
    })
    listen('roundEnded', (message: LiveMetadataWire & { result?: SettlementResult, state?: EngineState, viewerRoundStats?: NetworkViewerRoundStats }) => {
      if (!message.result || !this.acceptStateEnvelope(message)) return
      this.applyLiveMetadata('round-ended-metadata', message)
      if (!this.sync.acceptVersion('round-ended', message.version)) return
      this.emitRoundEnded(message.result, message.roomId, message.version, message.gameVersion, message.state ?? null, message.viewerRoundStats)
    })
    listen('roundPrepared', (message: LiveMetadataWire & { state?: EngineState, tribute?: TributeState }) => {
      if (!message.state || !this.acceptStateEnvelope(message)) return
      this.applyLiveMetadata('round-prepared-metadata', message)
      if (!this.sync.acceptVersion('round-prepared', message.version)) return
      const packet = this.statePacket(message.state, message.roomId, message.version, message.gameVersion, 'round-reset')
      if (packet) this.dependencies.emit('guandan:round-prepared', { ...packet, tribute: message.tribute ?? null } satisfies NetworkRoundPacket)
    })
    listen('tributeUpdated', (message: LiveMetadataWire & { state?: EngineState, tribute?: TributeState }) => {
      if (!message.state || !this.acceptStateEnvelope(message)) return
      this.applyLiveMetadata('tribute-updated-metadata', message)
      if (!this.sync.acceptVersion('tribute-updated', message.version)) return
      const packet = this.statePacket(message.state, message.roomId, message.version, message.gameVersion)
      if (packet) this.dependencies.emit('guandan:round-prepared', { ...packet, tribute: message.tribute ?? null } satisfies NetworkRoundPacket)
    })
    listen('chat', (message: LobbyWire<{ roomId?: string, playerId?: PlayerId, text?: string }>) => {
      if (this.acceptRoomMessage(message.roomId) && message.playerId && message.text) this.dependencies.emit('guandan:chat', { playerId: message.playerId, text: message.text })
    })
    listen('hostLeft', (message: LobbyWire<{ roomId?: string }>) => {
      if (this.acceptRoomMessage(message.roomId)) this.dependencies.closeRoom('房主已离开，房间已关闭')
    })
    listen('roomDissolved', (message: LobbyWire<{ roomId?: string, reason?: string }>) => {
      if (this.acceptRoomMessage(message.roomId)) this.dependencies.closeRoom(message.reason === 'vote-approved' ? '全员同意，房间已解散' : '房间已解散')
    })
    listen('roomKicked', (message: LobbyWire<{ roomId?: string }>) => {
      if (this.acceptRoomMessage(message.roomId)) this.dependencies.closeRoom('已被房主移出房间')
    })
  }
  public reset (): void { this.sync.reset() }

  /** Projects an already accepted room-entry snapshot in the original event order. */
  public applyEntrySnapshot (message: RoomSnapshotWire, recoveryReason: ForcedNetworkRecoveryReason): void {
    if (!this.acceptRoomMessage(message.roomId)) return
    if (message.roomRole === 'observer' && message.observerClockAt && message.turnDeadlineAt) message = { ...message, turnDeadlineAt: message.turnDeadlineAt + Date.now() - message.observerClockAt }
    const version = protocolVersion(message.version) ?? this.sync.normalizedVersion()
    const gameVersion = protocolVersion(message.gameVersion) ?? this.sync.normalizedGameVersion()
    if (message.roomRole) this.dependencies.patch(roomViewMetadata(message))
    this.applyEntryMetadata(message, version)
    if (!message.state) return
    const packet = this.statePacket(message.state, message.roomId, version, gameVersion, recoveryReason)
    if (!packet) return
    const phase = message.phase ?? (message.roundResult ? 'settlement' : message.tribute ? 'tribute' : 'playing')
    if (phase === 'tribute') {
      this.dependencies.emit('guandan:round-prepared', { ...packet, tribute: message.tribute ?? null } satisfies NetworkRoundPacket)
      return
    }
    this.dependencies.emit('guandan:network-state', packet)
    if (phase === 'settlement' && message.roundResult) {
      this.emitRoundEnded(message.roundResult, message.roomId, version, gameVersion, message.state, message.viewerRoundStats, packet.effectSync)
    }
  }

  private acceptRoomMessage (roomId: unknown): roomId is string {
    const snapshot = this.dependencies.snapshot()
    return typeof roomId === 'string' && /^\d{6}$/.test(roomId)
      && snapshot.roomStatus === 'ready' && roomId === snapshot.roomId
      && !this.dependencies.isRoomCleaning(roomId)
  }

  private applyLiveMetadata (eventType: string, message: LiveMetadataWire): boolean {
    const version = protocolVersion(message.version)
    if (!this.acceptRoomMessage(message.roomId) || version === null) return false
    if (!this.sync.acceptVersion(`metadata:${eventType}`, version)) return false
    this.projectMetadata(message, version)
    return true
  }

  private applyEntryMetadata (message: LiveMetadataWire, version: number): void {
    if (this.sync.observeVersion(version) === null) return
    this.projectMetadata(message, version)
  }

  private projectMetadata (message: LiveMetadataWire, version: number): void {
    const next = projectLobbyLiveMetadata(message)
    if (Object.keys(next).length > 0) this.dependencies.patch(next)
    if (next.matchEnded && this.sync.acceptVersion('match-ended', version)) this.dependencies.emit('guandan:match-ended', next.matchEnded satisfies NetworkMatchEnded)
  }

  private acceptStateEnvelope<T extends LiveMetadataWire> (message: T): message is T & { roomId: string, version: number, gameVersion: number } {
    return this.acceptRoomMessage(message.roomId)
      && protocolVersion(message.version) !== null
      && protocolVersion(message.gameVersion) !== null
  }

  private statePacket (state: EngineState, roomId?: string, version?: number, gameVersion?: number, forceRecovery?: ForcedNetworkRecoveryReason): NetworkStatePacket | null {
    const normalizedRoomId = roomId ?? this.dependencies.snapshot().roomId ?? ''
    return this.sync.statePacket(state, normalizedRoomId, version, gameVersion, forceRecovery)
  }

  private emitRoundEnded (
    result: SettlementResult,
    roomId?: string,
    version?: number,
    gameVersion?: number,
    state: EngineState | null = null,
    viewerRoundStats?: NetworkViewerRoundStats,
    effectSync: NetworkEffectSync = this.sync.effectSyncForGameVersion(roomId ?? this.dependencies.snapshot().roomId ?? '', gameVersion),
  ): void {
    const normalizedRoomId = roomId ?? this.dependencies.snapshot().roomId
    if (!normalizedRoomId || !this.sync.acceptRoomEvent('round-ended', normalizedRoomId, version)) return
    this.dependencies.emit('guandan:round-ended', {
      roomId: normalizedRoomId,
      version: this.sync.normalizedVersion(version),
      gameVersion: this.sync.normalizedGameVersion(gameVersion),
      result,
      effectSync,
      ...(state ? { state } : {}),
      ...(viewerRoundStats ? { viewerRoundStats } : {}),
    } satisfies NetworkRoundEndedPacket)
  }
}
