import type { TableMatchCoordinatorDependencies } from './TableMatchPorts'
export type { TableMatchCoordinatorDependencies } from './TableMatchPorts'
import { Node, Vec3 } from 'cc'
import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import { TeammateHandProjector } from '../game/TeammateHandProjector'
import type { LobbyNetworkResult, LobbySnapshot, NetworkMatchEnded, NetworkRoundEndedPacket, NetworkRoundPacket, NetworkStatePacket } from '../network/LobbyController'
import { tableHintToast } from '../ui/TablePromptPolicy'
import { TablePhasePresenter } from './TablePhasePresenter'
import { TableNetworkEventBridge } from './TableNetworkEventBridge'
import { projectTableViewer } from './TableSnapshotPresenter'
import { TableProgressPresentation } from './TableProgressPresentation'

const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']
/** Coordinates authoritative match packets and their short-lived table presentation. */
export class TableMatchCoordinator {
  private latest: GameSnapshot | null = null
  private lastPhase: GameSnapshot['phase'] | null = null
  private readonly progress: TableProgressPresentation
  private lastPresentedHint = ''
  private suppressNextSettlementEffect = false
  private mounted = false
  private disposed = false
  private readonly networkEvents: TableNetworkEventBridge
  private readonly phasePresenter: TablePhasePresenter
  private readonly teammateHand = new TeammateHandProjector()

  public constructor (private readonly dependencies: TableMatchCoordinatorDependencies) {
    this.phasePresenter = new TablePhasePresenter(dependencies)
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
    this.networkEvents.mount()
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.networkEvents.dispose()
    this.phasePresenter.clear()
    if (this.mounted) {
      this.dependencies.manager.node.off('guandan:state', this.render, this)
      this.dependencies.controls.nextRound?.off(Node.EventType.TOUCH_END, this.handleNextRound, this)
    }
    this.mounted = false
    this.clearPresentationState()
  }

  public readonly render = (snapshot: GameSnapshot): void => {
    if (this.disposed) return
    this.latest = snapshot
    const { session, handInteraction, hand, effects, playArea, playerSeats, lobby, controls, hud } = this.dependencies
    const humanId = session.snapshot.myPlayerId ?? 'p1'
    playArea.setSeatOrder(snapshot.state.turnOrder)
    this.dependencies.layoutSeats(humanId)
    const ownHandProjection = handInteraction.submit(snapshot)
    const teammate = session.snapshot.isObserver ? null : this.teammateHand.project(snapshot, humanId, ownHandProjection.sortOrder)
    const handProjection = teammate?.hand ?? ownHandProjection
    hand.render(
      handProjection.hand, handProjection.playSelectedCardIds, handProjection.sortOrder, !session.snapshot.isObserver && handProjection.interactive,
      handProjection.displayCardIds, handProjection.groups, handProjection.lockedCardIds,
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
        finishPlace,
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
    const isPlaying = snapshot.phase === 'playing'
    this.phasePresenter.layoutActionControls(snapshot, humanId, humanFinished)
    hud.render(snapshot, humanId, handProjection, teammate?.view ?? null)
    this.phasePresenter.renderPhaseOverlay(snapshot, humanId, viewer.settlementTitle, matchEnded, isPlaying)
    if (snapshot.phase !== this.lastPhase) {
      const previousPhase = this.lastPhase
      this.lastPhase = snapshot.phase
      if (!isPlaying) this.phasePresenter.animateEntrance()
      if (snapshot.phase === 'settlement' && previousPhase !== 'settlement' && snapshot.settlement) {
        if (this.suppressNextSettlementEffect) this.suppressNextSettlementEffect = false
        else this.dependencies.audio.playEvent(viewer.settlementWon ? 'victory' : 'defeat')
      }
    }
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
    handInteraction.clearSuitPreview(false)
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
    this.dependencies.handInteraction.clearSuitPreview(false)
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
    if (packet.enteredTrustee) this.dependencies.overlays.showToast(`${name}连续超时，已进入托管`)
    this.refresh()
  }

  private readonly handleNextRound = (): void => {
    const { lobby, session } = this.dependencies
    if ((lobby.snapshot.matchEnded || this.latest?.settlement?.isGameWon) && this.dependencies.frontPages.isTournamentRoom?.(lobby.snapshot.roomId)) {
      this.leaveTableToMenu()
      this.dependencies.frontPages.showTournament()
      return
    }
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

  public readonly toggleTrustee = (): void => {
    const { session, lobby } = this.dependencies
    if (!session.snapshot.isMultiplayer) return
    const humanId = session.snapshot.myPlayerId ?? 'p1'
    if (lobby.snapshot.trustees?.[humanId]) lobby.cancelTrustee()
    else lobby.setTrustee()
  }

  private renderLobby (snapshot: LobbySnapshot): void {
    this.dependencies.renderDuplicateStatus?.()
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
    this.lastPhase = phase
  }

  private presentHint (snapshot: GameSnapshot): void {
    if (snapshot.hint === this.lastPresentedHint) return
    this.lastPresentedHint = snapshot.hint
    const toast = tableHintToast(snapshot.hint, snapshot.phase)
    if (toast) this.dependencies.overlays.showToast(toast)
  }




  private clearPresentationState (): void {
    this.teammateHand.reset()
    this.phasePresenter.clear()
    this.progress.reset()
    this.latest = null
    this.lastPhase = null
    this.lastPresentedHint = ''
    this.suppressNextSettlementEffect = false
  }
}
