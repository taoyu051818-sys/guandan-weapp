import { diagnosePlay, getRuleProfile, type Card, type RuleProfile } from '../core/generated'
import {
  arrangeHandGroupCardIds,
  arrangeHandCardIds,
  assertUniqueCardIds,
  getStraightFlushSuitAvailability,
  normalizeHandArrangementOptions,
  selectStraightFlushForSuit,
  selectNonOverlappingSuggestions,
  suggestHandGroups,
  type CardId,
  type HandDisplayUnit,
  type HandArrangementOptions,
  type HandGroupOrigin,
  type HandLayoutMode,
  type HandGroupSuggestion,
  type HandSuggestionOptions,
  type StraightFlushSuit,
  type StraightFlushSuitAvailability,
} from './HandArrangement'
import { HandGroupingHistory } from './HandGroupingHistory'
import {
  cardUnitKey,
  cloneArrangement,
  cloneGroup,
  cloneHandGroupingState,
  cloneRuleProfile,
  displayUnitsForState,
  distinctCardIds,
  equalHandGroupingState,
  groupUnitKey,
  insertBefore,
  isLockedGroup,
  normalizeHandGroupingState,
  sortHandGroupingDisplayState,
  type HandGroup,
  type HandGroupClassification,
  type HandGroupId,
  type HandGroupingState,
} from './HandGroupingState'

export type {
  HandGroup,
  HandGroupClassification,
  HandGroupId,
} from './HandGroupingState'

export interface HandGroupingSnapshot {
  revision: number
  handCardIds: CardId[]
  groups: HandGroup[]
  ungroupedCardIds: CardId[]
  displayUnits: HandDisplayUnit[]
  displayCardIds: CardId[]
  layoutMode: HandLayoutMode
  arrangement: HandArrangementOptions
  ruleProfile: RuleProfile
  canUndo: boolean
  canRedo: boolean
}

export interface HandGroupingOptions {
  arrangement?: Partial<HandArrangementOptions>
  ruleProfile?: RuleProfile
  historyLimit?: number
}

export type HandAuthoritativeSyncOptions = Partial<HandArrangementOptions> & Readonly<{
  /** Controls only where newly observed cards enter the presentation order. */
  fallbackOrder?: 'arranged' | 'authoritative'
  ruleProfile?: RuleProfile
}>

/**
 * Pure card-id grouping state. It owns presentation data only: rule cards and
 * selected-card state are deliberately outside this class.
 */
export class HandGrouping {
  private cards: Card[] = []
  private handCardIds: CardId[] = []
  private state: HandGroupingState
  private readonly history: HandGroupingHistory<HandGroupingState>
  private revision = 0

  public constructor (hand: readonly Card[] = [], options: HandGroupingOptions = {}) {
    this.history = new HandGroupingHistory(options.historyLimit ?? 40, cloneHandGroupingState)
    this.state = {
      groups: [],
      ungroupedCardIds: [],
      unitOrder: [],
      layoutMode: 'point-stacked',
      arrangement: normalizeHandArrangementOptions(options.arrangement),
      ruleProfile: cloneRuleProfile(options.ruleProfile ?? getRuleProfile('classic')),
      nextGroupSequence: 1,
    }
    this.reset(hand, {
      ...options.arrangement,
      ruleProfile: options.ruleProfile,
    })
    this.revision = 0
  }

  public getSnapshot (): HandGroupingSnapshot {
    const displayUnits = displayUnitsForState(this.state)
    const groupById = new Map(this.state.groups.map(group => [group.id, group]))
    const groups = displayUnits.flatMap(unit => unit.groupId
      ? [groupById.get(unit.groupId)].filter((group): group is HandGroup => Boolean(group)).map(cloneGroup)
      : [])
    const ungroupedCardIds = this.state.ungroupedCardIds.slice()
    return {
      revision: this.revision,
      handCardIds: this.handCardIds.slice(),
      groups,
      ungroupedCardIds,
      displayUnits,
      displayCardIds: displayUnits.flatMap(unit => unit.cardIds),
      layoutMode: this.state.layoutMode,
      arrangement: cloneArrangement(this.state.arrangement),
      ruleProfile: cloneRuleProfile(this.state.ruleProfile),
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    }
  }

