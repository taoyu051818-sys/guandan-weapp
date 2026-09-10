import type { Card, PlayerId, Rank } from '../types/game'
import { createDeck, dealCards, shuffleDeck } from './deck'
import { MATCH_LEVELS, type MatchFormat } from './matchFormat'

export type DealMode = NonNullable<MatchFormat['dealMode']>
const SEATS: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
const CLUSTER_COUNT = 6

const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Single-hand 多炸: preserve randomly selected rank packets, not a previous round's pile.
 * No player identity, strength or wallet enters the deal. Cuts may split a packet;
 * more bombs is a distribution property, never a guaranteed bomb or win for a seat.
 */
export const dealGameCards = (
  level: Rank,
  mode: DealMode = 'random',
  random: () => number = Math.random,
): Record<PlayerId, Card[]> => {
  if (mode !== 'random' && mode !== 'no-shuffle') throw new Error('INVALID_DEAL_MODE')
  const checkedRandom = () => {
    const value = random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('INVALID_DEAL_RANDOM')
    return value
  }
  let pool = shuffleDeck(createDeck(level), checkedRandom)
  if (mode === 'random') return dealCards(pool)

  const packets: Card[][] = []
  const ranks = shuffled(MATCH_LEVELS, checkedRandom).slice(0, CLUSTER_COUNT)
  for (const rank of ranks) {
    const packet = pool.filter(card => card.rank === rank).slice(0, 4 + Math.floor(checkedRandom() * 3))
    const ids = new Set(packet.map(card => card.id))
    pool = pool.filter(card => !ids.has(card.id))
    packets.push(packet)
  }
  packets.push(...pool.map(card => [card]))
  const ordered = shuffled(packets, checkedRandom).flat()
  const cut = Math.floor(checkedRandom() * ordered.length)
  const deck = [...ordered.slice(cut), ...ordered.slice(0, cut)]
  const seats = shuffled(SEATS, checkedRandom)
  const hands = {} as Record<PlayerId, Card[]>
  seats.forEach((seat, index) => {
    hands[seat] = deck.slice(index * 27, (index + 1) * 27).sort((a, b) => b.value - a.value)
  })
  return hands
}
