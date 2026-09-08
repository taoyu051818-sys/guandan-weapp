import type { TableMatchCoordinatorDependencies } from './TableMatchPorts'
export type { TableMatchCoordinatorDependencies } from './TableMatchPorts'
import { Label, Node, Vec3, tween } from 'cc'
import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import type { HandInteractionMode } from '../game/HandInteractionState'
import { TeammateHandProjector } from '../game/TeammateHandProjector'
import type { LobbyNetworkResult, LobbySnapshot, NetworkMatchEnded, NetworkRoundEndedPacket, NetworkRoundPacket, NetworkStatePacket } from '../network/LobbyController'
import { tableHintToast } from '../ui/TablePromptPolicy'
import { TablePlayActionPolicy } from '../ui/TablePlayActionPolicy'
import { TableSettlementView } from '../ui/TableSettlementView'
import { projectMatchEndedPresentation } from './MatchEndedPresentation'
import { projectSettlementContent } from './SettlementPresentation'
import { TableNetworkEventBridge } from './TableNetworkEventBridge'
import { projectTableViewer } from './TableSnapshotPresenter'
import { TableProgressPresentation } from './TableProgressPresentation'

const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']
/** Coordinates authoritative match packets and their short-lived table presentation. */
export class TableMatchCoordinator {
  private latest: GameSnapshot | null = null
  private lastPhase: GameSnapshot['phase'] | null = null
  private lastTurn: PlayerId | null = null
  private readonly progress: TableProgressPresentation
  private lastPresentedHint = ''
  private suppressNextSettlementEffect = false
  private mounted = false
  private disposed = false
  private readonly networkEvents: TableNetworkEventBridge
  private readonly settlementView = new TableSettlementView()
  private readonly playActionPolicy = new TablePlayActionPolicy()
  private readonly teammateHand = new TeammateHandProjector()

  public constructor (private readonly dependencies: TableMatchCoordinatorDependencies) {
    this.progress = new TableProgressPresentation({
      showToast: text => dependencies.overlays.showToast(text),
    })
    this.networkEvents = new TableNetworkEventBridge(dependencies.lobby.events, {
      onLobby: snapshot => this.renderLobby(snapshot),
      onNetworkState: packet => this.applyNetworkState(packet),
      onRoundPrepared: packet => this.applyNetworkRoundPrepared(packet),
      onRoundEnded: packet => this.applyNetworkRoundEnded(packet),
      onMatchEnded: ended => this.applyNetworkMatchEnded(ended),
      onNetworkResult: result => this.applyNetworkResult(result),
      onNetworkError: message => this.applyNetworkError(message),
      onRoomClosed: (message, options) => this.applyNetworkRoomClosed(message, options),
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
    this.settlementView.clear()
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
    const ownHandProjection = handInteraction.submit(snapshot)
    const teammate = session.snapshot.isObserver ? null : this.teammateHand.project(snapshot, humanId, ownHandProjection.sortOrder)
    const handProjection = teammate?.hand ?? ownHandProjection
    hand.render(
      handProjection.hand, handProjection.playSelectedCardIds, handProjection.sortOrder, !session.snapshot.isObserver && handProjection.interactive,
      handProjection.displayCardIds, handProjection.groups, handProjection.lockedCardIds,
      handProjection.lockDraftCardIds, handProjection.interactionMode,
      !teammate,
    )
    const entranceCompletion = hand.consumeEntranceCompletion()
    if (entranceCompletion) effects.waitForPresentation(entranceCompletion, () => hand.finishEntrances())
    effects.syncActions(
      snapshot.state.playArea,
      humanId,
      id => playerSeats.get(id)?.getPlayOriginWorldPosition() ?? hand.node.worldPosition.clone(),
      (id, action) => playArea.getActionWorldPosition(id, humanId, action.cards.length) ?? Vec3.ZERO,
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
    PLAYER_IDS.forEach(id => {
      const seat = playerSeats.get(id)
      if (!seat) return
      seat.node.active = id !== humanId
      const ranking = snapshot.settlement?.fullRank ?? snapshot.state.finishedPlayers
      const finishPlace = ranking.indexOf(id) + 1
      if (id !== humanId) seat.render(
        snapshot.state.players[id], snapshot.state.currentTurn === id, snapshot.state.players[humanId].team,
        false,
        undefined, finishPlace,
      )
    })
    this.syncSeatConnections(lobby.snapshot)
    this.progress.renderProgressNotifications(snapshot, humanId)
    const humanFinished = snapshot.state.finishedPlayers.includes(humanId)
    if (controls.hintLabel) controls.hintLabel.node.active = false
    if (controls.phaseLabel) controls.phaseLabel.node.active = false
    if (!session.snapshot.isObserver) this.presentHint(snapshot)
    const teamLevels = lobby.snapshot.scoreboard?.teamLevels ?? snapshot.teamLevels
    const viewer = projectTableViewer(snapshot.state.players, humanId, teamLevels, snapshot.settlement?.winnerTeam ?? null)
    const matchEnded = lobby.snapshot.matchEnded ?? null
    if (controls.levelLabel) controls.levelLabel.string = viewer.levelLabel
    this.renderTrustee(snapshot, humanId, matchEnded)
    const isPlaying = snapshot.phase === 'playing'
    this.layoutActionControls(snapshot, humanId, humanFinished, handProjection.interactionMode)
    hud.render(snapshot, humanId, handProjection, teammate?.view ?? null)
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
        else this.dependencies.audio.playEvent(viewer.settlementWon ? 'victory' : 'defeat')
      }
    }
    if (snapshot.state.currentTurn !== this.lastTurn) this.lastTurn = snapshot.state.currentTurn
    overlays.renderOwnChat()
  }

  public refresh (): void { if (this.latest && !this.disposed) this.render(this.latest) }

  public handleTableHidden (): void { this.lastPresentedHint = '' }

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
    const { lobby, frontPages, audio, handInteraction, manager } = this.dependencies
    if (packet.roomId !== lobby.snapshot.roomId) return
    frontPages.handoffFriendRoomReservation()
    const isLiveNextRound = this.latest?.phase === 'settlement' && packet.state.playArea.length === 0
    frontPages.hideAll()
    this.dependencies.setTableVisible(true)
    const shouldPlayOpening = packet.effectSync.mode !== 'recovery'
    if (!shouldPlayOpening) {
      this.prepareRecoveryVisualBaseline(packet.state, packet.tribute ? 'tribute' : 'playing')
    }
    if (isLiveNextRound) audio.playRoundStart()
    handInteraction.resetForRound()
    manager.applyNetworkRoundPrepared(packet.state, packet.tribute)
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
    if (!this.latest || status === 'menu' || status === 'lobby') return
    this.dependencies.manager.applyNetworkError(message)
  }

