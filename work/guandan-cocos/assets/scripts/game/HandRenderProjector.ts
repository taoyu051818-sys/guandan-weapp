import { PlayType, resolvePlay, type Card } from '../core/generated'
import type { HandGroupingSnapshot } from './HandGrouping'
import type { HandInteractionMode } from './HandInteractionState'
import type { HandSortDirection, StraightFlushSuit } from './HandArrangement'
import type { HandLockDecision } from './HandWorkspace'
import { handDisplayZone } from './HandDisplayOrdering'
import type { HandGroupBadge, HandStackGroup } from './HandStackLayout'

export const resolveHandGroupBadge = (type: PlayType | undefined, count: number): HandGroupBadge | undefined => {
  if (type === PlayType.Bomb) {
    const names = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
    return { label: `${names[count] ?? count}炸`, tone: 'purple' }
  }
  if (type === PlayType.StraightFlush) return { label: '同花顺', tone: 'purple' }
  if (type === PlayType.Rocket) return { label: '天王炸', tone: 'purple' }
  const labels: Partial<Record<PlayType, string>> = {
    [PlayType.Triple]: '三张', [PlayType.TripleWithPair]: '三带二',
    [PlayType.Straight]: '顺子', [PlayType.Tube]: '三连对', [PlayType.Plate]: '钢板',
  }
  return type && labels[type] ? { label: labels[type]!, tone: 'cyan' } : undefined
}

const projectGroups = (hand: readonly Card[], grouping: HandGroupingSnapshot): HandRenderModel['groups'] => {
  if (grouping.layoutMode !== 'smart-arranged') return grouping.groups
  const cardById = new Map(hand.map(card => [card.id, card]))
  return grouping.groups.map(group => {
    const cards = group.cardIds.map(id => cardById.get(id)).filter((card): card is Card => Boolean(card))
    const type = resolvePlay(cards, grouping.ruleProfile)?.type
    return { ...group, zone: handDisplayZone(type ?? null, grouping.ruleProfile), badge: resolveHandGroupBadge(type, cards.length) }
  })
}

export type HandRenderModel = Readonly<{
  hand: Card[]
  interactionMode: HandInteractionMode
  playSelectedCardIds: string[]
  sortOrder: HandSortDirection
  interactive: boolean
  displayCardIds: string[]
  groups: Array<HandGroupingSnapshot['groups'][number] & HandStackGroup>
  lockedCardIds: string[]
  availableSuits: StraightFlushSuit[]
  selectedSuit: StraightFlushSuit | null
  lockDecision: HandLockDecision
  arrangeRestoreAvailable: boolean
}>

export const projectHandRenderModel = (input: Readonly<{
  hand: Card[]
  mode: HandInteractionMode
  playSelectedCardIds: readonly string[]
  sortOrder: HandSortDirection
  interactive: boolean
  grouping: HandGroupingSnapshot
  lockedCardIds: readonly string[]
  availableSuits: readonly StraightFlushSuit[]
  selectedSuit: StraightFlushSuit | null
  lockDecision: HandLockDecision
  arrangeRestoreAvailable: boolean
}>): HandRenderModel => ({
  hand: input.hand,
  interactionMode: input.mode,
  playSelectedCardIds: input.mode === 'play' || input.mode === 'tribute' ? [...input.playSelectedCardIds] : [],
  sortOrder: input.sortOrder,
  interactive: input.interactive,
  displayCardIds: input.grouping.displayCardIds,
  groups: projectGroups(input.hand, input.grouping),
  lockedCardIds: [...input.lockedCardIds],
  availableSuits: [...input.availableSuits],
  selectedSuit: input.selectedSuit,
  lockDecision: input.lockDecision,
  arrangeRestoreAvailable: input.arrangeRestoreAvailable,
})
