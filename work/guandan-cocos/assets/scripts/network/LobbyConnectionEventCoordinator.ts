import type { PlayerId } from '../core/generated'
import type { LobbySnapshot, PendingRoomEntry } from './LobbyModels'
import type { MatchedEntryDisconnectOutcome } from './LobbyMatchedEntryCoordinator'

type Dependencies = Readonly<{
  snapshot: () => LobbySnapshot
  resumeToken: () => string | null
  matchedConnected: () => boolean
  matchedDisconnected: () => MatchedEntryDisconnectOutcome
  resumePending: () => boolean
  startResumeWatchdog: () => void
  recordResumeFailure: () => boolean
  beginEntry: (
    requestType: PendingRoomEntry['requestType'],
    responseType: PendingRoomEntry['responseType'],
    roomId: string,
    payload: Record<string, unknown>,
    expectedPlayerId?: PlayerId,
  ) => number | null
  invalidateEntry: () => void
  closeForRecovery: (message: string) => void
  requestPlatformRecovery: () => void
  refreshRooms: () => void
  patch: (next: Partial<LobbySnapshot>) => void
  reportDisconnect: (message: string) => void
}>

/** Owns connected/disconnected ordering for matched entry and local resume. */
export class LobbyConnectionEventCoordinator {
  public constructor (private readonly dependencies: Dependencies) {}

  public handleConnected (): void {
    if (this.dependencies.matchedConnected()) return
    const { roomId, myPlayerId } = this.dependencies.snapshot()
    const resumeToken = this.dependencies.resumeToken()
    const canResume = Boolean(roomId && myPlayerId && resumeToken)
    this.dependencies.patch({ connected: true, roomStatus: canResume ? 'rejoining' : 'idle', error: null })
    if (!roomId || !myPlayerId || !resumeToken) {
      this.dependencies.refreshRooms()
      return
    }
    const requestId = this.dependencies.beginEntry(
      'rejoinRoom',
      'roomRejoined',
      roomId,
      { roomId, myPlayerId, resumeToken },
      myPlayerId,
    )
    if (requestId !== null) return
    this.dependencies.closeForRecovery('无法恢复房间，请重新加入')
    this.dependencies.requestPlatformRecovery()
  }

  public handleDisconnected (): void {
    const matchedDisconnect = this.dependencies.matchedDisconnected()
    if (matchedDisconnect === 'failed') return
    const snapshot = this.dependencies.snapshot()
    const retryMatchedEntry = matchedDisconnect === 'retrying'
    const retryLocalResume = !retryMatchedEntry && Boolean(snapshot.roomId && this.dependencies.resumeToken())
    if (retryLocalResume && !this.dependencies.resumePending()) this.dependencies.startResumeWatchdog()
    if (retryLocalResume && this.dependencies.recordResumeFailure()) return
    this.dependencies.invalidateEntry()
    this.dependencies.patch({
      connected: false,
      roomStatus: retryMatchedEntry ? 'joining' : snapshot.roomId && this.dependencies.resumeToken() ? 'rejoining' : 'idle',
      error: '网络连接已断开，正在重新连接',
    })
    this.dependencies.reportDisconnect('网络连接已断开，正在重新连接')
  }
}
