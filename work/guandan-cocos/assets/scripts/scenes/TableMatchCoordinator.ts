import { Label, Node, Vec3, tween } from 'cc'
import type { PlayerId } from '../core/generated'
import type { CocosAudioController } from '../audio/CocosAudioController'
import type { EffectController } from '../effects/EffectController'
import type { GameManager, GameSnapshot } from '../game/GameManager'
import type { HandInteractionMode } from '../game/HandInteractionState'
import type { LobbyController, LobbyNetworkResult, LobbySnapshot, NetworkMatchEnded, NetworkRoundEndedPacket, NetworkRoundPacket, NetworkStatePacket } from '../network/LobbyController'
import type { GameSession } from '../session/GameSession'
import type { HandController } from '../ui/HandController'
import type { PlayAreaController } from '../ui/PlayAreaController'
import type { PlayerSeatController } from '../ui/PlayerSeatController'
import { tableHintToast } from '../ui/TablePromptPolicy'
import type { FrontPageController } from './FrontPageController'
import { projectMatchEndedPresentation } from './MatchEndedPresentation'
import type { TableHandInteractionController } from './TableHandInteractionController'
import type { TableHudPresenter } from './TableHudPresenter'
import { TableNetworkEventBridge } from './TableNetworkEventBridge'
import type { TableOverlayController } from './TableOverlayController'
import { projectTableViewer, projectTributeEffectTokens } from './TableSnapshotPresenter'
import type { TableTurnClockController } from './TableTurnClockController'

type TableMatchControls = Readonly<{
  hint: Node | null
  pass: Node | null
  play: Node | null
  confirmTribute: Node | null
  finishTribute: Node | null
  nextRound: Node | null
  trustee: Node | null
  hintLabel: Label | null
  phaseLabel: Label | null
  levelLabel: Label | null
  overlayLabel: Label | null
}>

export type TableMatchCoordinatorDependencies = Readonly<{
  session: GameSession
  manager: GameManager
  lobby: LobbyController
  audio: CocosAudioController
  effects: EffectController
  hand: HandController
  playArea: PlayAreaController
  playerSeats: ReadonlyMap<string, PlayerSeatController>
  frontPages: FrontPageController
  overlays: TableOverlayController
  turnClock: TableTurnClockController
  handInteraction: TableHandInteractionController
  hud: TableHudPresenter
  controls: TableMatchControls
  controlsY: () => number
  layoutSeats: (humanId: PlayerId) => void
  setTableVisible: (visible: boolean) => void
  setFriendRoomWaitingVisible: (visible: boolean) => void
}>

const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']

/** Coordinates authoritative match packets and their short-lived table presentation. */
export class TableMatchCoordinator {
  private latest: GameSnapshot | null = null
  private lastPhase: GameSnapshot['phase'] | null = null
  private lastTurn: PlayerId | null = null
  private previousFinishedPlayers: PlayerId[] = []
  private readonly previousHandCounts = new Map<PlayerId, number>()
  private previousTributeEffects = new Set<string>()
  private lastPresentedHint = ''
  private suppressNextSettlementEffect = false
  private mounted = false
  private disposed = false
  private readonly networkEvents: TableNetworkEventBridge

  public constructor (private readonly dependencies: TableMatchCoordinatorDependencies) {
    this.networkEvents = new TableNetworkEventBridge(dependencies.lobby.events, {
      onLobby: snapshot => this.renderLobby(snapshot),
      onNetworkState: packet => this.applyNetworkState(packet),
      onRoundPrepared: packet => this.applyNetworkRoundPrepared(packet),
      onRoundEnded: packet => this.applyNetworkRoundEnded(packet),
      onMatchEnded: ended => this.applyNetworkMatchEnded(ended),
      onNetworkResult: result => this.applyNetworkResult(result),
      onNetworkError: message => this.applyNetworkError(message),
      onRoomClosed: (_message, options) => this.applyNetworkRoomClosed(options),
      onPresentationChanged: () => this.refresh(),
      onTurnTimeout: packet => this.applyNetworkTurnTimeout(packet),
    })
  }

  public get snapshot (): GameSnapshot | null { return this.latest }
  public get hasSnapshot (): boolean { return Boolean(this.latest) }

