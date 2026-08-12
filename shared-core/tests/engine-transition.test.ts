import { describe, expect, it } from 'vitest'
import {
  PlayType,
  createMatchState,
  getRuleProfile,
  transition,
  type Card,
  type GameCommand,
  type MatchState,
  type Player,
  type PlayerId,
  type Team,
} from '../src'

const teamFor = (id: PlayerId): Team => id === 'p1' || id === 'p3' ? 'teamA' : 'teamB'
const card = (id: string, value: number): Card => ({
  id,
  suit: 'spade',
  rank: value as Card['rank'],
  value,
  isLevelCard: false,
})
const player = (id: PlayerId, hand: Card[]): Player => ({
  id,
  name: id,
  isAI: id !== 'p1',
  team: teamFor(id),
  hand,
  role: 'normal',
})

const match = (hands: Record<PlayerId, Card[]>, currentTurn: PlayerId = 'p1'): MatchState =>
  createMatchState({
    ruleProfile: getRuleProfile('classic'),
    currentLevel: 2,
    levelTeam: 'teamA',
    teamLevels: { teamA: 2, teamB: 2 },
    dealerId: 'p1',
    currentTurn,
    players: {
      p1: player('p1', hands.p1),
      p2: player('p2', hands.p2),
      p3: player('p3', hands.p3),
      p4: player('p4', hands.p4),
    },
  })

const command = <T extends GameCommand['type']>(
  state: MatchState,
  value: Omit<Extract<GameCommand, { type: T }>, 'roundId' | 'expectedRevision'>,
): Extract<GameCommand, { type: T }> => ({
  ...value,
  roundId: state.roundId,
  expectedRevision: state.revision,
} as Extract<GameCommand, { type: T }>)

const expectFailureUnchanged = (state: MatchState, action: GameCommand, reason: string): void => {
  const before = structuredClone(state)
  const result = transition(state, action)
  expect(result).toEqual({ ok: false, reason })
  expect(state).toEqual(before)
}

describe('atomic transition', () => {
  it('plays owned cards and advances the turn in one revision', () => {
    const state = match({
      p1: [card('p1-3', 3), card('p1-8', 8)],
      p2: [card('p2-4', 4)], p3: [card('p3-5', 5)], p4: [card('p4-6', 6)],
    })
    const result = transition(state, command(state, {
      type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['p1-3'],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.revision).toBe(1)
    expect(result.state.currentTurn).toBe('p2')
    expect(result.state.players.p1.hand.map(item => item.id)).toEqual(['p1-8'])
    expect(result.state.trick.winningPlay?.type).toBe(PlayType.Single)
    expect(result.events.map(event => event.type)).toEqual(['CARDS_PLAYED', 'TURN_ADVANCED'])
  })

  it('rejects stale, wrong-round, duplicate, forged, and opening-pass commands unchanged', () => {
    const state = match({
      p1: [card('p1-3', 3)], p2: [card('p2-4', 4)],
      p3: [card('p3-5', 5)], p4: [card('p4-6', 6)],
    })
    expectFailureUnchanged(state, { type: 'PASS', playerId: 'p1', roundId: 1, expectedRevision: 0 }, 'CANNOT_PASS_ON_LEAD')
    expectFailureUnchanged(state, { type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['missing'], roundId: 1, expectedRevision: 0 }, 'CARD_NOT_IN_HAND')
    expectFailureUnchanged(state, { type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['p1-3', 'p1-3'], roundId: 1, expectedRevision: 0 }, 'DUPLICATE_CARD')
    expectFailureUnchanged(state, { type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['p1-3'], roundId: 2, expectedRevision: 0 }, 'ROUND_MISMATCH')
    expectFailureUnchanged(state, { type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['p1-3'], roundId: 1, expectedRevision: 9 }, 'STALE_REVISION')
  })

  it('returns the lead to the active winner after three passes', () => {
    let state = match({
      p1: [card('p1-3', 3), card('p1-9', 9)], p2: [card('p2-4', 4)],
      p3: [card('p3-5', 5)], p4: [card('p4-6', 6)],
    })
    const play = transition(state, command(state, { type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['p1-3'] }))
    if (!play.ok) throw new Error(play.reason)
    state = play.state
    for (const playerId of ['p2', 'p3', 'p4'] as const) {
      const passed = transition(state, command(state, { type: 'PASS', playerId }))
      if (!passed.ok) throw new Error(passed.reason)
      state = passed.state
    }
    expect(state.currentTurn).toBe('p1')
    expect(state.trick).toEqual({ winningPlay: null, passedPlayerIds: [] })
  })

  it("hands the lead to a finished winner's teammate after contact", () => {
    let state = match({
      p1: [card('p1-3', 3)], p2: [card('p2-4', 4)],
      p3: [card('p3-5', 5), card('p3-9', 9)], p4: [card('p4-6', 6)],
    })
    const play = transition(state, command(state, { type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['p1-3'] }))
    if (!play.ok) throw new Error(play.reason)
    state = play.state
    for (const playerId of ['p2', 'p3', 'p4'] as const) {
      const passed = transition(state, command(state, { type: 'PASS', playerId }))
      if (!passed.ok) throw new Error(passed.reason)
      state = passed.state
    }
    expect(state.currentTurn).toBe('p3')
  })

  it('records ranking and settlement in the finishing play command', () => {
    const base = match({
      p1: [], p2: [card('p2-4', 4)], p3: [card('p3-5', 5)], p4: [card('p4-6', 6)],
    }, 'p3')
    const state: MatchState = { ...base, finishedPlayers: ['p1'] }
    const result = transition(state, command(state, {
      type: 'PLAY_CARDS', playerId: 'p3', cardIds: ['p3-5'],
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.phase).toBe('settled')
    expect(result.state.finishedPlayers).toEqual(['p1', 'p3'])
    expect(result.state.settlement?.levelUp).toBe(3)
    expect(result.events.map(event => event.type)).toEqual([
      'CARDS_PLAYED', 'PLAYER_FINISHED', 'ROUND_SETTLED',
    ])
  })
})
