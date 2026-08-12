import type { Card, Rank, RuleProfile } from '../core/generated'
import {
  HandGrouping,
  type HandGroupingSnapshot,
} from './HandGrouping'
import type {
  HandSortDirection,
  HandSuggestionOptions,
  StraightFlushSuit,
  StraightFlushSuitAvailability,
} from './HandArrangement'

export type HandWorkspaceCardToggle = 'selected' | 'deselected' | 'unlock-selected' | 'locked' | 'unknown'
export type HandWorkspaceArrangementResult = 'arranged' | 'restored' | 'fallback-restored'
export type HandWorkspaceLockAction = 'start' | 'cancel' | 'commit' | 'unlock'

export interface HandWorkspaceSyncOptions {
  roundId: number
  levelRank: Rank
  direction: HandSortDirection
  autoSort: boolean
  ruleProfile: RuleProfile
}

export interface HandWorkspaceArrangementOptions {
  direction: HandSortDirection
  allowAceLowStraight: boolean
}

type HandLockDraft =
  | Readonly<{ mode: 'idle' }>
  | { mode: 'create', selectedCardIds: Set<string>, selectedSuit: StraightFlushSuit | null }
  | Readonly<{ mode: 'unlock', groupId: string, cardIds: readonly string[] }>

type HandArrangementState =
  | Readonly<{ mode: 'point-stacked' }>
  | Readonly<{ mode: 'smart-arranged', baseline: HandGroupingSnapshot | null }>

/**
 * Owns the complete presentation-side hand transaction. Scenes provide
 * authoritative cards and forward intent; no Cocos node or rule selection is
 * stored here.
 */
export class HandWorkspace {
  private readonly grouping = new HandGrouping()
  private authoritativeSignature = ''
  private authorityRoundId: number | null = null
  private arrangementState: HandArrangementState = { mode: 'point-stacked' }
  private lockDraft: HandLockDraft = { mode: 'idle' }

  public get snapshot (): HandGroupingSnapshot { return this.grouping.getSnapshot() }
  public get isManualSelectionActive (): boolean { return this.lockDraft.mode !== 'idle' }
  public get selectedCardIds (): string[] {
    if (this.lockDraft.mode === 'create') return Array.from(this.lockDraft.selectedCardIds)
    if (this.lockDraft.mode === 'unlock') return this.lockDraft.cardIds.slice()
    return []
  }
  public get selectedSuit (): StraightFlushSuit | null {
    return this.lockDraft.mode === 'create' ? this.lockDraft.selectedSuit : null
  }
  public get lockedCardIds (): string[] {
    return this.snapshot.groups.filter(group => group.locked).flatMap(group => group.cardIds)
  }
  public get canRestoreArrangement (): boolean { return this.arrangementState.mode === 'smart-arranged' }

  /** Returns true only when a new authoritative hand was applied. */
  public syncAuthoritativeHand (hand: readonly Card[], options: HandWorkspaceSyncOptions): boolean {
    if (this.authorityRoundId !== null && this.authorityRoundId !== options.roundId) {
      this.grouping.reset()
      this.arrangementState = { mode: 'point-stacked' }
      this.cancelManualSelection()
    }
    this.authorityRoundId = options.roundId
    const profileSignature = `${Number(options.ruleProfile.allowA2345Straight)}${Number(options.ruleProfile.straightFlushAsBomb)}${Number(options.ruleProfile.enableTripleWithPair)}`
    const signature = [
      String(options.roundId),
      String(options.levelRank),
      options.direction,
      String(options.autoSort),
      profileSignature,
      hand.map(card => card.id).sort().join('\u0000'),
    ].join('\u0001')
    if (signature === this.authoritativeSignature) return false
    this.authoritativeSignature = signature
    const smartArrangementActive = this.arrangementState.mode === 'smart-arranged'
    if (smartArrangementActive) {
      this.arrangementState = { mode: 'smart-arranged', baseline: null }
    }
    this.cancelManualSelection()
    this.grouping.syncAuthoritativeHand(hand, {
      levelRank: options.levelRank,
      ruleProfile: options.ruleProfile,
      fallbackOrder: options.autoSort ? 'arranged' : 'authoritative',
    })
    if (options.autoSort || smartArrangementActive) this.grouping.arrange({ direction: options.direction })
    if (smartArrangementActive) {
      this.grouping.autoGroup({ allowAceLowStraight: options.ruleProfile.allowA2345Straight })
    }
    this.grouping.stackMatchingRanks()
    return true
  }

  public invalidateAuthoritativeHand (): void { this.authoritativeSignature = '' }

  /** A round boundary must discard every lane because deck card ids are reused. */
  public resetForRound (): void {
    this.authoritativeSignature = ''
    this.authorityRoundId = null
    this.arrangementState = { mode: 'point-stacked' }
    this.cancelManualSelection()
    this.grouping.reset()
  }

  public resetForTableExit (): void {
    this.resetForRound()
  }

  public beginManualSelection (): void {
    this.lockDraft = { mode: 'create', selectedCardIds: new Set<string>(), selectedSuit: null }
  }

  public cancelManualSelection (): void {
    this.lockDraft = { mode: 'idle' }
  }

