import { describe, expect, it } from 'vitest'
import { createGame, dealNextRound, isRoundOver, passTurn, playCards, type Card, type EngineState } from '../src'

describe('legacy round recovery boundary', () => {
  it('retains independent ranking and deal rules without aliasing the previous format', () => {
    const previous = createGame(2)
    previous.matchFormat = { kind: 'independent', levelMode: 'random', levelRank: 2, tributeEnabled: false, doubleDown: 3, individualRanking: true, dealMode: 'random' }
    const next = dealNextRound(previous, 5, 'p1')
    expect(next.matchFormat).toEqual(previous.matchFormat)
    expect(next.matchFormat).not.toBe(previous.matchFormat)
    next.finishedPlayers = ['p1', 'p3']
    expect(isRoundOver(next)).toBe(false)
    expect(Object.values(next.players).every(player => player.hand.length === 27)).toBe(true)
  })

  it('does not count passes from an earlier winner after JSON restoration', () => {
    const card = (id: string, value: number): Card => ({ id, rank: value as Card['rank'], value, suit: 'spade', isLevelCard: false, isRedJoker: false })
    let state: EngineState = createGame(2)
    for (const [index, id] of state.turnOrder.entries()) state.players[id].hand = [card(`${id}-a`, 3 + index), card(`${id}-b`, 8 + index)]
    state = playCards(state, 'p1', [state.players.p1.hand[0]])
    state = passTurn(state, 'p2')
    state = passTurn(state, 'p3')
    state = playCards(state, 'p4', [state.players.p4.hand[0]])
    const restored = JSON.parse(JSON.stringify(state)) as EngineState
    const originalNext = passTurn(state, 'p1')
    expect(passTurn(restored, 'p1')).toEqual(originalNext)
    expect(originalNext.currentTurn).toBe('p2')
    expect(originalNext.lastValidPlay?.playerId).toBe('p4')
  })
})
