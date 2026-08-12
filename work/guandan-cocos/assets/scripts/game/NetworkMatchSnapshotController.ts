import type { EngineState, MatchState, PlayerId, SettlementResult, TributeState } from '../core/generated'
import type { NetworkViewerRoundStats } from '../network/LobbyModels'
import { countPlayerBombs, type LocalRoundRecord, type LocalSessionPhase } from './LocalMatchEventController'
import { mergeGameManagerProjection, projectAuthoritativeState, type GameManagerProjection } from './GameManagerProjection'

export type NetworkMatchSnapshotPorts = Readonly<{
  getState: () => EngineState
  getProjection: () => GameManagerProjection
  getRoomId: () => string | null
  getHumanId: () => PlayerId
  commit: (state: EngineState, projection: GameManagerProjection) => void
  retireLocalMatch: () => void
  clearSelection: () => void
  cancelPendingAction: () => void
  setSessionPhase: (phase: LocalSessionPhase) => void
  recordRound: (record: LocalRoundRecord) => void
  publishHint: (hint: string) => void
}>

/** Owns network snapshot projection, version gating, and once-per-round session effects. */
export class NetworkMatchSnapshotController {
  private readonly recordedRoundKeys = new Set<string>()

  public constructor (private readonly ports: NetworkMatchSnapshotPorts) {}

  public reset (): void {
    this.recordedRoundKeys.clear()
  }

  public applyServerState (state: EngineState, hint = '已同步服务器状态'): boolean {
    const projection = this.commit(state, { phase: 'playing', tribute: null, settlement: null })
    if (!projection) return false
    this.ports.publishHint(hint)
    return true
  }

  public applyRoundPrepared (state: EngineState, tribute: TributeState | null): boolean {
    const projection = this.commit(state, {
      phase: tribute ? 'tribute' : 'playing',
      tribute,
      settlement: null,
    })
    if (!projection) return false
    this.ports.publishHint(projection.tribute
      ? projection.tribute.isAntiTribute ? '抗贡成立，等待开始本局' : '请完成进贡与还贡'
      : '本局开始')
    return true
  }

  public applyRoundEnded (
    result: SettlementResult,
    packetState: EngineState | null = null,
    viewerRoundStats?: NetworkViewerRoundStats,
    eventIdentity?: Readonly<{ roomId: string, version: number, gameVersion: number }>,
  ): boolean {
    const state = packetState ?? this.ports.getState()
    const current = this.ports.getProjection()
    const match = state as Partial<MatchState>
    const authoritativeScores = match.phase === 'playing' ? null : match.scores
    const scores = authoritativeScores
      ? { ...authoritativeScores }
      : {
          ...current.scores,
          [result.winnerTeam]: current.scores[result.winnerTeam] + Math.max(0, result.levelUp),
        }
    const patch: Partial<GameManagerProjection> = {
      phase: 'settlement',
      teamLevels: result.teamLevels,
      aFailStreaks: result.aFailStreaks,
      scores,
      lastRoundRank: result.fullRank,
      tribute: null,
      settlement: result,
    }
    const stateRoundId = Number.isSafeInteger(match.roundId) ? Number(match.roundId) : null
    const duplicateCurrentRound = current.phase === 'settlement' && (
      stateRoundId === null || current.roundId === null || stateRoundId === current.roundId
    )
    const projection = duplicateCurrentRound
      ? current
      : match.phase === 'settled'
        ? this.commit(state, patch)
        : this.commitLegacyRoundEnd(state, patch)
    if (!projection || projection.phase !== 'settlement' || !projection.settlement) return false

    const settlement = projection.settlement
    const humanId = this.ports.getHumanId()
    const roundKey = this.roundKey(state, eventIdentity)
    if (!roundKey || !this.recordedRoundKeys.has(roundKey)) {
      this.ports.recordRound({
        settlement,
        wasFirst: settlement.fullRank[0] === humanId,
        bombCount: this.bombCount(state, humanId, viewerRoundStats),
        scores: projection.scores,
      })
      if (roundKey) this.rememberRoundKey(roundKey)
    }
    this.ports.publishHint(settlement.message)
    return true
  }

  private commit (
    state: EngineState,
    fallback: Partial<GameManagerProjection>,
  ): GameManagerProjection | null {
    const result = projectAuthoritativeState(this.ports.getProjection(), state, fallback)
    if (!result.accepted) return null
    return this.commitProjection(state, result.projection)
  }

  /** Legacy result-only packets explicitly advance lifecycle after adapting their last playing snapshot. */
  private commitLegacyRoundEnd (state: EngineState, patch: Partial<GameManagerProjection>): GameManagerProjection | null {
    const adapted = projectAuthoritativeState(this.ports.getProjection(), state)
    if (!adapted.accepted) return null
    return this.commitProjection(state, mergeGameManagerProjection(adapted.projection, patch))
  }

  private commitProjection (state: EngineState, projection: GameManagerProjection): GameManagerProjection {
    this.ports.retireLocalMatch()
    this.ports.commit(state, projection)
    this.ports.clearSelection()
    this.ports.cancelPendingAction()
    this.ports.setSessionPhase(projection.phase)
    return projection
  }

  private bombCount (state: EngineState, humanId: PlayerId, stats?: NetworkViewerRoundStats): number {
    return Number.isSafeInteger(stats?.bombsPlayed) && Number(stats?.bombsPlayed) >= 0 && Number(stats?.bombsPlayed) <= 99
      ? Number(stats?.bombsPlayed)
      : countPlayerBombs(state, humanId)
  }

  private roundKey (
    state: EngineState,
    eventIdentity?: Readonly<{ roomId: string, version: number, gameVersion: number }>,
  ): string | null {
    const roomId = eventIdentity?.roomId ?? this.ports.getRoomId()
    const roundId = (state as Partial<MatchState>).roundId
    if (!roomId) return null
    if (Number.isSafeInteger(roundId)) return `${roomId}:round:${String(roundId)}`
    if (eventIdentity &&
      Number.isSafeInteger(eventIdentity.version) && eventIdentity.version >= 0 &&
      Number.isSafeInteger(eventIdentity.gameVersion) && eventIdentity.gameVersion >= 0) {
      return `${roomId}:event:${eventIdentity.version}:${eventIdentity.gameVersion}`
    }
    // Direct legacy callers do not carry a protocol identity. The settlement
    // signature keeps repeated delivery idempotent without conflating the next
    // result once ranks, scores or message change.
    return `${roomId}:legacy:${JSON.stringify([
      resultSignature(this.ports.getProjection().settlement),
      this.ports.getProjection().scores,
    ])}`
  }

  private rememberRoundKey (key: string): void {
    this.recordedRoundKeys.add(key)
    while (this.recordedRoundKeys.size > 64) {
      const oldest = this.recordedRoundKeys.values().next().value as string | undefined
      if (!oldest) break
      this.recordedRoundKeys.delete(oldest)
    }
  }
}

const resultSignature = (result: SettlementResult | null): unknown => result ? [
  result.winnerTeam,
  result.levelUp,
  result.fullRank,
  result.teamLevels,
  result.aFailStreaks,
  result.message,
] : null
