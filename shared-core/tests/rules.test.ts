import { describe, expect, it } from 'vitest'
import {
  PlayType,
  createDeck,
  getRuleProfile,
  legalMoves,
  representativeLegalMoves,
  resolvePlay,
  type Card,
} from '../src'

const key = (cards: readonly Card[]): string => cards.map(card => card.id).sort().join(',')

describe('explicit rule profiles', () => {
  it('returns immutable profiles without shared mutable rule state', () => {
    const classic = getRuleProfile('classic')
    const tournament = getRuleProfile('tournament')

    expect(Object.isFrozen(classic)).toBe(true)
    expect(Object.isFrozen(tournament)).toBe(true)
    expect(classic.allowA2345Straight).toBe(true)
    expect(tournament.allowA2345Straight).toBe(false)
    expect(getRuleProfile('classic')).toBe(classic)
  })

  it('classifies the same cards independently under each supplied profile', () => {
    const deck = createDeck(6)
    const take = (rank: Card['rank'], suit: Card['suit']): Card => {
      const card = deck.find(item => item.rank === rank && item.suit === suit)
      if (!card) throw new Error(`missing ${String(rank)}-${suit}`)
      return card
    }
    const aceLow = [
      take('A', 'spade'), take(2, 'club'), take(3, 'diamond'),
      take(4, 'club'), take(5, 'diamond'),
    ]

    expect(resolvePlay(aceLow, getRuleProfile('classic'))?.type).toBe(PlayType.Straight)
    expect(resolvePlay(aceLow, getRuleProfile('tournament'))).toBeNull()
    expect(resolvePlay(aceLow, getRuleProfile('classic'))?.type).toBe(PlayType.Straight)
  })
})

describe('legalMoves', () => {
  it('returns every physical single, pair, triple, and bomb without strategy pruning', () => {
    const fourSevens = createDeck(2).filter(card => card.rank === 7).slice(0, 4)
    const moves = legalMoves(fourSevens, null, getRuleProfile('classic'))
    const byLength = (length: number) => moves.filter(move => move.length === length).map(key)

    expect(new Set(byLength(1)).size).toBe(4)
    expect(new Set(byLength(2)).size).toBe(6)
    expect(new Set(byLength(3)).size).toBe(4)
    expect(new Set(byLength(4)).size).toBe(1)
    expect(moves.every(move => resolvePlay(move, getRuleProfile('classic')) !== null)).toBe(true)
  })

  it('filters profile-specific moves while preserving stable physical ids', () => {
    const deck = createDeck(6)
    const ranks: Card['rank'][] = ['A', 2, 3, 4, 5]
    const hand = ranks.map((rank, index) => {
      const suits: Card['suit'][] = ['spade', 'club', 'diamond', 'club', 'diamond']
      const card = deck.find(item => item.rank === rank && item.suit === suits[index])
      if (!card) throw new Error(`missing ${String(rank)}`)
      return card
    })
    const fullHandKey = key(hand)

    expect(legalMoves(hand, null, getRuleProfile('classic')).map(key)).toContain(fullHandKey)
    expect(legalMoves(hand, null, getRuleProfile('tournament')).map(key)).not.toContain(fullHandKey)
    expect(legalMoves([...hand].reverse(), null, getRuleProfile('classic')).map(key))
      .toEqual(legalMoves(hand, null, getRuleProfile('classic')).map(key))
  })

  it('keeps AI representatives complete by semantic class and deterministic', () => {
    const profile = getRuleProfile('classic')
    const hand = createDeck(6).filter(card => (
      [3, 4, 5, 6, 7].includes(card.rank as number)
      || card.isRedJoker
    )).slice(0, 10)
    const classKey = (move: Card[]): string => {
      const resolution = resolvePlay(move, profile)
      if (!resolution) throw new Error('expected legal move')
      return `${resolution.type}:${resolution.maxValue}:${move.length}`
    }
    const allClasses = new Set(legalMoves(hand, null, profile).map(classKey))
    const representatives = representativeLegalMoves(hand, null, profile)

    expect(new Set(representatives.map(classKey))).toEqual(allClasses)
    expect(representatives).toHaveLength(allClasses.size)
    expect(representativeLegalMoves([...hand].reverse(), null, profile).map(key))
      .toEqual(representatives.map(key))
  })
})
