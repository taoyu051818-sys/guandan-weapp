import { PlayType } from '../types/game'
import type { Card, PlayAction, Suit } from '../types/game'
import { canPlay, getFaceValue, getPlayInfo, type RuleProfile } from './rules'

const cardsKey = (cards: readonly Card[]): string =>
  cards.map(card => card.id).sort().join(',')

const semanticCardsKey = (cards: readonly Card[]): string =>
  cards
    .map(card => [
      card.rank,
      card.value,
      card.suit,
      Number(card.isLevelCard),
      Number(card.isRedJoker === true),
    ].join(':'))
    .sort()
    .join(',')

const SUIT_ORDER: Readonly<Record<Suit, number>> = {
  spade: 0,
  heart: 1,
  club: 2,
  diamond: 3,
  joker: 4,
}

const CARD_VALUES = Array.from({ length: 16 }, (_, index) => index + 2)

const compareCards = (left: Card, right: Card): number =>
  left.value - right.value
  || SUIT_ORDER[left.suit] - SUIT_ORDER[right.suit]
  || left.id.localeCompare(right.id)

const combinations = <T>(items: readonly T[], size: number): T[][] => {
  if (size < 0 || size > items.length) return []
  if (size === 0) return [[]]
  const result: T[][] = []
  const selected: T[] = []
  const visit = (start: number): void => {
    if (selected.length === size) {
      result.push([...selected])
      return
    }
    const remaining = size - selected.length
    for (let index = start; index <= items.length - remaining; index += 1) {
      selected.push(items[index])
      visit(index + 1)
      selected.pop()
    }
  }
  visit(0)
  return result
}

const groupedCombinations = (groups: readonly Card[][], sizePerGroup: number): Card[][] => {
  let result: Card[][] = [[]]
  for (const group of groups) {
    const choices = combinations(group, sizePerGroup)
    if (choices.length === 0) return []
    const next: Card[][] = []
    for (const prefix of result) {
      const usedIds = new Set(prefix.map(card => card.id))
      for (const choice of choices) {
        if (choice.every(card => !usedIds.has(card.id))) next.push([...prefix, ...choice])
      }
    }
    result = next
  }
  return result
}

const groupCardsBy = (
  cards: readonly Card[],
  valueOf: (card: Card) => number,
): Map<number, Card[]> => {
  const groups = new Map<number, Card[]>()
  cards.forEach(card => {
    const value = valueOf(card)
    const group = groups.get(value)
    if (group) group.push(card)
    else groups.set(value, [card])
  })
  return groups
}

export const enumerateCandidateMoves = (hand: readonly Card[]): Card[][] => {
  if (hand.length === 0) return []
  const moves: Card[][] = []
  const sorted = [...hand].sort(compareCards)
  const wildcards = sorted.filter(card => card.isRedJoker)
  const normalCards = sorted.filter(card => !card.isRedJoker)
  const valueGroups = groupCardsBy(normalCards, card => card.value)

  sorted.forEach(card => moves.push([card]))

  const pairs: Array<{ cards: Card[]; targetValue: number }> = []
  const triples: Array<{ cards: Card[]; targetValue: number }> = []
  for (const value of CARD_VALUES) {
    const group = [...(valueGroups.get(value) ?? []), ...(value <= 15 ? wildcards : [])]
    const groupPairs = combinations(group, 2)
    const groupTriples = combinations(group, 3)
    pairs.push(...groupPairs.map(cards => ({ cards, targetValue: value })))
    triples.push(...groupTriples.map(cards => ({ cards, targetValue: value })))
    moves.push(...groupPairs, ...groupTriples)
    for (let length = 4; length <= group.length; length += 1) {
      moves.push(...combinations(group, length))
    }
  }

  for (const triple of triples) {
    for (const pair of pairs) {
      if (
        triple.targetValue !== pair.targetValue
        && pair.cards.every(card => !triple.cards.some(item => item.id === card.id))
      ) moves.push([...triple.cards, ...pair.cards])
    }
  }

  const consecutiveCards = normalCards.filter(
    card => getFaceValue(card) <= 14 && !card.isLevelCard,
  )
  const faceGroups = groupCardsBy(consecutiveCards, getFaceValue)
  const cardsForFace = (value: number): Card[] => [
    ...(faceGroups.get(value) ?? []),
    ...wildcards,
  ]
  const straightWindows = [
    [14, 2, 3, 4, 5],
    ...Array.from({ length: 9 }, (_, index) =>
      Array.from({ length: 5 }, (__, offset) => index + offset + 2)),
  ]
  straightWindows.forEach(window => {
    moves.push(...groupedCombinations(window.map(cardsForFace), 1))
  })
  for (let start = 2; start <= 12; start += 1) {
    moves.push(...groupedCombinations([start, start + 1, start + 2].map(cardsForFace), 2))
  }
  for (let start = 2; start <= 13; start += 1) {
    moves.push(...groupedCombinations([start, start + 1].map(cardsForFace), 3))
  }

  moves.push(...combinations(sorted.filter(card => card.suit === 'joker'), 4))
  const uniqueMoves = new Map<string, Card[]>()
  moves.forEach(move => uniqueMoves.set(cardsKey(move), move))
  return Array.from(uniqueMoves.values())
}