  private applyNetworkResult (result: LobbyNetworkResult): void { this.dependencies.manager.applyNetworkResult(result) }

  private applyNetworkRoomClosed (message = '房间已关闭', options?: { compensateReservation?: boolean }): void {
    const { overlays, manager, turnClock, effects, frontPages } = this.dependencies
    overlays.clearDialogs()
    manager.abortRound()
    this.clearPresentationState()
    turnClock.reset()
    effects.resetForRecovery(0)
    // "showLobby" is the private-room entry screen, not the main hall.
    // Recovery-only resets must retain reservations; authoritative closure may release them.
    if (options?.compensateReservation === false) frontPages.showRecoveryMenu()
    else frontPages.showMenu()
    overlays.showToast(message)
  }

  private applyNetworkTurnTimeout (packet: { playerId: PlayerId | null, enteredTrustee: boolean }): void {
    if (!packet.playerId) return
    const humanId = this.dependencies.session.snapshot.myPlayerId ?? 'p1'
    const name = packet.playerId === humanId ? '你' : this.latest?.state.players[packet.playerId].name ?? packet.playerId
    this.dependencies.overlays.showToast(packet.enteredTrustee ? `${name}连续超时，已进入托管` : `${name}操作超时，服务器已自动处理`)
    this.refresh()
  }

