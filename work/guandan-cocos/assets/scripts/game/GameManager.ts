import { _decorator, Component } from 'cc'
import { diagnosePlay, getRuleProfile, type HintProtectedGroup } from '../core/generated'
import type { Card, EngineState, PlayerId, PlayValidation, Rank, RuleProfile, SettlementResult, Team, TributeState } from '../core/generated'
import { GameSession } from '../session/GameSession'
import { LobbyController, type LobbyNetworkResult, type NetworkViewerRoundStats } from '../network/LobbyController'
import { LocalHandSelectionController, playValidationHint } from './LocalHandSelectionController'
import { NetworkMatchSnapshotController } from './NetworkMatchSnapshotController'
import { NetworkActionController } from './NetworkActionController'
import { createGameManagerProjection, type GameManagerProjection } from './GameManagerProjection'

export type GameSnapshot = {
  state: EngineState
  selectedCardIds: string[]
  actionPending: boolean
  hint: string
  playValidation: PlayValidation
  phase: 'playing' | 'tribute' | 'settlement'
  teamLevels: Record<Team, Rank>
  scores: Record<Team, number>
  tribute: TributeState | null
  settlement: SettlementResult | null
}

export { playValidationHint } from './LocalHandSelectionController'

const { ccclass, property } = _decorator

/**
 * Cocos side's single source of interactive round state.  Network clients
 * replace `state` only with snapshots validated by the server.
 */
@ccclass('GameManager')
export class GameManager extends Component {
  @property(GameSession)
  public session: GameSession | null = null

  @property(LobbyController)
  public lobby: LobbyController | null = null
  public state!: EngineState
  private projection: GameManagerProjection = createGameManagerProjection()
  private readonly selection = new LocalHandSelectionController()
  private networkActions: NetworkActionController | null = null
  private readonly networkSnapshots = new NetworkMatchSnapshotController({
    getState: () => this.state,
    getProjection: () => this.projection,
    getRoomId: () => this.session?.snapshot.roomId ?? null,
    getHumanId: () => this.humanId,
    commit: (state, projection) => { this.state = state; this.projection = projection },
    clearSelection: () => this.selection.clear(),
    cancelPendingAction: () => this.networkActionController.cancel(),
    setSessionPhase: phase => {
      if (phase === 'playing') this.session?.beginPlay()
      else if (phase === 'tribute') this.session?.beginTribute()
      else this.session?.beginSettlement()
    },
    recordRound: ({ settlement, wasFirst, bombCount, scores }) => {
      this.session?.recordRound(settlement.winnerTeam, wasFirst, bombCount, {
        levelUp: settlement.levelUp,
        currentLevel: settlement.currentLevel,
        teamLevels: settlement.teamLevels,
        scores,
      })
    },
    publishHint: hint => this.emitSnapshot(hint),
  })

  public toggleCard (cardId: string): void {
    this.emitSnapshot(this.selection.toggle(cardId, this.selectionContext))
  }

  /** Replaces the current choice in one snapshot, used by locked hand stacks. */
  public replaceSelectedCards (cardIds: readonly string[]): void {
    this.emitSnapshot(this.selection.replaceFromInput(cardIds, this.selectionContext))
  }

