import type { EngineState, MatchState, PlayerId, SettlementResult, Team } from '../core/generated'

export type SessionPhase = 'playing' | 'tribute' | 'settlement'
export type RoundRecord = Readonly<{
  settlement: SettlementResult
  wasFirst: boolean
  bombCount: number
  scores: Record<Team, number>
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
