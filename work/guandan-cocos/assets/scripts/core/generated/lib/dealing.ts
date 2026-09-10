import type { Card, PlayerId, Rank } from '../types/game'
import { createDeck, dealCards, shuffleDeck } from './deck'
import type { MatchFormat } from './matchFormat'
import { dealClusteredDeck } from './noShuffleDeal'

export type DealMode = NonNullable<MatchFormat['dealMode']>
/** Single-hand 多炸, not a previous round's pile. Ordinary random dealing is unchanged. */
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
  const pool = shuffleDeck(createDeck(level), checkedRandom)
  if (mode === 'random') return dealCards(pool)
  return dealClusteredDeck(pool, level, checkedRandom)
}
