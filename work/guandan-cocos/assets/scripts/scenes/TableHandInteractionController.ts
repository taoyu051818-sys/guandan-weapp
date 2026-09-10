import type { EngineState, HintProtectedGroup, MatchState, PlayerId, PlayValidation, RuleProfile, TributeState } from '../core/generated'
import { requestTableHandHint } from '../game/HandHintProtectionProjector'
import { resolveHandCapabilities } from '../game/HandInteractionPolicy'
import { projectHandRenderModel, type HandRenderModel } from '../game/HandRenderProjector'
import { HandWorkspace, type HandLockUnavailableReason, type HandWorkspaceArrangementResult } from '../game/HandWorkspace'
import type { HandSortDirection, StraightFlushSuit } from '../game/HandArrangement'
export type TableHandSnapshot = Readonly<{
  state: Pick<EngineState, 'currentLevel' | 'ruleProfile' | 'players' | 'currentTurn' | 'finishedPlayers'> &
    Partial<Pick<MatchState, 'roundId'>>
  selectedCardIds: readonly string[]
  actionPending: boolean
  playValidation: PlayValidation
  phase: 'playing' | 'tribute' | 'settlement'
  tribute: TributeState | null
}>
export type TableHandRuntimeSettings = Readonly<{
  sortOrder: HandSortDirection
  autoSort: boolean
  ruleProfile: RuleProfile
  multiplayer: boolean
  trustee: boolean
  deadlinePlayerId: PlayerId | null
}>
export interface TableHandRuleAuthority {
  readonly selectedCardIds: ReadonlySet<string>
  toggleCard: (cardId: string) => void
  replaceSelectedCards: (cardIds: readonly string[]) => void
  clearRuleSelection: () => void
  hint: (protectedGroups: readonly HintProtectedGroup[]) => void
  playSelected: () => void
}

export type TableHandProjection = HandRenderModel

const lockUnavailableHints: Readonly<Record<HandLockUnavailableReason, string>> = {
  'empty-selection': '请先选择要锁定的组合牌',
  'stale-selection': '手牌已更新，请重新选择',
  'invalid-combination': '请选择未锁定的合法组合牌',
  'partial-lock': '请选择完整的已锁牌组后恢复',
  'mixed-selection': '请单独选择未锁定的组合，或完整的已锁牌组',
  'interaction-blocked': '当前阶段不能锁牌',
}

export type TableHandInteractionDependencies = Readonly<{
  ruleAuthority: TableHandRuleAuthority
  getHumanId: () => PlayerId
  getRuntimeSettings: (humanId: PlayerId) => TableHandRuntimeSettings
  refresh: () => void
  showToast: (message: string) => void
  showNotice: (title: string, detail: string) => void
  validationHint: (validation: PlayValidation) => string
  captureSelectedOrigins: (cardIds: Iterable<string>) => void
  workspace?: HandWorkspace
}>

export class TableHandInteractionController {
  private readonly workspace: HandWorkspace
  private snapshot: TableHandSnapshot | null = null
  private selectedSuit: StraightFlushSuit | null = null
  public constructor (private readonly dependencies: TableHandInteractionDependencies) {
    this.workspace = dependencies.workspace ?? new HandWorkspace()
  }

  public submit (snapshot: TableHandSnapshot): TableHandProjection {
    this.snapshot = snapshot
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    const hand = snapshot.state.players[humanId].hand
    const changed = this.workspace.syncAuthoritativeHand(hand, {
      roundId: snapshot.state.roundId ?? 0,
      levelRank: snapshot.state.currentLevel,
      direction: settings.sortOrder,
      autoSort: settings.autoSort,
      ruleProfile: settings.ruleProfile,
    })
    if (changed) this.selectedSuit = null
    return this.project(snapshot, humanId, settings)
  }

  public handleCardToggle (cardId: string, desiredSelected?: boolean): void {
    const snapshot = this.snapshot
    if (!snapshot) return
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    this.selectedSuit = null
    if (resolveHandCapabilities(snapshot, humanId, settings).canSelect) {
      const stackCardIds = snapshot.phase === 'playing'
        ? this.workspace.playSelectionForCard(cardId)
        : []
      if (stackCardIds.length > 0) {
        const selected = this.dependencies.ruleAuthority.selectedCardIds
        const deselect = desiredSelected === undefined
          ? stackCardIds.every(stackCardId => selected.has(stackCardId)) : !desiredSelected
        const nextSelected = new Set(selected)
        stackCardIds.forEach(stackCardId => {
          if (deselect) nextSelected.delete(stackCardId)
          else nextSelected.add(stackCardId)
        })
        this.dependencies.ruleAuthority.replaceSelectedCards(Array.from(nextSelected))
      } else {
        if (desiredSelected === undefined || this.dependencies.ruleAuthority.selectedCardIds.has(cardId) !== desiredSelected) {
          this.dependencies.ruleAuthority.toggleCard(cardId)
        }
      }
      return
    }
  }

