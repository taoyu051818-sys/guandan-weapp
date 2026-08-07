import type { Card, Rank, Suit } from '../core/generated'

export type CardId = string
export type HandSortMode = 'rank' | 'suit'
export type HandSortDirection = 'asc' | 'desc'
export type LevelCardPlacement = 'front' | 'natural' | 'back'

export interface HandArrangementOptions {
  mode: HandSortMode
  direction: HandSortDirection
  levelCards: LevelCardPlacement
  levelRank: Rank | null
  suitOrder: readonly Suit[]
}

export type HandGroupKind = 'king-bomb' | 'bomb' | 'straight-flush' | 'plate' | 'tube' | 'triple-with-pair'

export interface SuggestedWildcardUsage {
  cardId: CardId
  representedValue: number
  representedSuit?: Suit
}

export interface HandGroupSuggestion {
  key: string
  kind: HandGroupKind
  cardIds: CardId[]
  wildcardUsages: SuggestedWildcardUsage[]
  primaryValue: number
  priority: number
}

export interface HandSuggestionOptions {
  allowAceLowStraight: boolean
  maxSuggestions: number
}

export type StraightFlushSuit = Exclude<Suit, 'joker'>

export interface StraightFlushSuitAvailability {
  suit: StraightFlushSuit
  available: boolean
  candidateCount: number
  /** The deterministic candidate selected when the suit control is pressed. */
  cardIds: CardId[]
  wildcardUsages: SuggestedWildcardUsage[]
}

const ALL_SUITS: readonly Suit[] = ['spade', 'heart', 'club', 'diamond', 'joker']
export const STRAIGHT_FLUSH_SUITS: readonly StraightFlushSuit[] = ['spade', 'heart', 'club', 'diamond']

export const DEFAULT_HAND_ARRANGEMENT: HandArrangementOptions = {
  mode: 'rank',
  direction: 'desc',
  levelCards: 'natural',
  levelRank: null,
  suitOrder: ALL_SUITS,
}

export const DEFAULT_HAND_SUGGESTIONS: HandSuggestionOptions = {
  allowAceLowStraight: true,
  maxSuggestions: 96,
}

const RANK_VALUE: Readonly<Record<string, number>> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  Small: 16,
  Big: 17,
}

