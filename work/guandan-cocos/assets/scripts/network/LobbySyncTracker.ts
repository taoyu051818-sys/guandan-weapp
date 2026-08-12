import type { EngineState } from '../core/generated'
import {
  decideNetworkEffectSync,
  type ForcedNetworkRecoveryReason,
  type NetworkEffectCursor,
  type NetworkEffectSync,
} from '../effects/NetworkEffectSyncPolicy'
import type { NetworkStatePacket } from './LobbyModels'

type AppliedStateSync = {
  roomId: string
  gameVersion: number
  effectSync: NetworkEffectSync
}

/** Owns server-version deduplication and the network effect playback cursor. */
export class LobbySyncTracker {
  private lastVersion = -1
  private lastGameVersion = -1
  private effectCursor: NetworkEffectCursor | null = null
  private lastAppliedStateSync: AppliedStateSync | null = null
  private readonly processedRoomEvents = new Set<string>()
  private readonly processedVersionedEvents = new Set<string>()

  public reset (): void {
    this.lastVersion = -1
    this.lastGameVersion = -1
    this.effectCursor = null
    this.lastAppliedStateSync = null
    this.processedRoomEvents.clear()
    this.processedVersionedEvents.clear()
  }

  /** Accepts metadata at the current version, but rejects stale metadata. */
  public observeVersion (version?: number): number | null {
    const normalized = this.normalizedVersion(version)
    if (normalized < this.lastVersion) return null
    if (normalized > this.lastVersion) {
      this.lastVersion = normalized
      this.processedVersionedEvents.clear()
    }
    return normalized
  }

  /** Accepts a versioned event once per event type and server version. */
  public acceptVersion (eventType: string, version?: number): boolean {
    const normalized = this.observeVersion(version)
    if (normalized === null) return false
    const key = `${eventType}:${normalized}`
    if (this.processedVersionedEvents.has(key)) return false
    this.processedVersionedEvents.add(key)
    return true
  }

  /** Accepts room-lifecycle events once, independently of state packet dedupe. */
  public acceptRoomEvent (eventType: string, roomId: string, version?: number): boolean {
    const key = `${eventType}:${roomId}:${this.normalizedVersion(version)}`
    if (this.processedRoomEvents.has(key)) return false
    this.processedRoomEvents.add(key)
    return true
  }

  public normalizedVersion (version?: number): number {
    return Number.isSafeInteger(version) && Number(version) >= 0 ? Number(version) : Math.max(this.lastVersion, 0)
  }

  public normalizedGameVersion (gameVersion?: number): number {
    return Number.isSafeInteger(gameVersion) && Number(gameVersion) >= 0 ? Number(gameVersion) : Math.max(this.lastGameVersion, 0)
  }

  public statePacket (
    state: EngineState,
    roomId: string,
    version?: number,
    gameVersion?: number,
    forceRecovery?: ForcedNetworkRecoveryReason,
  ): NetworkStatePacket | null {
    const normalizedVersion = this.normalizedVersion(version)
    const normalizedGameVersion = this.normalizedGameVersion(gameVersion)
    const decision = decideNetworkEffectSync(this.effectCursor, {
      roomId,
      version: normalizedGameVersion,
      actionCount: state.playArea.length,
      forceRecovery,
    })
    if (decision.kind === 'drop') return null
    this.effectCursor = decision.cursor
    this.lastGameVersion = normalizedGameVersion
    this.lastAppliedStateSync = { roomId, gameVersion: normalizedGameVersion, effectSync: decision.sync }
    return { roomId, version: normalizedVersion, gameVersion: normalizedGameVersion, state, effectSync: decision.sync }
  }

  public effectSyncForGameVersion (roomId: string, gameVersion?: number): NetworkEffectSync {
    const normalizedGameVersion = this.normalizedGameVersion(gameVersion)
    if (this.lastAppliedStateSync?.roomId === roomId && this.lastAppliedStateSync.gameVersion === normalizedGameVersion) {
      return this.lastAppliedStateSync.effectSync
    }
    return { mode: 'incremental' }
  }
}
