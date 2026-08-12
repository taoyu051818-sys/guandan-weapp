import { describe, expect, it } from 'vitest'
import {
  PlayType,
  getRuleProfile,
  rankHintMoves,
  type Card,
  type HintProtectedGroup,
  type PlayAction,
} from '../src'

const profile = getRuleProfile('classic')
const card = (
  id: string,
  rank: Card['rank'],
  value: number,
  suit: Card['suit'] = 'spade',
  extra: Partial<Card> = {},
): Card => ({ id, rank, value, suit, isLevelCard: false, ...extra })
const lastSingle = (value: number): PlayAction => ({
  playerId: 'p2',
  cards: [card(`last-${value}`, value as Card['rank'], value)],
  type: PlayType.Single,
})
const rank = (hand: Card[], lastPlay: PlayAction | null, protectedGroups: HintProtectedGroup[] = []) =>
  rankHintMoves({ hand, lastPlay, ruleProfile: profile, protectedGroups })

describe('hand hint policy', () => {
  it('prefers a loose single over splitting a pair', () => {
    const hand = [card('8s', 8, 8), card('8c', 8, 8, 'club'), card('9s', 9, 9)]
    const moves = rank(hand, lastSingle(7), [{ id: 'pair-8', kind: 'pair', cardIds: ['8s', '8c'] }])
    expect(moves[0].cards.map(item => item.id)).toEqual(['9s'])
  })

  it('prefers splitting a pair over spending a complete bomb', () => {
    const hand = [
      card('8s', 8, 8), card('8c', 8, 8, 'club'),
      card('10s', 10, 10), card('10h', 10, 10, 'heart'), card('10c', 10, 10, 'club'), card('10d', 10, 10, 'diamond'),
    ]
    const moves = rank(hand, lastSingle(7), [
      { id: 'pair-8', kind: 'pair', cardIds: ['8s', '8c'] },
      { id: 'bomb-10', kind: 'bomb', cardIds: ['10s', '10h', '10c', '10d'] },
    ])
    expect(moves[0].cards).toHaveLength(1)
    expect(moves[0].cards[0].rank).toBe(8)
  })

  it('plays a complete bomb instead of splitting that bomb', () => {
    const hand = [card('9s', 9, 9), card('9h', 9, 9, 'heart'), card('9c', 9, 9, 'club'), card('9d', 9, 9, 'diamond')]
    const moves = rank(hand, lastSingle(8), [{ id: 'bomb-9', kind: 'bomb', cardIds: hand.map(item => item.id) }])
    expect(moves[0].cards).toHaveLength(4)
    expect(moves[0].damage.usesBomb).toBe(true)
  })

  it('hard-protects partial locked groups while an intact alternative exists', () => {
    const hand = [card('8s', 8, 8), card('8c', 8, 8, 'club'), card('9s', 9, 9)]
    const moves = rank(hand, lastSingle(7), [{ id: 'locked-8', kind: 'locked', cardIds: ['8s', '8c'] }])
    expect(moves.some(move => move.cards.some(item => item.id.startsWith('8')))).toBe(false)
    expect(moves[0].warning).toBeNull()
  })

  it('allows splitting a locked group only when no intact legal move exists', () => {
    const hand = [card('8s', 8, 8), card('8c', 8, 8, 'club')]
    const moves = rank(hand, lastSingle(7), [{ id: 'locked-8', kind: 'locked', cardIds: ['8s', '8c'] }])
    expect(moves[0].warning).toBe('splits-locked-group')
  })

  it('prefers an ordinary level card over the heart level wildcard', () => {
    const hand = [
      card('level-spade', 7, 15, 'spade', { isLevelCard: true }),
      card('level-heart', 7, 15, 'heart', { isLevelCard: true, isRedJoker: true }),
    ]
    const moves = rank(hand, lastSingle(14))
    expect(moves[0].cards.map(item => item.id)).toEqual(['level-spade'])
    expect(moves[0].damage.wildcardCount).toBe(0)
  })

  it('still uses the heart level wildcard when it is the only legal move', () => {
    const hand = [card('level-heart', 7, 15, 'heart', { isLevelCard: true, isRedJoker: true })]
    const moves = rank(hand, lastSingle(14))
    expect(moves[0].cards.map(item => item.id)).toEqual(['level-heart'])
  })
})