  public mount (): void {
    if (this.mounted || this.disposed) return
    this.mounted = true
    this.dependencies.manager.node.on('guandan:state', this.render, this)
    this.dependencies.controls.nextRound?.on(Node.EventType.TOUCH_END, this.handleNextRound, this)
    this.dependencies.controls.trustee?.on(Node.EventType.TOUCH_END, this.toggleTrustee, this)
    this.networkEvents.mount()
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.networkEvents.dispose()
    if (this.mounted) {
      this.dependencies.manager.node.off('guandan:state', this.render, this)
      this.dependencies.controls.nextRound?.off(Node.EventType.TOUCH_END, this.handleNextRound, this)
      this.dependencies.controls.trustee?.off(Node.EventType.TOUCH_END, this.toggleTrustee, this)
    }
    this.mounted = false
    this.clearPresentationState()
  }

  public readonly render = (snapshot: GameSnapshot): void => {
    if (this.disposed) return
    this.latest = snapshot
    const { session, handInteraction, hand, effects, playArea, playerSeats, overlays, lobby, controls, hud } = this.dependencies
    const humanId = session.snapshot.myPlayerId ?? 'p1'
    const handProjection = handInteraction.submit(snapshot)
    hand.render(
      handProjection.hand, handProjection.playSelectedCardIds, handProjection.sortOrder, handProjection.interactive,
      handProjection.displayCardIds, handProjection.groups, handProjection.lockedCardIds,
      handProjection.lockDraftCardIds, handProjection.interactionMode,
    )
    const entranceCompletion = hand.consumeEntranceCompletion()
    if (entranceCompletion) effects.waitForPresentation(entranceCompletion, () => hand.finishEntrances())
    effects.syncActions(
      snapshot.state.playArea,
      humanId,
      id => playerSeats.get(id)?.getPlayOriginWorldPosition() ?? hand.node.worldPosition.clone(),
      id => playArea.getActionWorldPosition(id, humanId) ?? Vec3.ZERO,
      {
        deferAction: (action, actionIndex) => playArea.deferAction(action, actionIndex),
        beginAction: (action, actionIndex, ticket) => playArea.beginAction(action, actionIndex, ticket),
        revealCard: (action, actionIndex, cardId, ticket) => playArea.revealCard(action, actionIndex, cardId, ticket),
        revealAction: (action, actionIndex, ticket) => playArea.revealAction(action, actionIndex, ticket),
        resetPresentation: actionCount => playArea.resetPresentation(actionCount),
      },
    )
    playArea.render(snapshot.state.playArea, humanId, snapshot.state.lastValidPlay)
    this.dependencies.layoutSeats(humanId)
    this.renderTributeEffects(snapshot, humanId)
    PLAYER_IDS.forEach(id => {
      const seat = playerSeats.get(id)
      if (!seat) return
      seat.node.active = id !== humanId
      const ranking = snapshot.settlement?.fullRank ?? snapshot.state.finishedPlayers
      const finishPlace = ranking.indexOf(id) + 1
      if (id !== humanId) seat.render(
        snapshot.state.players[id], snapshot.state.currentTurn === id, snapshot.state.players[humanId].team,
        session.snapshot.gameMode === 'double_open' && this.oppositeOf(humanId) === id,
        overlays.chatMessage(id), finishPlace,
      )
    })
    this.syncSeatConnections(lobby.snapshot)
    this.renderProgressNotifications(snapshot, humanId)
    const humanFinished = snapshot.state.finishedPlayers.includes(humanId)
    if (controls.hintLabel) controls.hintLabel.node.active = false
    if (controls.phaseLabel) controls.phaseLabel.node.active = false
    this.presentHint(snapshot)
    const teamLevels = lobby.snapshot.scoreboard?.teamLevels ?? snapshot.teamLevels
    const viewer = projectTableViewer(snapshot.state.players, humanId, teamLevels, snapshot.settlement?.winnerTeam ?? null)
    const matchEnded = lobby.snapshot.matchEnded ?? null
    if (controls.levelLabel) controls.levelLabel.string = viewer.levelLabel
    this.renderTrustee(snapshot, humanId, matchEnded)
    const isPlaying = snapshot.phase === 'playing'
    this.layoutActionControls(snapshot, humanId, humanFinished, handProjection.interactionMode)
    hud.render(snapshot, humanId, handProjection)
    this.renderPhaseOverlay(snapshot, humanId, viewer.settlementTitle, matchEnded, isPlaying)
    if (snapshot.phase !== this.lastPhase) {
      const previousPhase = this.lastPhase
      this.lastPhase = snapshot.phase
      if (!isPlaying && controls.overlayLabel) {
        controls.overlayLabel.node.setScale(new Vec3(0.82, 0.82, 1))
        tween(controls.overlayLabel.node).to(0.24, { scale: Vec3.ONE }, { easing: 'backOut' }).start()
      }
      if (snapshot.phase === 'settlement' && previousPhase !== 'settlement' && snapshot.settlement) {
        if (this.suppressNextSettlementEffect) this.suppressNextSettlementEffect = false
        else effects.playSettlement(Boolean(viewer.settlementWon), snapshot.settlement.levelUp)
      }
    }
    if (snapshot.state.currentTurn !== this.lastTurn) this.lastTurn = snapshot.state.currentTurn
    overlays.renderOwnChat()
  }

