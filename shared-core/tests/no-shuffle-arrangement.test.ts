import { describe, expect, it } from 'vitest'
import { createDeck, dealGameCards, MATCH_LEVELS } from '../src'
import { createSeededRandom } from '../src/ai/random'
import { dealClusteredDeck } from '../src/lib/noShuffleDeal'

describe('noShuffleDeal opening arrangement', () => {
  it('retains the same deterministic physical deal independently of client grouping', () => {
    for (const [index, level] of MATCH_LEVELS.entries()) {
      const hands = dealGameCards(level, 'no-shuffle', createSeededRandom(931000 + index))
      expect(hands).toEqual(dealGameCards(level, 'no-shuffle', createSeededRandom(931000 + index)))
      expect(Object.values(hands).map(hand => hand.length)).toEqual([27, 27, 27, 27])
      const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
      expect(Object.values(hands).flat().sort(byId)).toEqual(createDeck(level).sort(byId))
    }
  })

  it('preserves the input deck and terminates for extreme valid random values', () => {
    for (const level of MATCH_LEVELS) for (const value of [0, 1 - Number.EPSILON]) {
      const deck = createDeck(level), original = JSON.stringify(deck)
      const hands = dealClusteredDeck(deck, level, () => value)
      expect(Object.values(hands).map(hand => hand.length)).toEqual([27, 27, 27, 27])
      expect(new Set(Object.values(hands).flat().map(card => card.id)).size).toBe(108)
      expect(JSON.stringify(deck)).toBe(original)
    }
  })
})
