import { diagnosePlay, type Card } from '../core/generated'
import {
  arrangeHandCardIds,
  assertUniqueCardIds,
  getStraightFlushSuitAvailability,
  normalizeHandArrangementOptions,
  recognizeHandGroup,
  reconcileCardIdOrder,
  selectStraightFlushForSuit,
  selectNonOverlappingSuggestions,
  suggestHandGroups,
  type CardId,
  type HandArrangementOptions,
  type HandGroupKind,
  type HandGroupSuggestion,
  type HandSuggestionOptions,
  type StraightFlushSuit,
  type StraightFlushSuitAvailability,
} from './HandArrangement'

export type HandGroupId = string
export type HandGroupClassification = HandGroupKind | 'manual' | 'rank-stack'

export interface HandGroup {
  id: HandGroupId
  kind: HandGroupClassification
  cardIds: CardId[]
}

export interface HandGroupingSnapshot {
  revision: number
  handCardIds: CardId[]
  groups: HandGroup[]
  ungroupedCardIds: CardId[]
  displayCardIds: CardId[]
  arrangement: HandArrangementOptions
  canUndo: boolean
  canRedo: boolean
}

interface HandGroupingState {
  groups: HandGroup[]
  ungroupedCardIds: CardId[]
  arrangement: HandArrangementOptions
  nextGroupSequence: number
}

export interface HandGroupingOptions {
  arrangement?: Partial<HandArrangementOptions>
  historyLimit?: number
}

export interface MoveCardTarget {
  /** null means the ungrouped lane. */
  groupId: HandGroupId | null
  /** Omit to append to the target lane/group. */
  beforeCardId?: CardId
}

const cloneArrangement = (options: HandArrangementOptions): HandArrangementOptions => ({
  ...options,
  suitOrder: options.suitOrder.slice(),
})

const cloneGroup = (group: HandGroup): HandGroup => ({ ...group, cardIds: group.cardIds.slice() })

const cloneState = (state: HandGroupingState): HandGroupingState => ({
  groups: state.groups.map(cloneGroup),
  ungroupedCardIds: state.ungroupedCardIds.slice(),
  arrangement: cloneArrangement(state.arrangement),
  nextGroupSequence: state.nextGroupSequence,
})

const equalArrays = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const equalState = (left: HandGroupingState, right: HandGroupingState): boolean => {
  if (left.nextGroupSequence !== right.nextGroupSequence) return false
  if (left.arrangement.mode !== right.arrangement.mode ||
      left.arrangement.direction !== right.arrangement.direction ||
      left.arrangement.levelCards !== right.arrangement.levelCards ||
      left.arrangement.levelRank !== right.arrangement.levelRank ||
      !equalArrays(left.arrangement.suitOrder, right.arrangement.suitOrder)) return false
  if (!equalArrays(left.ungroupedCardIds, right.ungroupedCardIds)) return false
  if (left.groups.length !== right.groups.length) return false
  return left.groups.every((group, index) => {
    const other = right.groups[index]
    return group.id === other.id && group.kind === other.kind && equalArrays(group.cardIds, other.cardIds)
  })
}

const distinctCardIds = (cardIds: readonly CardId[]): CardId[] => {
  const result: CardId[] = []
  const seen = new Set<CardId>()
  for (const cardId of cardIds) {
    if (!seen.has(cardId)) {
      seen.add(cardId)
      result.push(cardId)
    }
  }
  return result
}