  /** Starts a fresh presentation transaction and retires all prior card ids/history. */
  public reset (hand: readonly Card[] = [], options: HandAuthoritativeSyncOptions = {}): void {
    assertUniqueCardIds(hand)
    const { fallbackOrder = 'arranged', ruleProfile, ...arrangement } = options
    this.cards = hand.map(card => ({ ...card }))
    this.handCardIds = this.cards.map(card => card.id)
    const normalizedArrangement = normalizeHandArrangementOptions(arrangement)
    const ungroupedCardIds = fallbackOrder === 'authoritative'
      ? this.handCardIds.slice()
      : arrangeHandCardIds(this.cards, normalizedArrangement)
    this.state = {
      groups: [],
      ungroupedCardIds,
      unitOrder: ungroupedCardIds.map(cardUnitKey),
      layoutMode: 'point-stacked',
      arrangement: normalizedArrangement,
      ruleProfile: cloneRuleProfile(ruleProfile ?? getRuleProfile('classic')),
      nextGroupSequence: 1,
    }
    this.history.clear()
    this.revision += 1
  }

  public clearPresentation (): void { this.reset() }

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

  /** Locking is explicit presentation metadata; classification never implies it. */
  public isCardLocked (cardId: CardId): boolean {
    const group = this.state.groups.find(candidate => candidate.cardIds.includes(cardId))
    return Boolean(group && isLockedGroup(group))
  }

  /** One authoritative legality check for every UI route that creates a locked group. */
  public canCreateLockedGroup (cardIds: readonly CardId[], ruleProfile: RuleProfile): boolean {
    const requested = distinctCardIds(cardIds)
    if (requested.length !== cardIds.length || requested.length < 2) return false
    const requestedSet = new Set(requested)
    if (requested.some(cardId => this.isCardLocked(cardId))) return false
    const cards = this.cards.filter(card => requestedSet.has(card.id))
    return cards.length === requested.length && diagnosePlay(cards, null, ruleProfile).canPlay
  }

  public createLockedGroup (cardIds: readonly CardId[], ruleProfile: RuleProfile, groupIndex?: number): HandGroupId {
    if (!this.canCreateLockedGroup(cardIds, ruleProfile)) throw new Error('Selected cards do not form an unlocked legal combination')
    const groupId = this.createGroup(cardIds, groupIndex, 'manual', 'manual', true, ruleProfile)
    if (groupIndex === undefined) this.arrangeLockedZone()
    return groupId
  }

  /** Locked groups select atomically from every exposed member; loose stacks only from their bottom card. */
  public getPlaySelectionForCard (cardId: CardId): CardId[] {
    const group = this.state.groups.find(candidate => candidate.cardIds.includes(cardId))
    if (!group) return []
    return group.locked || group.cardIds[group.cardIds.length - 1] === cardId ? group.cardIds.slice() : []
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
    options: HandAuthoritativeSyncOptions = {},
  ): void {
    assertUniqueCardIds(hand)
    const { fallbackOrder = 'arranged', ruleProfile, ...arrangement } = options
    const nextCards = hand.map(card => ({ ...card }))
    const previous = cloneHandGroupingState(this.state)
    previous.arrangement = normalizeHandArrangementOptions({ ...previous.arrangement, ...arrangement })
    previous.ruleProfile = cloneRuleProfile(ruleProfile ?? previous.ruleProfile)

    this.cards = nextCards
    this.handCardIds = nextCards.map(card => card.id)
    this.state = normalizeHandGroupingState(
      this.cards,
      this.handCardIds,
      previous,
      fallbackOrder === 'authoritative' ? this.handCardIds : [],
      true,
    )
    this.history.clear()
    this.revision += 1
  }

