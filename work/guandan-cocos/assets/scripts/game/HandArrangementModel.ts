import { getRuleProfile, PlayType, type Card, type Rank, type RuleProfile, type Suit } from '../core/generated'

export type CardId = string
export type HandSortMode = 'rank' | 'suit'
export type HandSortDirection = 'asc' | 'desc'
export type LevelCardPlacement = 'front' | 'natural' | 'back'
export type HandLayoutMode = 'point-stacked' | 'smart-arranged'

export interface HandArrangementOptions {
  mode: HandSortMode
  direction: HandSortDirection
  levelCards: LevelCardPlacement
  levelRank: Rank | null
  suitOrder: readonly Suit[]
}

export type HandGroupKind = 'king-bomb' | 'bomb' | 'straight-flush' | 'plate' | 'tube' | 'triple-with-pair' | 'straight' | 'pair' | 'triple'
/** Classification also supports manually locked straights, pairs and triples. */
export const arrangementKind = (type: PlayType): HandGroupKind | null => ({
  [PlayType.Single]: null, [PlayType.Pass]: null,
  [PlayType.Pair]: 'pair', [PlayType.Triple]: 'triple',
  [PlayType.Straight]: 'straight', [PlayType.StraightFlush]: 'straight-flush',
  [PlayType.Bomb]: 'bomb', [PlayType.Rocket]: 'king-bomb',
  [PlayType.TripleWithPair]: 'triple-with-pair', [PlayType.Plate]: 'plate', [PlayType.Tube]: 'tube',
} as const)[type]
export type HandGroupOrigin = 'rank' | 'auto' | 'manual'

/** One horizontal hand lane. Groups and loose cards deliberately share one sequence. */
export interface HandDisplayUnit {
  key: string
  groupId: string | null
  origin: HandGroupOrigin | 'single'
  locked: boolean
  cardIds: readonly CardId[]
}

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
  /** Attachment strength, only for triple-with-pair; lower pairs are spent first. */
  pairValue?: number
  priority: number
}

export interface HandSuggestionOptions {
  allowAceLowStraight: boolean
  maxSuggestions: number
  ruleProfile: RuleProfile
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

export const ALL_SUITS: readonly Suit[] = ['spade', 'heart', 'club', 'diamond', 'joker']
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
  ruleProfile: getRuleProfile('classic'),
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

export const KIND_PRIORITY: Readonly<Record<HandGroupKind, number>> = {
  'king-bomb': 600,
  bomb: 500,
  'straight-flush': 400,
  plate: 300,
  tube: 200,
  'triple-with-pair': 100,
  straight: 90,
  triple: 50,
  pair: 20,
}

export const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

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

export const getArrangementRankValue = (card: Card, levelRank: Rank | null): number =>
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
  const rankDifference = getArrangementRankValue(left, options.levelRank) - getArrangementRankValue(right, options.levelRank)
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

export const distinctStableCardIds = (cardIds: readonly CardId[]): CardId[] => {
  const seen = new Set<CardId>()
  const result: CardId[] = []
  for (const cardId of cardIds) {
    if (seen.has(cardId)) continue
    seen.add(cardId)
    result.push(cardId)
  }
  return result
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
