import { _decorator, Component, EventTarget } from 'cc'
import type { EngineState, PlayerId, Rank, SettlementResult, TributeState } from '../core/generated'
import { decideNetworkEffectSync, type ForcedNetworkRecoveryReason, type NetworkEffectCursor, type NetworkEffectSync } from '../effects/NetworkEffectSyncPolicy'
import { GameSession } from '../session/GameSession'
import { CocosSocketClient, type NetworkRequestResult } from './CocosSocketClient'

export type FriendRoomSettings = {
  mode: 'classic'
  rounds: number
  scoring: 'double-3' | 'double-4'
  scoreVisibility: 'live' | 'hidden'
  turnSeconds: 20 | 40 | 60
  trusteeSeconds: 0 | 15 | 30 | 60
  totalTimeMinutes: 0 | 20 | 30 | 60
  spectator: 'off' | 'live' | 'delayed-round'
  autoSort: boolean
  disableInteraction: boolean
  sortOrder: 'desc' | 'asc'
  authoritativeValidation: true
}
export const DEFAULT_FRIEND_ROOM_SETTINGS: FriendRoomSettings = {
  mode: 'classic',
  rounds: 4,
  scoring: 'double-3',
  scoreVisibility: 'live',
  turnSeconds: 40,
  trusteeSeconds: 15,
  totalTimeMinutes: 0,
  spectator: 'off',
  autoSort: true,
  disableInteraction: true,
  sortOrder: 'desc',
  authoritativeValidation: true,
}
export type NetworkRoom = { roomId: string, hostName: string, playerCount: number, roomSettings?: FriendRoomSettings }
export type LobbyRoomStatus = 'idle' | 'joining' | 'ready' | 'rejoining' | 'leaving'
export type NetworkDeadlineAction = 'play' | 'tribute' | 'returnTribute' | 'finishTribute'
export type TrusteeReason = 'manual' | 'timeout' | 'disconnected'
export type NetworkTrustee = { reason: TrusteeReason, since: number }
export type DissolveVoteChoice = 'pending' | 'agree' | 'refuse' | 'offline'
export type NetworkDissolveVote = {
  initiator: PlayerId
  votes: Record<PlayerId, DissolveVoteChoice>
  expiresAt: number
}
export type NetworkScoreboard = {
  roundsPlayed: number
  currentLevel: Rank
  teamLevels: Record<'teamA' | 'teamB', Rank>
}
export type LobbySnapshot = {
  connected: boolean
  rooms: NetworkRoom[]
  roomId: string | null
  members: PlayerId[]
  myPlayerId: PlayerId | null
  roomStatus: LobbyRoomStatus
  error: string | null
  turnDeadlineAt?: number | null
  deadlinePlayerId?: PlayerId | null
  deadlineAction?: NetworkDeadlineAction | null
  trustees?: Record<PlayerId, NetworkTrustee | null>
  consecutiveTimeouts?: Record<PlayerId, number>
  lobbyReadyRequired?: boolean
  lobbyReadyPlayerIds?: PlayerId[]
  botPlayerIds?: PlayerId[]
  roundReadyPlayerIds?: PlayerId[]
  dissolveVote?: NetworkDissolveVote | null
  roomSettings?: FriendRoomSettings | null
  scoreboard?: NetworkScoreboard | null
}
export type LobbyNetworkResult = NetworkRequestResult | { requestId: null, requestType: string, responseType: 'client-error', ok: false, message: string }
export type NetworkStatePacket = { roomId: string, version: number, state: EngineState, effectSync: NetworkEffectSync }
export type NetworkRoundPacket = NetworkStatePacket & { tribute: TributeState | null }
export type NetworkRoundEndedPacket = { result: SettlementResult, effectSync: NetworkEffectSync }
export type MatchedRoomEntry = {
  roomId: string
  gameEndpoint: string
  gameTicket: string
  seat: PlayerId
  expiresAt?: number
  displayName?: string
}
type Wire<T> = { type: string, requestId?: number } & T
type RoomSnapshotWire = Wire<{
  roomId: string
  myPlayerId: PlayerId
  resumeToken?: string
  state?: EngineState | null
  phase?: 'lobby' | 'playing' | 'tribute' | 'settlement'
  tribute?: TributeState | null
  roundResult?: SettlementResult | null
  version?: number
  turnDeadlineAt?: number | null
  deadlinePlayerId?: PlayerId | null
  deadlineAction?: NetworkDeadlineAction | null
  trustees?: Record<PlayerId, NetworkTrustee | null>
  consecutiveTimeouts?: Record<PlayerId, number>
  lobbyReadyRequired?: boolean
  lobbyReadyPlayerIds?: PlayerId[]
  botPlayerIds?: PlayerId[]
  roundReadyPlayerIds?: PlayerId[]
  dissolveVote?: NetworkDissolveVote | null
  roomSettings?: FriendRoomSettings | null
  scoreboard?: NetworkScoreboard | null
  memberPlayerIds?: PlayerId[]
}>
type LiveMetadataWire = Wire<{
  roomId?: string
  version?: number
  currentTurn?: PlayerId | null
  turnDeadlineAt?: number | null
  deadlinePlayerId?: PlayerId | null
  deadlineAction?: NetworkDeadlineAction | null
  trustees?: Record<PlayerId, NetworkTrustee | null>
  consecutiveTimeouts?: Record<PlayerId, number>
  lobbyReadyRequired?: boolean
  lobbyReadyPlayerIds?: PlayerId[]
  botPlayerIds?: PlayerId[]
  roundReadyPlayerIds?: PlayerId[]
  dissolveVote?: NetworkDissolveVote | null
  roomSettings?: FriendRoomSettings | null
  scoreboard?: NetworkScoreboard | null
  outcome?: 'rejected' | 'expired' | null
}>
type PendingRoomEntry = {
  generation: number
  requestId: number
  requestType: 'createRoom' | 'joinRoom' | 'rejoinRoom'
  responseType: 'roomCreated' | 'roomJoined' | 'roomRejoined'
  roomId: string
  expectedPlayerId?: PlayerId
  matched: boolean
}

