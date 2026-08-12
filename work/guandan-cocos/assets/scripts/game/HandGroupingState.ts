import { diagnosePlay, getRuleProfile, type Card, type RuleProfile } from '../core/generated'
import {
  arrangeHandGroupCardIds,
  normalizeHandArrangementOptions,
  recognizeHandGroup,
  reconcileCardIdOrder,
  sortHandDisplayUnits,
  type CardId,
  type HandArrangementOptions,
  type HandDisplayUnit,
  type HandGroupKind,
  type HandGroupOrigin,
  type HandLayoutMode,
} from './HandArrangement'

export type HandGroupId = string
export type HandGroupClassification = HandGroupKind | 'manual' | 'rank-stack'

export interface HandGroup {
  id: HandGroupId
  kind: HandGroupClassification
  origin: HandGroupOrigin
  locked: boolean
  cardIds: CardId[]
}

export interface HandGroupingState {
  groups: HandGroup[]
  ungroupedCardIds: CardId[]
  unitOrder: string[]
  layoutMode: HandLayoutMode
  arrangement: HandArrangementOptions
  ruleProfile: RuleProfile
  nextGroupSequence: number
}

export const cloneArrangement = (options: HandArrangementOptions): HandArrangementOptions => ({
  ...options,
  suitOrder: options.suitOrder.slice(),
})

export const cloneGroup = (group: HandGroup): HandGroup => ({
  ...group,
  cardIds: group.cardIds.slice(),
})

export const cloneRuleProfile = (profile: RuleProfile): RuleProfile => ({ ...profile })

export const cloneHandGroupingState = (state: HandGroupingState): HandGroupingState => ({
  groups: state.groups.map(cloneGroup),
  ungroupedCardIds: state.ungroupedCardIds.slice(),
  unitOrder: state.unitOrder.slice(),
  layoutMode: state.layoutMode,
  arrangement: cloneArrangement(state.arrangement),
  ruleProfile: cloneRuleProfile(state.ruleProfile),
  nextGroupSequence: state.nextGroupSequence,
})

const equalArrays = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

export const equalHandGroupingState = (
  left: HandGroupingState,
  right: HandGroupingState,
): boolean => {
  if (left.nextGroupSequence !== right.nextGroupSequence || left.layoutMode !== right.layoutMode) return false
  if (left.ruleProfile.allowA2345Straight !== right.ruleProfile.allowA2345Straight ||
      left.ruleProfile.straightFlushAsBomb !== right.ruleProfile.straightFlushAsBomb ||
      left.ruleProfile.enableTripleWithPair !== right.ruleProfile.enableTripleWithPair) return false
  if (left.arrangement.mode !== right.arrangement.mode ||
      left.arrangement.direction !== right.arrangement.direction ||
      left.arrangement.levelCards !== right.arrangement.levelCards ||
      left.arrangement.levelRank !== right.arrangement.levelRank ||
      !equalArrays(left.arrangement.suitOrder, right.arrangement.suitOrder)) return false
  if (!equalArrays(left.ungroupedCardIds, right.ungroupedCardIds) ||
      !equalArrays(left.unitOrder, right.unitOrder) ||
      left.groups.length !== right.groups.length) return false
  return left.groups.every((group, index) => {
    const other = right.groups[index]
    return group.id === other.id && group.kind === other.kind && group.origin === other.origin &&
      group.locked === other.locked && equalArrays(group.cardIds, other.cardIds)
  })
}

export const distinctCardIds = (cardIds: readonly CardId[]): CardId[] => {
  const result: CardId[] = []
  const seen = new Set<CardId>()
  for (const cardId of cardIds) {
    if (seen.has(cardId)) continue
    seen.add(cardId)
    result.push(cardId)
  }
  return result
}

export const insertBefore = (items: readonly string[], item: string, beforeItem?: string): string[] => {
  if (beforeItem === item) return items.slice()
  const result = items.filter(value => value !== item)
  if (beforeItem === undefined) {
    result.push(item)
    return result
  }
  const index = result.indexOf(beforeItem)
  if (index < 0) throw new Error(`Target item is not in the requested lane: ${beforeItem}`)
  result.splice(index, 0, item)
  return result
}

export const groupUnitKey = (groupId: HandGroupId): string => `group:${groupId}`
export const cardUnitKey = (cardId: CardId): string => `card:${cardId}`
export const isLockedGroup = (group: Pick<HandGroup, 'locked'>): boolean => group.locked

export const displayUnitsForState = (state: HandGroupingState): HandDisplayUnit[] => {
  const unitByKey = new Map<string, HandDisplayUnit>()
  for (const group of state.groups) {
    const key = groupUnitKey(group.id)
    unitByKey.set(key, {
      key,
      groupId: group.id,
      origin: group.origin,
      locked: group.locked,
      cardIds: group.cardIds.slice(),
    })
  }
  for (const cardId of state.ungroupedCardIds) {
    const key = cardUnitKey(cardId)
    unitByKey.set(key, {
      key,
      groupId: null,
      origin: 'single',
      locked: false,
      cardIds: [cardId],
    })
  }
  const seen = new Set<string>()
  const orderedKeys = state.unitOrder.concat(Array.from(unitByKey.keys()))
    .filter(key => unitByKey.has(key) && !seen.has(key) && Boolean(seen.add(key)))
  return orderedKeys.map(key => {
    const unit = unitByKey.get(key)!
    return { ...unit, cardIds: unit.cardIds.slice() }
  })
}

