import type { Card, Rank } from '../core/generated'

export type PublicCounterSuit = 'spade' | 'heart' | 'club' | 'diamond'
const SUITS: readonly PublicCounterSuit[] = ['spade', 'heart', 'club', 'diamond']
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A']

/** A public-information upper bound, NOT a peek at opponents' actual card allocation. */
export const publicStraightFlushPossibleSuits = (input: Readonly<{
  knownHand: readonly Card[]
  publicPlays: readonly { cards: readonly Card[] }[]
  otherHandSizes: readonly number[]
  level: Rank
  allowAceLowStraight: boolean
}>): PublicCounterSuit[] => {
  if (!input.otherHandSizes.some(count => count >= 5)) return []
  const remaining = new Map<string, number>()
  for (const suit of SUITS) for (const rank of RANKS) remaining.set(`${suit}:${rank}`, 2)
  const seen = new Set<string>()
  const remove = (card: Card): void => {
    if (seen.has(card.id)) return
    seen.add(card.id)
    const key = `${card.suit}:${card.rank}`
    if (remaining.has(key)) remaining.set(key, Math.max(0, remaining.get(key)! - 1))
  }
  input.knownHand.forEach(remove)
  input.publicPlays.forEach(play => play.cards.forEach(remove))
  // Red-heart level cards can replace any missing rank/suit, but only once each.
  const wildcardKey = `heart:${input.level}`
  const wildcards = remaining.get(wildcardKey) ?? 0
  remaining.set(wildcardKey, 0)
  const sequences = Array.from({ length: 9 }, (_, start) => RANKS.slice(start, start + 5))
  if (input.allowAceLowStraight) sequences.push(['A', 2, 3, 4, 5])
  return SUITS.filter(suit => sequences.some(sequence =>
    sequence.filter(rank => (remaining.get(`${suit}:${rank}`) ?? 0) === 0).length <= wildcards,
  ))
}
