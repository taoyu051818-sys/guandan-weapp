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

export type HandWorkspaceArrangementResult = 'arranged' | 'restored' | 'fallback-restored'
export type HandLockUnavailableReason =
  | 'empty-selection' | 'stale-selection' | 'invalid-combination'
  | 'partial-lock' | 'mixed-selection' | 'interaction-blocked'

/** One presentation decision shared by the toolbar, feedback and mutation validation. */
export type HandLockDecision =
  | Readonly<{ kind: 'lock' | 'unlock' }>
  | Readonly<{ kind: 'unavailable', reason: HandLockUnavailableReason }>

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

  public get snapshot (): HandGroupingSnapshot { return this.grouping.getSnapshot() }
  public get lockedCardIds (): string[] {
    return this.snapshot.groups.filter(group => group.locked).flatMap(group => group.cardIds)
  }
  public get canRestoreArrangement (): boolean { return this.arrangementState.mode === 'smart-arranged' }

  /** Returns true only when a new authoritative hand was applied. */
  public syncAuthoritativeHand (hand: readonly Card[], options: HandWorkspaceSyncOptions): boolean {
    if (this.authorityRoundId !== null && this.authorityRoundId !== options.roundId) {
      this.grouping.reset()
      this.arrangementState = { mode: 'point-stacked' }
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
    this.grouping.reset()
  }

  public resetForTableExit (): void {
    this.resetForRound()
  }

  /** One selection drives both the button and its mutation. No separate lock-edit mode. */
  public getLockDecision (ruleProfile: RuleProfile, cardIds: readonly string[] = []): HandLockDecision {
    if (!cardIds.length) return { kind: 'unavailable', reason: 'empty-selection' }
    const selected = new Set(cardIds)
    const snapshot = this.snapshot
    if (selected.size !== cardIds.length || cardIds.some(id => !snapshot.handCardIds.includes(id))) {
      return { kind: 'unavailable', reason: 'stale-selection' }
    }
    const locked = snapshot.groups.filter(group => group.locked && group.cardIds.some(id => selected.has(id)))
    if (locked.length) {
      const members = locked.flatMap(group => group.cardIds)
      if (!members.every(id => selected.has(id))) return { kind: 'unavailable', reason: 'partial-lock' }
      return members.length === selected.size ? { kind: 'unlock' } : { kind: 'unavailable', reason: 'mixed-selection' }
    }
    return this.grouping.canCreateLockedGroup(cardIds, ruleProfile)
      ? { kind: 'lock' } : { kind: 'unavailable', reason: 'invalid-combination' }
  }

  public applySelectionLock (cardIds: readonly string[], ruleProfile: RuleProfile): boolean {
    const decision = this.getLockDecision(ruleProfile, cardIds)
    if (decision.kind === 'unavailable') return false
    if (decision.kind === 'unlock') {
      const selected = new Set(cardIds)
      this.snapshot.groups.filter(group => group.locked && group.cardIds.every(id => selected.has(id)))
        .forEach(group => this.grouping.splitGroup(group.id))
    } else {
      this.grouping.createLockedGroup(cardIds, ruleProfile)
    }
    this.reprojectAfterLockChange(true, ruleProfile, {})
    return true
  }

  public straightFlushCardIds (
    suit: StraightFlushSuit,
    options: Partial<Pick<HandSuggestionOptions, 'allowAceLowStraight'>> = {},
  ): string[] {
    return this.grouping.selectStraightFlush(suit, options)?.cardIds.slice() ?? []
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
