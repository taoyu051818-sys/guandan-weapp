import type { Card, PlayerId } from '../types/game'
import type { MatchState } from './engine'
import { MATCH_LEVELS } from './matchFormat'

export type TeamRotation = 'draw' | 'clockwise'
export type RotatingScoring = 3 | 6

/** Reference contract: rows are the head player's teammate's finishing place. */
export const VARIANT_SCORE_ROWS = Object.freeze([
  Object.freeze({ matePlace: 2, label: '头游＋二游', duplicate: 3, three: [3, -3] as const, six: [6, 0] as const }),
  Object.freeze({ matePlace: 3, label: '头游＋三游', duplicate: 2, three: [2, -2] as const, six: [5, 1] as const }),
  Object.freeze({ matePlace: 4, label: '头游＋末游', duplicate: 1, three: [1, -1] as const, six: [4, 2] as const }),
])

export const variantAward = (matePlace: number, mode: 'duplicate' | RotatingScoring): readonly [number, number] => {
  const row = VARIANT_SCORE_ROWS.find(item => item.matePlace === matePlace)
  if (!row || ![3, 6, 'duplicate'].includes(mode)) throw new Error('INVALID_VARIANT_SCORE')
  return mode === 'duplicate' ? [row.duplicate, 0] : mode === 3 ? [...row.three] : [...row.six]
}

export const pairingCardAt = (index: number): Pick<Card, 'suit' | 'rank'> => {
  if (!Number.isInteger(index) || index < 0 || index >= 52) throw new Error('INVALID_PAIRING_CARD')
  return { suit: (['spade', 'heart', 'club', 'diamond'] as const)[Math.floor(index / 13)], rank: MATCH_LEVELS[index % 13] }
}

/** IDs stay attached to authenticated people; only physical order and partnerships change. */
export const arrangeRotatingRound = (state: MatchState, pairingIndex?: number): MatchState => {
  if (state.matchFormat?.kind !== 'rotating') return state
  const turnOrder = [...state.turnOrder]
  let pairingCard: Pick<Card, 'suit' | 'rank'> | undefined
  if (state.matchFormat.teamRotation === 'draw') {
    pairingCard = pairingCardAt(pairingIndex as number)
    const holders = turnOrder.flatMap(id => state.players[id].hand
      .filter(card => card.suit === pairingCard!.suit && card.rank === pairingCard!.rank).map(() => id))
    if (holders.length !== 2) throw new Error('PAIRING_CARDS_UNAVAILABLE')
    if (holders[0] !== holders[1]) {
      const opposite = (turnOrder.indexOf(holders[0]) + 2) % 4
      const other = turnOrder.indexOf(holders[1])
      ;[turnOrder[opposite], turnOrder[other]] = [turnOrder[other], turnOrder[opposite]]
    }
  } else if (state.matchFormat.teamRotation === 'clockwise') {
    // Initial East (index 1) stays fixed. South -> West -> North -> South.
    if (state.roundId > 1) [turnOrder[0], turnOrder[2], turnOrder[3]] = [turnOrder[2], turnOrder[3], turnOrder[0]]
  } else throw new Error('INVALID_TEAM_ROTATION')
  const players = { ...state.players }
  turnOrder.forEach((id, index) => { players[id] = { ...players[id], team: index % 2 === 0 ? 'teamA' : 'teamB' } })
  return { ...state, players, turnOrder, pairingCard,
    playerScores: { p1: 0, p2: 0, p3: 0, p4: 0, ...state.playerScores } }
}

export const rotatingRoundPoints = (state: MatchState, winner: PlayerId, matePlace: number): Record<PlayerId, number> => {
  const [won, lost] = variantAward(matePlace, state.matchFormat?.rotatingScoring ?? 3)
  const points = { p1: 0, p2: 0, p3: 0, p4: 0 }
  state.turnOrder.forEach(id => { points[id] = state.players[id].team === state.players[winner].team ? won : lost })
  return points
}