  public refresh (): void { if (this.latest && !this.disposed) this.render(this.latest) }

  public handleTableHidden (): void { this.lastPresentedHint = '' }

  public startMasterBotTest (): void {
    if (this.disposed) return
    const { session, manager, lobby, effects, frontPages } = this.dependencies
    if (lobby.snapshot.roomId) lobby.safeExit()
    manager.abortRound()
    this.clearPresentationState()
    effects.resetForRecovery(0)
    frontPages.hideAll()
    this.dependencies.setFriendRoomWaitingVisible(false)
    this.dependencies.setTableVisible(true)
    session.beginLocalGame('standard')
    manager.startRound()
  }

  public leaveTableToMenu (): void {
    if (this.disposed) return
    const { session, manager, lobby, overlays, turnClock, effects, handInteraction, frontPages } = this.dependencies
    const multiplayer = Boolean(session.snapshot.isMultiplayer)
    overlays.clearModal()
    manager.abortRound()
    this.clearPresentationState()
    turnClock.reset()
    effects.resetForRecovery(0)
    handInteraction.cancelManualSelection(false)
    if (multiplayer) lobby.safeExit()
    else session.leaveToMenu()
    frontPages.showMenu()
  }

  private applyNetworkState (packet: NetworkStatePacket): void {
    const { lobby, frontPages, handInteraction, manager, session } = this.dependencies
    if (packet.roomId !== lobby.snapshot.roomId) return
    frontPages.handoffFriendRoomReservation()
    frontPages.hideAll()
    this.dependencies.setTableVisible(true)
    if (packet.effectSync.mode === 'recovery') {
      this.prepareRecoveryVisualBaseline(packet.state, 'playing')
      handInteraction.invalidateAuthoritativeHand()
    }
    manager.applyServerState(packet.state, packet.state.currentTurn === (session.snapshot.myPlayerId ?? 'p1') ? '轮到你出牌' : '等待其他玩家')
  }

  private applyNetworkRoundPrepared (packet: NetworkRoundPacket): void {
    const { lobby, frontPages, audio, handInteraction, manager, effects } = this.dependencies
    if (packet.roomId !== lobby.snapshot.roomId) return
    frontPages.handoffFriendRoomReservation()
    const isLiveNextRound = this.latest?.phase === 'settlement' && packet.state.playArea.length === 0
    frontPages.hideAll()
    this.dependencies.setTableVisible(true)
    const shouldPlayOpening = packet.effectSync.mode !== 'recovery'
    if (shouldPlayOpening) this.previousTributeEffects.clear()
    else {
      this.prepareRecoveryVisualBaseline(packet.state, packet.tribute ? 'tribute' : 'playing')
      this.previousTributeEffects = projectTributeEffectTokens(packet.tribute)
    }
    if (isLiveNextRound) audio.playRoundStart()
    handInteraction.resetForRound()
    manager.applyNetworkRoundPrepared(packet.state, packet.tribute)
    if (shouldPlayOpening) effects.playRoundOpening(`本局打 ${String(packet.state.currentLevel)}`)
  }

  private applyNetworkRoundEnded (packet: NetworkRoundEndedPacket): void {
    this.dependencies.frontPages.handoffFriendRoomReservation()
    this.dependencies.setTableVisible(true)
    this.suppressNextSettlementEffect = packet.effectSync.mode === 'recovery'
    if (this.suppressNextSettlementEffect) this.lastPhase = 'settlement'
    this.dependencies.manager.applyNetworkRoundEnded(packet.result, packet.state ?? null, packet.viewerRoundStats, {
      roomId: packet.roomId,
      version: packet.version,
      gameVersion: packet.gameVersion,
    })
    this.suppressNextSettlementEffect = false
  }