const PLAY_TYPE_ORDER: Readonly<Record<PlayType, number>> = {
  [PlayType.Single]: 0,
  [PlayType.Pair]: 1,
  [PlayType.Triple]: 2,
  [PlayType.TripleWithPair]: 3,
  [PlayType.Straight]: 4,
  [PlayType.Tube]: 5,
  [PlayType.Plate]: 6,
  [PlayType.StraightFlush]: 7,
  [PlayType.Bomb]: 8,
  [PlayType.Rocket]: 9,
  [PlayType.Pass]: 10,
}

/**
 * Returns one deterministic physical move for every legal semantic class.
 * AI may rank these representatives; callers needing every physical choice
 * must use legalMoves instead.
 */
export const representativeLegalMoves = (
  hand: readonly Card[],
  lastPlay: PlayAction | null,
  profile: RuleProfile,
): Card[][] => {
  const semanticCandidates = new Map<string, Card[]>()
  for (const move of enumerateCandidateMoves(hand)) {
    const key = semanticCardsKey(move)
    const existing = semanticCandidates.get(key)
    if (!existing || cardsKey(move).localeCompare(cardsKey(existing)) < 0) {
      semanticCandidates.set(key, move)
    }
  }
  const representatives = new Map<
    string,
    { move: Card[], type: PlayType, maxValue: number }
  >()
  for (const move of semanticCandidates.values()) {
    const info = getPlayInfo(move, profile)
    if (!info || (lastPlay && lastPlay.type !== PlayType.Pass && !canPlay(move, lastPlay, profile))) {
      continue
    }
    const classKey = `${info.type}:${info.maxValue}:${move.length}`
    const existing = representatives.get(classKey)
    if (!existing || cardsKey(move).localeCompare(cardsKey(existing.move)) < 0) {
      representatives.set(classKey, { move, type: info.type, maxValue: info.maxValue })
    }
  }
  return Array.from(representatives.values())
    .sort((left, right) =>
      PLAY_TYPE_ORDER[left.type] - PLAY_TYPE_ORDER[right.type]
      || left.maxValue - right.maxValue
      || left.move.length - right.move.length
      || cardsKey(left.move).localeCompare(cardsKey(right.move)))
    .map(({ move }) => move)
}

export const legalMoves = (
  hand: readonly Card[],
  lastPlay: PlayAction | null,
  profile: RuleProfile,
): Card[][] => {
  const uniqueMoves = new Map<string, { move: Card[]; maxValue: number }>()
  const infoCache = new Map<string, ReturnType<typeof getPlayInfo>>()
  const playableCache = new Map<string, boolean>()
  enumerateCandidateMoves(hand).forEach(move => {
    const semanticKey = semanticCardsKey(move)
    let info = infoCache.get(semanticKey)
    if (info === undefined) {
      info = getPlayInfo(move, profile)
      infoCache.set(semanticKey, info)
    }
    if (!info) return
    if (lastPlay && lastPlay.type !== PlayType.Pass) {
      let playable = playableCache.get(semanticKey)
      if (playable === undefined) {
        playable = canPlay(move, lastPlay, profile)
        playableCache.set(semanticKey, playable)
      }
      if (!playable) return
    }
    uniqueMoves.set(cardsKey(move), { move, maxValue: info.maxValue })
  })
  return Array.from(uniqueMoves.values())
    .sort((left, right) =>
      left.move.length - right.move.length
      || left.maxValue - right.maxValue
      || cardsKey(left.move).localeCompare(cardsKey(right.move)))
    .map(({ move }) => move)
}
