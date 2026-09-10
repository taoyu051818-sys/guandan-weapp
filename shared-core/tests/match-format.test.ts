import { describe, expect, it } from 'vitest'
import { chooseMatchLevel, MATCH_LEVELS, normalizeRoomFormat, roomMatchFormat, createGame, createMatchState, createDeck, dealCards, settleMatchState, transition, getRuleProfile, type MatchFormat, type PlayerId, type Rank } from '../src'

const independent: MatchFormat = { kind: 'independent', levelMode: 'random', levelRank: 2, tributeEnabled: false, doubleDown: 3 }
const ranked = (level: Rank, rank: PlayerId[], format: MatchFormat = independent) => {
  const state = createMatchState({
    matchFormat: format, ruleProfile: getRuleProfile('classic'), currentLevel: level,
    teamLevels: { teamA: level, teamB: level }, levelTeam: 'teamA', dealerId: 'p1', players: createGame(level).players,
  })
  state.finishedPlayers = rank
  return state
}

describe('independent level matches', () => {
  it('plays out third place for individual tournaments instead of inventing it by seat order', () => {
    const tournament = { ...independent, individualRanking: true }
    const state = ranked(7, ['p1'], tournament)
    const card = (rank: number) => createDeck(7).find(c => c.rank === rank && c.suit === 'spade')!
    state.players.p1.hand = []
    state.players.p2.hand = [card(4)]
    state.players.p3.hand = [card(5)]
    state.players.p4.hand = [card(6)]
    state.currentTurn = 'p3'
    const second = transition(state, { type: 'PLAY_CARDS', playerId: 'p3', cardIds: [state.players.p3.hand[0].id], roundId: state.roundId, expectedRevision: state.revision })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.reason)
    expect(second.state.phase).toBe('playing')
    expect(second.state.currentTurn).toBe('p4')
    expect(settleMatchState(second.state)).toBeNull()
    const third = transition(second.state, { type: 'PLAY_CARDS', playerId: 'p4', cardIds: [second.state.players.p4.hand[0].id], roundId: second.state.roundId, expectedRevision: second.state.revision })
    expect(third.ok).toBe(true)
    if (!third.ok) throw new Error(third.reason)
    expect(third.state.phase).toBe('settled')
    expect(third.state.settlement?.fullRank).toEqual(['p1', 'p3', 'p4', 'p2'])
    expect(third.state.settlement?.playerPoints).toEqual({ p1: 3, p3: 2, p4: 1, p2: 0 })
    expect(settleMatchState(ranked(7, ['p1', 'p3']))).not.toBeNull()
  })
  it('validates explicit friend-room gates without migrating historical matches', () => {
    for (const upgradeTarget of [6, 10, 'A', 'A-reset']) {
      expect(roomMatchFormat(normalizeRoomFormat({ format: 'upgrade', upgradeTarget })!).upgradeTarget).toBe(upgradeTarget)
    }
    for (const source of [{ format: 'rounds', upgradeTarget: 6 }, { format: 'upgrade', upgradeTarget: 9 }, { upgradeTarget: 'A' }]) expect(() => normalizeRoomFormat(source)).toThrow()
    expect(normalizeRoomFormat({ format: 'upgrade' })?.upgradeTarget).toBeUndefined()
  })
  it('caps at each mandatory gate, requires playing it, and preserves the losing team level', () => {
    for (const upgradeTarget of [6, 10, 'A'] as const) {
      const format: MatchFormat = { ...independent, kind: 'upgrade', levelMode: 'fixed', upgradeTarget, doubleDown: 4 }
      const beforeGate = MATCH_LEVELS[MATCH_LEVELS.indexOf(upgradeTarget) - 1]
      const reached = settleMatchState(ranked(beforeGate, ['p1', 'p3'], format))!
      expect(reached.state.currentLevel).toBe(upgradeTarget)
      expect(reached.settlement.isGameWon).toBe(false)
      const atGate = ranked(upgradeTarget, ['p1', 'p2', 'p3'], format)
      expect(settleMatchState(atGate)?.settlement.isGameWon).toBe(true)
      atGate.finishedPlayers = ['p1', 'p2', 'p4']
      expect(settleMatchState(atGate)?.state).toMatchObject({ currentLevel: upgradeTarget, aFailStreaks: { teamA: 0, teamB: 0 } })
      atGate.finishedPlayers = ['p2', 'p4']
      expect(settleMatchState(atGate)?.settlement.isGameWon).toBe(false)
    }
  })
  it('counts only the attacking team’s A attempts and resets on the third failure', () => {
    const format: MatchFormat = { ...independent, kind: 'upgrade', levelMode: 'fixed', upgradeTarget: 'A-reset' }
    for (const rank of [['p1', 'p2', 'p4'], ['p2', 'p4']] as PlayerId[][]) {
      const state = ranked('A', rank, format)
      state.aFailStreaks.teamA = 2
      const result = settleMatchState(state)!
      expect(result.state.teamLevels.teamA).toBe(2)
      expect(result.state.aFailStreaks.teamA).toBe(0)
      expect(result.settlement.isGameWon).toBe(false)
      expect(state.teamLevels.teamA).toBe('A')
    }
    const unrelated = ranked(8, ['p2', 'p4'], format)
    unrelated.teamLevels.teamA = 'A'
    unrelated.aFailStreaks.teamA = 2
    unrelated.levelTeam = 'teamB'
    expect(settleMatchState(unrelated)?.state.aFailStreaks.teamA).toBe(2)
  })
  it('draws all 13 levels uniformly and rejects malformed randomness', () => {
    expect(MATCH_LEVELS.map((_, i) => chooseMatchLevel(independent, () => (i + 0.5) / 13))).toEqual(MATCH_LEVELS)
    for (const value of [-1, 1, NaN, Infinity]) expect(() => chooseMatchLevel(independent, () => value)).toThrow()
    expect(chooseMatchLevel({ ...independent, levelMode: 'fixed', levelRank: 'A' }, () => { throw new Error('unused') })).toBe('A')
  })
  it('settles every level by rank, never invokes the K/A gates or upgrades', () => {
    for (const level of MATCH_LEVELS) for (const [rank, points] of [
      [['p1', 'p3'], 3], [['p1', 'p2', 'p3'], 2], [['p1', 'p2', 'p4'], 1],
    ] as [PlayerId[], number][]) {
      const before = ranked(level, rank)
      const result = settleMatchState(before)!
      expect(result.settlement).toMatchObject({ format: 'independent', winnerTeam: 'teamA', levelUp: 0, pointsEarned: points, currentLevel: level, isGameWon: false })
      expect(result.state.teamLevels).toEqual({ teamA: level, teamB: level })
      expect(result.state.scores).toEqual({ teamA: points, teamB: 0 })
      expect(before.scores).toEqual({ teamA: 0, teamB: 0 })
    }
  })
  it('starts the next independent hand at its supplied authoritative level without tribute', () => {
    const ended = settleMatchState(ranked('A', ['p1', 'p3']))!.state
    const result = transition(ended, { type: 'PREPARE_NEXT_ROUND', expectedRevision: ended.revision, roundId: ended.roundId, nextLevel: 7, dealtHands: dealCards(createDeck(7)) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.state).toMatchObject({ phase: 'playing', currentLevel: 7, teamLevels: { teamA: 7, teamB: 7 }, tribute: null, roundMeta: null, roundId: ended.roundId + 1 })
    expect(result.state.players.p1.hand).toHaveLength(27)
    expect(Object.values(result.state.players).flatMap(p => p.hand).filter(c => c.isLevelCard).every(c => c.rank === 7)).toBe(true)
    expect(result.events.some(event => event.type === 'ANTI_TRIBUTE')).toBe(false)
    expect(ended.currentLevel).toBe('A')
  })
  it('rejects a changed fixed level and preserves upgrade behavior and optional tribute', () => {
    const fixed = settleMatchState(ranked('A', ['p1', 'p3'], { ...independent, levelMode: 'fixed', levelRank: 'A' }))!.state
    expect(transition(fixed, { type: 'PREPARE_NEXT_ROUND', expectedRevision: fixed.revision, roundId: fixed.roundId, nextLevel: 2, dealtHands: dealCards(createDeck(2)) }).ok).toBe(false)
    const upgrade: MatchFormat = { ...independent, kind: 'upgrade', levelMode: 'fixed', doubleDown: 4 }
    const ended = settleMatchState(ranked(2, ['p1', 'p3'], upgrade))!.state
    expect(ended.settlement?.levelUp).toBe(4)
    expect(ended.currentLevel).toBe(6)
    const next = transition(ended, { type: 'PREPARE_NEXT_ROUND', expectedRevision: ended.revision, roundId: ended.roundId, dealtHands: dealCards(createDeck(6)) })
    expect(next.ok && next.state.phase).toBe('playing')
    expect(settleMatchState(ranked('A', ['p1', 'p3'], upgrade))?.settlement.isGameWon).toBe(true)
  })
  it('keeps legacy settings distinguishable and rejects contradictory configurations', () => {
    expect(normalizeRoomFormat({})).toBeUndefined()
    expect(roomMatchFormat(normalizeRoomFormat({ format: 'rounds' })!)).toEqual(independent)
    for (const source of [{ format: 'rounds', tributeEnabled: true }, { format: 'upgrade', levelMode: 'random' }, { format: 'rounds', levelRank: 'JOKER' }, { levelMode: 'fixed' }]) {
      expect(() => normalizeRoomFormat(source)).toThrow()
    }
  })
})