  private applyNetworkMatchEnded (_ended: NetworkMatchEnded): void {
    this.dependencies.frontPages.handoffFriendRoomReservation()
    this.dependencies.turnClock.reset()
    this.dependencies.handInteraction.cancelManualSelection(false)
    this.refresh()
  }

  private applyNetworkError (message: string): void {
    const status = this.dependencies.session.snapshot.status
    if (!this.latest || status === 'menu' || status === 'lobby' || status === 'grouping' || status === 'dealing') return
    this.dependencies.manager.applyNetworkError(message)
  }

  private applyNetworkResult (result: LobbyNetworkResult): void { this.dependencies.manager.applyNetworkResult(result) }

  private applyNetworkRoomClosed (options?: { compensateReservation?: boolean }): void {
    const { overlays, manager, turnClock, effects, frontPages } = this.dependencies
    overlays.clearDialogs()
    manager.abortRound()
    this.clearPresentationState()
    turnClock.reset()
    effects.resetForRecovery(0)
    frontPages.showLobby(options?.compensateReservation !== false)
  }

  private applyNetworkTurnTimeout (packet: { playerId: PlayerId | null, enteredTrustee: boolean }): void {
    if (!packet.playerId) return
    const humanId = this.dependencies.session.snapshot.myPlayerId ?? 'p1'
    const name = packet.playerId === humanId ? '你' : this.latest?.state.players[packet.playerId].name ?? packet.playerId
    this.dependencies.overlays.showToast(packet.enteredTrustee ? `${name}连续超时，已进入托管` : `${name}操作超时，服务器已自动处理`)
    this.refresh()
  }

  private readonly handleNextRound = (): void => {
    const { lobby, session, manager, effects } = this.dependencies
    if (lobby.snapshot.matchEnded) { this.leaveTableToMenu(); return }
    if (this.latest?.settlement?.isGameWon && session.snapshot.isMultiplayer) { this.leaveTableToMenu(); return }
    if (session.snapshot.isMultiplayer) {
      const humanId = session.snapshot.myPlayerId ?? 'p1'
      if (lobby.snapshot.roundReadyPlayerIds?.includes(humanId)) lobby.cancelRoundReady()
      else lobby.readyNextRound()
      return
    }
    const before = this.latest?.phase
    manager.nextRound()
    if (before === 'settlement' && this.latest?.phase !== 'settlement') {
      this.previousTributeEffects.clear()
      effects.playRoundOpening(`本局打 ${String(this.latest?.state.currentLevel ?? '')}`.trim())
    }
  }

  private readonly toggleTrustee = (): void => {
    const { session, lobby } = this.dependencies
    if (!session.snapshot.isMultiplayer) return
    const humanId = session.snapshot.myPlayerId ?? 'p1'
    if (lobby.snapshot.trustees?.[humanId]) lobby.cancelTrustee()
    else lobby.setTrustee()
  }

  private renderLobby (snapshot: LobbySnapshot): void {
    this.dependencies.frontPages.renderLobby(snapshot)
    this.syncSeatConnections(snapshot)
    this.refresh()
  }

  private syncSeatConnections (snapshot?: LobbySnapshot): void {
    const multiplayerTable = Boolean(this.latest && this.dependencies.session.snapshot.isMultiplayer && snapshot?.roomId)
    PLAYER_IDS.forEach(id => {
      const seat = this.dependencies.playerSeats.get(id)
      if (!seat) return
      if (!multiplayerTable || !snapshot) seat.clearConnectionStatus()
      else seat.setOffline(!snapshot.members.includes(id))
    })
  }

  private prepareRecoveryVisualBaseline (state: NetworkStatePacket['state'], phase: GameSnapshot['phase']): void {
    this.dependencies.effects.resetForRecovery(state.playArea.length)
    this.previousFinishedPlayers = [...state.finishedPlayers]
    this.previousHandCounts.clear()
    PLAYER_IDS.forEach(id => this.previousHandCounts.set(id, state.players[id].hand.length))
    this.lastTurn = state.currentTurn
    this.lastPhase = phase
  }

  private presentHint (snapshot: GameSnapshot): void {
    if (snapshot.hint === this.lastPresentedHint) return
    this.lastPresentedHint = snapshot.hint
    const toast = tableHintToast(snapshot.hint, snapshot.phase)
    if (toast) this.dependencies.overlays.showToast(toast)
  }

