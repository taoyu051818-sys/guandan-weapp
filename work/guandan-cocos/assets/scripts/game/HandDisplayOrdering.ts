import { PlayType, resolvePlay, type Card, type Rank, type RuleProfile, type Suit, type WildcardUsage } from '../core/generated'
import {
  ALL_SUITS,
  assertUniqueCardIds,
  compareCardsForArrangement,
  compareText,
  distinctStableCardIds,
  getArrangementRankValue,
  getPhysicalRankValue,
  normalizeHandArrangementOptions,
  type CardId,
  type HandArrangementOptions,
  type HandDisplayUnit,
  type HandLayoutMode,
} from './HandArrangementModel'

const playTypeTier = (type: PlayType | null, ruleProfile: RuleProfile): number => {
  if (type === PlayType.Rocket || type === PlayType.Bomb || (type === PlayType.StraightFlush && ruleProfile.straightFlushAsBomb)) return 0
  if (type === PlayType.Plate) return 1
  if (type === PlayType.Tube) return 2
  if (type === PlayType.TripleWithPair) return 3
  if (type === PlayType.Straight || type === PlayType.StraightFlush) return 4
  if (type === PlayType.Single || type === PlayType.Pair || type === PlayType.Triple) return 5
  return 6
}

const unitCardSignature = (cards: readonly Card[]): string => cards
  .map(card => card.id)
  .slice()
  .sort(compareText)
  .join('\u0000')

const ordinaryUnitRank = (
  cards: readonly Card[],
  resolution: ReturnType<typeof resolvePlay>,
  levelRank: Rank | null,
): number => {
  if (cards.length === 1 || cards.every(card => card.rank === cards[0]?.rank)) {
    return cards.length ? getArrangementRankValue(cards[0], levelRank) : 0
  }
  return resolution?.maxValue ?? Math.max(0, ...cards.map(card => getArrangementRankValue(card, levelRank)))
}

const bombStrength = (
  cards: readonly Card[],
  resolution: NonNullable<ReturnType<typeof resolvePlay>>,
  levelRank: Rank | null,
): number => {
  if (resolution.type === PlayType.Rocket) return resolution.maxValue
  if (resolution.type === PlayType.Bomb && cards.length && cards.every(card => card.rank === cards[0]?.rank)) {
    return cards.length * 1000 + getArrangementRankValue(cards[0], levelRank)
  }
  return resolution.maxValue
}

interface ResolvedDisplayUnit {
  unit: HandDisplayUnit
  resolution: ReturnType<typeof resolvePlay>
  cards: Card[]
  tier: number
  strength: number
  multiplicity: number
  arrangementAnchor: Card | null
  signature: string
}

/**
 * Total order for horizontal lanes. Point-stacked mode never inspects a lane's
 * play type; smart-arranged mode promotes structured combinations to the left.
 */
export const sortHandDisplayUnits = (
  hand: readonly Card[],
  units: readonly HandDisplayUnit[],
  ruleProfile: RuleProfile,
  layoutMode: HandLayoutMode,
  rawOptions: Partial<HandArrangementOptions> = {},
): HandDisplayUnit[] => {
  assertUniqueCardIds(hand)
  const options = normalizeHandArrangementOptions(rawOptions)
  const cardById = new Map(hand.map(card => [card.id, card]))
  const resolved: ResolvedDisplayUnit[] = units.map(unit => {
    const cards = unit.cardIds.map(cardId => cardById.get(cardId)).filter((card): card is Card => Boolean(card))
    const resolution = cards.length === unit.cardIds.length ? resolvePlay(cards, ruleProfile) : null
    const semanticMode: HandLayoutMode = unit.locked ? 'smart-arranged' : layoutMode
    const tier = semanticMode === 'smart-arranged' ? playTypeTier(resolution?.type ?? null, ruleProfile) : 5
    const strength = semanticMode === 'point-stacked'
      ? Math.max(0, ...cards.map(card => getArrangementRankValue(card, options.levelRank)))
      : tier === 0 && resolution
      ? bombStrength(cards, resolution, options.levelRank)
      : tier === 5
        ? ordinaryUnitRank(cards, resolution, options.levelRank)
        : resolution?.maxValue ?? Math.max(0, ...cards.map(card => getArrangementRankValue(card, options.levelRank)))
    return {
      unit,
      resolution,
      cards,
      tier,
      strength,
      multiplicity: cards.length,
      arrangementAnchor: cards.slice().sort((left, right) => compareCardsForArrangement(left, right, options))[0] ?? null,
      signature: unitCardSignature(cards),
    }
  })

  resolved.sort((left, right) => {
    if (left.unit.locked !== right.unit.locked) return left.unit.locked ? -1 : 1
    if (!left.unit.locked && layoutMode === 'point-stacked' && left.arrangementAnchor && right.arrangementAnchor) {
      const pointDifference = compareCardsForArrangement(left.arrangementAnchor, right.arrangementAnchor, options)
      if (pointDifference !== 0) return pointDifference
    }
    const tierDifference = left.tier - right.tier
    if (tierDifference !== 0) return tierDifference
    if (left.tier === 5 && options.mode === 'suit' && left.arrangementAnchor && right.arrangementAnchor) {
      const arrangementDifference = compareCardsForArrangement(left.arrangementAnchor, right.arrangementAnchor, options)
      if (arrangementDifference !== 0) return arrangementDifference
    }
    const direction = !left.unit.locked && left.tier === 5 && options.direction === 'asc' ? 1 : -1
    const strengthDifference = direction * (left.strength - right.strength)
    if (strengthDifference !== 0) return strengthDifference
    if (left.tier === 5 && left.multiplicity !== right.multiplicity) return right.multiplicity - left.multiplicity
    const signatureDifference = compareText(left.signature, right.signature)
    return signatureDifference || compareText(left.unit.key, right.unit.key)
  })
  return resolved.map(item => ({ ...item.unit, cardIds: item.unit.cardIds.slice() }))
}

