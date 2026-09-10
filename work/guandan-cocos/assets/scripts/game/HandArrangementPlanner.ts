import { planHandArrangement, PlayType, type Card, type RuleProfile } from '../core/generated'
import type { HandGroupKind, HandGroupSuggestion } from './HandArrangementModel'

/** Pure adapter: whole-hand strategy owns membership, the scene owns positions.
 * Singles stay loose; pairs/triples are real groups, but pair badges stay hidden.
 */
export const arrangementKind = (type: PlayType): HandGroupKind | null => ({
  [PlayType.Single]: null, [PlayType.Pass]: null,
  [PlayType.Pair]: 'pair', [PlayType.Triple]: 'triple',
  [PlayType.Straight]: 'straight', [PlayType.StraightFlush]: 'straight-flush',
  [PlayType.Bomb]: 'bomb', [PlayType.Rocket]: 'king-bomb',
  [PlayType.TripleWithPair]: 'triple-with-pair', [PlayType.Plate]: 'plate', [PlayType.Tube]: 'tube',
} as const)[type]

export const planHandGroups = (hand: readonly Card[], profile: RuleProfile): HandGroupSuggestion[] =>
  planHandArrangement(hand, profile).groups.flatMap(({ cards, resolution }) => {
    const kind = arrangementKind(resolution.type)
    if (!kind) return []
    const cardIds = cards.map(card => card.id)
    return [{ kind, cardIds, key: `${kind}:${cardIds.slice().sort().join(',')}`,
      primaryValue: resolution.maxValue, priority: 0,
      wildcardUsages: resolution.wildcardUsages?.map(usage => ({ ...usage })) ?? [] }]
  })
