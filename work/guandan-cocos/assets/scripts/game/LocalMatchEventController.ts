import type { EngineState, GameEvent, MatchState, PlayerId, SettlementResult, Team } from '../core/generated'

export type LocalSessionPhase = 'playing' | 'tribute' | 'settlement'

export type LocalRoundRecord = Readonly<{
  settlement: SettlementResult
  wasFirst: boolean
  bombCount: number
  scores: Record<Team, number>
}>

export type LocalMatchEventContext = Readonly<{
  state: MatchState
  humanId: PlayerId
  scores: Record<Team, number>
  recordProgress: boolean
}>

export type LocalMatchEventPorts = Readonly<{
  playPass: () => void
  playRoundStart: () => void
  setSessionPhase: (phase: LocalSessionPhase) => void
  recordRound: (record: LocalRoundRecord) => void
  clearSelection: () => void
  publishHint: (hint: string) => void
}>

export const countPlayerBombs = (
  state: EngineState | MatchState,
  playerId: PlayerId,
): number => {
  const history = 'playHistory' in state && Array.isArray(state.playHistory)
    ? state.playHistory
    : state.playArea
  return history.filter(action => action.playerId === playerId && (
    action.type === 'Bomb'
    || action.type === 'Rocket'
    || (action.type === 'StraightFlush' && state.ruleProfile.straightFlushAsBomb)
  )).length
}

/** Maps domain events to application ports without importing Cocos or session state. */
export class LocalMatchEventController {
  public constructor (private readonly ports: LocalMatchEventPorts) {}

  public consume (events: readonly GameEvent[], context: LocalMatchEventContext): void {
    events.forEach(event => {
      if (event.type === 'PLAYER_PASSED') {
        this.ports.playPass()
        return
      }
      if (event.type === 'ROUND_PREPARED') {
        this.ports.playRoundStart()
        this.ports.setSessionPhase('tribute')
        return
      }
      if (event.type === 'PLAY_STARTED_AFTER_TRIBUTE') {
        this.ports.setSessionPhase('playing')
        return
      }
      if (event.type !== 'ROUND_SETTLED') return
      if (context.recordProgress) {
        this.ports.recordRound({
          settlement: event.settlement,
          wasFirst: event.settlement.fullRank[0] === context.humanId,
          bombCount: countPlayerBombs(context.state, context.humanId),
          scores: { ...context.scores },
        })
      }
      this.ports.setSessionPhase('settlement')
      this.ports.clearSelection()
      this.ports.publishHint(event.settlement.message)
    })
  }
}