  public playSelected (): void {
    if (this.actionPending || this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    const cards = this.selectedCards()
    const validation = diagnosePlay(cards, this.state.lastValidPlay, this.ruleProfile)
    if (!validation.canPlay) return this.emitSnapshot(playValidationHint(validation))
    this.beginNetworkAction('', 'play', () => this.lobby?.play(cards.map(card => card.id)) ?? null)
  }

  public pass (): void {
    if (this.actionPending || this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    if (!this.state.lastValidPlay) return this.emitSnapshot('当前不能不要')
    this.beginNetworkAction('', 'pass', () => this.lobby?.pass() ?? null)
  }

  /** Cycles legal human plays, preserving the desktop HandArea hint behavior. */
  public hint (protectedGroups: readonly HintProtectedGroup[] = []): void {
    const hint = this.selection.hint(this.selectionContext, protectedGroups)
    if (hint !== null) this.emitSnapshot(hint)
  }

  /** Clears a live rule selection when switching into a presentation-only grouping mode. */
  public clearRuleSelection (): void {
    if (this.actionPending) return
    this.selection.clear()
    this.emitSnapshot('')
  }

  /** Retires pending network interaction before leaving the table. */
  public abortRound (): void {
    this.unscheduleAllCallbacks()
    this.selection.clear()
    this.networkActionController.cancel()
    this.networkSnapshots.reset()
    this.projection = createGameManagerProjection()
  }

  /** Called by the WebSocket adapter after service-authoritative state sync. */
  public applyServerState (state: EngineState, hint = '已同步服务器状态'): void {
    this.networkSnapshots.applyServerState(state, hint)
  }

  public applyNetworkRoundPrepared (state: EngineState, tribute: TributeState | null): void {
    this.networkSnapshots.applyRoundPrepared(state, tribute)
  }

  public applyNetworkRoundEnded (result: SettlementResult, state: EngineState | null = null, viewerRoundStats?: NetworkViewerRoundStats,
    eventIdentity?: Readonly<{ roomId: string, version: number, gameVersion: number }>): void {
    this.networkSnapshots.applyRoundEnded(result, state, viewerRoundStats, eventIdentity)
  }

  public confirmTribute (): void {
    if (this.actionPending || this.phase !== 'tribute' || !this.tribute || this.tribute.isAntiTribute) return
    try {
      const cards = this.selectedCards()
      if (cards.length !== 1) throw new Error('请选择一张牌')
      const action = this.tribute.phase === 'tributing'
        ? this.tribute.actions.find(item => item.from === this.humanId && !item.card)
        : this.tribute.actions.find(item => item.to === this.humanId && !item.returnCard)
      if (!action) throw new Error('当前等待其他玩家操作')
      const requestType = this.tribute.phase === 'tributing' ? 'tribute' : 'returnTribute'
      this.beginNetworkAction('', requestType, () => requestType === 'tribute'
        ? this.lobby?.tribute(cards[0].id) ?? null
        : this.lobby?.returnTribute(cards[0].id) ?? null)
    } catch (error) {
      this.emitSnapshot(error instanceof Error ? error.message : '贡还失败')
    }
  }

  public finishTribute (): void {
    if (this.actionPending || this.phase !== 'tribute' || !this.tribute || (!this.tribute.isAntiTribute && this.tribute.phase !== 'done')) return
    this.beginNetworkAction('正在等待服务器开始本局…', 'finishTribute', () => this.lobby?.finishTribute() ?? null)
  }

  /** Restores interaction after a rejected or failed network intent. */
  public applyNetworkError (message: string): void {
    this.networkActionController.fail(message)
  }

  /** Only the rejection matching the active request may unlock its UI. */
  public applyNetworkResult (result: LobbyNetworkResult): void {
    this.networkActionController.applyResult({ ...result, message: result.message ?? '' })
  }

  private selectedCards (): Card[] {
    return this.selection.selectedCards(this.state, this.humanId)
  }

  private beginNetworkAction (hint: string, requestType: string, submit: () => number | null): boolean {
    const snapshot = this.lobby?.snapshot
    return this.networkActionController.begin({
      connected: snapshot?.connected ?? false,
      roomId: snapshot?.roomId ?? null,
      roomStatus: snapshot?.roomStatus ?? 'offline',
    }, hint, requestType, submit)
  }

  private emitSnapshot (hint: string): void {
    const playValidation = diagnosePlay(this.phase === 'playing' ? this.selectedCards() : [], this.state.lastValidPlay, this.ruleProfile)
    this.node.emit('guandan:state', {
      state: this.state,
      selectedCardIds: Array.from(this.selectedCardIds),
      actionPending: this.actionPending,
      hint,
      playValidation,
      phase: this.phase,
      teamLevels: this.teamLevels,
      scores: this.scores,
      tribute: this.tribute,
      settlement: this.settlement,
    } satisfies GameSnapshot)
  }

  private get ruleProfile (): RuleProfile {
    return this.state?.ruleProfile ?? this.session?.ruleProfile ?? getRuleProfile('classic')
  }

  private get networkActionController (): NetworkActionController {
    if (!this.networkActions) {
      this.networkActions = new NetworkActionController(
        (callback, delaySeconds) => this.scheduleOnce(callback, delaySeconds),
        hint => this.emitSnapshot(hint),
      )
    }
    return this.networkActions
  }

  private get humanId (): PlayerId { return this.session?.snapshot.myPlayerId ?? 'p1' }
  public get phase (): GameManagerProjection['phase'] { return this.projection.phase }
  public get teamLevels (): Record<Team, Rank> { return { ...this.projection.teamLevels } }
  public get aFailStreaks (): Record<Team, number> { return { ...this.projection.aFailStreaks } }
  public get scores (): Record<Team, number> { return { ...this.projection.scores } }
  public get lastRoundRank (): PlayerId[] { return [...this.projection.lastRoundRank] }
  public get tribute (): TributeState | null { return this.projection.tribute }
  public get settlement (): SettlementResult | null { return this.projection.settlement }
  public get selectedCardIds (): ReadonlySet<string> { return this.selection.selectedCardIds }
  public get actionPending (): boolean { return this.networkActions?.pending ?? false }

  private get selectionContext () {
    return {
      state: this.state,
      humanId: this.humanId,
      actionPending: this.actionPending,
      phase: this.phase,
      tribute: this.tribute,
    } as const
  }
}
