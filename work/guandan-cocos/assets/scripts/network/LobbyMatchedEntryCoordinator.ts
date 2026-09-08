import type { PlayerId } from '../core/generated'
import type { LobbySnapshot, MatchedRoomEntry, PendingRoomEntry } from './LobbyModels'

const MAX_ATTEMPTS = 10
const MAX_CONNECTION_FAILURES = 6
const DEFAULT_ENTRY_LIFETIME_MS = 90_000
const RETRY_SECONDS = 0.5
const WATCHDOG_SECONDS = 6

export type MatchedEntryDisconnectOutcome = 'none' | 'retrying' | 'failed'

export type LobbyMatchedEntryDependencies = Readonly<{
  connected: () => boolean
  connect: (endpoint: string) => Promise<void>
  begin: (
    requestType: PendingRoomEntry['requestType'], responseType: PendingRoomEntry['responseType'],
    roomId: string, payload: Record<string, unknown>, expectedPlayerId?: PlayerId,
  ) => number | null
  pendingRoom: (requestId: number) => string | null
  resetTransport: () => void
  close: (message: string) => void
  requestRecovery: (abandonAttemptId?: string) => void
  patch: (next: Partial<LobbySnapshot>) => void
  reportError: (message: string, next?: Partial<LobbySnapshot>) => void
  schedule: (callback: () => void, delaySeconds: number) => void
}>

/** Owns platform-ticket entry retries, expiry, watchdogs and recovery rotation. */
export class LobbyMatchedEntryCoordinator {
  private entry: MatchedRoomEntry | null = null
  private inFlight = false
  private attempts = 0
  private connectionFailures = 0
  private connectPending = false
  private connectFailureObserved = false
  private deadlineAt = 0
  private generation = 0

  public constructor (private readonly dependencies: LobbyMatchedEntryDependencies) {}

  public get current (): MatchedRoomEntry | null { return this.entry }
  public get pending (): boolean { return Boolean(this.entry) }

  public start (entry: MatchedRoomEntry): void {
    this.clear()
    this.entry = entry
    this.deadlineAt = entry.expiresAt ?? Date.now() + DEFAULT_ENTRY_LIFETIME_MS
    if (this.rejectExpired()) return
    const generation = this.generation
    this.scheduleAbsoluteExpiry(generation, entry)
    this.connectEntry(entry, generation, false)
  }

  public handleConnected (): boolean {
    if (!this.entry) return false
    this.connectPending = false
    this.connectFailureObserved = false
    this.dependencies.patch({ connected: true, roomStatus: 'joining', error: null })
    if (!this.rejectExpired()) this.attempt()
    return true
  }

  public handleDisconnected (): MatchedEntryDisconnectOutcome {
    if (!this.entry) return 'none'
    this.inFlight = false
    if (this.connectPending) this.connectFailureObserved = true
    return this.recordConnectionFailure() ? 'failed' : 'retrying'
  }

  public handleFailure (message: string, code?: string | null): void {
    this.inFlight = false
    if (this.rejectExpired()) return
    if (code === 'RECOVERY_NOT_AVAILABLE') {
      this.fail('未找到可恢复的进行中牌局，正在与平台同步')
      return
    }
    if (this.attempts < MAX_ATTEMPTS && /房间不存在|牌桌尚未准备|房主尚未进入|暂时不可用|请稍后重试/.test(message)) {
      const generation = this.generation
      this.dependencies.patch({ roomStatus: 'joining', error: '比赛匹配暂未完成，正在重试' })
      this.dependencies.schedule(() => { if (generation === this.generation) this.attempt() }, RETRY_SECONDS)
      return
    }
    this.fail('比赛匹配失败，请稍后重试')
  }

  public complete (): void { this.clear() }

  public reject (message: string): void { this.fail(message) }

  public static isExpired (entry: MatchedRoomEntry): boolean {
    return entry.expiresAt !== undefined && (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now())
  }

  public clear (): void {
    this.generation += 1
    this.entry = null
    this.inFlight = false
    this.attempts = 0
    this.connectionFailures = 0
    this.connectPending = false
    this.connectFailureObserved = false
    this.deadlineAt = 0
  }