const KIND_PRIORITY: Readonly<Record<HandGroupKind, number>> = {
  'king-bomb': 600,
  bomb: 500,
  'straight-flush': 400,
  plate: 300,
  tube: 200,
  'triple-with-pair': 100,
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const uniqueSuitOrder = (requested: readonly Suit[]): Suit[] => {
  const result: Suit[] = []
  for (const suit of requested.concat(ALL_SUITS)) {
    if (!result.includes(suit)) result.push(suit)
  }
  return result
}

export const normalizeHandArrangementOptions = (
  options: Partial<HandArrangementOptions> = {},
): HandArrangementOptions => ({
  mode: options.mode ?? DEFAULT_HAND_ARRANGEMENT.mode,
  direction: options.direction ?? DEFAULT_HAND_ARRANGEMENT.direction,
  levelCards: options.levelCards ?? DEFAULT_HAND_ARRANGEMENT.levelCards,
  levelRank: options.levelRank ?? DEFAULT_HAND_ARRANGEMENT.levelRank,
  suitOrder: uniqueSuitOrder(options.suitOrder ?? DEFAULT_HAND_ARRANGEMENT.suitOrder),
})

export const getPhysicalRankValue = (card: Pick<Card, 'rank'>): number => RANK_VALUE[String(card.rank)] ?? 0

/**
 * `isRedJoker` is the legacy engine field name for the Guandan heart-level
 * wildcard. Check its physical identity as well so a malformed red-joker card
 * can never be consumed as the wildcard.
 */
export const isHeartLevelWildcard = (
  card: Pick<Card, 'suit' | 'isLevelCard' | 'isRedJoker'>,
): boolean => card.suit === 'heart' && card.isLevelCard && card.isRedJoker === true

const isArrangementLevelCard = (card: Card, levelRank: Rank | null): boolean =>
  levelRank === null ? card.isLevelCard : card.suit !== 'joker' && card.rank === levelRank

const levelBucket = (card: Card, placement: LevelCardPlacement, levelRank: Rank | null): number => {
  if (placement === 'natural') return 0
  if (placement === 'front') return isArrangementLevelCard(card, levelRank) ? 0 : 1
  return isArrangementLevelCard(card, levelRank) ? 1 : 0
}

const getArrangementRankValue = (card: Card, levelRank: Rank | null): number =>
  isArrangementLevelCard(card, levelRank) ? 15 : getPhysicalRankValue(card)

export const compareCardsForArrangement = (
  left: Card,
  right: Card,
  rawOptions: Partial<HandArrangementOptions> = {},
): number => {
  const options = normalizeHandArrangementOptions(rawOptions)
  const levelDifference = levelBucket(left, options.levelCards, options.levelRank) -
    levelBucket(right, options.levelCards, options.levelRank)
  if (levelDifference !== 0) return levelDifference

  const suitOrder = new Map<Suit, number>(options.suitOrder.map((suit, index) => [suit, index]))
  const suitDifference = (suitOrder.get(left.suit) ?? ALL_SUITS.length) - (suitOrder.get(right.suit) ?? ALL_SUITS.length)
  const rankDifference = getArrangementRankValue(left, options.levelRank) -
    getArrangementRankValue(right, options.levelRank)
  const directedRankDifference = options.direction === 'asc' ? rankDifference : -rankDifference

  if (options.mode === 'suit') {
    if (suitDifference !== 0) return suitDifference
    if (directedRankDifference !== 0) return directedRankDifference
  } else {
    if (directedRankDifference !== 0) return directedRankDifference
    if (suitDifference !== 0) return suitDifference
  }

  return compareText(left.id, right.id)
}

export const assertUniqueCardIds = (hand: readonly Card[]): void => {
  const ids = new Set<CardId>()
  for (const card of hand) {
    if (!card.id) throw new Error('Every hand card must have a non-empty cardId')
    if (ids.has(card.id)) throw new Error(`Duplicate cardId in hand: ${card.id}`)
    ids.add(card.id)
  }
}

/** Returns a presentation order only. It never reorders or mutates the rule-layer hand. */
export const arrangeHandCardIds = (
  hand: readonly Card[],
  options: Partial<HandArrangementOptions> = {},
): CardId[] => {
  assertUniqueCardIds(hand)
  return hand.slice().sort((left, right) => compareCardsForArrangement(left, right, options)).map(card => card.id)
}

/** Drops stale/duplicate ids and appends any newly dealt cards in the configured fallback order. */
export const reconcileCardIdOrder = (
  hand: readonly Card[],
  requestedOrder: readonly CardId[],
  options: Partial<HandArrangementOptions> = {},
): CardId[] => {
  assertUniqueCardIds(hand)
  const valid = new Set(hand.map(card => card.id))
  const seen = new Set<CardId>()
  const result: CardId[] = []
  for (const cardId of requestedOrder) {
    if (valid.has(cardId) && !seen.has(cardId)) {
      seen.add(cardId)
      result.push(cardId)
    }
  }
  for (const cardId of arrangeHandCardIds(hand, options)) {
    if (!seen.has(cardId)) {
      seen.add(cardId)
      result.push(cardId)
    }
  }
  return result
}

const sortCardsDeterministically = (cards: readonly Card[]): Card[] => cards.slice().sort((left, right) => {
  const rank = getPhysicalRankValue(left) - getPhysicalRankValue(right)
  if (rank !== 0) return rank
  const suit = ALL_SUITS.indexOf(left.suit) - ALL_SUITS.indexOf(right.suit)
  return suit !== 0 ? suit : compareText(left.id, right.id)
})

interface PatternSlot {
  value: number
  count: number
  suit?: Suit
}

interface AllocatedPattern {
  cardIds: CardId[]
  wildcardUsages: SuggestedWildcardUsage[]
}

const allocatePattern = (
  cards: readonly Card[],
  wildcards: readonly Card[],
  slots: readonly PatternSlot[],
  valueOf: (card: Card) => number,
  allowPlainLevelCards: boolean,
): AllocatedPattern | null => {
  const available = sortCardsDeterministically(cards).filter(card => allowPlainLevelCards || !card.isLevelCard)
  const remainingWildcards = sortCardsDeterministically(wildcards)
  const used = new Set<CardId>()
  const cardIds: CardId[] = []
  const wildcardUsages: SuggestedWildcardUsage[] = []

  for (const slot of slots) {
    const natural = available
      .filter(card => !used.has(card.id) && valueOf(card) === slot.value && (slot.suit === undefined || card.suit === slot.suit))
      .slice(0, slot.count)
    for (const card of natural) {
      used.add(card.id)
      cardIds.push(card.id)
    }
    const missing = slot.count - natural.length
    // The current Guandan rule model allows a red-heart level wildcard to
    // represent ordinary/level values (2...15), never a small/big joker.
    if (missing > 0 && slot.value > 15) return null
    if (missing > remainingWildcards.length) return null
    for (let index = 0; index < missing; index += 1) {
      const wildcard = remainingWildcards.shift()
      if (!wildcard) return null
      cardIds.push(wildcard.id)
      wildcardUsages.push({
        cardId: wildcard.id,
        representedValue: slot.value,
        ...(slot.suit === undefined ? {} : { representedSuit: slot.suit }),
      })
    }
  }

  return { cardIds, wildcardUsages }
}

const suggestionKey = (kind: HandGroupKind, cardIds: readonly CardId[]): string =>
  `${kind}:${cardIds.slice().sort(compareText).join(',')}`

const makeSuggestion = (
  kind: HandGroupKind,
  allocation: AllocatedPattern,
  primaryValue: number,
): HandGroupSuggestion => ({
  key: suggestionKey(kind, allocation.cardIds),
  kind,
  cardIds: allocation.cardIds,
  wildcardUsages: allocation.wildcardUsages,
  primaryValue,
  // Prefer a natural group over spending a wildcard merely to make an already
  // complete group longer. A wildcard remains valuable when it is required.
  priority: KIND_PRIORITY[kind] + allocation.cardIds.length * 10 + primaryValue - allocation.wildcardUsages.length * 25,
})

const consecutiveStarts = (length: number): number[] => {
  const result: number[] = []
  for (let start = 2; start + length - 1 <= 14; start += 1) result.push(start)
  return result
}

const compareSuggestions = (left: HandGroupSuggestion, right: HandGroupSuggestion): number =>
  right.priority - left.priority || compareText(left.key, right.key)

const straightSequences = (allowAceLowStraight: boolean): number[][] => {
  const sequences = consecutiveStarts(5).map(start => [start, start + 1, start + 2, start + 3, start + 4])
  if (allowAceLowStraight) sequences.unshift([14, 2, 3, 4, 5])
  return sequences
}

/**
 * Enumerates the one useful deterministic five-card candidate for every
 * suit/sequence. The returned order is stable: strongest/natural candidates
 * first, then a card-id tie-breaker.
 */
export const suggestStraightFlushGroups = (
  hand: readonly Card[],
  rawOptions: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
): HandGroupSuggestion[] => {
  assertUniqueCardIds(hand)
  const allowAceLowStraight = rawOptions.allowAceLowStraight ?? DEFAULT_HAND_SUGGESTIONS.allowAceLowStraight
  const wildcards = hand.filter(isHeartLevelWildcard)
  const normalCards = hand.filter(card => !isHeartLevelWildcard(card))
  const suggestions = new Map<string, HandGroupSuggestion>()

  for (const suit of STRAIGHT_FLUSH_SUITS) {
    for (const sequence of straightSequences(allowAceLowStraight)) {
      const allocation = allocatePattern(
        normalCards,
        wildcards,
        sequence.map(value => ({ value, count: 1, suit })),
        getPhysicalRankValue,
        false,
      )
      if (!allocation) continue
      const suggestion = makeSuggestion('straight-flush', allocation, sequence[sequence.length - 1])
      if (!suggestions.has(suggestion.key)) suggestions.set(suggestion.key, suggestion)
    }
  }

  return Array.from(suggestions.values()).sort(compareSuggestions)
}

const straightFlushMatchesSuit = (
  suggestion: HandGroupSuggestion,
  cardsById: ReadonlyMap<CardId, Card>,
  suit: StraightFlushSuit,
): boolean => suggestion.cardIds.every(cardId => {
  const card = cardsById.get(cardId)
  if (!card) return false
  if (isHeartLevelWildcard(card)) {
    return suggestion.wildcardUsages.some(usage => usage.cardId === cardId && usage.representedSuit === suit)
  }
  return card.suit === suit
})

/** Returns the exact five-card selection used by one suit control. */
export const selectStraightFlushForSuit = (
  hand: readonly Card[],
  suit: StraightFlushSuit,
  options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
): HandGroupSuggestion | null => {
  const cardsById = new Map<CardId, Card>(hand.map(card => [card.id, card]))
  return suggestStraightFlushGroups(hand, options)
    .find(suggestion => straightFlushMatchesSuit(suggestion, cardsById, suit)) ?? null
}

/** One compact four-suit model for the HUD; `available` drives its lit state. */
export const getStraightFlushSuitAvailability = (
  hand: readonly Card[],
  options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
): StraightFlushSuitAvailability[] => {
  const cardsById = new Map<CardId, Card>(hand.map(card => [card.id, card]))
  const suggestions = suggestStraightFlushGroups(hand, options)
  return STRAIGHT_FLUSH_SUITS.map(suit => {
    const candidates = suggestions.filter(suggestion => straightFlushMatchesSuit(suggestion, cardsById, suit))
    const selected = candidates[0]
    return {
      suit,
      available: Boolean(selected),
      candidateCount: candidates.length,
      cardIds: selected?.cardIds.slice() ?? [],
      wildcardUsages: selected?.wildcardUsages.map(usage => ({ ...usage })) ?? [],
    }
  })
}

/**
 * Produces deterministic alternative groups. Suggestions may overlap; call
 * selectNonOverlappingSuggestions when a single automatic layout is needed.
 */
export const suggestHandGroups = (
  hand: readonly Card[],
  rawOptions: Partial<HandSuggestionOptions> = {},
): HandGroupSuggestion[] => {
  assertUniqueCardIds(hand)
  const options: HandSuggestionOptions = {
    allowAceLowStraight: rawOptions.allowAceLowStraight ?? DEFAULT_HAND_SUGGESTIONS.allowAceLowStraight,
    maxSuggestions: Math.max(0, rawOptions.maxSuggestions ?? DEFAULT_HAND_SUGGESTIONS.maxSuggestions),
  }
  const wildcards = hand.filter(isHeartLevelWildcard)
  const normalCards = hand.filter(card => !isHeartLevelWildcard(card))
  const suggestions = new Map<string, HandGroupSuggestion>()
  const add = (suggestion: HandGroupSuggestion | null): void => {
    if (suggestion && !suggestions.has(suggestion.key)) suggestions.set(suggestion.key, suggestion)
  }

  const jokers = sortCardsDeterministically(hand.filter(card => card.suit === 'joker'))
  if (jokers.length >= 4) {
    const allocation = { cardIds: jokers.slice(0, 4).map(card => card.id), wildcardUsages: [] }
    add(makeSuggestion('king-bomb', allocation, 10000))
  }

  const compareValues = Array.from(new Set(normalCards.map(card => card.value))).sort((left, right) => left - right)
  for (const value of compareValues) {
    const matching = sortCardsDeterministically(normalCards.filter(card => card.value === value))
    if (matching.length + wildcards.length < 4) continue
    for (let count = 4; count <= matching.length + wildcards.length; count += 1) {
      const allocation = allocatePattern(normalCards, wildcards, [{ value, count }], card => card.value, true)
      if (allocation) add(makeSuggestion('bomb', allocation, value))
    }
  }

  suggestStraightFlushGroups(hand, options).forEach(add)

  for (const start of consecutiveStarts(2)) {
    const allocation = allocatePattern(
      normalCards,
      wildcards,
      [{ value: start, count: 3 }, { value: start + 1, count: 3 }],
      getPhysicalRankValue,
      false,
    )
    if (allocation) add(makeSuggestion('plate', allocation, start + 1))
  }

  for (const start of consecutiveStarts(3)) {
    const allocation = allocatePattern(
      normalCards,
      wildcards,
      [{ value: start, count: 2 }, { value: start + 1, count: 2 }, { value: start + 2, count: 2 }],
      getPhysicalRankValue,
      false,
    )
    if (allocation) add(makeSuggestion('tube', allocation, start + 2))
  }

  for (const tripleValue of compareValues) {
    for (const pairValue of compareValues) {
      if (tripleValue === pairValue) continue
      const allocation = allocatePattern(
        normalCards,
        wildcards,
        [{ value: tripleValue, count: 3 }, { value: pairValue, count: 2 }],
        card => card.value,
        true,
      )
      if (allocation) add(makeSuggestion('triple-with-pair', allocation, tripleValue))
    }
  }

  return Array.from(suggestions.values()).sort(compareSuggestions).slice(0, options.maxSuggestions)
}

const sameCardSet = (left: readonly CardId[], right: readonly CardId[]): boolean => {
  if (left.length !== right.length) return false
  const expected = new Set(left)
  return right.every(cardId => expected.has(cardId))
}

export const recognizeHandGroup = (
  hand: readonly Card[],
  cardIds: readonly CardId[],
  options: Partial<HandSuggestionOptions> = {},
): HandGroupSuggestion | null => {
  const requested = new Set(cardIds)
  if (requested.size !== cardIds.length) return null
  const groupHand = hand.filter(card => requested.has(card.id))
  if (groupHand.length !== cardIds.length) return null
  return suggestHandGroups(groupHand, options).find(suggestion => sameCardSet(suggestion.cardIds, cardIds)) ?? null
}

/** Greedy, deterministic conflict resolution for an automatic one-card-one-group layout. */
export const selectNonOverlappingSuggestions = (
  suggestions: readonly HandGroupSuggestion[],
): HandGroupSuggestion[] => {
  const used = new Set<CardId>()
  const selected: HandGroupSuggestion[] = []
  for (const suggestion of suggestions.slice().sort(compareSuggestions)) {
    if (suggestion.cardIds.some(cardId => used.has(cardId))) continue
    selected.push({
      ...suggestion,
      cardIds: suggestion.cardIds.slice(),
      wildcardUsages: suggestion.wildcardUsages.map(usage => ({ ...usage })),
    })
    suggestion.cardIds.forEach(cardId => used.add(cardId))
  }
  return selected
}