  /** Alias used by network/session adapters. */
  public replaceHandFromServer (
    hand: readonly Card[],
    options: HandAuthoritativeSyncOptions = {},
  ): void {
    this.syncAuthoritativeHand(hand, options)
  }

  private createGroup (
    cardIds: readonly CardId[],
    groupIndex?: number,
    classification: HandGroupClassification = 'manual',
    origin: HandGroupOrigin = 'manual',
    locked: boolean = origin === 'manual',
    ruleProfile?: RuleProfile,
  ): HandGroupId {
    const requested = distinctCardIds(cardIds)
    if (requested.length !== cardIds.length) throw new Error('A manual group cannot contain the same cardId twice')
    if (requested.length < 2) throw new Error('A manual group needs at least two cards')
    this.assertKnownCards(requested)
    const canonicalPlacement = groupIndex === undefined && this.state.layoutMode === 'smart-arranged'

    let groupId = ''
    this.commit(draft => {
      if (ruleProfile) draft.ruleProfile = cloneRuleProfile(ruleProfile)
      groupId = `hand-group-${draft.nextGroupSequence}`
      draft.nextGroupSequence += 1
      const requestedSet = new Set(requested)
      const sourceUnitKeys = new Set(requested.map(cardId => {
        const sourceGroup = draft.groups.find(group => group.cardIds.includes(cardId))
        return sourceGroup ? groupUnitKey(sourceGroup.id) : cardUnitKey(cardId)
      }))
      draft.groups = draft.groups.map(group => ({
        ...group,
        cardIds: group.cardIds.filter(cardId => !requestedSet.has(cardId)),
      }))
      draft.ungroupedCardIds = draft.ungroupedCardIds.filter(cardId => !requestedSet.has(cardId))
      const insertionIndex = groupIndex === undefined
        ? draft.groups.length
        : Math.max(0, Math.min(draft.groups.length, Math.floor(groupIndex)))
      const group: HandGroup = {
        id: groupId,
        kind: classification,
        origin,
        locked,
        cardIds: arrangeHandGroupCardIds(this.cards, requested, draft.ruleProfile, draft.arrangement),
      }
      draft.groups.splice(insertionIndex, 0, group)
      if (groupIndex !== undefined) {
        draft.unitOrder = draft.unitOrder.filter(key => !requested.some(cardId => key === cardUnitKey(cardId)))
        const beforeGroup = draft.groups[insertionIndex + 1]
        const beforeKeyIndex = beforeGroup ? draft.unitOrder.indexOf(groupUnitKey(beforeGroup.id)) : -1
        if (beforeKeyIndex >= 0) draft.unitOrder.splice(beforeKeyIndex, 0, groupUnitKey(groupId))
        else draft.unitOrder.push(groupUnitKey(groupId))
      } else {
        const nextOrder: string[] = []
        let inserted = false
        for (const key of draft.unitOrder) {
          if (!inserted && sourceUnitKeys.has(key)) {
            nextOrder.push(groupUnitKey(groupId))
            inserted = true
          }
          if (!requested.some(cardId => key === cardUnitKey(cardId))) nextOrder.push(key)
        }
        if (!inserted) nextOrder.push(groupUnitKey(groupId))
        draft.unitOrder = nextOrder
      }
    }, canonicalPlacement)
    return groupId
  }

  public applySuggestion (suggestion: Pick<HandGroupSuggestion, 'cardIds' | 'kind'>, groupIndex?: number): HandGroupId {
    const groupId = this.createGroup(suggestion.cardIds, groupIndex, suggestion.kind, 'manual', true)
    if (groupIndex === undefined) this.arrangeLockedZone()
    return groupId
  }

