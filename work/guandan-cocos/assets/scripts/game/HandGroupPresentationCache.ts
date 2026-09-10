import { PlayType, resolvePlay, ruleProfileKey, type Card } from '../core/generated'
import type { HandGroupingSnapshot } from './HandGrouping'
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


/** One workspace's bounded display cache, populated on first projection.
 * Selection/clock renders reuse metadata; actual faces and rules key validity.
 */
export class HandGroupPresentationCache {
  private readonly entries = new Map<string, Pick<HandStackGroup, 'zone' | 'badge'>>()
  public clear (): void { this.entries.clear() }
  public project (hand: readonly Card[], grouping: HandGroupingSnapshot): Array<HandGroupingSnapshot['groups'][number] & HandStackGroup> {
    if (grouping.layoutMode !== 'smart-arranged') return grouping.groups
    const cardById = new Map(hand.map(card => [card.id, card]))
    const profile = ruleProfileKey(grouping.ruleProfile)
    return grouping.groups.map(group => {
      const cards = group.cardIds.map(id => cardById.get(id)).filter((card): card is Card => Boolean(card))
      const key = JSON.stringify([profile, cards.map(card =>
        [card.id, card.rank, card.suit, card.value, card.isLevelCard, card.isRedJoker === true])])
      let metadata = this.entries.get(key)
      if (!metadata) {
        const type = resolvePlay(cards, grouping.ruleProfile)?.type
        metadata = { zone: handDisplayZone(type ?? null, grouping.ruleProfile), badge: resolveHandGroupBadge(type, cards.length) }
        this.entries.set(key, metadata)
        if (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!)
      }
      return { ...group, zone: metadata.zone, badge: metadata.badge ? { ...metadata.badge } : undefined }
    })
  }
}
