import { describe, expect, it } from 'vitest'
import {
  PlayType,
  compareBombResolutions,
  createMatchState,
  diagnosePlay,
  getPlayInfo,
  getRuleProfile,
  resolvePlay,
  resolvePlayForContext,
  transition,
  type Card,
  type GameCommand,
  type MatchState,
  type PlayAction,
  type Player,
  type PlayerId,
  type Team,
} from '../src'

const profile = getRuleProfile('classic')
const teamFor = (id: PlayerId): Team => id === 'p1' || id === 'p3' ? 'teamA' : 'teamB'
const card = (
  id: string,
  value: number,
  suit: Card['suit'] = 'spade',
  extra: Partial<Card> = {},
): Card => ({ id, suit, rank: value as Card['rank'], value, isLevelCard: false, ...extra })
const player = (id: PlayerId, hand: Card[]): Player => ({
  id, name: id, isAI: id !== 'p1', team: teamFor(id), hand, role: 'normal',
})
const naturalTriplePair = (prefix: string, triple: number, pair: number): Card[] => [
  card(`${prefix}-t1`, triple, 'spade'),
  card(`${prefix}-t2`, triple, 'club'),
  card(`${prefix}-t3`, triple, 'diamond'),
  card(`${prefix}-p1`, pair, 'spade'),
  card(`${prefix}-p2`, pair, 'club'),
]
const ambiguousTriplePair = (): Card[] => [
  card('seven-a', 7, 'spade'),
  card('seven-b', 7, 'club'),
  card('nine-a', 9, 'spade'),
  card('nine-b', 9, 'club'),
  card('wild', 15, 'heart', { rank: 2, isLevelCard: true, isRedJoker: true }),
]
const action = (cards: Card[], maxValue: number): PlayAction => ({
  playerId: 'p2',
  cards,
  type: PlayType.TripleWithPair,
  resolution: { type: PlayType.TripleWithPair, maxValue },
})