  public toggleManualCard (cardId: string): HandWorkspaceCardToggle {
    if (this.lockDraft.mode === 'idle') this.beginManualSelection()
    if (!this.snapshot.handCardIds.includes(cardId)) {
      if (this.lockDraft.mode === 'create') this.lockDraft.selectedCardIds.delete(cardId)
      return 'unknown'
    }
    const group = this.grouping.getGroupForCard(cardId)
    if (group?.locked) {
      if (this.lockDraft.mode === 'create' && this.lockDraft.selectedCardIds.size > 0) return 'locked'
      if (this.lockDraft.mode === 'unlock' && this.lockDraft.groupId === group.id) {
        this.beginManualSelection()
        return 'deselected'
      }
      this.lockDraft = { mode: 'unlock', groupId: group.id, cardIds: group.cardIds.slice() }
      return 'unlock-selected'
    }
    if (this.lockDraft.mode === 'unlock') this.beginManualSelection()
    if (this.lockDraft.mode !== 'create') return 'unknown'
    if (this.lockDraft.selectedCardIds.has(cardId)) {
      this.lockDraft.selectedCardIds.delete(cardId)
      this.lockDraft.selectedSuit = null
      return 'deselected'
    }
    this.lockDraft.selectedCardIds.add(cardId)
    this.lockDraft.selectedSuit = null
    return 'selected'
  }

  public canLockSelection (ruleProfile: RuleProfile): boolean {
    return this.lockDraft.mode === 'create' && this.grouping.canCreateLockedGroup(this.selectedCardIds, ruleProfile)
  }

  public lockAction (ruleProfile: RuleProfile): HandWorkspaceLockAction {
    if (this.lockDraft.mode === 'idle') return 'start'
    if (this.lockDraft.mode === 'unlock') return 'unlock'
    return this.canLockSelection(ruleProfile) ? 'commit' : 'cancel'
  }

  public commitManualSelection (
    ruleProfile: RuleProfile,
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
  ): boolean {
    if (this.lockDraft.mode === 'unlock') {
      const changed = this.grouping.splitGroup(this.lockDraft.groupId)
      this.reprojectAfterLockChange(changed, ruleProfile, options)
      this.cancelManualSelection()
      return changed
    }
    if (!this.canLockSelection(ruleProfile)) return false
    const selected = this.selectedCardIds
    const suit = this.lockDraft.mode === 'create' ? this.lockDraft.selectedSuit : null
    const suitSuggestion = suit
      ? this.grouping.selectStraightFlush(suit, options)
      : null
    const createDraft = this.lockDraft.mode === 'create' ? this.lockDraft : null
    const exactSuitSuggestion = Boolean(suitSuggestion &&
      suitSuggestion.cardIds.length === selected.length &&
      createDraft &&
      suitSuggestion.cardIds.every(cardId => createDraft.selectedCardIds.has(cardId)))
    if (suitSuggestion && exactSuitSuggestion) this.grouping.applySuggestion(suitSuggestion)
    else this.grouping.createLockedGroup(selected, ruleProfile)
    this.reprojectAfterLockChange(true, ruleProfile, options)
    this.cancelManualSelection()
    return true
  }

  public selectStraightFlush (
    suit: StraightFlushSuit,
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
  ): boolean {
    const suggestion = this.grouping.selectStraightFlush(suit, options)
    if (!suggestion) {
      this.cancelManualSelection()
      return false
    }
    this.beginManualSelection()
    const createDraft = this.lockDraft.mode === 'create' ? this.lockDraft : null
    if (!createDraft) return false
    suggestion.cardIds.forEach(cardId => createDraft.selectedCardIds.add(cardId))
    createDraft.selectedSuit = suit
    return true
  }

  public straightFlushAvailability (
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
  ): StraightFlushSuitAvailability[] {
    return this.grouping.getStraightFlushAvailability(options)
  }

  public playSelectionForCard (cardId: string): string[] {
    return this.grouping.getPlaySelectionForCard(cardId)
  }

  public toggleArrangement (options: HandWorkspaceArrangementOptions): HandWorkspaceArrangementResult {
    this.cancelManualSelection()
    if (this.arrangementState.mode === 'smart-arranged') {
      const restored = this.arrangementState.baseline
        ? this.grouping.restoreSnapshot(this.arrangementState.baseline)
        : false
      this.arrangementState = { mode: 'point-stacked' }
      if (restored) {
        this.grouping.arrangeLockedZone()
        return 'restored'
      }
      this.grouping.restorePointStacked({ direction: options.direction })
      this.grouping.stackMatchingRanks()
      return 'fallback-restored'
    }

    const baseline = this.grouping.getSnapshot()
    this.grouping.arrange({ direction: options.direction })
    this.grouping.autoGroup({ allowAceLowStraight: options.allowAceLowStraight })
    this.grouping.stackMatchingRanks()
    this.arrangementState = { mode: 'smart-arranged', baseline }
    return 'arranged'
  }

  private invalidateArrangementBaselineOnLockChange (changed: boolean): void {
    if (changed && this.arrangementState.mode === 'smart-arranged') {
      this.arrangementState = { mode: 'smart-arranged', baseline: null }
    }
  }

  /** Lock membership is independent; each layout mode immediately reprojects around it. */
  private reprojectAfterLockChange (
    changed: boolean,
    ruleProfile: RuleProfile,
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>>,
  ): void {
    if (!changed) return
    if (this.arrangementState.mode === 'smart-arranged') {
      this.grouping.autoGroup({
        allowAceLowStraight: options.allowAceLowStraight ?? ruleProfile.allowA2345Straight,
      })
    }
    this.grouping.stackMatchingRanks()
    this.grouping.arrangeLockedZone()
    this.invalidateArrangementBaselineOnLockChange(true)
  }
}
