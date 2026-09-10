import { _decorator, Component, EventTarget, sys } from 'cc'
import type { PlayerId } from '../core/generated'
import type { ForcedNetworkRecoveryReason } from '../effects/NetworkEffectSyncPolicy'
import { GameSession } from '../session/GameSession'
import { CocosSocketClient } from './CocosSocketClient'
import { LobbyCleanupTracker } from './LobbyCleanupTracker'
import { LobbyCommandSender } from './LobbyCommandSender'
import { LobbyConnectionEventCoordinator } from './LobbyConnectionEventCoordinator'
import { isEntryAttemptId, LobbyEntryAttemptTracker } from './LobbyEntryAttempt'
import { isExpectedRoomEntry, LobbyEntryRequest } from './LobbyEntryRequest'
import { LobbyMatchedEntryCoordinator } from './LobbyMatchedEntryCoordinator'
import { LobbyResumeConnectionWatchdog } from './LobbyResumeConnectionWatchdog'
import {
  DEFAULT_FRIEND_ROOM_SETTINGS,
  createClearedRoomPatch,
  createLobbySnapshot,
  createRoomMetadataDefaults,
  type FriendRoomSettings,
  type LobbySnapshot,
  type MatchedRoomEntry,
  type PendingRoomEntry,
  type RoomSnapshotWire,
} from './LobbyModels'
import { LobbyMessageRouter } from './LobbyMessageRouter'
import type { LobbySocketClient, LobbySocketListener, NetworkRequestResult } from './LobbySocketClient'
import { LobbyResumeSessionStore, type LobbyResumeStorage } from './LobbyResumeSession'
export { DEFAULT_FRIEND_ROOM_SETTINGS } from './LobbyModels'
export type { LobbySocketClient } from './LobbySocketClient'
export type {
  DissolveVoteChoice,
  FriendRoomSettings,
  LobbyNetworkResult,
  LobbyRoomStatus,
  LobbySnapshot,
  MatchEndedReason,
  MatchedRoomEntry,
  NetworkDeadlineAction,
  NetworkDissolveVote,
  NetworkMatchEnded,
  NetworkRoom,
  NetworkRoundEndedPacket,
  NetworkRoundPacket,
  NetworkScoreboard,
  NetworkStatePacket,
  NetworkTrustee,
  NetworkViewerRoundStats,
  TrusteeReason,
} from './LobbyModels'

const ROOM_CLEANUP_WATCHDOG_SECONDS = 6

const { ccclass, property } = _decorator

/** Cocos counterpart of the desktop Lobby page, using the raw WebSocket protocol. */
@ccclass('LobbyController')
export class LobbyController extends Component {
  @property(GameSession)
  public session: GameSession | null = null

  public readonly events = new EventTarget()
  public snapshot: LobbySnapshot = createLobbySnapshot()
  private client: LobbySocketClient = new CocosSocketClient()
  private readonly clientListenerDisposers: Array<() => void> = []
  private readonly entryAttempts = new LobbyEntryAttemptTracker()
  private readonly entryRequest = new LobbyEntryRequest()
  private readonly cleanup = new LobbyCleanupTracker()
  private readonly commands = new LobbyCommandSender({
    client: () => this.client,
    snapshot: () => this.snapshot,
    emitResult: result => this.events.emit('guandan:network-result', result),
    reportError: message => this.reportError(message),
  })
  private readonly messages = new LobbyMessageRouter({
    listen: (type, listener) => this.listen(type, listener),
    snapshot: () => this.snapshot,
    patch: next => this.patch(next),
    emit: (type, ...args) => this.events.emit(type, ...args),
    isRoomCleaning: roomId => this.cleanup.isCleaning(roomId),
    handleRequestResult: result => this.handleRequestResult(result),
    applyRoomEntry: (message, members) => this.applyRoomEntry(message, members),
    closeRoom: message => this.closeRoomLocally(message),
    reportError: message => this.reportError(message),
  })
  private readonly matchedEntries = new LobbyMatchedEntryCoordinator({
    connected: () => this.snapshot.connected,
    connect: endpoint => this.client.connect(endpoint),
    begin: (requestType, responseType, roomId, payload, expectedPlayerId) =>
      this.beginRoomEntry(requestType, responseType, roomId, payload, expectedPlayerId, true),
    pendingRoom: requestId => this.pendingMatchedRoom(requestId),
    resetTransport: () => { this.client.close(); this.patch({ connected: false }) },
    close: message => this.closeRoomLocally(message, false),
    requestRecovery: abandonAttemptId => this.events.emit('guandan:platform-recovery-required', abandonAttemptId ? { abandonAttemptId } : {}),
    patch: next => this.patch(next),
    reportError: (message, next) => this.reportError(message, next),
    schedule: (callback, delay) => this.scheduleOnce(callback, delay),
  })
  private readonly resumeConnections = new LobbyResumeConnectionWatchdog({
    schedule: (callback, delay) => this.scheduleOnce(callback, delay),
    onExhausted: message => {
      this.closeRoomForRecovery(message)
      this.events.emit('guandan:platform-recovery-required', {})
    },
  })
  private resumeSessions = new LobbyResumeSessionStore(sys.localStorage)
  private socketBound = false
  private endpoint = ''
  private resumeToken: string | null = null
  private activeMatchId: string | null = null
  private entryGeneration = 0
  private pendingRoomEntry: PendingRoomEntry | null = null
  private readonly connectionEvents = new LobbyConnectionEventCoordinator({
    snapshot: () => this.snapshot,
    resumeToken: () => this.resumeToken,
    matchedConnected: () => this.matchedEntries.handleConnected(),
    matchedDisconnected: () => this.matchedEntries.handleDisconnected(),
    resumePending: () => this.resumeConnections.pending,
    startResumeWatchdog: () => this.resumeConnections.start(),
    recordResumeFailure: () => this.resumeConnections.recordFailure(),
    beginEntry: (requestType, responseType, roomId, payload, expectedPlayerId) =>
      this.beginRoomEntry(requestType, responseType, roomId, payload, expectedPlayerId),
    invalidateEntry: () => this.invalidateRoomEntryRequest(),
    closeForRecovery: message => this.closeRoomForRecovery(message),
    requestPlatformRecovery: () => this.events.emit('guandan:platform-recovery-required', {}),
    refreshRooms: () => { this.refreshRooms() },
    patch: next => this.patch(next),
    reportDisconnect: message => this.events.emit('guandan:network-error', message),
  })