  /**
   * Appends deterministic smart groups from every editable card. Explicit
   * locks survive unchanged; default same-rank stacks are dissolved first.
   */
  public autoGroup (options: Partial<HandSuggestionOptions> = {}): HandGroupSuggestion[] {
    const editableCards = this.editableCards()
    const suggestionOptions = { ...options, ruleProfile: this.state.ruleProfile }
    const applied = selectNonOverlappingSuggestions(
      suggestHandGroups(editableCards, suggestionOptions),
      this.state.ruleProfile,
    )
    this.commit(draft => {
      draft.layoutMode = 'smart-arranged'
      const used = new Set<CardId>()
      draft.groups = draft.groups.filter(isLockedGroup)
      const appendedGroups = applied.map(suggestion => {
        const group: HandGroup = {
          id: `hand-group-${draft.nextGroupSequence}`,
          kind: suggestion.kind,
          origin: 'auto',
          locked: false,
          cardIds: arrangeHandGroupCardIds(
            this.cards,
            suggestion.cardIds,
            draft.ruleProfile,
            draft.arrangement,
          ),
        }
        draft.nextGroupSequence += 1
        group.cardIds.forEach(cardId => used.add(cardId))
        return group
      })
      draft.groups.push(...appendedGroups)
      draft.ungroupedCardIds = arrangeHandCardIds(editableCards, draft.arrangement)
        .filter(cardId => !used.has(cardId))
    }, true)
    return applied
  }

  /** Rebuilds exactly one unlocked presentation stack for every physical rank. */
  public stackMatchingRanks (): HandGroupId[] {
    const cardById = new Map(this.cards.map(card => [card.id, card]))
    const groupIds: HandGroupId[] = []
    this.commit(draft => {
      const rankGroups = draft.groups.filter(group => group.origin === 'rank' && !group.locked)
      const candidateIds = new Set(rankGroups.flatMap(group => group.cardIds).concat(draft.ungroupedCardIds))
      const sourceRankByKey = new Map<string, string>()
      rankGroups.forEach(group => {
        const rank = cardById.get(group.cardIds[0])?.rank
        if (rank !== undefined) sourceRankByKey.set(groupUnitKey(group.id), String(rank))
      })
      draft.ungroupedCardIds.forEach(cardId => {
        const rank = cardById.get(cardId)?.rank
        if (rank !== undefined) sourceRankByKey.set(cardUnitKey(cardId), String(rank))
      })

      const orderedCandidateIds: CardId[] = []
      const seenCandidateIds = new Set<CardId>()
      const appendCandidate = (cardId: CardId): void => {
        if (candidateIds.has(cardId) && !seenCandidateIds.has(cardId)) {
          seenCandidateIds.add(cardId)
          orderedCandidateIds.push(cardId)
        }
      }
      for (const key of draft.unitOrder) {
        const rankGroup = rankGroups.find(group => groupUnitKey(group.id) === key)
        if (rankGroup) rankGroup.cardIds.forEach(appendCandidate)
        else {
          const looseCardId = draft.ungroupedCardIds.find(cardId => cardUnitKey(cardId) === key)
          if (looseCardId) appendCandidate(looseCardId)
        }
      }
      candidateIds.forEach(appendCandidate)

      const rankBuckets = new Map<string, CardId[]>()
      orderedCandidateIds.forEach(cardId => {
        const rank = cardById.get(cardId)?.rank
        if (rank === undefined) return
        const key = String(rank)
        const bucket = rankBuckets.get(key) ?? []
        bucket.push(cardId)
        rankBuckets.set(key, bucket)
      })
      const existingGroupByRank = new Map<string, HandGroup>()
      rankGroups.forEach(group => {
        const rank = cardById.get(group.cardIds[0])?.rank
        if (rank !== undefined && !existingGroupByRank.has(String(rank))) existingGroupByRank.set(String(rank), group)
      })
      const stackByRank = new Map<string, HandGroup>()
      rankBuckets.forEach((cardIds, rank) => {
        if (cardIds.length < 2) return
        const existing = existingGroupByRank.get(rank)
        const groupId = existing?.id ?? `hand-group-${draft.nextGroupSequence++}`
        const group: HandGroup = {
          id: groupId,
          kind: 'rank-stack',
          origin: 'rank',
          locked: false,
          cardIds: arrangeHandGroupCardIds(
            this.cards,
            cardIds,
            draft.ruleProfile,
            draft.arrangement,
          ),
        }
        groupIds.push(groupId)
        stackByRank.set(rank, group)
      })

      draft.groups = draft.groups.filter(group => group.origin !== 'rank' || group.locked)
        .concat(Array.from(stackByRank.values()))
      draft.ungroupedCardIds = orderedCandidateIds.filter(cardId => {
        const rank = cardById.get(cardId)?.rank
        return rank === undefined || !stackByRank.has(String(rank))
      })

      const nextOrder: string[] = []
      const emittedRanks = new Set<string>()
      for (const key of draft.unitOrder) {
        const rank = sourceRankByKey.get(key)
        if (rank === undefined) {
          nextOrder.push(key)
          continue
        }
        if (emittedRanks.has(rank)) continue
        emittedRanks.add(rank)
        const stack = stackByRank.get(rank)
        if (stack) nextOrder.push(groupUnitKey(stack.id))
        else (rankBuckets.get(rank) ?? []).forEach(cardId => nextOrder.push(cardUnitKey(cardId)))
      }
      rankBuckets.forEach((cardIds, rank) => {
        if (emittedRanks.has(rank)) return
        const stack = stackByRank.get(rank)
        if (stack) nextOrder.push(groupUnitKey(stack.id))
        else cardIds.forEach(cardId => nextOrder.push(cardUnitKey(cardId)))
      })
      draft.unitOrder = nextOrder
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
      const released = this.sortCardIds(target.cardIds, draft.arrangement)
      draft.ungroupedCardIds = this.sortCardIds(draft.ungroupedCardIds.concat(released), draft.arrangement)
      const unitIndex = draft.unitOrder.indexOf(groupUnitKey(groupId))
      draft.unitOrder = draft.unitOrder.filter(key => key !== groupUnitKey(groupId))
      draft.unitOrder.splice(unitIndex < 0 ? draft.unitOrder.length : unitIndex, 0, ...released.map(cardUnitKey))
    })
  }

