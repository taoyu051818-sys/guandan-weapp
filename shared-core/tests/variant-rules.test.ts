import { describe, expect, it } from 'vitest'
import { arrangeRotatingRound, createGame, createMatchState, createDeck, dealCards, getRuleProfile, normalizeRoomFormat, pairingCardAt, roomMatchFormat, settleMatchState, transition, variantAward, type PlayerId } from '../src'

const stateFor = (scoring: 3 | 6 = 3, rotation: 'draw' | 'clockwise' = 'clockwise') => {
  const format = roomMatchFormat(normalizeRoomFormat({ format: 'rotating', levelMode: 'fixed', rotatingScoring: scoring, teamRotation: rotation })!)
  return createMatchState({ matchFormat: format, players: createGame(2).players, currentLevel: 2, ruleProfile: getRuleProfile('classic'), levelTeam: 'teamA', teamLevels: { teamA: 2, teamB: 2 }, dealerId: 'p1' })
}

describe('confirmed variant rules', () => {
  it('implements all supplied score rows; duplicate losers get zero', () => {
    expect([2, 3, 4].map(place => variantAward(place, 'duplicate'))).toEqual([[3, 0], [2, 0], [1, 0]])
    expect([2, 3, 4].map(place => variantAward(place, 3))).toEqual([[3, -3], [2, -2], [1, -1]])
    expect([2, 3, 4].map(place => variantAward(place, 6))).toEqual([[6, 0], [5, 1], [4, 2]])
    expect(() => variantAward(1, 3)).toThrow()
    expect(() => normalizeRoomFormat({ format: 'rotating', rotatingScoring: 4 })).toThrow()
    expect(() => normalizeRoomFormat({ format: 'rounds', teamRotation: 'draw' })).toThrow()
    expect(() => normalizeRoomFormat({ format: 'rotating', tributeEnabled: true })).toThrow()
  })
  it('keeps East fixed, covers every partnership and preserves authenticated identities', () => {
    let state = arrangeRotatingRound(stateFor())
    const original = structuredClone(state)
    const mates = new Set<PlayerId>()
    for (let roundId = 2; roundId <= 4; roundId++) {
      state = arrangeRotatingRound({ ...state, roundId })
      expect(state.turnOrder[1]).toBe('p2')
      mates.add(state.turnOrder[3])
      for (const id of state.turnOrder) expect(state.players[id].hand).toEqual(original.players[id].hand)
    }
    expect(mates.size).toBe(3)
    expect(state.turnOrder).toEqual(original.turnOrder)
    expect(original.turnOrder).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
  it('pairs both holders, leaves seats unchanged for a double holder, and excludes jokers', () => {
    const state = stateFor(3, 'draw')
    const original = structuredClone(state)
    for (let index = 0; index < 52; index++) {
      const marker = pairingCardAt(index)
      expect(marker.suit).not.toBe('joker')
      const holders = state.turnOrder.filter(id => state.players[id].hand.some(card => card.rank === marker.rank && card.suit === marker.suit))
      const next = arrangeRotatingRound(state, index)
      if (holders.length === 1) expect(next.turnOrder).toEqual(state.turnOrder)
      else expect(next.players[holders[0]].team).toBe(next.players[holders[1]].team)
      expect(next.pairingCard).toEqual(marker)
      expect(state).toEqual(original)
    }
    expect(() => arrangeRotatingRound(state, 52)).toThrow()
    expect(() => arrangeRotatingRound(state)).toThrow()
  })
  it('settles each score scheme and keeps personal totals across prepare and serialization', () => {
    for (const scoring of [3, 6] as const) for (const rank of [['p1', 'p3'], ['p1', 'p2', 'p3'], ['p1', 'p2', 'p4']] as PlayerId[][]) {
      const state = arrangeRotatingRound(stateFor(scoring))
      state.finishedPlayers = rank
      const settled = settleMatchState(state)!
      const [won, lost] = variantAward(settled.settlement.fullRank.indexOf('p3') + 1, scoring)
      expect(settled.state.playerScores).toEqual({ p1: won, p2: lost, p3: won, p4: lost })
      expect(settled.state.scores).toEqual({ teamA: 0, teamB: 0 })
      const restored = JSON.parse(JSON.stringify(settled.state))
      const prepared = transition(restored, { type: 'PREPARE_NEXT_ROUND', roundId: restored.roundId, expectedRevision: restored.revision, dealtHands: dealCards(createDeck(2)), nextLevel: 2 })
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) continue
      expect(prepared.state.playerScores).toEqual(settled.state.playerScores)
      expect(prepared.state.phase).toBe('playing')
      expect(prepared.state.tribute).toBeNull()
      expect(prepared.state.turnOrder).toEqual(['p3', 'p2', 'p4', 'p1'])
      prepared.state.finishedPlayers = ['p2', 'p1']
      const second = settleMatchState(prepared.state)!
      expect(second.state.playerScores!.p1).toBe(won + (scoring === 3 ? 3 : 6))
      expect(second.state.playerScores!.p3).toBe(won + (scoring === 3 ? -3 : 0))
    }
  })
})