const MATCHED_ENTRY_MAX_ATTEMPTS = 10
const MATCHED_ENTRY_RETRY_SECONDS = 0.5
const MATCHED_ENTRY_WATCHDOG_SECONDS = 6
const emptyTrustees = (): Record<PlayerId, NetworkTrustee | null> => ({ p1: null, p2: null, p3: null, p4: null })
const emptyTimeouts = (): Record<PlayerId, number> => ({ p1: 0, p2: 0, p3: 0, p4: 0 })

const { ccclass, property } = _decorator

/** Cocos counterpart of the desktop Lobby page, using the raw WebSocket protocol. */
@ccclass('LobbyController')
export class LobbyController extends Component {
  @property(GameSession)
  public session: GameSession | null = null

  public readonly events = new EventTarget()
  public snapshot: LobbySnapshot = {
    connected: false,
    rooms: [],
    roomId: null,
    members: [],
    myPlayerId: null,
    roomStatus: 'idle',
    error: null,
    turnDeadlineAt: null,
    deadlinePlayerId: null,
    deadlineAction: null,
    trustees: emptyTrustees(),
    consecutiveTimeouts: emptyTimeouts(),
    lobbyReadyRequired: false,
    lobbyReadyPlayerIds: [],
    botPlayerIds: [],
    roundReadyPlayerIds: [],
    dissolveVote: null,
    roomSettings: null,
    scoreboard: null,
  }
  private readonly client = new CocosSocketClient()
  private endpoint = ''
  private resumeToken: string | null = null
  private lastVersion = -1
  private effectSyncCursor: NetworkEffectCursor | null = null
  private lastAppliedStateSync: { roomId: string, version: number, effectSync: NetworkEffectSync } | null = null
  private readonly processedRoomEvents = new Set<string>()
  private readonly processedVersionedEvents = new Set<string>()
  private pendingMatchedRoom: MatchedRoomEntry | null = null
  private entryGeneration = 0
  private pendingRoomEntry: PendingRoomEntry | null = null
  private matchedJoinInFlight = false
  private matchedJoinAttempts = 0
  private readonly cleanupRequestRooms = new Map<number, string>()
  private readonly cleanupRoomIds = new Set<string>()