export const sortHandGroupingDisplayState = (
  cards: readonly Card[],
  state: HandGroupingState,
): void => {
  state.groups.forEach(group => {
    group.cardIds = arrangeHandGroupCardIds(
      cards,
      group.cardIds,
      state.ruleProfile,
      state.arrangement,
    )
  })
  const units = sortHandDisplayUnits(
    cards,
    displayUnitsForState(state),
    state.ruleProfile,
    state.layoutMode,
    state.arrangement,
  )
  state.unitOrder = units.map(unit => unit.key)
  const groupPosition = new Map(units.flatMap((unit, index) =>
    unit.groupId ? [[unit.groupId, index] as const] : []))
  state.groups.sort((left, right) =>
    (groupPosition.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (groupPosition.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  state.ungroupedCardIds = units.filter(unit => unit.groupId === null).flatMap(unit => unit.cardIds)
}

const classifyGroup = (
  cards: readonly Card[],
  cardIds: readonly CardId[],
  requestedKind?: HandGroupClassification,
): HandGroupClassification => {
  if (requestedKind === 'rank-stack') {
    const requested = new Set(cardIds)
    const ranks = new Set(cards.filter(card => requested.has(card.id)).map(card => String(card.rank)))
    if (ranks.size === 1) return 'rank-stack'
  }
  return recognizeHandGroup(cards, cardIds)?.kind ?? 'manual'
}

export const normalizeHandGroupingState = (
  cards: readonly Card[],
  handCardIds: readonly CardId[],
  rawState: HandGroupingState,
  authoritativeFallback: readonly CardId[] = [],
  releaseInvalidManualLocks = false,
): HandGroupingState => {
  const valid = new Set(handCardIds)
  const claimed = new Set<CardId>()
  const groupIds = new Set<HandGroupId>()
  const groups: HandGroup[] = []
  const releasedByGroupKey = new Map<string, CardId[]>()
  const ruleProfile = cloneRuleProfile(rawState.ruleProfile ?? getRuleProfile('classic'))

  for (const rawGroup of rawState.groups) {
    if (groupIds.has(rawGroup.id)) continue
    const originalIds = distinctCardIds(rawGroup.cardIds)
    const cardIds = originalIds.filter(cardId => valid.has(cardId) && !claimed.has(cardId))
    const origin: HandGroupOrigin = rawGroup.origin ?? (rawGroup.kind === 'rank-stack' ? 'rank' : 'manual')
    const locked = rawGroup.locked ?? origin === 'manual'
    const requestedSet = new Set(cardIds)
    const groupCards = cards.filter(card => requestedSet.has(card.id))
    const membershipChanged = cardIds.length !== originalIds.length
    const invalidManualLock = releaseInvalidManualLocks && origin === 'manual' && locked &&
      (membershipChanged || !diagnosePlay(groupCards, null, ruleProfile).canPlay)
    const invalidRankStack = origin === 'rank' &&
      new Set(groupCards.map(card => String(card.rank))).size !== 1
    const invalidAutoGroup = origin === 'auto' &&
      !diagnosePlay(groupCards, null, ruleProfile).canPlay
    if (cardIds.length < 2 || invalidManualLock || invalidRankStack || invalidAutoGroup) {
      releasedByGroupKey.set(groupUnitKey(rawGroup.id), cardIds)
      continue
    }
    groupIds.add(rawGroup.id)
    cardIds.forEach(cardId => claimed.add(cardId))
    groups.push({
      id: rawGroup.id,
      kind: classifyGroup(cards, cardIds, rawGroup.kind),
      origin,
      locked,
      cardIds,
    })
  }

  const requestedUngrouped = distinctCardIds(rawState.ungroupedCardIds)
    .filter(cardId => valid.has(cardId) && !claimed.has(cardId))
  requestedUngrouped.forEach(cardId => claimed.add(cardId))
  const fallback = reconcileCardIdOrder(
    cards,
    requestedUngrouped.concat(authoritativeFallback),
    rawState.arrangement,
  ).filter(cardId => !groups.some(group => group.cardIds.includes(cardId)))

  const validUnitKeys = new Set(groups.map(group => groupUnitKey(group.id)).concat(fallback.map(cardUnitKey)))
  const unitOrder: string[] = []
  const seenUnitKeys = new Set<string>()
  const appendUnitKey = (key: string): void => {
    if (!validUnitKeys.has(key) || seenUnitKeys.has(key)) return
    seenUnitKeys.add(key)
    unitOrder.push(key)
  }
  for (const key of rawState.unitOrder ?? []) {
    const released = releasedByGroupKey.get(key)
    if (released) released.forEach(cardId => appendUnitKey(cardUnitKey(cardId)))
    else appendUnitKey(key)
  }
  groups.forEach(group => appendUnitKey(groupUnitKey(group.id)))
  fallback.forEach(cardId => appendUnitKey(cardUnitKey(cardId)))

  return {
    groups,
    ungroupedCardIds: fallback,
    unitOrder,
    layoutMode: rawState.layoutMode ?? 'point-stacked',
    arrangement: normalizeHandArrangementOptions(rawState.arrangement),
    ruleProfile,
    nextGroupSequence: rawState.nextGroupSequence,
  }
}