  public playSelected (): void {
    const snapshot = this.snapshot
    if (!snapshot) return
    const humanId = this.dependencies.getHumanId()
    if (!resolveHandCapabilities(snapshot, humanId, this.dependencies.getRuntimeSettings(humanId)).canPlay) return
    if (!snapshot.playValidation.canPlay) {
      this.dependencies.showToast(this.dependencies.validationHint(snapshot.playValidation))
    }
    this.dependencies.captureSelectedOrigins(this.dependencies.ruleAuthority.selectedCardIds)
    this.dependencies.ruleAuthority.playSelected()
  }

  public handleHint (): void {
    const humanId = this.dependencies.getHumanId()
    requestTableHandHint(this.snapshot, humanId, this.dependencies.getRuntimeSettings(humanId),
      this.workspace, this.dependencies.ruleAuthority.hint.bind(this.dependencies.ruleAuthority))
  }

  public canInteractWithCurrentHand (): boolean {
    const snapshot = this.snapshot
    if (!snapshot) return false
    const humanId = this.dependencies.getHumanId()
    return resolveHandCapabilities(snapshot, humanId, this.dependencies.getRuntimeSettings(humanId)).canSelect
  }

  public handleArrangeIntent (): HandWorkspaceArrangementResult | null {
    if (!this.snapshot) return null
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    if (!resolveHandCapabilities(this.snapshot, humanId, settings).canArrange) return null
    if (!settings.autoSort) {
      this.dependencies.showToast('本好友房已关闭一键理牌')
      return null
    }
    const result = this.workspace.toggleArrangement({
      direction: settings.sortOrder,
      allowAceLowStraight: settings.ruleProfile.allowA2345Straight,
    })
    this.dependencies.refresh()
    return result
  }

  /** Suit shortcuts populate the same rule selection as ordinary card taps. */
  public handleSuitIntent (suit: StraightFlushSuit | null): void {
    if (!suit) {
      this.dependencies.ruleAuthority.clearRuleSelection()
      this.clearSuitPreview()
      return
    }
    const snapshot = this.snapshot
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    if (!snapshot || !resolveHandCapabilities(snapshot, humanId, settings).canGroup) {
      this.dependencies.showToast('当前阶段不能选择同花顺')
      return
    }
    const ids = this.workspace.straightFlushCardIds(suit, { allowAceLowStraight: settings.ruleProfile.allowA2345Straight })
    if (!ids.length) {
      this.dependencies.showToast('当前花色没有可组成的同花顺')
      return
    }
    this.selectedSuit = suit
    this.dependencies.ruleAuthority.replaceSelectedCards(ids)
    this.dependencies.refresh()
  }

  /** Lock or restore the current visible selection in one click. */
  public handleLockAction (): void {
    const snapshot = this.snapshot
    if (!snapshot) return
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    const selected = Array.from(this.dependencies.ruleAuthority.selectedCardIds)
    const decision = resolveHandCapabilities(snapshot, humanId, settings).canGroup
      ? this.workspace.getLockDecision(settings.ruleProfile, selected)
      : { kind: 'unavailable', reason: 'interaction-blocked' } as const
    if (decision.kind === 'unavailable') {
      this.dependencies.showToast(lockUnavailableHints[decision.reason])
      return
    }
    try {
      if (this.workspace.applySelectionLock(selected, settings.ruleProfile)) {
        this.selectedSuit = null
        this.dependencies.showToast(decision.kind === 'unlock' ? '已恢复牌组，可单张选择' : '已锁定牌组')
      }
    } catch (error) {
      this.dependencies.showNotice('无法锁牌', error instanceof Error ? error.message : '手牌状态已变更')
    }
    this.dependencies.refresh()
  }

  /** Clears only the transient suit highlight; selections belong to ruleAuthority. */
  public clearSuitPreview (refresh = true): void {
    this.selectedSuit = null
    if (refresh) this.dependencies.refresh()
  }

  public invalidateAuthoritativeHand (): void {
    this.workspace.invalidateAuthoritativeHand()
  }

  public resetForRound (): void {
    this.snapshot = null
    this.selectedSuit = null
    this.workspace.resetForRound()
  }

  public resetForTableExit (): void {
    this.snapshot = null
    this.selectedSuit = null
    this.workspace.resetForTableExit()
  }

  private project (
    snapshot: TableHandSnapshot,
    humanId: PlayerId,
    settings: TableHandRuntimeSettings,
  ): TableHandProjection {
    const grouping = this.workspace.snapshot
    const capabilities = resolveHandCapabilities(snapshot, humanId, settings)
    const mode = capabilities.interaction.mode
    return projectHandRenderModel({
      hand: snapshot.state.players[humanId].hand,
      mode,
      playSelectedCardIds: mode === 'play' || mode === 'tribute' ? snapshot.selectedCardIds.slice() : [],
      sortOrder: settings.sortOrder,
      interactive: capabilities.canSelect,
      grouping,
      lockedCardIds: this.workspace.lockedCardIds,
      availableSuits: this.workspace.straightFlushAvailability({
        allowAceLowStraight: settings.ruleProfile.allowA2345Straight,
      }).filter(item => item.available).map(item => item.suit),
      selectedSuit: this.selectedSuit,
      lockDecision: capabilities.canGroup
        ? this.workspace.getLockDecision(settings.ruleProfile, snapshot.selectedCardIds)
        : { kind: 'unavailable', reason: 'interaction-blocked' },
      arrangeRestoreAvailable: this.workspace.canRestoreArrangement,
    })
  }

}
