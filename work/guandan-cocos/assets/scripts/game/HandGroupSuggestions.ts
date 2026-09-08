import type { Card, RuleProfile, Suit } from '../core/generated'
import {
  ALL_SUITS,
  DEFAULT_HAND_SUGGESTIONS,
  KIND_PRIORITY,
  STRAIGHT_FLUSH_SUITS,
  assertUniqueCardIds,
  compareText,
  getPhysicalRankValue,
  isHeartLevelWildcard,
  type CardId,
  type HandGroupKind,
  type HandGroupSuggestion,
  type HandSuggestionOptions,
  type StraightFlushSuit,
  type StraightFlushSuitAvailability,
  type SuggestedWildcardUsage,
} from './HandArrangementModel'

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

/** Mirrors the shared rule maxValue order for competing bomb-family kinds. */
const bombFamilyRuleStrength = (
  suggestion: HandGroupSuggestion,
  ruleProfile: RuleProfile,
): number | null => {
  if (suggestion.kind === 'king-bomb') return Number.MAX_SAFE_INTEGER
  if (suggestion.kind === 'straight-flush') {
    return ruleProfile.straightFlushAsBomb ? 5500 + suggestion.primaryValue : null
  }
  if (suggestion.kind === 'bomb') return suggestion.cardIds.length * 1000 + suggestion.primaryValue
  return null
}

const compareBombFamilySuggestions = (
  left: HandGroupSuggestion,
  right: HandGroupSuggestion,
  ruleProfile: RuleProfile,
): number => {
  const leftStrength = bombFamilyRuleStrength(left, ruleProfile)
  const rightStrength = bombFamilyRuleStrength(right, ruleProfile)
  if (leftStrength === null || rightStrength === null) return 0
  return rightStrength - leftStrength || left.wildcardUsages.length - right.wildcardUsages.length
}

const compareSuggestions = (
  left: HandGroupSuggestion,
  right: HandGroupSuggestion,
  ruleProfile: RuleProfile = DEFAULT_HAND_SUGGESTIONS.ruleProfile,
): number =>
  compareBombFamilySuggestions(left, right, ruleProfile) ||
  right.priority - left.priority ||
  (left.kind === 'triple-with-pair' && right.kind === 'triple-with-pair'
    ? (left.pairValue ?? 0) - (right.pairValue ?? 0) : 0) ||
  compareText(left.key, right.key)

const straightSequences = (allowAceLowStraight: boolean): number[][] => {
  const sequences = consecutiveStarts(5).map(start => [start, start + 1, start + 2, start + 3, start + 4])
  if (allowAceLowStraight) sequences.unshift([14, 2, 3, 4, 5])
  return sequences
}

/** Enumerates one deterministic five-card candidate for every suit/sequence. */
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

/** Produces deterministic alternatives; suggestions may overlap. */
export const suggestHandGroups = (
  hand: readonly Card[],
  rawOptions: Partial<HandSuggestionOptions> = {},
): HandGroupSuggestion[] => {
  assertUniqueCardIds(hand)
  const options: HandSuggestionOptions = {
    allowAceLowStraight: rawOptions.allowAceLowStraight ?? DEFAULT_HAND_SUGGESTIONS.allowAceLowStraight,
    maxSuggestions: Math.max(0, rawOptions.maxSuggestions ?? DEFAULT_HAND_SUGGESTIONS.maxSuggestions),
    ruleProfile: rawOptions.ruleProfile ?? DEFAULT_HAND_SUGGESTIONS.ruleProfile,
  }
  const wildcards = hand.filter(isHeartLevelWildcard)
  const normalCards = hand.filter(card => !isHeartLevelWildcard(card))
  const suggestions = new Map<string, HandGroupSuggestion>()
  const add = (suggestion: HandGroupSuggestion | null): void => {
    if (suggestion && !suggestions.has(suggestion.key)) suggestions.set(suggestion.key, suggestion)
  }

  const jokers = sortCardsDeterministically(hand.filter(card => card.suit === 'joker'))
  if (jokers.length >= 4) {
    add(makeSuggestion('king-bomb', { cardIds: jokers.slice(0, 4).map(card => card.id), wildcardUsages: [] }, 10000))
  }

  const compareValues = Array.from(new Set(normalCards.map(card => card.value))).sort((left, right) => left - right)
  for (const value of compareValues) {
    const matching = sortCardsDeterministically(normalCards.filter(card => card.value === value))
    if (matching.length + wildcards.length < 4) continue
    const maximumUsefulCount = matching.length >= 4 ? matching.length : matching.length + wildcards.length
    for (let count = 4; count <= maximumUsefulCount; count += 1) {
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
      if (allocation) add({ ...makeSuggestion('triple-with-pair', allocation, tripleValue), pairValue })
    }
  }

  return Array.from(suggestions.values())
    .sort((left, right) => compareSuggestions(left, right, options.ruleProfile))
    .slice(0, options.maxSuggestions)
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
  ruleProfile: RuleProfile = DEFAULT_HAND_SUGGESTIONS.ruleProfile,
): HandGroupSuggestion[] => {
  const used = new Set<CardId>()
  const selected: HandGroupSuggestion[] = []
  for (const suggestion of suggestions.slice().sort((left, right) => compareSuggestions(left, right, ruleProfile))) {
    // Auto-arrange preserves valuable pairs. Manual recognition and legal moves stay unrestricted.
    if (suggestion.kind === 'triple-with-pair' && (suggestion.pairValue ?? Infinity) >= 10) continue
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