  protected onLoad (): void {
    if (!this.session) this.session = this.getComponent(GameSession)
    this.client.on('connected', () => {
      if (this.pendingMatchedRoom) {
        this.patch({ connected: true, roomStatus: 'joining', error: null })
        if (this.rejectExpiredMatchedEntry()) return
        this.attemptMatchedRoomEntry()
        return
      }
      const { roomId, myPlayerId } = this.snapshot
      const canResume = Boolean(roomId && myPlayerId && this.resumeToken)
      this.patch({ connected: true, roomStatus: canResume ? 'rejoining' : 'idle', error: null })
      if (roomId && myPlayerId && this.resumeToken) {
        const requestId = this.beginRoomEntry(
          'rejoinRoom',
          'roomRejoined',
          roomId,
          { roomId, myPlayerId, resumeToken: this.resumeToken },
          myPlayerId,
        )
        if (requestId === null) this.closeRoomLocally('无法恢复房间，请重新加入')
      } else {
        this.refreshRooms()
      }
    })
    this.client.on('disconnected', () => {
      const retryMatchedEntry = Boolean(this.pendingMatchedRoom)
      this.invalidateRoomEntryRequest()
      this.patch({
        connected: false,
        roomStatus: retryMatchedEntry ? 'joining' : this.snapshot.roomId && this.resumeToken ? 'rejoining' : 'idle',
        error: '网络连接已断开，正在重新连接',
      })
      this.events.emit('guandan:network-error', '网络连接已断开，正在重新连接')
    })
    this.client.on('requestResult', (result: NetworkRequestResult) => this.handleRequestResult(result))
    this.client.on('error', (message: Wire<{ message?: string }>) => {
      // Direct request rejects are already routed through requestResult, where
      // their request id can be matched to the correct pending game action.
      if (typeof message.requestId === 'number') return
      this.reportError(message.message ?? '网络错误')
    })
    this.client.on('roomList', (message: Wire<{ rooms?: NetworkRoom[] }>) => this.patch({ rooms: message.rooms ?? [] }))
    this.client.on('roomCreated', (message: RoomSnapshotWire) => this.applyRoomEntry(message, message.memberPlayerIds ?? ['p1']))
    this.client.on('roomJoined', (message: RoomSnapshotWire) => this.applyRoomEntry(message, message.memberPlayerIds ?? this.snapshot.members))
    this.client.on('roomRejoined', (message: RoomSnapshotWire) => this.applyRoomEntry(message, message.memberPlayerIds ?? this.snapshot.members))
    this.client.on('roomMembers', (message: LiveMetadataWire & { memberPlayerIds?: PlayerId[] }) => {
      if (this.applyLiveMetadata(message)) this.patch({ members: message.memberPlayerIds ?? [] })
    })
    this.client.on('lobbyReadyUpdated', (message: LiveMetadataWire) => {
      if (!this.applyLiveMetadata(message)) return
      this.events.emit('guandan:lobby-ready', this.snapshot.lobbyReadyPlayerIds ?? [])
    })
    this.client.on('turnDeadline', (message: LiveMetadataWire) => {
      if (!this.applyLiveMetadata(message)) return
      this.events.emit('guandan:turn-deadline', {
        currentTurn: message.currentTurn ?? null,
        turnDeadlineAt: this.snapshot.turnDeadlineAt ?? null,
        deadlinePlayerId: this.snapshot.deadlinePlayerId ?? null,
        deadlineAction: this.snapshot.deadlineAction ?? null,
      })
    })
    this.client.on('trusteeUpdated', (message: LiveMetadataWire) => {
      if (!this.applyLiveMetadata(message)) return
      this.events.emit('guandan:trustee', this.snapshot.trustees ?? emptyTrustees())
    })
    this.client.on('roundReadyUpdated', (message: LiveMetadataWire) => {
      if (!this.applyLiveMetadata(message)) return
      this.events.emit('guandan:round-ready', this.snapshot.roundReadyPlayerIds ?? [])
    })
    this.client.on('dissolveVoteUpdated', (message: LiveMetadataWire) => {
      if (!this.applyLiveMetadata(message)) return
      this.events.emit('guandan:dissolve-vote', { vote: this.snapshot.dissolveVote ?? null, outcome: message.outcome ?? null })
    })
    this.client.on('turnTimedOut', (message: LiveMetadataWire & { playerId?: PlayerId, action?: NetworkDeadlineAction, enteredTrustee?: boolean }) => {
      if (!this.applyLiveMetadata(message)) return
      this.events.emit('guandan:turn-timeout', { playerId: message.playerId ?? null, action: message.action ?? null, enteredTrustee: Boolean(message.enteredTrustee) })
    })
    this.client.on('gameState', (message: LiveMetadataWire & { state?: EngineState }) => {
      this.applyLiveMetadata(message)
      if (!message.state || !this.acceptRoomMessage(message.roomId) || !this.acceptVersion('game-state', message.version)) return
      this.patch({ error: null })
      const packet = this.statePacket(message.state, message.roomId, message.version)
      if (packet) this.events.emit('guandan:network-state', packet)
    })
    this.client.on('roundEnded', (message: LiveMetadataWire & { result?: SettlementResult }) => {
      this.applyLiveMetadata(message)
      if (!message.result || !this.acceptRoomMessage(message.roomId) || !this.acceptVersion('round-ended', message.version)) return
      this.emitRoundEnded(message.result, message.roomId, message.version)
    })
    this.client.on('roundPrepared', (message: LiveMetadataWire & { state?: EngineState, tribute?: TributeState }) => {
      this.applyLiveMetadata(message)
      if (!message.state || !this.acceptRoomMessage(message.roomId) || !this.acceptVersion('round-prepared', message.version)) return
      const packet = this.statePacket(message.state, message.roomId, message.version, 'round-reset')
      if (packet) this.events.emit('guandan:round-prepared', { ...packet, tribute: message.tribute ?? null } satisfies NetworkRoundPacket)
    })
    this.client.on('tributeUpdated', (message: LiveMetadataWire & { state?: EngineState, tribute?: TributeState }) => {
      this.applyLiveMetadata(message)
      if (!message.state || !this.acceptRoomMessage(message.roomId) || !this.acceptVersion('tribute-updated', message.version)) return
      const packet = this.statePacket(message.state, message.roomId, message.version)
      if (packet) this.events.emit('guandan:round-prepared', { ...packet, tribute: message.tribute ?? null } satisfies NetworkRoundPacket)
    })
    this.client.on('chat', (message: Wire<{ roomId?: string, playerId?: PlayerId, text?: string }>) => {
      if (this.acceptRoomMessage(message.roomId) && message.playerId && message.text) this.events.emit('guandan:chat', { playerId: message.playerId, text: message.text })
    })
    this.client.on('hostLeft', (message: Wire<{ roomId?: string }>) => {
      if (this.acceptRoomMessage(message.roomId)) this.closeRoomLocally('房主已离开，房间已关闭')
    })
    this.client.on('roomDissolved', (message: Wire<{ roomId?: string, reason?: string }>) => {
      if (this.acceptRoomMessage(message.roomId)) this.closeRoomLocally(message.reason === 'vote-approved' ? '全员同意，房间已解散' : '房间已解散')
    })
    this.client.on('roomKicked', (message: Wire<{ roomId?: string, reason?: string }>) => {
      if (this.acceptRoomMessage(message.roomId)) this.closeRoomLocally('已被房主移出房间')
    })
  }

