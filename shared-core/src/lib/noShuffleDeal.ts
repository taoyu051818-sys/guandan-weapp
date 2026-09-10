import type { Card, PlayerId, Rank } from '../types/game'
import { MATCH_LEVELS } from './matchFormat'

const SEATS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']
const HAND_SIZE = 27
// Historical deal calibration; client auto-arrange no longer promises six groups.
const STRAIGHT_PACKETS = 7

const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Make natural rank/sequence packets from an already shuffled physical deck.
 * No wildcard substitution or artificial card faces. Plain level cards cannot
 * join sequences; avoiding A2345 also works with both existing rule profiles.
 */
const makePackets = (deck: readonly Card[], level: Rank, random: () => number): Card[][] => {
  let pool = deck.slice()
  const packets: Card[][] = []
  const take = (cards: Card[]): void => {
    const ids = new Set(cards.map(card => card.id))
    pool = pool.filter(card => !ids.has(card.id))
    packets.push(cards)
  }
  const windows = Array.from({ length: 9 }, (_, start) => MATCH_LEVELS.slice(start, start + 5))
    .filter(window => !window.includes(level))
  for (let i = 0; i < STRAIGHT_PACKETS; i++) {
    const ranks = shuffled(windows, random)
      .find(window => window.every(rank => pool.some(card => card.rank === rank)))
    if (ranks) take(ranks.map(rank => pool.find(card => card.rank === rank)!))
  }
  for (const rank of shuffled(MATCH_LEVELS, random)) {
    const cards = pool.filter(card => card.rank === rank)
    if (cards.length) take(cards)
  }
  // Jokers remain independent: do not deliberately distribute rockets.
  packets.push(...pool.map(card => [card]))
  return packets
}

/** A single bounded deal, no expensive planner/rejection loop and no player
 * identity, wallet, recent win/loss or bot flags. Keep packets intact wherever
 * one of the four anonymous 27-card slots fits; split only the remaining tail.
 * Seat assignment happens last, so allocation order never privileges p1/host.
 */
export const dealClusteredDeck = (
  deck: readonly Card[], level: Rank, random: () => number,
): Record<PlayerId, Card[]> => {
  const slots: Card[][] = [[], [], [], []]
  const packets = shuffled(makePackets(deck, level, random), random)
    .sort((a, b) => b.length - a.length)
  for (const packet of packets) {
    const slot = shuffled(slots, random).find(hand => hand.length + packet.length <= HAND_SIZE)
    if (slot) slot.push(...packet)
    else for (const card of packet) {
      const available = shuffled(slots, random).find(hand => hand.length < HAND_SIZE)!
      available.push(card)
    }
  }
  const hands = {} as Record<PlayerId, Card[]>
  shuffled(SEATS, random).forEach((seat, index) => {
    hands[seat] = slots[index].sort((a, b) => b.value - a.value)
  })
  return hands
}
