import type { PlayerId } from '../core/generated'
import type {
  LobbyNetworkResult,
  LobbySnapshot,
  NetworkMatchEnded,
  NetworkRoundEndedPacket,
  NetworkRoundPacket,
  NetworkStatePacket,
} from '../network/LobbyModels'

export type TableNetworkTurnTimeout = Readonly<{
  playerId: PlayerId | null
  enteredTrustee: boolean
}>

export type TableNetworkRoomClosedOptions = Readonly<{
  compensateReservation?: boolean
}>

export type TableNetworkEventSource = Readonly<{
  on: (eventName: string, callback: (...args: any[]) => void, target?: any) => any
  off: (eventName: string, callback: (...args: any[]) => void, target?: any) => any
}>

export type TableNetworkEventHandlers = Readonly<{
  onLobby: (snapshot: LobbySnapshot) => void
  onNetworkState: (packet: NetworkStatePacket) => void
  onRoundPrepared: (packet: NetworkRoundPacket) => void
  onRoundEnded: (packet: NetworkRoundEndedPacket) => void
  onMatchEnded: (ended: NetworkMatchEnded) => void
  onNetworkResult: (result: LobbyNetworkResult) => void
  onNetworkError: (message: string) => void
  onRoomClosed: (message?: string, options?: TableNetworkRoomClosedOptions) => void
  onPresentationChanged: () => void
  onTurnTimeout: (packet: TableNetworkTurnTimeout) => void
}>

/** Owns the live-table Lobby event wiring without taking ownership of Lobby state. */
export class TableNetworkEventBridge {
  private mounted = false
  private disposed = false

  public constructor (
    private readonly events: TableNetworkEventSource,
    private readonly handlers: TableNetworkEventHandlers,
  ) {}

  public mount (): void {
    if (this.mounted || this.disposed) return
    this.mounted = true
    this.events.on('guandan:lobby', this.onLobby, this)
    this.events.on('guandan:network-state', this.onNetworkState, this)
    this.events.on('guandan:round-prepared', this.onRoundPrepared, this)
    this.events.on('guandan:round-ended', this.onRoundEnded, this)
    this.events.on('guandan:match-ended', this.onMatchEnded, this)
    this.events.on('guandan:network-result', this.onNetworkResult, this)
    this.events.on('guandan:network-error', this.onNetworkError, this)
    this.events.on('guandan:room-closed', this.onRoomClosed, this)
    this.events.on('guandan:trustee', this.onPresentationChanged, this)
    this.events.on('guandan:round-ready', this.onPresentationChanged, this)
    this.events.on('guandan:turn-deadline', this.onPresentationChanged, this)
    this.events.on('guandan:turn-timeout', this.onTurnTimeout, this)
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.mounted) return
    this.mounted = false
    this.events.off('guandan:lobby', this.onLobby, this)
    this.events.off('guandan:network-state', this.onNetworkState, this)
    this.events.off('guandan:round-prepared', this.onRoundPrepared, this)
    this.events.off('guandan:round-ended', this.onRoundEnded, this)
    this.events.off('guandan:match-ended', this.onMatchEnded, this)
    this.events.off('guandan:network-result', this.onNetworkResult, this)
    this.events.off('guandan:network-error', this.onNetworkError, this)
    this.events.off('guandan:room-closed', this.onRoomClosed, this)
    this.events.off('guandan:trustee', this.onPresentationChanged, this)
    this.events.off('guandan:round-ready', this.onPresentationChanged, this)
    this.events.off('guandan:turn-deadline', this.onPresentationChanged, this)
    this.events.off('guandan:turn-timeout', this.onTurnTimeout, this)
  }

  private readonly onLobby = (snapshot: LobbySnapshot): void => { if (!this.disposed) this.handlers.onLobby(snapshot) }
  private readonly onNetworkState = (packet: NetworkStatePacket): void => { if (!this.disposed) this.handlers.onNetworkState(packet) }
  private readonly onRoundPrepared = (packet: NetworkRoundPacket): void => { if (!this.disposed) this.handlers.onRoundPrepared(packet) }
  private readonly onRoundEnded = (packet: NetworkRoundEndedPacket): void => { if (!this.disposed) this.handlers.onRoundEnded(packet) }
  private readonly onMatchEnded = (ended: NetworkMatchEnded): void => { if (!this.disposed) this.handlers.onMatchEnded(ended) }
  private readonly onNetworkResult = (result: LobbyNetworkResult): void => { if (!this.disposed) this.handlers.onNetworkResult(result) }
  private readonly onNetworkError = (message: string): void => { if (!this.disposed) this.handlers.onNetworkError(message) }
  private readonly onRoomClosed = (message?: string, options?: TableNetworkRoomClosedOptions): void => {
    if (!this.disposed) this.handlers.onRoomClosed(message, options)
  }
  private readonly onPresentationChanged = (): void => { if (!this.disposed) this.handlers.onPresentationChanged() }
  private readonly onTurnTimeout = (packet: TableNetworkTurnTimeout): void => { if (!this.disposed) this.handlers.onTurnTimeout(packet) }
}