  private attempt (): void {
    const entry = this.entry
    if (!entry || !this.dependencies.connected() || this.inFlight || this.rejectExpired()) return
    this.inFlight = true
    this.attempts += 1
    const payload = { roomId: entry.roomId, gameTicket: entry.gameTicket, entryAttemptId: entry.entryAttemptId }
    const expectedSeat = entry.seat === 'observer' ? undefined : entry.seat
    const requestId = entry.ticketPurpose === 'rejoin'
      ? this.dependencies.begin('joinRoom', 'roomRejoined', entry.roomId, payload, expectedSeat)
      : entry.seat === 'p1'
        ? this.dependencies.begin('createRoom', 'roomCreated', entry.roomId, { ...payload, hostName: entry.displayName ?? '匹配玩家' }, entry.seat)
        : this.dependencies.begin('joinRoom', 'roomJoined', entry.roomId, payload, expectedSeat)
    if (requestId === null) { this.inFlight = false; return }
    const generation = this.generation
    const attempt = this.attempts
    this.dependencies.schedule(() => this.handleWatchdog(generation, attempt, requestId), WATCHDOG_SECONDS)
  }

  private handleWatchdog (generation: number, attempt: number, requestId: number): void {
    if (generation !== this.generation || attempt !== this.attempts) return
    const roomId = this.dependencies.pendingRoom(requestId)
    if (!roomId || this.rejectExpired()) return
    this.inFlight = false
    if (this.attempts < MAX_ATTEMPTS) {
      this.dependencies.patch({ roomStatus: 'joining', error: '匹配入桌响应超时，正在恢复席位' })
      this.dependencies.schedule(() => {
        if (generation !== this.generation || !this.entry) return
        if (this.dependencies.connected()) { this.attempt(); return }
        this.connectEntry(this.entry, generation, true)
      }, RETRY_SECONDS)
      return
    }
    this.fail('匹配入桌多次超时，请重新匹配')
  }

  private rejectExpired (): boolean {
    const entry = this.entry
    if (!entry || (!LobbyMatchedEntryCoordinator.isExpired(entry) && Date.now() < this.deadlineAt)) return false
    this.fail('匹配入桌凭证已过期，请重新匹配')
    return true
  }

  private scheduleAbsoluteExpiry (generation: number, entry: MatchedRoomEntry): void {
    const delaySeconds = Math.max(0, (this.deadlineAt - Date.now()) / 1000)
    this.dependencies.schedule(() => {
      if (generation !== this.generation || this.entry !== entry) return
      if (Date.now() < this.deadlineAt) { this.scheduleAbsoluteExpiry(generation, entry); return }
      this.fail('匹配入桌凭证已过期，请重新匹配')
    }, delaySeconds)
  }

  private connectEntry (entry: MatchedRoomEntry, generation: number, resumeAfterConnect: boolean): void {
    if (generation !== this.generation || this.entry !== entry || this.connectPending || this.rejectExpired()) return
    this.connectPending = true
    this.connectFailureObserved = false
    void this.dependencies.connect(entry.gameEndpoint).then(() => {
      if (generation !== this.generation || this.entry !== entry) return
      this.connectPending = false
      this.connectFailureObserved = false
      if (this.rejectExpired()) return
      if (resumeAfterConnect) this.dependencies.patch({ connected: true, roomStatus: 'joining', error: null })
      this.attempt()
    }).catch(error => {
      if (generation !== this.generation || this.entry !== entry) return
      const failureAlreadyObserved = this.connectFailureObserved
      this.connectPending = false
      this.connectFailureObserved = false
      if (!failureAlreadyObserved && this.recordConnectionFailure()) return
      if (this.entry === entry) {
        this.dependencies.reportError(error instanceof Error ? error.message : '无法连接匹配牌桌', { connected: false, roomStatus: 'joining' })
      }
    })
  }

  private recordConnectionFailure (): boolean {
    if (this.rejectExpired()) return true
    this.connectionFailures += 1
    if (this.connectionFailures < MAX_CONNECTION_FAILURES) return false
    this.fail('匹配牌桌连接多次失败，请重新匹配')
    return true
  }

  private fail (message: string): void {
    const entry = this.entry
    const recoveryAttemptId = entry?.recoveryAttemptId ?? (entry?.ticketPurpose === 'rejoin' ? entry.entryAttemptId : undefined)
    this.clear()
    this.dependencies.resetTransport()
    this.dependencies.close(message)
    if (entry) this.dependencies.requestRecovery(recoveryAttemptId)
  }
}