  private readonly handleNextRound = (): void => {
    const { lobby, session } = this.dependencies
    if (lobby.snapshot.matchEnded) {
      const rematch = lobby.snapshot.matchEnded.reason === 'single-round'
      this.leaveTableToMenu()
      if (rematch) this.dependencies.frontPages.showClassicRooms()
      return
    }
    if (this.latest?.settlement?.isGameWon && session.snapshot.isMultiplayer) { this.leaveTableToMenu(); return }
    if (session.snapshot.isMultiplayer) {
      const humanId = session.snapshot.myPlayerId ?? 'p1'
      if (lobby.snapshot.roundReadyPlayerIds?.includes(humanId)) lobby.cancelRoundReady()
      else lobby.readyNextRound()
      return
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
    // Metadata arrives before its private hand snapshot; never render hidden cards as the new viewpoint.
    const hand = this.latest?.state.players[snapshot.myPlayerId ?? 'p1']?.hand
    if (snapshot.roomRole === 'observer' && (snapshot.observerWaiting || hand?.some(card => card.id.startsWith('hidden-')))) return
    this.refresh()
  }

  private syncSeatConnections (snapshot?: LobbySnapshot): void {
    const multiplayerTable = Boolean(this.latest && this.dependencies.session.snapshot.isMultiplayer && snapshot?.roomId)
    PLAYER_IDS.forEach(id => {
      const seat = this.dependencies.playerSeats.get(id)
      if (!seat) return
      if (!multiplayerTable || !snapshot) seat.clearConnectionStatus()
      else seat.setOffline(!snapshot.members.includes(id) && !snapshot.botPlayerIds?.includes(id))
    })
  }

  private prepareRecoveryVisualBaseline (state: NetworkStatePacket['state'], phase: GameSnapshot['phase']): void {
    this.dependencies.effects.resetForRecovery(state.playArea.length)
    this.progress.seedRecovery(state)
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
    button.active = Boolean(!this.dependencies.session.snapshot.isObserver && this.dependencies.session.snapshot.isMultiplayer && snapshot.phase !== 'settlement' && !matchEnded && !snapshot.state.finishedPlayers.includes(humanId))
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
    if (snapshot.phase !== 'settlement') this.settlementView.clear()
    overlay.node.active = Boolean(matchEnded || !isPlaying)
    if (matchEnded && !snapshot.settlement) {
      const presentation = projectMatchEndedPresentation(matchEnded, humanId)
      overlay.string = `${presentation.title}\n${presentation.detail}`
    } else if (snapshot.phase === 'tribute' && snapshot.tribute) {
      const title = snapshot.tribute.isAntiTribute ? '抗贡成立' : snapshot.tribute.phase === 'tributing' ? '进贡阶段' : snapshot.tribute.phase === 'returning' ? '还贡阶段' : '贡还完成'
      const actions = snapshot.tribute.actions.map(action => `${snapshot.state.players[action.from].name}至${snapshot.state.players[action.to].name}`).join('\n')
      overlay.string = `${title}\n${actions}`
    } else if (snapshot.phase === 'settlement' && snapshot.settlement) {
      const { session, lobby } = this.dependencies
      this.settlementView.render(overlay, projectSettlementContent(snapshot, humanId, settlementTitle,
        session.snapshot.isMultiplayer, lobby.snapshot.roundReadyPlayerIds ?? [], matchEnded))
      const button = this.dependencies.controls.nextRound
      if (button?.active) {
        button.setPosition(new Vec3(0, -172, 0))
        if (button.parent) button.setSiblingIndex(button.parent.children.length - 1)
      }
    }
  }

  private layoutActionControls (snapshot: GameSnapshot, humanId: PlayerId, humanFinished: boolean, interactionMode: HandInteractionMode): void {
    const { controls, turnClock, lobby, session, handInteraction, hud } = this.dependencies
    const actionNodes = [controls.hint, controls.pass, controls.play, controls.confirmTribute, controls.finishTribute, controls.nextRound]
    actionNodes.forEach(node => { if (node) node.active = false })
    const controlsY = this.dependencies.controlsY()
    turnClock.update({ snapshot, humanId, humanFinished, controlsY })
    if (session.snapshot.isObserver) return
    if (lobby.snapshot.matchEnded) {
      this.showNextRoundButton(lobby.snapshot.matchEnded.reason === 'single-round' ? '再来一局 · 选择场次' : '本场结束 · 返回大厅', controlsY)
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
    const visible = this.playActionPolicy.resolve(snapshot.state, humanId).map(key => controls[key]).filter((node): node is Node => Boolean(node))
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



  private clearPresentationState (): void {
    this.teammateHand.reset()
    this.settlementView.clear()
    this.progress.reset()
    this.latest = null
    this.lastPhase = null
    this.lastTurn = null
    this.lastPresentedHint = ''
    this.suppressNextSettlementEffect = false
  }
}