const wildcardUsageByCardId = (usages: readonly WildcardUsage[] | undefined): ReadonlyMap<CardId, WildcardUsage> =>
  new Map((usages ?? []).map(usage => [usage.cardId, usage]))

/** Canonicalises cards inside a downward stack without mutating the rule hand. */
export const arrangeHandGroupCardIds = (
  hand: readonly Card[],
  cardIds: readonly CardId[],
  ruleProfile: RuleProfile,
  rawOptions: Partial<HandArrangementOptions> = {},
): CardId[] => {
  assertUniqueCardIds(hand)
  const options = normalizeHandArrangementOptions(rawOptions)
  const requested = new Set(cardIds)
  const cards = hand.filter(card => requested.has(card.id))
  if (cards.length !== requested.size || requested.size !== cardIds.length) return distinctStableCardIds(cardIds)
  const resolution = resolvePlay(cards, ruleProfile)
  const usageById = wildcardUsageByCardId(resolution?.wildcardUsages)
  const suitIndex = new Map(options.suitOrder.map((suit, index) => [suit, index]))
  const semanticValue = (card: Card): number => usageById.get(card.id)?.representedValue ??
    getArrangementRankValue(card, options.levelRank)
  const semanticSuit = (card: Card): Suit => usageById.get(card.id)?.representedSuit ?? card.suit
  const suitDifference = (left: Card, right: Card): number =>
    (suitIndex.get(semanticSuit(left)) ?? ALL_SUITS.length) - (suitIndex.get(semanticSuit(right)) ?? ALL_SUITS.length)
  const deterministicTie = (left: Card, right: Card): number => suitDifference(left, right) || compareText(left.id, right.id)

  return cards.slice().sort((left, right) => {
    const type = resolution?.type
    if (type === PlayType.Straight || type === PlayType.StraightFlush || type === PlayType.Plate || type === PlayType.Tube) {
      const aceLow = resolution?.maxValue === 5
      const leftValue = aceLow && semanticValue(left) === 14 ? 1 : semanticValue(left)
      const rightValue = aceLow && semanticValue(right) === 14 ? 1 : semanticValue(right)
      return leftValue - rightValue || deterministicTie(left, right)
    }
    if (resolution?.type === PlayType.TripleWithPair) {
      const leftTriple = semanticValue(left) === resolution.maxValue ? 1 : 0
      const rightTriple = semanticValue(right) === resolution.maxValue ? 1 : 0
      return leftTriple - rightTriple || semanticValue(left) - semanticValue(right) || deterministicTie(left, right)
    }
    if (type === PlayType.Rocket) {
      return getPhysicalRankValue(left) - getPhysicalRankValue(right) || deterministicTie(left, right)
    }
    if (type === PlayType.Bomb) {
      const wildcardDifference = Number(usageById.has(left.id)) - Number(usageById.has(right.id))
      return wildcardDifference || deterministicTie(left, right)
    }
    return deterministicTie(left, right)
  }).map(card => card.id)
}