  /** Replaces the production WebSocket adapter before Cocos calls onLoad. */
  public setSocketClient (client: LobbySocketClient): void {
    if (this.socketBound) throw new Error('LobbySocketClient 必须在 onLoad 前注入')
    if (client === this.client) return
    this.client.close()
    this.client = client
  }

  public setResumeStorage (storage: LobbyResumeStorage): void {
    if (this.socketBound) throw new Error('LobbyResumeStorage 必须在 onLoad 前注入')
    this.resumeSessions = new LobbyResumeSessionStore(storage)
  }

  protected onLoad (): void {
    this.socketBound = true
    if (!this.session) this.session = this.getComponent(GameSession)
    this.listen('connected', () => this.connectionEvents.handleConnected())
    this.listen('disconnected', () => this.connectionEvents.handleDisconnected())
    this.messages.bind()
    this.restoreResumeSession()
  }

  public connect (endpoint: string): void {
    if (this.snapshot.connected && endpoint === this.endpoint) return
    this.endpoint = endpoint
    void this.client.connect(endpoint).catch(error => this.reportError(error instanceof Error ? error.message : '无法连接服务器', { connected: false }))
  }

  /** Enters a room reserved by the platform matchmaking coordinator. */
  public enterMatchedRoom (entry: MatchedRoomEntry): void {
    if (
      !/^\d{6}$/.test(entry.roomId) || !entry.gameEndpoint || !entry.gameTicket
      || !['p1', 'p2', 'p3', 'p4', 'observer'].includes(entry.seat)
      || !isEntryAttemptId(entry.entryAttemptId)
    ) {
      this.reportError('匹配服务返回了无效的入桌信息')
      return
    }
    if (LobbyMatchedEntryCoordinator.isExpired(entry)) {
      this.reportError('匹配入桌凭证已过期，请重新匹配')
      const abandonAttemptId = entry.recoveryAttemptId ?? (entry.ticketPurpose === 'rejoin' ? entry.entryAttemptId : undefined)
      this.events.emit('guandan:platform-recovery-required', abandonAttemptId ? { abandonAttemptId } : {})
      return
    }
    this.clearRoomIdentity()
    this.endpoint = entry.gameEndpoint
    this.session?.enterLobby()
    this.patch({ roomId: entry.roomId, myPlayerId: entry.seat === 'observer' ? 'p1' : entry.seat, members: [], lobbyReadyRequired: false, lobbyReadyPlayerIds: [], botPlayerIds: [], roomSettings: null, scoreboard: null, entryKind: null, capabilities: null, roomStatus: 'joining', recoveryAvailable: false, error: null })
    this.matchedEntries.start(entry)
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
  public standUp (): number | null { return this.sendRoomIntent('standUp') }
  public sitDown (playerId: PlayerId): number | null { return this.sendRoomIntent('sitDown', { playerId }) }
  public watchPlayer (playerId: PlayerId): number | null { return this.sendRoomIntent('watchPlayer', { playerId }) }
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
  public leaveRoom (): void { this.exitRoom('leaveRoom') }
  public safeExit (): void { this.exitRoom('safeExit') }
  public recoverActiveMatch (): void {
    if (!this.snapshot.recoveryAvailable) return
    this.patch({ recoveryAvailable: false, error: null })
    this.events.emit('guandan:platform-recovery-required', { manual: true })
  }

  public offerActiveMatchRecovery (message?: string): void { this.patch({ recoveryAvailable: true, ...(message ? { error: message } : {}) }) }

  private exitRoom (intent: 'leaveRoom' | 'safeExit'): void {
    if (this.snapshot.gameStartPending) { this.reportError('平台确认开局期间暂不能离开房间'); return }
    const roomId = this.snapshot.roomId
    const recoveryAvailable = intent === 'safeExit' && !this.snapshot.matchEnded
    if (roomId && this.snapshot.connected) {
      this.patch({ roomStatus: 'leaving' })
      this.send(intent, { roomId })
    }
    this.clearRoomIdentity()
    this.patch({ ...createClearedRoomPatch(), recoveryAvailable })
    this.session?.leaveToMenu()
  }

  protected onDestroy (): void {
    const disposers = this.clientListenerDisposers.splice(0)
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        console.warn('Unable to remove a lobby socket listener.', error)
      }
    }
    this.socketBound = false
    this.matchedEntries.clear()
    this.resumeConnections.clear()
    this.entryRequest.clear()
    this.client.close()
  }

  private listen<T> (type: string, listener: LobbySocketListener<T>): void {
    this.clientListenerDisposers.push(this.client.on(type, listener))
  }

  public sendRoomIntent (type: string, payload: Record<string, unknown> = {}): number | null {
    return this.commands.roomIntent(type, payload)
  }

  private send (type: string, payload?: unknown): number | null {
    return this.commands.send(type, payload)
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
    let entryPayload = payload
    let requestId: number | null
    try {
      if (requestType !== 'rejoinRoom') entryPayload = this.entryAttempts.decorate(payload, matched)
      requestId = this.entryRequest.send(requestType, entryPayload, matched || requestType === 'rejoinRoom',
        (type, body, retryId) => this.commands.send(type, body, retryId))
    } catch {
      this.reportError('当前环境无法生成安全入桌凭证，请升级客户端后重试')
      return null
    }
    if (requestId === null) return null
    this.pendingRoomEntry = { generation, requestId, requestType, responseType, roomId, expectedPlayerId, matched }
    return requestId
  }

  private handleRequestResult (result: NetworkRequestResult): void {
    if (this.cleanup.consumeResult(result.requestId)) return
    this.events.emit('guandan:network-result', result)
    if (result.ok) return
    const message = result.message ?? '服务器拒绝了请求'
    if (result.requestType === 'createRoom' || result.requestType === 'joinRoom' || result.requestType === 'rejoinRoom') {
      const pending = this.pendingRoomEntry
      if (!pending || pending.requestId !== result.requestId || pending.requestType !== result.requestType || pending.generation !== this.entryGeneration) return
      this.invalidateRoomEntryRequest()
      if (pending.matched) {
        this.matchedEntries.handleFailure(message, result.code)
        return
      }
      if (pending.requestType === 'rejoinRoom') {
        this.closeRoomForRecovery(`房间恢复失败：${message}`)
        this.events.emit('guandan:platform-recovery-required', {})
        return
      }
      this.patch({ roomStatus: 'idle', error: message })
      return
    }
    this.patch({ error: message })
  }

  private applyRoomEntry (message: RoomSnapshotWire, members: PlayerId[]): void {
    const pending = this.pendingRoomEntry
    if (!isExpectedRoomEntry(message, pending, this.entryGeneration, this.snapshot.roomStatus)) {
      this.rejectUnexpectedRoomEntry(message, pending)
      return
    }
    if (!message.roomId || !message.myPlayerId || !message.resumeToken) {
      this.bestEffortLeaveRoom(message.roomId)
      this.invalidateRoomEntryRequest()
      if (pending.matched) this.matchedEntries.reject('服务器未返回安全的重连凭证，请重新匹配')
      else if (pending.requestType === 'rejoinRoom') {
        this.closeRoomForRecovery('服务器未返回安全的重连凭证，请重新加入')
        this.events.emit('guandan:platform-recovery-required', {})
      }
      else this.patch({ roomStatus: 'idle', error: '服务器未返回安全的重连凭证，请重新加入' })
      return
    }
    const recoveryReason: ForcedNetworkRecoveryReason = pending.responseType === 'roomRejoined' ? 'reconnect' : 'initial-snapshot'
    const matchedEntry = this.matchedEntries.current
    const matchId = matchedEntry?.matchId ?? this.activeMatchId
    this.pendingRoomEntry = null
    this.entryGeneration += 1
    this.matchedEntries.complete()
    this.entryAttempts.clearMatched()
    this.entryRequest.clear()
    this.enterRoom(message.roomId, message.myPlayerId, message.resumeToken, members, matchId)
    if (matchedEntry) this.events.emit('guandan:room-entry-confirmed', {
      entryAttemptId: matchedEntry.entryAttemptId,
      recoveryAttemptId: matchedEntry.recoveryAttemptId,
      ticketPurpose: matchedEntry.ticketPurpose ?? 'entry',
    })
    this.messages.applyEntrySnapshot(message, recoveryReason)
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
      this.matchedEntries.reject('匹配服务返回了与请求不一致的牌桌信息')
      return
    }
    if (pending.requestType === 'rejoinRoom') {
      this.closeRoomForRecovery('房间恢复响应与请求不一致，请重新加入')
      this.events.emit('guandan:platform-recovery-required', {})
      return
    }
    this.patch({ roomStatus: 'idle', error: '服务器返回了与请求不一致的房间信息' })
  }

  private enterRoom (roomId: string, myPlayerId: PlayerId, resumeToken: string, members: PlayerId[], matchId: string | null): void {
    const isNewRoom = roomId !== this.snapshot.roomId || resumeToken !== this.resumeToken
    if (isNewRoom) this.messages.reset()
    this.resumeToken = resumeToken
    this.activeMatchId = matchId
    this.resumeConnections.clear()
    this.patch({
      roomId,
      myPlayerId,
      members,
      roomStatus: 'ready',
      recoveryAvailable: false,
      error: null,
      ...(isNewRoom ? createRoomMetadataDefaults() : {}),
    })
    if (!this.resumeSessions.save({ version: 1, endpoint: this.endpoint, roomId, seat: myPlayerId, resumeToken, ...(matchId ? { matchId } : {}) })) {
      this.patch({ error: '当前设备无法保存断线恢复凭证；本次牌局可继续，应用重启后需重新进入' })
      this.events.emit('guandan:network-error', '无法保存断线恢复凭证，本次牌局仍可继续')
    }
    this.session?.joinRoom(roomId, myPlayerId)
  }

  private closeRoomLocally (message: string, compensateReservation = true): void {
    const hadRoom = Boolean(this.snapshot.roomId)
    this.clearRoomIdentity()
    this.patch(createClearedRoomPatch(message))
    this.session?.enterLobby()
    if (hadRoom) this.events.emit('guandan:room-closed', message, { compensateReservation })
    if (this.snapshot.connected) this.refreshRooms()
  }

  private closeRoomForRecovery (message: string): void {
    this.client.close()
    this.patch({ connected: false })
    this.closeRoomLocally(message, false)
  }

  private clearRoomIdentity (): void {
    this.invalidateRoomEntryRequest()
    this.matchedEntries.clear()
    this.entryAttempts.clearMatched()
    this.entryRequest.clear()
    this.resumeToken = null
    this.activeMatchId = null
    this.resumeSessions.clear()
    this.resumeConnections.clear()
    this.messages.reset()
  }

  private invalidateRoomEntryRequest (): void {
    this.entryGeneration += 1
    this.pendingRoomEntry = null
  }

  private pendingMatchedRoom (requestId: number): string | null {
    const pending = this.pendingRoomEntry
    if (!pending || !pending.matched || pending.requestId !== requestId) return null
    // Keep accepting a late success while the watchdog waits to retransmit.
    return pending.roomId
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
    this.cleanup.request(
      roomId,
      target => this.client.send('leaveRoom', { roomId: target }),
      callback => this.scheduleOnce(callback, ROOM_CLEANUP_WATCHDOG_SECONDS),
    )
  }

  private restoreResumeSession (): void {
    const restored = this.resumeSessions.restore()
    if (!restored) return
    this.endpoint = restored.endpoint
    this.resumeToken = restored.resumeToken
    this.activeMatchId = restored.matchId ?? null
    this.session?.enterLobby()
    this.patch({ roomId: restored.roomId, myPlayerId: restored.seat, members: [], roomStatus: 'rejoining', error: null })
    this.resumeConnections.start()
    void this.client.connect(restored.endpoint).catch(error => {
      if (this.resumeToken !== restored.resumeToken || this.snapshot.roomStatus !== 'rejoining') return
      this.reportError(error instanceof Error ? error.message : '无法恢复房间', { connected: false })
    })
  }

  private reportError (message: string, next: Partial<LobbySnapshot> = {}): void {
    this.patch({ ...next, error: message })
    this.events.emit('guandan:network-error', message)
  }
  private patch (next: Partial<LobbySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    if (next.roomRole && this.snapshot.myPlayerId) this.session?.setRoomView(this.snapshot.myPlayerId, next.roomRole === 'observer')
    this.events.emit('guandan:lobby', this.snapshot)
  }
}
