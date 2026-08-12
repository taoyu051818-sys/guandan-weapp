import type { Card, EngineState, HintProtectedGroup, MatchState, PlayerId, PlayValidation, RuleProfile, TributeState } from '../core/generated'
import { requestTableHandHint } from '../game/HandHintProtectionProjector'
import { canSelectPlayingHand } from '../game/HandInteractionPolicy'
import { handInteractionContext, HandInteractionStateMachine } from '../game/HandInteractionState'
import { projectHandRenderModel, type HandRenderModel } from '../game/HandRenderProjector'
import { HandWorkspace, type HandWorkspaceArrangementResult } from '../game/HandWorkspace'
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
  private readonly interaction = new HandInteractionStateMachine()
  private snapshot: TableHandSnapshot | null = null
  public constructor (private readonly dependencies: TableHandInteractionDependencies) {
    this.workspace = dependencies.workspace ?? new HandWorkspace()
  }

  public submit (snapshot: TableHandSnapshot): TableHandProjection {
    this.snapshot = snapshot
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    this.interaction.sync(handInteractionContext({ ...snapshot, ...snapshot.state, humanId, trustee: settings.trustee }))
    if (!this.interaction.isLocking && this.workspace.isManualSelectionActive) {
      this.workspace.cancelManualSelection()
    }
    const hand = snapshot.state.players[humanId].hand
    this.workspace.syncAuthoritativeHand(hand, {
      roundId: snapshot.state.roundId ?? 0,
      levelRank: snapshot.state.currentLevel,
      direction: settings.sortOrder,
      autoSort: settings.autoSort,
      ruleProfile: settings.ruleProfile,
    })
    return this.project(snapshot, humanId, settings)
  }

  public handleCardToggle (cardId: string): void {
    const snapshot = this.snapshot
    if (!snapshot) return
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    this.interaction.sync(handInteractionContext({ ...snapshot, ...snapshot.state, humanId, trustee: settings.trustee }))
    const mode = this.interaction.state.mode
    if (mode === 'play' || mode === 'tribute') {
      if (!this.canInteract(snapshot, humanId, settings)) return
      const stackCardIds = snapshot.phase === 'playing'
        ? this.workspace.playSelectionForCard(cardId)
        : []
      if (stackCardIds.length > 0) {
        const selected = this.dependencies.ruleAuthority.selectedCardIds
        const stackIsSelected = stackCardIds.every(stackCardId => selected.has(stackCardId))
        const nextSelected = new Set(selected)
        stackCardIds.forEach(stackCardId => {
          if (stackIsSelected) nextSelected.delete(stackCardId)
          else nextSelected.add(stackCardId)
        })
        this.dependencies.ruleAuthority.replaceSelectedCards(Array.from(nextSelected))
      } else {
        this.dependencies.ruleAuthority.toggleCard(cardId)
      }
      return
    }
    if (mode !== 'lock-create' && mode !== 'lock-unlock') return
    const result = this.workspace.toggleManualCard(cardId)
    if (result === 'unlock-selected') this.interaction.selectUnlock()
    else if (result === 'selected' || result === 'deselected') this.interaction.selectLockCreate()
    if (result === 'locked') this.dependencies.showToast('请先完成当前锁牌选择')
    if (result === 'unlock-selected') this.dependencies.showToast('已选中锁牌组合，点击“解锁”拆分')
    this.dependencies.refresh()
  }

  public playSelected (): void {
    const snapshot = this.snapshot
    if (!snapshot) return
    if (this.interaction.isLocking) {
      this.dependencies.showToast('请先完成或取消锁牌')
      return
    }
    if (!snapshot.playValidation.canPlay) {
      this.dependencies.showToast(this.dependencies.validationHint(snapshot.playValidation))
    }
    this.dependencies.captureSelectedOrigins(this.dependencies.ruleAuthority.selectedCardIds)
    this.dependencies.ruleAuthority.playSelected()
  }

  public handleHint (): void {
    if (this.interaction.isLocking) {
      this.dependencies.showToast('请先完成或取消锁牌')
      return
    }
    const humanId = this.dependencies.getHumanId()
    requestTableHandHint(this.snapshot, humanId, this.dependencies.getRuntimeSettings(humanId),
      this.workspace, this.dependencies.ruleAuthority.hint.bind(this.dependencies.ruleAuthority))
  }

  public canInteractWithCurrentHand (): boolean {
    const snapshot = this.snapshot
    if (!snapshot) return false
    const humanId = this.dependencies.getHumanId()
    return this.canInteract(snapshot, humanId, this.dependencies.getRuntimeSettings(humanId))
  }

  public handleArrangeIntent (): HandWorkspaceArrangementResult | null {
    if (!this.snapshot) return null
    if (this.interaction.isLocking) {
      this.dependencies.showToast('请先完成或取消锁牌')
      return null
    }
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    const result = this.workspace.toggleArrangement({
      direction: settings.sortOrder,
      allowAceLowStraight: settings.ruleProfile.allowA2345Straight,
    })
    this.dependencies.refresh()
    return result
  }

  /** A lit suit selects its deterministic five-card straight-flush candidate. */
  public handleSuitIntent (suit: StraightFlushSuit | null): void {
    if (!suit) {
      this.cancelManualSelection()
      return
    }
    const snapshot = this.snapshot
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    if (!snapshot || !this.canEnterGrouping(snapshot, humanId, settings)) {
      this.workspace.cancelManualSelection()
      this.dependencies.showToast('当前阶段不能选择同花顺锁牌')
      this.dependencies.refresh()
      return
    }
    if (!this.interaction.startLock()) return
    if (!this.workspace.selectStraightFlush(suit, { allowAceLowStraight: settings.ruleProfile.allowA2345Straight })) {
      this.interaction.finishLock()
      this.dependencies.showToast('当前花色没有可组成的同花顺')
      this.dependencies.refresh()
      return
    }
    this.clearCurrentTurnRuleSelection(snapshot, humanId)
    this.dependencies.refresh()
  }

  /** Executes the one action currently projected by the lock draft state. */
  public handleLockAction (): void {
    const snapshot = this.snapshot
    if (!snapshot) {
      this.dependencies.refresh()
      return
    }
    const humanId = this.dependencies.getHumanId()
    const settings = this.dependencies.getRuntimeSettings(humanId)
    this.interaction.sync(handInteractionContext({ ...snapshot, ...snapshot.state, humanId, trustee: settings.trustee }))
    const action = this.interaction.isLocking ? this.workspace.lockAction(settings.ruleProfile) : 'start'
    if (action !== 'cancel' && !this.canEnterGrouping(snapshot, humanId, settings)) {
      this.workspace.cancelManualSelection()
      this.interaction.finishLock()
      this.dependencies.showToast('当前阶段不能锁牌')
      this.dependencies.refresh()
      return
    }
    if (action === 'start') {
      if (!this.interaction.startLock()) {
        this.dependencies.showToast('当前阶段不能锁牌')
        this.dependencies.refresh()
        return
      }
      this.workspace.beginManualSelection()
      this.clearCurrentTurnRuleSelection(snapshot, humanId)
      this.dependencies.refresh()
      return
    }

    if (action === 'cancel') {
      this.cancelManualSelection()
      return
    }
    try {
      const changed = this.workspace.commitManualSelection(settings.ruleProfile, { allowAceLowStraight: settings.ruleProfile.allowA2345Straight })
      this.interaction.finishLock()
      if (changed) this.dependencies.showToast(action === 'unlock' ? '已解锁牌组' : '已锁定牌组')
    } catch (error) {
      this.workspace.cancelManualSelection()
      this.interaction.finishLock()
      this.dependencies.showNotice('无法锁牌', error instanceof Error ? error.message : '手牌状态已变更')
    }
    this.dependencies.refresh()
  }

  public cancelManualSelection (refresh = true): void {
    this.workspace.cancelManualSelection()
    this.interaction.finishLock()
    if (refresh) this.dependencies.refresh()
  }

  public invalidateAuthoritativeHand (): void {
    this.workspace.invalidateAuthoritativeHand()
  }

  public resetForRound (): void {
    this.snapshot = null
    this.interaction.reset()
    this.workspace.resetForRound()
  }

  public resetForTableExit (): void {
    this.snapshot = null
    this.interaction.reset()
    this.workspace.resetForTableExit()
  }

  private project (
    snapshot: TableHandSnapshot,
    humanId: PlayerId,
    settings: TableHandRuntimeSettings,
  ): TableHandProjection {
    const grouping = this.workspace.snapshot
    const mode = this.interaction.state.mode
    return projectHandRenderModel({
      hand: snapshot.state.players[humanId].hand,
      mode,
      playSelectedCardIds: mode === 'play' || mode === 'tribute' ? snapshot.selectedCardIds.slice() : [],
      lockDraftCardIds: this.interaction.isLocking ? this.workspace.selectedCardIds : [],
      sortOrder: settings.sortOrder,
      interactive: this.interaction.isLocking || this.canInteract(snapshot, humanId, settings),
      grouping,
      lockedCardIds: this.workspace.lockedCardIds,
      availableSuits: this.workspace.straightFlushAvailability({
        allowAceLowStraight: settings.ruleProfile.allowA2345Straight,
      }).filter(item => item.available).map(item => item.suit),
      selectedSuit: this.workspace.selectedSuit,
      lockAction: this.workspace.lockAction(settings.ruleProfile),
      arrangeRestoreAvailable: this.workspace.canRestoreArrangement,
    })
  }

  private canInteract (
    snapshot: TableHandSnapshot,
    humanId: PlayerId,
    settings: TableHandRuntimeSettings,
  ): boolean {
    if (snapshot.actionPending || settings.trustee) return false
    if (snapshot.phase === 'playing') {
      return canSelectPlayingHand(snapshot.state, humanId, snapshot.actionPending)
    }
    if (snapshot.phase !== 'tribute' || !snapshot.tribute || snapshot.tribute.isAntiTribute || snapshot.tribute.phase === 'done') return false
    if (settings.multiplayer && settings.deadlinePlayerId !== humanId) return false
    return snapshot.tribute.phase === 'tributing'
      ? snapshot.tribute.actions.some(action => action.from === humanId && !action.card)
      : snapshot.tribute.actions.some(action => action.to === humanId && !action.returnCard)
  }

  private canEnterGrouping (
    snapshot: TableHandSnapshot,
    humanId: PlayerId,
    settings: TableHandRuntimeSettings,
  ): boolean {
    return snapshot.phase === 'playing' && !settings.trustee && !snapshot.actionPending &&
      !snapshot.state.finishedPlayers.includes(humanId)
  }

  /** Clears rule selection only when changing modes during a legal local action window. */
  private clearCurrentTurnRuleSelection (snapshot: TableHandSnapshot, humanId: PlayerId): void {
    if (canSelectPlayingHand(snapshot.state, humanId, snapshot.actionPending)) {
      this.dependencies.ruleAuthority.clearRuleSelection()
    }
  }
}