const insertBefore = (items: readonly string[], item: string, beforeItem?: string): string[] => {
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

const isLockedGroup = (group: Pick<HandGroup, 'kind'>): boolean => group.kind !== 'rank-stack'

/**
 * Pure card-id grouping state. It owns presentation data only: rule cards and
 * selected-card state are deliberately outside this class.
 */
export class HandGrouping {
  private cards: Card[] = []
  private handCardIds: CardId[] = []
  private state: HandGroupingState
  private undoStack: HandGroupingState[] = []
  private redoStack: HandGroupingState[] = []
  private readonly historyLimit: number
  private revision = 0

  public constructor (hand: readonly Card[] = [], options: HandGroupingOptions = {}) {
    this.historyLimit = Math.max(1, Math.floor(options.historyLimit ?? 40))
    this.state = {
      groups: [],
      ungroupedCardIds: [],
      arrangement: normalizeHandArrangementOptions(options.arrangement),
      nextGroupSequence: 1,
    }
    this.syncAuthoritativeHand(hand)
    this.revision = 0
  }

  public getSnapshot (): HandGroupingSnapshot {
    const groups = this.state.groups.map(cloneGroup)
    const ungroupedCardIds = this.state.ungroupedCardIds.slice()
    return {
      revision: this.revision,
      handCardIds: this.handCardIds.slice(),
      groups,
      ungroupedCardIds,
      displayCardIds: groups.flatMap(group => group.cardIds).concat(ungroupedCardIds),
      arrangement: cloneArrangement(this.state.arrangement),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    }
  }

  public getSuggestions (options: Partial<HandSuggestionOptions> = {}): HandGroupSuggestion[] {
    return suggestHandGroups(this.cards, options)
  }

  /** Four-suit HUD model. `available` is the authoritative highlighted state. */
  public getStraightFlushAvailability (
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
  ): StraightFlushSuitAvailability[] {
    return getStraightFlushSuitAvailability(this.editableCards(), options)
  }

  /** The exact five card ids to select when one highlighted suit is pressed. */
  public selectStraightFlush (
    suit: StraightFlushSuit,
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
  ): HandGroupSuggestion | null {
    const suggestion = selectStraightFlushForSuit(this.editableCards(), suit, options)
    return suggestion
      ? { ...suggestion, cardIds: suggestion.cardIds.slice(), wildcardUsages: suggestion.wildcardUsages.map(usage => ({ ...usage })) }
      : null
  }

  /** Resolves and locks one suit's deterministic straight flush as a stack. */
  public lockStraightFlush (
    suit: StraightFlushSuit,
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
    groupIndex?: number,
  ): HandGroupId | null {
    const suggestion = this.selectStraightFlush(suit, options)
    return suggestion ? this.applySuggestion(suggestion, groupIndex) : null
  }

  /** Safe copy for callers that need to inspect the stack owning a card. */
  public getGroupForCard (cardId: CardId): HandGroup | null {
    const group = this.state.groups.find(candidate => candidate.cardIds.includes(cardId))
    return group ? cloneGroup(group) : null
  }

  /** Default rank stacks are editable presentation units; every other group is an explicit lock. */
  public isCardLocked (cardId: CardId): boolean {
    const group = this.state.groups.find(candidate => candidate.cardIds.includes(cardId))
    return Boolean(group && isLockedGroup(group))
  }

  /** One authoritative legality check for every UI route that creates a locked group. */
  public canCreateLockedGroup (cardIds: readonly CardId[]): boolean {
    const requested = distinctCardIds(cardIds)
    if (requested.length !== cardIds.length || requested.length < 2) return false
    const requestedSet = new Set(requested)
    if (requested.some(cardId => this.isCardLocked(cardId))) return false
    const cards = this.cards.filter(card => requestedSet.has(card.id))
    return cards.length === requested.length && diagnosePlay(cards, null).canPlay
  }

  public createLockedGroup (cardIds: readonly CardId[], groupIndex?: number): HandGroupId {
    if (!this.canCreateLockedGroup(cardIds)) throw new Error('Selected cards do not form an unlocked legal combination')
    return this.createGroup(cardIds, groupIndex)
  }

  /**
   * The final id is the fully visible bottom card in HandStackLayout. Returning
   * the whole group here lets one tap select the stack without scene heuristics.
   */
  public getStackSelectionForBottomCard (cardId: CardId): CardId[] {
    const group = this.state.groups.find(candidate => candidate.cardIds[candidate.cardIds.length - 1] === cardId)
    return group?.cardIds.slice() ?? []
  }

  /**
   * Reconciles a server snapshot or post-play hand. Stale ids are removed,
   * newly dealt ids are appended in the configured order, and old undo states
   * are discarded so undo can never resurrect a played card.
   */
  public syncAuthoritativeHand (
    hand: readonly Card[],
    arrangement: Partial<HandArrangementOptions> = {},
  ): void {
    assertUniqueCardIds(hand)
    const nextCards = hand.map(card => ({ ...card }))
    const valid = new Set(nextCards.map(card => card.id))
    const previous = cloneState(this.state)
    previous.arrangement = normalizeHandArrangementOptions({ ...previous.arrangement, ...arrangement })
    previous.groups = previous.groups.map(group => ({
      ...group,
      cardIds: group.cardIds.filter(cardId => valid.has(cardId)),
    }))
    previous.ungroupedCardIds = previous.ungroupedCardIds.filter(cardId => valid.has(cardId))

    this.cards = nextCards
    this.handCardIds = nextCards.map(card => card.id)
    this.state = this.normalizeState(previous)
    this.undoStack = []
    this.redoStack = []
    this.revision += 1
  }

  /** Alias used by network/session adapters. */
  public replaceHandFromServer (
    hand: readonly Card[],
    arrangement: Partial<HandArrangementOptions> = {},
  ): void {
    this.syncAuthoritativeHand(hand, arrangement)
  }

  public createGroup (
    cardIds: readonly CardId[],
    groupIndex?: number,
    classification: HandGroupClassification = 'manual',
  ): HandGroupId {
    const requested = distinctCardIds(cardIds)
    if (requested.length !== cardIds.length) throw new Error('A manual group cannot contain the same cardId twice')
    if (requested.length < 2) throw new Error('A manual group needs at least two cards')
    this.assertKnownCards(requested)

    let groupId = ''
    this.commit(draft => {
      groupId = `hand-group-${draft.nextGroupSequence}`
      draft.nextGroupSequence += 1
      const requestedSet = new Set(requested)
      draft.groups = draft.groups.map(group => ({
        ...group,
        cardIds: group.cardIds.filter(cardId => !requestedSet.has(cardId)),
      }))
      draft.ungroupedCardIds = draft.ungroupedCardIds.filter(cardId => !requestedSet.has(cardId))
      const insertionIndex = groupIndex === undefined
        ? draft.groups.length
        : Math.max(0, Math.min(draft.groups.length, Math.floor(groupIndex)))
      draft.groups.splice(insertionIndex, 0, { id: groupId, kind: classification, cardIds: requested.slice() })
    })
    return groupId
  }

  public applySuggestion (suggestion: Pick<HandGroupSuggestion, 'cardIds' | 'kind'>, groupIndex?: number): HandGroupId {
    return this.createGroup(suggestion.cardIds, groupIndex, suggestion.kind)
  }

  /**
   * Appends deterministic smart groups from every editable card. Explicit
   * locks survive unchanged; default same-rank stacks are dissolved first.
   */
  public autoGroup (options: Partial<HandSuggestionOptions> = {}): HandGroupSuggestion[] {
    const editableCards = this.editableCards()
    const applied = selectNonOverlappingSuggestions(suggestHandGroups(editableCards, options))
    this.commit(draft => {
      const used = new Set<CardId>()
      draft.groups = draft.groups.filter(isLockedGroup)
      const appendedGroups = applied.map(suggestion => {
        const group: HandGroup = {
          id: `hand-group-${draft.nextGroupSequence}`,
          kind: suggestion.kind,
          cardIds: suggestion.cardIds.slice(),
        }
        draft.nextGroupSequence += 1
        group.cardIds.forEach(cardId => used.add(cardId))
        return group
      })
      draft.groups.push(...appendedGroups)
      draft.ungroupedCardIds = arrangeHandCardIds(editableCards, draft.arrangement)
        .filter(cardId => !used.has(cardId))
    })
    return applied
  }

  /** Stacks loose cards with the same physical rank without turning them into explicit locks. */
  public stackMatchingRanks (): HandGroupId[] {
    const cardById = new Map(this.cards.map(card => [card.id, card]))
    const rankBuckets = new Map<string, CardId[]>()
    for (const cardId of this.state.ungroupedCardIds) {
      const card = cardById.get(cardId)
      if (!card) continue
      const key = String(card.rank)
      const bucket = rankBuckets.get(key) ?? []
      bucket.push(cardId)
      rankBuckets.set(key, bucket)
    }
    const stacks = Array.from(rankBuckets.values()).filter(cardIds => cardIds.length >= 2)
    if (!stacks.length) return []

    const groupIds: HandGroupId[] = []
    this.commit(draft => {
      const used = new Set(stacks.flat())
      for (const cardIds of stacks) {
        const groupId = `hand-group-${draft.nextGroupSequence}`
        draft.nextGroupSequence += 1
        groupIds.push(groupId)
        draft.groups.push({ id: groupId, kind: 'rank-stack', cardIds: cardIds.slice() })
      }
      draft.ungroupedCardIds = draft.ungroupedCardIds.filter(cardId => !used.has(cardId))
    })
    return groupIds
  }

  public splitGroup (groupId: HandGroupId): boolean {
    const group = this.state.groups.find(candidate => candidate.id === groupId)
    if (!group) return false
    return this.commit(draft => {
      const target = draft.groups.find(candidate => candidate.id === groupId)
      if (!target) return
      draft.groups = draft.groups.filter(candidate => candidate.id !== groupId)
      draft.ungroupedCardIds = this.sortCardIds(draft.ungroupedCardIds.concat(target.cardIds), draft.arrangement)
    })
  }

  /** Moves/reorders one card by id, either within a group or across group/ungrouped lanes. */
  public moveCard (cardId: CardId, target: MoveCardTarget): boolean {
    this.assertKnownCards([cardId])
    if (target.groupId !== null && !this.state.groups.some(group => group.id === target.groupId)) {
      throw new Error(`Unknown target group: ${target.groupId}`)
    }

    return this.commit(draft => {
      const sourceGroup = draft.groups.find(group => group.cardIds.includes(cardId))
      const sourceIsUngrouped = draft.ungroupedCardIds.includes(cardId)
      if (!sourceGroup && !sourceIsUngrouped) throw new Error(`Card is missing from grouping state: ${cardId}`)

      if (sourceGroup?.id === target.groupId) {
        sourceGroup.cardIds = insertBefore(sourceGroup.cardIds, cardId, target.beforeCardId)
        return
      }
      if (!sourceGroup && target.groupId === null) {
        draft.ungroupedCardIds = insertBefore(draft.ungroupedCardIds, cardId, target.beforeCardId)
        return
      }

      if (sourceGroup) sourceGroup.cardIds = sourceGroup.cardIds.filter(id => id !== cardId)
      else draft.ungroupedCardIds = draft.ungroupedCardIds.filter(id => id !== cardId)

      if (target.groupId === null) {
        draft.ungroupedCardIds = insertBefore(draft.ungroupedCardIds, cardId, target.beforeCardId)
      } else {
        const targetGroup = draft.groups.find(group => group.id === target.groupId)
        if (!targetGroup) throw new Error(`Unknown target group: ${target.groupId}`)
        targetGroup.cardIds = insertBefore(targetGroup.cardIds, cardId, target.beforeCardId)
      }
    })
  }

  public moveGroup (groupId: HandGroupId, beforeGroupId?: HandGroupId): boolean {
    if (!this.state.groups.some(group => group.id === groupId)) return false
    if (beforeGroupId !== undefined && !this.state.groups.some(group => group.id === beforeGroupId)) {
      throw new Error(`Unknown target group: ${beforeGroupId}`)
    }
    if (groupId === beforeGroupId) return false
    return this.commit(draft => {
      const group = draft.groups.find(candidate => candidate.id === groupId)
      if (!group) return
      draft.groups = draft.groups.filter(candidate => candidate.id !== groupId)
      if (beforeGroupId === undefined) {
        draft.groups.push(group)
        return
      }
      const targetIndex = draft.groups.findIndex(candidate => candidate.id === beforeGroupId)
      draft.groups.splice(targetIndex, 0, group)
    })
  }

  /** Sorts only the loose lane; locked groups are immutable arrangement units. */
  public arrange (options: Partial<HandArrangementOptions>): boolean {
    const arrangement = normalizeHandArrangementOptions({ ...this.state.arrangement, ...options })
    return this.commit(draft => {
      draft.arrangement = arrangement
      draft.ungroupedCardIds = this.sortCardIds(draft.ungroupedCardIds, arrangement)
    })
  }

  /** Clears all custom groups and restores the configured deterministic order. */
  public restoreDefault (options: Partial<HandArrangementOptions> = {}): boolean {
    const arrangement = normalizeHandArrangementOptions({ ...this.state.arrangement, ...options })
    return this.commit(draft => {
      draft.arrangement = arrangement
      draft.groups = []
      draft.ungroupedCardIds = arrangeHandCardIds(this.cards, arrangement)
    })
  }

  /** Restores a presentation snapshot only while it still describes the authoritative hand. */
  public restoreSnapshot (snapshot: HandGroupingSnapshot): boolean {
    const authoritativeIds = new Set(this.handCardIds)
    const snapshotIds = snapshot.groups.flatMap(group => group.cardIds).concat(snapshot.ungroupedCardIds)
    if (snapshotIds.length !== authoritativeIds.size ||
        new Set(snapshotIds).size !== snapshotIds.length ||
        snapshotIds.some(cardId => !authoritativeIds.has(cardId))) return false
    const restored = this.normalizeState({
      groups: snapshot.groups.map(cloneGroup),
      ungroupedCardIds: snapshot.ungroupedCardIds.slice(),
      arrangement: cloneArrangement(snapshot.arrangement),
      nextGroupSequence: this.state.nextGroupSequence,
    })
    this.commit(draft => {
      draft.groups = restored.groups.map(cloneGroup)
      draft.ungroupedCardIds = restored.ungroupedCardIds.slice()
      draft.arrangement = cloneArrangement(restored.arrangement)
    })
    return true
  }

  public undo (): boolean {
    const previous = this.undoStack.pop()
    if (!previous) return false
    this.redoStack.push(cloneState(this.state))
    this.state = this.normalizeState(previous)
    this.revision += 1
    return true
  }

  public redo (): boolean {
    const next = this.redoStack.pop()
    if (!next) return false
    this.undoStack.push(cloneState(this.state))
    this.state = this.normalizeState(next)
    this.revision += 1
    return true
  }

  private assertKnownCards (cardIds: readonly CardId[]): void {
    const valid = new Set(this.handCardIds)
    const unknown = cardIds.find(cardId => !valid.has(cardId))
    if (unknown !== undefined) throw new Error(`Unknown cardId: ${unknown}`)
  }

  private sortCardIds (cardIds: readonly CardId[], options: HandArrangementOptions): CardId[] {
    const order = arrangeHandCardIds(this.cards, options)
    const index = new Map(order.map((cardId, position) => [cardId, position]))
    return distinctCardIds(cardIds).sort((left, right) =>
      (index.get(left) ?? Number.MAX_SAFE_INTEGER) - (index.get(right) ?? Number.MAX_SAFE_INTEGER),
    )
  }

  private editableCards (): Card[] {
    const lockedCardIds = new Set(this.state.groups.filter(isLockedGroup).flatMap(group => group.cardIds))
    return this.cards.filter(card => !lockedCardIds.has(card.id))
  }

  private classifyGroup (cardIds: readonly CardId[], requestedKind?: HandGroupClassification): HandGroupClassification {
    if (requestedKind === 'rank-stack') {
      const requested = new Set(cardIds)
      const ranks = new Set(this.cards.filter(card => requested.has(card.id)).map(card => String(card.rank)))
      if (ranks.size === 1) return 'rank-stack'
    }
    return recognizeHandGroup(this.cards, cardIds)?.kind ?? 'manual'
  }

  private normalizeState (rawState: HandGroupingState): HandGroupingState {
    const valid = new Set(this.handCardIds)
    const claimed = new Set<CardId>()
    const groupIds = new Set<HandGroupId>()
    const groups: HandGroup[] = []

    for (const rawGroup of rawState.groups) {
      if (groupIds.has(rawGroup.id)) continue
      const cardIds = distinctCardIds(rawGroup.cardIds).filter(cardId => valid.has(cardId) && !claimed.has(cardId))
      if (cardIds.length < 2) continue
      groupIds.add(rawGroup.id)
      cardIds.forEach(cardId => claimed.add(cardId))
      groups.push({ id: rawGroup.id, kind: this.classifyGroup(cardIds, rawGroup.kind), cardIds })
    }

    const requestedUngrouped = distinctCardIds(rawState.ungroupedCardIds)
      .filter(cardId => valid.has(cardId) && !claimed.has(cardId))
    requestedUngrouped.forEach(cardId => claimed.add(cardId))
    const fallback = reconcileCardIdOrder(this.cards, requestedUngrouped, rawState.arrangement)
      .filter(cardId => !groups.some(group => group.cardIds.includes(cardId)))

    return {
      groups,
      ungroupedCardIds: fallback,
      arrangement: normalizeHandArrangementOptions(rawState.arrangement),
      nextGroupSequence: rawState.nextGroupSequence,
    }
  }

  private commit (mutate: (draft: HandGroupingState) => void): boolean {
    const before = cloneState(this.state)
    const draft = cloneState(this.state)
    mutate(draft)
    const after = this.normalizeState(draft)
    if (equalState(before, after)) return false
    this.undoStack.push(before)
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift()
    this.redoStack = []
    this.state = after
    this.revision += 1
    return true
  }
}