  private renderTrustee (snapshot: GameSnapshot, humanId: PlayerId, matchEnded: unknown): void {
    const button = this.dependencies.controls.trustee
    if (!button) return
    const trustee = this.dependencies.lobby.snapshot.trustees?.[humanId]
    const label = button.getComponentInChildren(Label)
    if (label) label.string = trustee ? '取消托管' : '托管'
    button.active = Boolean(this.dependencies.session.snapshot.isMultiplayer && snapshot.phase !== 'settlement' && !matchEnded)
    this.dependencies.effects.playTrusteeState(Boolean(trustee), button)
  }

  private renderPhaseOverlay (
    snapshot: GameSnapshot,
    humanId: PlayerId,
    settlementTitle: string | null,
    matchEnded: LobbySnapshot['matchEnded'],
    isPlaying: boolean,
  ): void {
    const overlay = this.dependencies.controls.overlayLabel
    if (!overlay) return
    overlay.node.active = Boolean(matchEnded || !isPlaying)
    if (matchEnded) {
      const presentation = projectMatchEndedPresentation(matchEnded, humanId)
      overlay.string = `${presentation.title}\n${presentation.detail}`
    } else if (snapshot.phase === 'tribute' && snapshot.tribute) {
      const title = snapshot.tribute.isAntiTribute ? '抗贡成立' : snapshot.tribute.phase === 'tributing' ? '进贡阶段' : snapshot.tribute.phase === 'returning' ? '还贡阶段' : '贡还完成'
      const actions = snapshot.tribute.actions.map(action => `${snapshot.state.players[action.from].name}至${snapshot.state.players[action.to].name}`).join('\n')
      overlay.string = `${title}\n${actions}`
    } else if (snapshot.phase === 'settlement' && snapshot.settlement) {
      const { session, lobby } = this.dependencies
      const campaign = session.snapshot.campaignProgress
      const campaignText = campaign ? `\n战役：${campaign.wins}/${campaign.targetWins} 胜 · ${campaign.losses}/2 负${campaign.completed ? ' · 闯关成功' : campaign.failed ? ' · 闯关失败' : ''}` : ''
      const readyText = session.snapshot.isMultiplayer && !snapshot.settlement.isGameWon ? `\n下一局准备 ${lobby.snapshot.roundReadyPlayerIds?.length ?? 0}/4` : ''
      const rankNames = snapshot.settlement.fullRank.map(id => snapshot.state.players[id].name).join(' · ')
      overlay.string = `${settlementTitle ?? ''}\n${snapshot.settlement.message}\n${rankNames}${campaignText}${readyText}`
    }
  }

  private layoutActionControls (snapshot: GameSnapshot, humanId: PlayerId, humanFinished: boolean, interactionMode: HandInteractionMode): void {
    const { controls, turnClock, lobby, session, handInteraction, hud } = this.dependencies
    const actionNodes = [controls.hint, controls.pass, controls.play, controls.confirmTribute, controls.finishTribute, controls.nextRound]
    actionNodes.forEach(node => { if (node) node.active = false })
    const controlsY = this.dependencies.controlsY()
    turnClock.update({ snapshot, humanId, humanFinished, controlsY })
    if (lobby.snapshot.matchEnded) {
      this.showNextRoundButton('本场结束 · 返回大厅', controlsY)
      return
    }
    if (snapshot.actionPending) return
    if (snapshot.phase === 'tribute') {
      if (session.snapshot.isMultiplayer && (lobby.snapshot.deadlinePlayerId !== humanId || lobby.snapshot.trustees?.[humanId])) return
      const ready = Boolean(snapshot.tribute?.isAntiTribute || snapshot.tribute?.phase === 'done')
      const node = ready
        ? (!session.snapshot.isMultiplayer || lobby.snapshot.deadlineAction === 'finishTribute' ? controls.finishTribute : null)
        : handInteraction.canInteractWithCurrentHand() ? controls.confirmTribute : null
      if (node) { node.active = true; node.setPosition(new Vec3(0, controlsY, 0)) }
      return
    }
    if (snapshot.phase === 'settlement') {
      const ready = lobby.snapshot.roundReadyPlayerIds?.includes(humanId) ?? false
      const label = snapshot.settlement?.isGameWon
        ? (session.snapshot.isMultiplayer ? '本场结束 · 返回大厅' : '重新开局')
        : session.snapshot.isMultiplayer ? (ready ? '取消准备' : '准备下一局') : '下一局'
      this.showNextRoundButton(label, controlsY)
      return
    }
    if (session.snapshot.isMultiplayer && lobby.snapshot.trustees?.[humanId]) return
    if (humanFinished || snapshot.state.currentTurn !== humanId) return
    if (interactionMode === 'lock-create' || interactionMode === 'lock-unlock') return
    const visible = [controls.hint, controls.pass, controls.play].filter((node): node is Node => Boolean(node))
    const startX = -126 * (visible.length - 1) / 2
    visible.forEach((node, index) => {
      node.active = true
      if (hud.mounted) return
      tween(node).stop().to(0.12, { position: new Vec3(startX + index * 126, controlsY, 0) }, { easing: 'quadOut' }).start()
    })
  }