describe('context-aware play resolution', () => {
  it('records 33+44+two level-7 wildcards as Plate:4 when following Plate:3', () => {
    const selected = [
      card('three-a', 3, 'spade'), card('three-b', 3, 'club'),
      card('four-a', 4, 'spade'), card('four-b', 4, 'club'),
      card('wild-seven-a', 15, 'heart', { rank: 7, isLevelCard: true, isRedJoker: true }),
      card('wild-seven-b', 15, 'heart', { rank: 7, isLevelCard: true, isRedJoker: true }),
    ]
    const lastCards = [
      card('last-two-a', 2, 'spade'), card('last-two-b', 2, 'club'), card('last-two-c', 2, 'diamond'),
      card('last-three-a', 3, 'spade'), card('last-three-b', 3, 'club'), card('last-three-c', 3, 'diamond'),
    ]
    const last: PlayAction = {
      playerId: 'p2', cards: lastCards, type: PlayType.Plate,
      resolution: { type: PlayType.Plate, maxValue: 3 },
    }

    expect(resolvePlay(selected, profile)).toMatchObject({ type: PlayType.Tube, maxValue: 5 })
    expect(resolvePlayForContext(selected, last, profile)).toMatchObject({ type: PlayType.Plate, maxValue: 4 })

    const base = createMatchState({
      ruleProfile: profile, currentLevel: 7, levelTeam: 'teamA',
      teamLevels: { teamA: 7, teamB: 7 }, dealerId: 'p1', currentTurn: 'p1',
      players: {
        p1: player('p1', [...selected, card('spare-seven-test', 8)]),
        p2: player('p2', [card('plate-p2', 9)]),
        p3: player('p3', [card('plate-p3', 10)]),
        p4: player('p4', [card('plate-p4', 11)]),
      },
    })
    const state: MatchState = {
      ...base, trick: { winningPlay: last, passedPlayerIds: [] }, lastValidPlay: last,
      playArea: [last], playHistory: [last],
    }
    const result = transition(state, {
      type: 'PLAY_CARDS', playerId: 'p1', cardIds: selected.map(item => item.id),
      roundId: state.roundId, expectedRevision: state.revision,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.lastValidPlay).toMatchObject({
      type: PlayType.Plate,
      resolution: { type: PlayType.Plate, maxValue: 4 },
    })
  })

  it('uses one least-sufficient interpretation for validation, diagnosis, and atomic accounting', () => {
    const selected = ambiguousTriplePair()
    const last = action(naturalTriplePair('last', 6, 4), 6)

    expect(resolvePlay(selected, profile)?.maxValue).toBe(9)
    const contextual = resolvePlayForContext(selected, last, profile)
    expect(contextual).toMatchObject({ type: PlayType.TripleWithPair, maxValue: 7 })
    expect(contextual?.wildcardUsages?.[0]).toMatchObject({ cardId: 'wild', representedValue: 7 })
    expect(diagnosePlay(selected, last, profile)).toMatchObject({
      code: 'valid', canPlay: true, resolution: { type: PlayType.TripleWithPair, maxValue: 7 },
    })

    const base = createMatchState({
      ruleProfile: profile,
      currentLevel: 2,
      levelTeam: 'teamA',
      teamLevels: { teamA: 2, teamB: 2 },
      dealerId: 'p1',
      currentTurn: 'p1',
      players: {
        p1: player('p1', [...selected, card('spare', 3)]),
        p2: player('p2', [card('p2', 4)]),
        p3: player('p3', [card('p3', 5)]),
        p4: player('p4', [card('p4', 6)]),
      },
    })
    const state: MatchState = {
      ...base,
      trick: { winningPlay: last, passedPlayerIds: [] },
      lastValidPlay: last,
      playArea: [last],
      playHistory: [last],
    }
    const command: GameCommand = {
      type: 'PLAY_CARDS', playerId: 'p1', cardIds: selected.map(item => item.id),
      roundId: state.roundId, expectedRevision: state.revision,
    }
    const result = transition(state, command)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const played = result.events.find(event => event.type === 'CARDS_PLAYED')
    expect(played?.type === 'CARDS_PLAYED' ? played.action.resolution : null)
      .toMatchObject({ type: PlayType.TripleWithPair, maxValue: 7 })
    expect(result.state.lastValidPlay?.resolution)
      .toMatchObject({ type: PlayType.TripleWithPair, maxValue: 7 })
  })

  it('uses the shared bomb comparator for four-bomb, straight-flush, six-bomb, and rocket order', () => {
    const four = { type: PlayType.Bomb, maxValue: 4_014, length: 4 }
    const flush = { type: PlayType.StraightFlush, maxValue: 5_507 }
    const six = { type: PlayType.Bomb, maxValue: 6_003, length: 6 }
    const rocket = { type: PlayType.Rocket, maxValue: 10_000 }
    expect(compareBombResolutions(flush, four)).toBeGreaterThan(0)
    expect(compareBombResolutions(six, flush)).toBeGreaterThan(0)
    expect(compareBombResolutions(rocket, six)).toBeGreaterThan(0)
  })

  it('keeps the rocket above physical eight-, nine-, and ten-card bombs', () => {
    const naturals = (value: number): Card[] => ['spade', 'heart', 'club', 'diamond'].flatMap(suit => [
      card(`${value}-${suit}-a`, value, suit as Card['suit']),
      card(`${value}-${suit}-b`, value, suit as Card['suit']),
    ])
    const wildcards = [
      card('wild-level-a', 15, 'heart', { rank: 7, isLevelCard: true, isRedJoker: true }),
      card('wild-level-b', 15, 'heart', { rank: 7, isLevelCard: true, isRedJoker: true }),
    ]
    const eight = getPlayInfo(naturals(3), profile)
    const nine = getPlayInfo([...naturals(3), wildcards[0]], profile)
    const ten = getPlayInfo([...naturals(3), ...wildcards], profile)
    const rocket = { type: PlayType.Rocket, maxValue: 10_000 }

    expect(eight).toMatchObject({ type: PlayType.Bomb, maxValue: 8_003, length: 8 })
    expect(nine).toMatchObject({ type: PlayType.Bomb, maxValue: 9_003, length: 9 })
    expect(ten).toMatchObject({ type: PlayType.Bomb, maxValue: 10_003, length: 10 })
    expect(compareBombResolutions(nine!, eight!)).toBeGreaterThan(0)
    expect(compareBombResolutions(ten!, nine!)).toBeGreaterThan(0)
    expect(compareBombResolutions(rocket, ten!)).toBeGreaterThan(0)
    expect(compareBombResolutions(ten!, rocket)).toBeLessThan(0)
  })

  it('preserves flush and non-flush interpretations with two wildcards', () => {
    const wildcards = [
      card('flush-wild-a', 15, 'heart', { rank: 7, isLevelCard: true, isRedJoker: true }),
      card('flush-wild-b', 15, 'heart', { rank: 7, isLevelCard: true, isRedJoker: true }),
    ]
    const flush = getPlayInfo([
      card('flush-three', 3, 'spade'),
      card('flush-four', 4, 'spade'),
      card('flush-five', 5, 'spade'),
      ...wildcards,
    ], profile)
    const straight = getPlayInfo([
      card('mixed-three', 3, 'spade'),
      card('mixed-four', 4, 'club'),
      card('mixed-five', 5, 'diamond'),
      ...wildcards,
    ], profile)

    expect(flush).toMatchObject({ type: PlayType.StraightFlush, maxValue: 5_507 })
    expect(flush?.wildcardUsages?.map(usage => usage.representedSuit)).toEqual(['spade', 'spade'])
    expect(straight).toMatchObject({ type: PlayType.Straight, maxValue: 7 })
  })
})