  public moveGroup (groupId: HandGroupId, beforeGroupId?: HandGroupId): boolean {
    if (!this.state.groups.some(group => group.id === groupId)) return false
    if (beforeGroupId !== undefined && !this.state.groups.some(group => group.id === beforeGroupId)) {
      throw new Error(`Unknown target group: ${beforeGroupId}`)
    }
    if (groupId === beforeGroupId) return false
    return this.commit(draft => {
      draft.unitOrder = insertBefore(
        draft.unitOrder,
        groupUnitKey(groupId),
        beforeGroupId === undefined ? undefined : groupUnitKey(beforeGroupId),
      )
    })
  }

  /** Sorts one unified lane sequence; locked membership never pins a horizontal position. */
  public arrange (options: Partial<HandArrangementOptions>): boolean {
    const arrangement = normalizeHandArrangementOptions({ ...this.state.arrangement, ...options })
    return this.commit(draft => {
      draft.arrangement = arrangement
    }, true)
  }

  /** Reapplies the shared total order after lock membership changes. */
  public arrangeLockedZone (): boolean {
    return this.commit(() => {}, true)
  }

  /** Leaves smart ordering while preserving the current explicit lock membership. */
  public restorePointStacked (options: Partial<HandArrangementOptions> = {}): boolean {
    const arrangement = normalizeHandArrangementOptions({ ...this.state.arrangement, ...options })
    return this.commit(draft => {
      const lockedGroups = draft.groups.filter(isLockedGroup)
      const lockedIds = new Set(lockedGroups.flatMap(group => group.cardIds))
      const ungroupedCardIds = arrangeHandCardIds(this.cards, arrangement)
        .filter(cardId => !lockedIds.has(cardId))
      draft.layoutMode = 'point-stacked'
      draft.arrangement = arrangement
      draft.groups = lockedGroups
      draft.ungroupedCardIds = ungroupedCardIds
      draft.unitOrder = lockedGroups.map(group => groupUnitKey(group.id)).concat(ungroupedCardIds.map(cardUnitKey))
    }, true)
  }

