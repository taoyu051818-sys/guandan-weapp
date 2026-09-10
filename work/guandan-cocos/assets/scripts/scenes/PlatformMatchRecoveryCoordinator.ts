import type { LobbyController } from '../network/LobbyController'
import type { MatchRecoveryEntry, MatchRecoveryGateway } from '../services/FrontPageGatewayContracts'

type RecoveryRequest = Readonly<{ abandonAttemptId?: string, manual?: boolean }>
type RecoveryConfirmation = Readonly<{ recoveryAttemptId?: string }>

const MAX_AUTOMATIC_RECOVERY_TICKETS = 3
const RECOVERY_PAUSED_MESSAGE = '自动恢复多次未成功，请手动重试'

export type PlatformMatchRecoveryDependencies = Readonly<{
  configured: boolean
  gateway: MatchRecoveryGateway
  lobby: LobbyController
  enterLobby: () => void
  restoreFriendRoom?: (entry: Extract<MatchRecoveryEntry, { roomKind: 'friend' }>) => void
  restoreMatchOrigin?: (entry: Extract<MatchRecoveryEntry, { roomKind: 'match' }>) => void
  showRecoveryAvailable: (message: string) => void
  onPendingChanged?: (pending: boolean) => void
  showNotice: (title: string, detail?: string) => void
  isDisposed: () => boolean
}>

/** Coordinates authenticated cold recovery without coupling platform HTTP to LobbyController. */
export class PlatformMatchRecoveryCoordinator {
  private inFlight = false
  private disposed = false
  private attemptsInCycle = 0
  private queuedRequest: RecoveryRequest | null = null
  private readonly recoverRequested = (request: RecoveryRequest = {}): void => { this.recover(request) }
  private readonly entryConfirmed = (confirmation: RecoveryConfirmation): void => {
    if (!confirmation.recoveryAttemptId) return
    this.dependencies.gateway.confirm(confirmation.recoveryAttemptId)
    this.attemptsInCycle = 0
    this.queuedRequest = null
  }

  public constructor (private readonly dependencies: PlatformMatchRecoveryDependencies) {
    dependencies.lobby.events.on('guandan:platform-recovery-required', this.recoverRequested)
    dependencies.lobby.events.on('guandan:room-entry-confirmed', this.entryConfirmed)
  }

  public start (): void {
    if (this.dependencies.lobby.snapshot.roomStatus !== 'rejoining') this.recover()
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.queuedRequest = null
    this.dependencies.lobby.events.off('guandan:platform-recovery-required', this.recoverRequested)
    this.dependencies.lobby.events.off('guandan:room-entry-confirmed', this.entryConfirmed)
  }

  private recover (request: RecoveryRequest = {}): void {
    if (!this.dependencies.configured || this.disposed || this.dependencies.isDisposed()) return
    if (this.inFlight) {
      this.queuedRequest = {
        abandonAttemptId: request.abandonAttemptId ?? this.queuedRequest?.abandonAttemptId,
        manual: Boolean(request.manual || this.queuedRequest?.manual),
      }
      return
    }
    if (request.manual) this.attemptsInCycle = 0
    if (request.abandonAttemptId) this.dependencies.gateway.abandon(request.abandonAttemptId)
    if (this.attemptsInCycle >= MAX_AUTOMATIC_RECOVERY_TICKETS) {
      this.dependencies.showRecoveryAvailable(RECOVERY_PAUSED_MESSAGE)
      this.dependencies.showNotice('牌局恢复已暂停', RECOVERY_PAUSED_MESSAGE)
      return
    }
    this.attemptsInCycle += 1
    this.inFlight = true
    this.dependencies.onPendingChanged?.(true)
    void this.dependencies.gateway.recover().then(entry => {
      if (this.disposed || this.dependencies.isDisposed()) return
      if (!entry) {
        this.attemptsInCycle = 0
        this.queuedRequest = null
        if (request.manual) this.dependencies.showNotice('没有可恢复的牌局', '牌局已结束或已离开，请重新开始。')
        return
      }
      this.dependencies.enterLobby()
      if (entry.roomKind === 'friend') this.dependencies.restoreFriendRoom?.(entry)
      else this.dependencies.restoreMatchOrigin?.(entry)
      this.dependencies.lobby.enterMatchedRoom({
        entryAttemptId: entry.entryAttemptId, recoveryAttemptId: entry.recoveryAttemptId,
        matchId: entry.matchId, roomId: entry.roomId, gameEndpoint: entry.gameEndpoint,
        gameTicket: entry.gameTicket, seat: entry.seat, expiresAt: entry.expiresAt,
        ticketPurpose: entry.ticketPurpose,
      })
    }).catch(error => {
      if (!this.disposed && !this.dependencies.isDisposed()) {
        const message = error instanceof Error ? error.message : '平台暂时无法恢复牌局'
        // Returning to the hall closes existing overlays; present the failure afterwards.
        this.dependencies.showRecoveryAvailable(message)
        this.dependencies.showNotice('牌局恢复失败', message)
      }
    }).finally(() => {
      this.inFlight = false
      if (!this.disposed && !this.dependencies.isDisposed()) this.dependencies.onPendingChanged?.(false)
      const queuedRequest = this.queuedRequest
      this.queuedRequest = null
      if (queuedRequest) this.recover(queuedRequest)
    })
  }
}