  public connect (endpoint: string): void {
    if (this.snapshot.connected && endpoint === this.endpoint) return
    this.endpoint = endpoint
    void this.client.connect(endpoint).catch(error => this.reportError(error instanceof Error ? error.message : '无法连接服务器', { connected: false }))
  }

  /** Enters a room reserved by the platform matchmaking coordinator. */
  public enterMatchedRoom (entry: MatchedRoomEntry): void {
    if (!/^\d{6}$/.test(entry.roomId) || !entry.gameEndpoint || !entry.gameTicket || !['p1', 'p2', 'p3', 'p4'].includes(entry.seat)) {
      this.reportError('匹配服务返回了无效的入桌信息')
      return
    }
    if (this.isMatchedEntryExpired(entry)) {
      this.reportError('匹配入桌凭证已过期，请重新匹配')
      return
    }
    this.clearRoomIdentity()
    this.pendingMatchedRoom = entry
    this.endpoint = entry.gameEndpoint
    this.session?.enterLobby()
    this.patch({ roomId: entry.roomId, myPlayerId: entry.seat, members: [], lobbyReadyRequired: false, lobbyReadyPlayerIds: [], botPlayerIds: [], roomSettings: null, scoreboard: null, roomStatus: 'joining', error: null })
    void this.client.connect(entry.gameEndpoint)
      .then(() => this.attemptMatchedRoomEntry())
      .catch(error => {
        if (!this.pendingMatchedRoom) return
        this.reportError(error instanceof Error ? error.message : '无法连接匹配牌桌', { connected: false, roomStatus: 'joining' })
      })
  }

  public refreshRooms (): number | null { return this.send('listRooms') }
  public createRoom (hostName = '玩家', roomSettings: FriendRoomSettings = DEFAULT_FRIEND_ROOM_SETTINGS): number | null {
    if (!this.canBeginManualEntry()) return null
    const roomId = String(Math.floor(100000 + Math.random() * 900000))
    this.patch({ roomStatus: 'joining', error: null })
    const requestId = this.beginRoomEntry('createRoom', 'roomCreated', roomId, { roomId, hostName, roomSettings }, 'p1')
    if (requestId === null) this.patch({ roomStatus: 'idle' })
    return requestId
  }
  public joinRoom (roomId: string): number | null {
    if (!/^\d{6}$/.test(roomId)) { this.reportError('房间号必须为六位数字'); return null }
    if (!this.canBeginManualEntry()) return null
    this.patch({ roomStatus: 'joining', error: null })
    const requestId = this.beginRoomEntry('joinRoom', 'roomJoined', roomId, { roomId })
    if (requestId === null) this.patch({ roomStatus: 'idle' })
    return requestId
  }
  public startGame (): number | null { return this.sendRoomIntent('startGame') }
  public setLobbyReady (): number | null { return this.sendRoomIntent('setLobbyReady') }
  public cancelLobbyReady (): number | null { return this.sendRoomIntent('cancelLobbyReady') }
  public kickMember (playerId: PlayerId): number | null { return this.sendRoomIntent('kickMember', { playerId }) }
  public addBot (playerId: PlayerId): number | null { return this.sendRoomIntent('addBot', { playerId }) }
  public removeBot (playerId: PlayerId): number | null { return this.sendRoomIntent('removeBot', { playerId }) }
  public play (cardIds: string[]): number | null { return this.sendRoomIntent('play', { cardIds }) }
  public pass (): number | null { return this.sendRoomIntent('pass') }
  /** Compatibility alias: the server now treats nextRound as this seat's ready vote. */
  public nextRound (): number | null { return this.readyNextRound() }
  public readyNextRound (): number | null { return this.sendRoomIntent('readyNextRound') }
  public cancelRoundReady (): number | null { return this.sendRoomIntent('cancelRoundReady') }
  public setTrustee (): number | null { return this.sendRoomIntent('setTrustee') }
  public cancelTrustee (): number | null { return this.sendRoomIntent('cancelTrustee') }
  public proposeDissolve (): number | null { return this.sendRoomIntent('proposeDissolve') }
  public voteDissolve (agree: boolean): number | null { return this.sendRoomIntent('dissolveVote', { agree }) }
  public tribute (cardId: string): number | null { return this.sendRoomIntent('tribute', { cardId }) }
  public returnTribute (cardId: string): number | null { return this.sendRoomIntent('returnTribute', { cardId }) }
  public finishTribute (): number | null { return this.sendRoomIntent('finishTribute') }
  public chat (text: string): number | null { return this.sendRoomIntent('chat', { text }) }
  public leaveRoom (): void { this.exitRoom('leaveRoom') }
  public safeExit (): void { this.exitRoom('safeExit') }