  /** Clears all custom groups and restores the configured deterministic order. */
  public restoreDefault (options: Partial<HandArrangementOptions> = {}): boolean {
    const arrangement = normalizeHandArrangementOptions({ ...this.state.arrangement, ...options })
    return this.commit(draft => {
      draft.layoutMode = 'point-stacked'
      draft.arrangement = arrangement
      draft.groups = []
      draft.ungroupedCardIds = arrangeHandCardIds(this.cards, arrangement)
      draft.unitOrder = draft.ungroupedCardIds.map(cardUnitKey)
    })
  }

  /** Restores a presentation snapshot only while it still describes the authoritative hand. */
  public restoreSnapshot (snapshot: HandGroupingSnapshot): boolean {
    const authoritativeIds = new Set(this.handCardIds)
    const snapshotIds = snapshot.groups.flatMap(group => group.cardIds).concat(snapshot.ungroupedCardIds)
    if (snapshotIds.length !== authoritativeIds.size ||
        new Set(snapshotIds).size !== snapshotIds.length ||
        snapshotIds.some(cardId => !authoritativeIds.has(cardId))) return false
    const restored = normalizeHandGroupingState(this.cards, this.handCardIds, {
      groups: snapshot.groups.map(cloneGroup),
      ungroupedCardIds: snapshot.ungroupedCardIds.slice(),
      unitOrder: snapshot.displayUnits?.map(unit => unit.key) ??
        snapshot.groups.map(group => groupUnitKey(group.id)).concat(snapshot.ungroupedCardIds.map(cardUnitKey)),
      layoutMode: snapshot.layoutMode ?? 'point-stacked',
      arrangement: cloneArrangement(snapshot.arrangement),
      ruleProfile: cloneRuleProfile(snapshot.ruleProfile ?? this.state.ruleProfile),
      nextGroupSequence: this.state.nextGroupSequence,
    })
    this.commit(draft => {
      draft.groups = restored.groups.map(cloneGroup)
      draft.ungroupedCardIds = restored.ungroupedCardIds.slice()
      draft.unitOrder = restored.unitOrder.slice()
      draft.layoutMode = restored.layoutMode
      draft.arrangement = cloneArrangement(restored.arrangement)
      draft.ruleProfile = cloneRuleProfile(restored.ruleProfile)
    })
    return true
  }

  public undo (): boolean {
    const previous = this.history.undo(this.state)
    if (!previous) return false
    this.state = normalizeHandGroupingState(this.cards, this.handCardIds, previous)
    this.revision += 1
    return true
  }

  public redo (): boolean {
    const next = this.history.redo(this.state)
    if (!next) return false
    this.state = normalizeHandGroupingState(this.cards, this.handCardIds, next)
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

  private commit (mutate: (draft: HandGroupingState) => void, canonicalSort = false): boolean {
    const before = cloneHandGroupingState(this.state)
    const draft = cloneHandGroupingState(this.state)
    mutate(draft)
    const after = normalizeHandGroupingState(this.cards, this.handCardIds, draft)
    if (canonicalSort) sortHandGroupingDisplayState(this.cards, after)
    if (equalHandGroupingState(before, after)) return false
    this.history.record(before)
    this.state = after
    this.revision += 1
    return true
  }
}
