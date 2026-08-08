import type { Card, Rank } from '../core/generated'
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

export type HandWorkspaceCardToggle = 'selected' | 'deselected' | 'locked' | 'unknown'
export type HandWorkspaceArrangementResult = 'arranged' | 'restored' | 'fallback-restored'

export interface HandWorkspaceSyncOptions {
  levelRank: Rank
  direction: HandSortDirection
  autoSort: boolean
}

export interface HandWorkspaceArrangementOptions {
  direction: HandSortDirection
  allowAceLowStraight: boolean
}

/**
 * Owns the complete presentation-side hand transaction. Scenes provide
 * authoritative cards and forward intent; no Cocos node or rule selection is
 * stored here.
 */
export class HandWorkspace {
  private readonly grouping = new HandGrouping()
  private authoritativeSignature = ''
  private arrangementBaseline: HandGroupingSnapshot | null = null
  private manualSelectionActive = false
  private readonly manualSelection = new Set<string>()
  private selectedStraightFlushSuit: StraightFlushSuit | null = null

  public get snapshot (): HandGroupingSnapshot { return this.grouping.getSnapshot() }
  public get isManualSelectionActive (): boolean { return this.manualSelectionActive }
  public get selectedCardIds (): string[] { return Array.from(this.manualSelection) }
  public get selectedSuit (): StraightFlushSuit | null { return this.selectedStraightFlushSuit }
  public get canRestoreArrangement (): boolean { return this.arrangementBaseline !== null }

  /** Returns true only when a new authoritative hand was applied. */
  public syncAuthoritativeHand (hand: readonly Card[], options: HandWorkspaceSyncOptions): boolean {
    const signature = `${String(options.levelRank)}\u0000${hand.map(card => card.id).sort().join('\u0000')}`
    if (signature === this.authoritativeSignature) return false
    this.authoritativeSignature = signature
    this.arrangementBaseline = null
    this.cancelManualSelection()
    this.grouping.syncAuthoritativeHand(hand, { levelRank: options.levelRank })
    if (options.autoSort) this.grouping.arrange({ direction: options.direction })
    this.grouping.stackMatchingRanks()
    return true
  }

  public invalidateAuthoritativeHand (): void { this.authoritativeSignature = '' }

  public resetForTableExit (): void {
    this.authoritativeSignature = ''
    this.arrangementBaseline = null
    this.cancelManualSelection()
  }

  public beginManualSelection (): void {
    this.manualSelectionActive = true
    this.manualSelection.clear()
    this.selectedStraightFlushSuit = null
  }

  public cancelManualSelection (): void {
    this.manualSelectionActive = false
    this.manualSelection.clear()
    this.selectedStraightFlushSuit = null
  }

  public toggleManualCard (cardId: string): HandWorkspaceCardToggle {
    if (!this.snapshot.handCardIds.includes(cardId)) {
      this.manualSelection.delete(cardId)
      return 'unknown'
    }
    if (this.grouping.isCardLocked(cardId)) {
      this.manualSelection.delete(cardId)
      return 'locked'
    }
    if (this.manualSelection.has(cardId)) {
      this.manualSelection.delete(cardId)
      this.selectedStraightFlushSuit = null
      return 'deselected'
    }
    this.manualSelection.add(cardId)
    this.selectedStraightFlushSuit = null
    return 'selected'
  }

  public canLockSelection (): boolean {
    return this.manualSelectionActive && this.grouping.canCreateLockedGroup(this.selectedCardIds)
  }

  public commitManualSelection (
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
  ): boolean {
    if (!this.canLockSelection()) return false
    const selected = this.selectedCardIds
    const suitSuggestion = this.selectedStraightFlushSuit
      ? this.grouping.selectStraightFlush(this.selectedStraightFlushSuit, options)
      : null
    const exactSuitSuggestion = Boolean(suitSuggestion &&
      suitSuggestion.cardIds.length === selected.length &&
      suitSuggestion.cardIds.every(cardId => this.manualSelection.has(cardId)))
    if (suitSuggestion && exactSuitSuggestion) this.grouping.applySuggestion(suitSuggestion)
    else this.grouping.createLockedGroup(selected)
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
    suggestion.cardIds.forEach(cardId => this.manualSelection.add(cardId))
    this.selectedStraightFlushSuit = suit
    return true
  }

  public straightFlushAvailability (
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
  ): StraightFlushSuitAvailability[] {
    return this.grouping.getStraightFlushAvailability(options)
  }

  public stackSelectionForBottomCard (cardId: string): string[] {
    return this.grouping.getStackSelectionForBottomCard(cardId)
  }

  public toggleArrangement (options: HandWorkspaceArrangementOptions): HandWorkspaceArrangementResult {
    this.cancelManualSelection()
    if (this.arrangementBaseline) {
      const restored = this.grouping.restoreSnapshot(this.arrangementBaseline)
      this.arrangementBaseline = null
      if (restored) return 'restored'
      this.grouping.restoreDefault({ direction: options.direction })
      this.grouping.stackMatchingRanks()
      return 'fallback-restored'
    }

    this.arrangementBaseline = this.grouping.getSnapshot()
    this.grouping.arrange({ direction: options.direction })
    this.grouping.autoGroup({ allowAceLowStraight: options.allowAceLowStraight })
    this.grouping.stackMatchingRanks()
    return 'arranged'
  }
}
