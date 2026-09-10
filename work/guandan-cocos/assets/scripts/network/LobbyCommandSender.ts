import { commandRequiresExpectedVersion } from '../core/generated/protocol'
import type { LobbyNetworkResult, LobbySnapshot } from './LobbyModels'
import type { LobbySocketClient } from './LobbySocketClient'

type LobbyCommandSenderDependencies = Readonly<{
  client: () => LobbySocketClient
  snapshot: () => LobbySnapshot
  emitResult: (result: LobbyNetworkResult) => void
  reportError: (message: string) => void
}>

/** Owns transport send failures and authoritative-version command decoration. */
export class LobbyCommandSender {
  public constructor (private readonly dependencies: LobbyCommandSenderDependencies) {}

  public roomIntent (type: string, payload: Record<string, unknown> = {}): number | null {
    const snapshot = this.dependencies.snapshot()
    const hostAction = snapshot.isRoomHost && ['startGame', 'kickMember', 'addBot', 'removeBot', 'fillBots'].includes(type)
    if (snapshot.roomRole === 'observer' && !hostAction && !['sitDown', 'standUp', 'watchPlayer', 'watchTable'].includes(type)
      && !(snapshot.duplicate?.mySeat && ['readyNextRound', 'cancelRoundReady'].includes(type))) {
      this.dependencies.reportError('观战中不能准备或操作手牌')
      return null
    }
    if (!snapshot.roomId || snapshot.roomStatus !== 'ready' || snapshot.matchEnded) return null
    if (snapshot.gameStartPending) {
      this.dependencies.reportError('平台确认开局期间暂不能操作')
      return null
    }
    const commandPayload = { roomId: snapshot.roomId, ...payload }
    return this.send(type, commandRequiresExpectedVersion(type)
      ? { ...commandPayload, expectedVersion: snapshot.gameVersion }
      : commandPayload)
  }

  public send (type: string, payload?: unknown, retryRequestId?: number): number | null {
    try {
      return this.dependencies.client().send(type, payload, retryRequestId)
    } catch (error) {
      const message = error instanceof Error ? error.message : '网络未连接'
      this.dependencies.emitResult({
        requestId: null,
        requestType: type,
        responseType: 'client-error',
        ok: false,
        message,
      })
      this.dependencies.reportError(message)
      return null
    }
  }
}