  private exitRoom (intent: 'leaveRoom' | 'safeExit'): void {
    const roomId = this.snapshot.roomId
    if (roomId && this.snapshot.connected) {
      this.patch({ roomStatus: 'leaving' })
      this.send(intent, { roomId })
    }
    this.clearRoomIdentity()
    this.patch({
      roomId: null,
      members: [],
      myPlayerId: null,
      roomStatus: 'idle',
      turnDeadlineAt: null,
      deadlinePlayerId: null,
      deadlineAction: null,
      trustees: emptyTrustees(),
      consecutiveTimeouts: emptyTimeouts(),
      lobbyReadyRequired: false,
      lobbyReadyPlayerIds: [],
      botPlayerIds: [],
      roundReadyPlayerIds: [],
      dissolveVote: null,
      roomSettings: null,
      scoreboard: null,
    })
    this.session?.leaveToMenu()
  }

  protected onDestroy (): void { this.client.close() }

  private sendRoomIntent (type: string, payload: Record<string, unknown> = {}): number | null {
    if (!this.snapshot.roomId || this.snapshot.roomStatus !== 'ready') return null
    return this.send(type, { roomId: this.snapshot.roomId, ...payload })
  }

  private send (type: string, payload?: unknown): number | null {
    try {
      return this.client.send(type, payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : '网络未连接'
      const result = { requestId: null, requestType: type, responseType: 'client-error', ok: false, message } satisfies LobbyNetworkResult
      this.events.emit('guandan:network-result', result)
      this.reportError(message)
      return null
    }
  }

  private canBeginManualEntry (): boolean {
    if (this.snapshot.roomStatus === 'joining') {
      this.reportError('正在加入房间，请勿重复操作')
      return false
    }
    if (this.snapshot.roomStatus !== 'idle' || this.snapshot.roomId) {
      this.reportError('请先离开当前房间')
      return false
    }
    return true
  }

  private beginRoomEntry (
    requestType: PendingRoomEntry['requestType'],
    responseType: PendingRoomEntry['responseType'],
    roomId: string,
    payload: Record<string, unknown>,
    expectedPlayerId?: PlayerId,
    matched = false,
  ): number | null {
    const generation = ++this.entryGeneration
    this.pendingRoomEntry = null
    const requestId = this.send(requestType, payload)
    if (requestId === null) return null
    this.pendingRoomEntry = { generation, requestId, requestType, responseType, roomId, expectedPlayerId, matched }
    return requestId
  }

  private handleRequestResult (result: NetworkRequestResult): void {
    const cleanupRoomId = this.cleanupRequestRooms.get(result.requestId)
    if (cleanupRoomId) {
      this.cleanupRequestRooms.delete(result.requestId)
      if (!Array.from(this.cleanupRequestRooms.values()).includes(cleanupRoomId)) this.cleanupRoomIds.delete(cleanupRoomId)
      return
    }
    this.events.emit('guandan:network-result', result)
    if (result.ok) return
    const message = result.message ?? '服务器拒绝了请求'
    if (result.requestType === 'createRoom' || result.requestType === 'joinRoom' || result.requestType === 'rejoinRoom') {
      const pending = this.pendingRoomEntry
      if (!pending || pending.requestId !== result.requestId || pending.requestType !== result.requestType || pending.generation !== this.entryGeneration) return
      this.invalidateRoomEntryRequest()
      if (pending.matched) {
        if (this.rejectExpiredMatchedEntry()) return
        if (this.matchedJoinAttempts < MATCHED_ENTRY_MAX_ATTEMPTS && this.isRetriableMatchedEntryFailure(message)) {
          const retryGeneration = this.entryGeneration
          this.patch({ roomStatus: 'joining', error: '比赛匹配暂未完成，正在重试' })
          // An arrow callback is required here: Cocos Component.scheduleOnce
          // does not promise to restore a method reference's `this` binding.
          this.scheduleOnce(() => {
            if (retryGeneration !== this.entryGeneration || !this.pendingMatchedRoom) return
            this.attemptMatchedRoomEntry()
          }, MATCHED_ENTRY_RETRY_SECONDS)
          return
        }
        this.bestEffortLeaveRoom(pending.roomId)
        this.failMatchedRoomEntry('比赛匹配失败，请稍后重试')
        return
      }
      if (pending.requestType === 'rejoinRoom') {
        this.closeRoomLocally(`房间恢复失败：${message}`)
        return
      }
      this.patch({ roomStatus: 'idle', error: message })
      return
    }
    this.patch({ error: message })
  }

  private applyRoomEntry (message: RoomSnapshotWire, members: PlayerId[]): void {
    const pending = this.pendingRoomEntry
    if (!this.isExpectedRoomEntry(message, pending)) {
      this.rejectUnexpectedRoomEntry(message, pending)
      return
    }
    if (!message.roomId || !message.myPlayerId || !message.resumeToken) {
      this.bestEffortLeaveRoom(message.roomId)
      this.invalidateRoomEntryRequest()
      if (pending.matched) this.failMatchedRoomEntry('服务器未返回安全的重连凭证，请重新匹配')
      else if (pending.requestType === 'rejoinRoom') this.closeRoomLocally('服务器未返回安全的重连凭证，请重新加入')
      else this.patch({ roomStatus: 'idle', error: '服务器未返回安全的重连凭证，请重新加入' })
      return
    }
    const recoveryReason: ForcedNetworkRecoveryReason = pending.requestType === 'rejoinRoom' ? 'reconnect' : 'initial-snapshot'
    this.pendingRoomEntry = null
    this.entryGeneration += 1
    this.pendingMatchedRoom = null
    this.matchedJoinInFlight = false
    this.matchedJoinAttempts = 0
    this.enterRoom(message.roomId, message.myPlayerId, message.resumeToken, members)
    this.applyLiveMetadata(message)
    if (!message.state) return
    const version = this.normalizedVersion(message.version)
    this.lastVersion = Math.max(this.lastVersion, version)
    const packet = this.statePacket(message.state, message.roomId, version, recoveryReason)
    if (!packet) return
    const phase = message.phase ?? (message.roundResult ? 'settlement' : message.tribute ? 'tribute' : 'playing')
    if (phase === 'tribute') {
      this.events.emit('guandan:round-prepared', { ...packet, tribute: message.tribute ?? null } satisfies NetworkRoundPacket)
      return
    }
    this.events.emit('guandan:network-state', packet)
    if (phase === 'settlement' && message.roundResult) this.emitRoundEnded(message.roundResult, message.roomId, version, packet.effectSync)
  }

  private isExpectedRoomEntry (message: RoomSnapshotWire, pending: PendingRoomEntry | null): pending is PendingRoomEntry {
    return Boolean(
      pending &&
      pending.generation === this.entryGeneration &&
      message.requestId === pending.requestId &&
      message.type === pending.responseType &&
      message.roomId === pending.roomId &&
      (!pending.expectedPlayerId || message.myPlayerId === pending.expectedPlayerId) &&
      this.snapshot.roomStatus === (pending.requestType === 'rejoinRoom' ? 'rejoining' : 'joining'),
    )
  }

  private rejectUnexpectedRoomEntry (message: RoomSnapshotWire, pending: PendingRoomEntry | null): void {
    this.bestEffortLeaveRoom(message.roomId, message)
    // A response for another generation is harmless after cleanup and must not
    // disturb a newer request for another room. If both attempts target the
    // same seat, however, cleanup also invalidates the newer attempt so a
    // queued success cannot make the client ready after leaveRoom is sent.
    const matchesPendingRequest = Boolean(pending && message.requestId === pending.requestId && pending.generation === this.entryGeneration)
    const conflictsWithPendingSeat = Boolean(
      pending &&
      pending.generation === this.entryGeneration &&
      message.roomId === pending.roomId &&
      (!pending.expectedPlayerId || message.myPlayerId === pending.expectedPlayerId),
    )
    if (!pending || (!matchesPendingRequest && !conflictsWithPendingSeat)) return
    this.invalidateRoomEntryRequest()
    if (pending.matched) {
      this.failMatchedRoomEntry('匹配服务返回了与请求不一致的牌桌信息')
      return
    }
    if (pending.requestType === 'rejoinRoom') {
      this.closeRoomLocally('房间恢复响应与请求不一致，请重新加入')
      return
    }
    this.patch({ roomStatus: 'idle', error: '服务器返回了与请求不一致的房间信息' })
  }

  private enterRoom (roomId: string, myPlayerId: PlayerId, resumeToken: string, members: PlayerId[]): void {
    const isNewRoom = roomId !== this.snapshot.roomId || resumeToken !== this.resumeToken
    if (isNewRoom) {
      this.lastVersion = -1
      this.effectSyncCursor = null
      this.lastAppliedStateSync = null
      this.processedRoomEvents.clear()
      this.processedVersionedEvents.clear()
    }
    this.resumeToken = resumeToken
    this.patch({
      roomId,
      myPlayerId,
      members,
      roomStatus: 'ready',
      error: null,
      ...(isNewRoom
        ? { turnDeadlineAt: null, deadlinePlayerId: null, deadlineAction: null, trustees: emptyTrustees(), consecutiveTimeouts: emptyTimeouts(), lobbyReadyRequired: false, lobbyReadyPlayerIds: [], botPlayerIds: [], roundReadyPlayerIds: [], dissolveVote: null, roomSettings: null, scoreboard: null }
        : {}),
    })
    this.session?.joinRoom(roomId, myPlayerId)
  }

  private emitRoundEnded (result: SettlementResult, roomId?: string, version?: number, effectSync = this.effectSyncForVersion(roomId, version)): void {
    const normalizedRoomId = roomId ?? this.snapshot.roomId
    if (!normalizedRoomId) return
    const key = `round-ended:${normalizedRoomId}:${this.normalizedVersion(version)}`
    if (this.processedRoomEvents.has(key)) return
    this.processedRoomEvents.add(key)
    this.events.emit('guandan:round-ended', { result, effectSync } satisfies NetworkRoundEndedPacket)
  }

  private acceptRoomMessage (roomId?: string): boolean {
    return Boolean(
      this.snapshot.roomId &&
      this.snapshot.roomStatus === 'ready' &&
      (!roomId || !this.cleanupRoomIds.has(roomId)) &&
      (!roomId || roomId === this.snapshot.roomId),
    )
  }

  private applyLiveMetadata (message: LiveMetadataWire): boolean {
    if (!this.acceptRoomMessage(message.roomId)) return false
    const normalized = this.normalizedVersion(message.version)
    if (normalized < this.lastVersion) return false
    if (normalized > this.lastVersion) {
      this.lastVersion = normalized
      this.processedVersionedEvents.clear()
    }
    const next: Partial<LobbySnapshot> = {}
    if (Object.prototype.hasOwnProperty.call(message, 'turnDeadlineAt')) next.turnDeadlineAt = message.turnDeadlineAt ?? null
    if (Object.prototype.hasOwnProperty.call(message, 'deadlinePlayerId')) next.deadlinePlayerId = message.deadlinePlayerId ?? null
    if (Object.prototype.hasOwnProperty.call(message, 'deadlineAction')) next.deadlineAction = message.deadlineAction ?? null
    if (message.trustees) next.trustees = message.trustees
    if (message.consecutiveTimeouts) next.consecutiveTimeouts = message.consecutiveTimeouts
    if (Object.prototype.hasOwnProperty.call(message, 'lobbyReadyRequired')) next.lobbyReadyRequired = Boolean(message.lobbyReadyRequired)
    if (message.lobbyReadyPlayerIds) next.lobbyReadyPlayerIds = message.lobbyReadyPlayerIds
    if (message.botPlayerIds) next.botPlayerIds = message.botPlayerIds
    if (message.roundReadyPlayerIds) next.roundReadyPlayerIds = message.roundReadyPlayerIds
    if (Object.prototype.hasOwnProperty.call(message, 'dissolveVote')) next.dissolveVote = message.dissolveVote ?? null
    if (Object.prototype.hasOwnProperty.call(message, 'roomSettings')) next.roomSettings = message.roomSettings ?? null
    if (Object.prototype.hasOwnProperty.call(message, 'scoreboard')) next.scoreboard = message.scoreboard ?? null
    if (Object.keys(next).length > 0) this.patch(next)
    return true
  }

  private acceptVersion (eventType: string, version?: number): boolean {
    const normalized = this.normalizedVersion(version)
    if (normalized < this.lastVersion) return false
    if (normalized > this.lastVersion) {
      this.lastVersion = normalized
      this.processedVersionedEvents.clear()
    }
    const key = `${eventType}:${normalized}`
    if (this.processedVersionedEvents.has(key)) return false
    this.processedVersionedEvents.add(key)
    return true
  }

  private normalizedVersion (version?: number): number { return Number.isInteger(version) ? Number(version) : Math.max(this.lastVersion, 0) }

  private statePacket (state: EngineState, roomId?: string, version?: number, forceRecovery?: ForcedNetworkRecoveryReason): NetworkStatePacket | null {
    const normalizedRoomId = roomId ?? this.snapshot.roomId ?? ''
    const normalizedVersion = this.normalizedVersion(version)
    const decision = decideNetworkEffectSync(this.effectSyncCursor, {
      roomId: normalizedRoomId,
      version: normalizedVersion,
      actionCount: state.playArea.length,
      forceRecovery,
    })
    if (decision.kind === 'drop') return null
    this.effectSyncCursor = decision.cursor
    this.lastAppliedStateSync = { roomId: normalizedRoomId, version: normalizedVersion, effectSync: decision.sync }
    return { roomId: normalizedRoomId, version: normalizedVersion, state, effectSync: decision.sync }
  }

  private effectSyncForVersion (roomId?: string, version?: number): NetworkEffectSync {
    const normalizedRoomId = roomId ?? this.snapshot.roomId ?? ''
    const normalizedVersion = this.normalizedVersion(version)
    if (this.lastAppliedStateSync?.roomId === normalizedRoomId && this.lastAppliedStateSync.version === normalizedVersion) {
      return this.lastAppliedStateSync.effectSync
    }
    return { mode: 'incremental' }
  }

  private closeRoomLocally (message: string): void {
    const hadRoom = Boolean(this.snapshot.roomId)
    this.clearRoomIdentity()
    this.patch({
      roomId: null,
      members: [],
      myPlayerId: null,
      roomStatus: 'idle',
      error: message,
      turnDeadlineAt: null,
      deadlinePlayerId: null,
      deadlineAction: null,
      trustees: emptyTrustees(),
      consecutiveTimeouts: emptyTimeouts(),
      lobbyReadyRequired: false,
      lobbyReadyPlayerIds: [],
      botPlayerIds: [],
      roundReadyPlayerIds: [],
      dissolveVote: null,
      roomSettings: null,
      scoreboard: null,
    })
    this.session?.enterLobby()
    if (hadRoom) this.events.emit('guandan:room-closed', message)
    if (this.snapshot.connected) this.refreshRooms()
  }

  private clearRoomIdentity (): void {
    this.invalidateRoomEntryRequest()
    this.pendingMatchedRoom = null
    this.matchedJoinAttempts = 0
    this.resumeToken = null
    this.lastVersion = -1
    this.effectSyncCursor = null
    this.lastAppliedStateSync = null
    this.processedRoomEvents.clear()
    this.processedVersionedEvents.clear()
  }

  private attemptMatchedRoomEntry (): void {
    const entry = this.pendingMatchedRoom
    if (!entry || !this.snapshot.connected || this.matchedJoinInFlight) return
    if (this.rejectExpiredMatchedEntry()) return
    this.matchedJoinInFlight = true
    this.matchedJoinAttempts += 1
    const payload = { roomId: entry.roomId, gameTicket: entry.gameTicket }
    const requestId = entry.seat === 'p1'
      ? this.beginRoomEntry('createRoom', 'roomCreated', entry.roomId, { ...payload, hostName: entry.displayName ?? '匹配玩家' }, entry.seat, true)
      : this.beginRoomEntry('joinRoom', 'roomJoined', entry.roomId, payload, entry.seat, true)
    if (requestId === null) {
      this.matchedJoinInFlight = false
      return
    }
    const watchdogGeneration = this.entryGeneration
    // Keep this arrow-bound for Cocos scheduleOnce; the generation/request
    // guards also make callbacks from an earlier attempt harmless.
    this.scheduleOnce(() => {
      const pending = this.pendingRoomEntry
      if (!pending || pending.generation !== watchdogGeneration || pending.requestId !== requestId || !pending.matched) return
      const roomId = pending.roomId
      this.invalidateRoomEntryRequest()
      if (this.rejectExpiredMatchedEntry()) return
      if (this.matchedJoinAttempts < MATCHED_ENTRY_MAX_ATTEMPTS) {
        const retryGeneration = this.entryGeneration
        this.patch({ roomStatus: 'joining', error: '匹配入桌响应超时，正在恢复席位' })
        // The server treats the same ticket jti as an idempotent entry retry and
        // returns the original resume token if the first response was lost.
        this.scheduleOnce(() => {
          if (retryGeneration !== this.entryGeneration || !this.pendingMatchedRoom) return
          if (this.snapshot.connected) {
            this.attemptMatchedRoomEntry()
            return
          }
          const reconnectEntry = this.pendingMatchedRoom
          void this.client.connect(reconnectEntry.gameEndpoint)
            .then(() => {
              if (retryGeneration !== this.entryGeneration || this.pendingMatchedRoom !== reconnectEntry) return
              this.patch({ connected: true, roomStatus: 'joining', error: null })
              this.attemptMatchedRoomEntry()
            })
            .catch(error => {
              if (retryGeneration === this.entryGeneration && this.pendingMatchedRoom === reconnectEntry) {
                this.reportError(error instanceof Error ? error.message : '无法恢复匹配牌桌', { connected: false, roomStatus: 'joining' })
              }
            })
        }, MATCHED_ENTRY_RETRY_SECONDS)
        return
      }
      this.bestEffortLeaveRoom(roomId)
      this.failMatchedRoomEntry('匹配入桌多次超时，请重新匹配')
    }, MATCHED_ENTRY_WATCHDOG_SECONDS)
  }

  private invalidateRoomEntryRequest (): void {
    this.entryGeneration += 1
    this.pendingRoomEntry = null
    this.matchedJoinInFlight = false
  }

  private isMatchedEntryExpired (entry: MatchedRoomEntry): boolean {
    if (entry.expiresAt === undefined) return false
    return !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now()
  }

  private rejectExpiredMatchedEntry (): boolean {
    const entry = this.pendingMatchedRoom
    if (!entry || !this.isMatchedEntryExpired(entry)) return false
    if (this.matchedJoinAttempts > 0) this.bestEffortLeaveRoom(entry.roomId)
    this.failMatchedRoomEntry('匹配入桌凭证已过期，请重新匹配')
    return true
  }

  private isRetriableMatchedEntryFailure (message: string): boolean {
    return /房间不存在|牌桌尚未准备|房主尚未进入|暂时不可用|请稍后重试/.test(message)
  }

  private failMatchedRoomEntry (message: string): void {
    this.pendingMatchedRoom = null
    this.closeRoomLocally(message)
  }

  private bestEffortLeaveRoom (roomId?: string, message?: RoomSnapshotWire): void {
    if (!roomId || !this.snapshot.connected) return
    const isAcceptedCurrentRoom = Boolean(
      message?.resumeToken &&
      this.snapshot.roomStatus === 'ready' &&
      this.snapshot.roomId === roomId &&
      this.snapshot.myPlayerId === message.myPlayerId &&
      this.resumeToken === message.resumeToken,
    )
    if (isAcceptedCurrentRoom) return
    try {
      const requestId = this.client.send('leaveRoom', { roomId })
      this.cleanupRequestRooms.set(requestId, roomId)
      this.cleanupRoomIds.add(roomId)
      this.scheduleOnce(() => {
        if (this.cleanupRequestRooms.get(requestId) !== roomId) return
        this.cleanupRequestRooms.delete(requestId)
        if (!Array.from(this.cleanupRequestRooms.values()).includes(roomId)) this.cleanupRoomIds.delete(roomId)
      }, MATCHED_ENTRY_WATCHDOG_SECONDS)
    } catch {
      // The connection may have closed between validation and cleanup. The
      // server's disconnect handling is the remaining best-effort release.
    }
  }

  private reportError (message: string, next: Partial<LobbySnapshot> = {}): void {
    this.patch({ ...next, error: message })
    this.events.emit('guandan:network-error', message)
  }

  private patch (next: Partial<LobbySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    this.events.emit('guandan:lobby', this.snapshot)
  }
}