  private showNextRoundButton (text: string, controlsY: number): void {
    const button = this.dependencies.controls.nextRound
    if (!button) return
    const label = button.getComponentInChildren(Label)
    if (label) label.string = text
    button.active = true
    button.setPosition(new Vec3(0, controlsY, 0))
  }

  private renderProgressNotifications (snapshot: GameSnapshot, humanId: PlayerId): void {
    if (snapshot.state.finishedPlayers.length < this.previousFinishedPlayers.length) {
      this.previousFinishedPlayers = []
      this.previousHandCounts.clear()
    }
    const newFinishers = snapshot.state.finishedPlayers.filter(id => !this.previousFinishedPlayers.includes(id))
    newFinishers.forEach(id => {
      const place = snapshot.state.finishedPlayers.indexOf(id)
      const rank = ['头游', '二游', '三游', '末游'][place] ?? '完成'
      const text = id === humanId ? `你已出完 · ${rank}` : `${snapshot.state.players[id].name} 已出完 · ${rank}`
      this.dependencies.overlays.showToast(text)
      this.dependencies.effects.playPlayerFinished(text)
    })
    PLAYER_IDS.forEach(id => {
      const count = snapshot.state.players[id].hand.length
      const previous = this.previousHandCounts.get(id)
      if (id !== humanId && count > 0 && count <= 10 && previous !== undefined && previous > 10) {
        this.dependencies.overlays.showToast(`${snapshot.state.players[id].name} 仅剩 ${count} 张牌`)
      }
      this.previousHandCounts.set(id, count)
    })
    this.previousFinishedPlayers = [...snapshot.state.finishedPlayers]
  }

  private renderTributeEffects (snapshot: GameSnapshot, humanId: PlayerId): void {
    if (snapshot.phase !== 'tribute' || !snapshot.tribute) { this.previousTributeEffects.clear(); return }
    const tribute = snapshot.tribute
    const current = projectTributeEffectTokens(tribute)
    if (tribute.isAntiTribute && !this.previousTributeEffects.has('anti-tribute')) {
      this.dependencies.effects.playTribute({ phase: 'anti-tribute', from: humanId, to: humanId, card: null }, Vec3.ZERO, Vec3.ZERO)
    }
    tribute.actions.forEach(action => {
      if (action.card && !this.previousTributeEffects.has(`give:${action.from}:${action.to}:${action.card.id}`)) {
        this.dependencies.effects.playTribute(
          { phase: 'tribute', from: action.from, to: action.to, card: action.card },
          this.playerEffectOrigin(action.from, humanId), this.playerEffectOrigin(action.to, humanId),
        )
      }
      if (action.returnCard && !this.previousTributeEffects.has(`return:${action.to}:${action.from}:${action.returnCard.id}`)) {
        this.dependencies.effects.playTribute(
          { phase: 'return', from: action.to, to: action.from, card: action.returnCard },
          this.playerEffectOrigin(action.to, humanId), this.playerEffectOrigin(action.from, humanId),
        )
      }
    })
    this.previousTributeEffects = current
  }

  private playerEffectOrigin (playerId: PlayerId, humanId: PlayerId): Vec3 {
    return playerId === humanId
      ? this.dependencies.hand.node.worldPosition.clone()
      : this.dependencies.playerSeats.get(playerId)?.getPlayOriginWorldPosition() ?? Vec3.ZERO
  }

  private oppositeOf (id: PlayerId): PlayerId {
    return ({ p1: 'p3', p2: 'p4', p3: 'p1', p4: 'p2' } as const)[id]
  }

  private clearPresentationState (): void {
    this.previousFinishedPlayers = []
    this.previousHandCounts.clear()
    this.previousTributeEffects.clear()
    this.latest = null
    this.lastPhase = null
    this.lastTurn = null
    this.lastPresentedHint = ''
    this.suppressNextSettlementEffect = false
  }
}
