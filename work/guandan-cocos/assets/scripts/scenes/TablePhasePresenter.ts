import { Label, Node, Vec3, tween } from 'cc'
import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import type { LobbySnapshot } from '../network/LobbyController'
import { TablePlayActionPolicy } from '../ui/TablePlayActionPolicy'
import { TableSettlementView } from '../ui/TableSettlementView'
import { projectMatchEndedPresentation } from './MatchEndedPresentation'
import { projectSettlementContent } from './SettlementPresentation'
import type { TableMatchCoordinatorDependencies } from './TableMatchPorts'

type Dependencies = Pick<TableMatchCoordinatorDependencies, 'controls' | 'turnClock' | 'lobby' | 'session' | 'handInteraction' | 'hud' | 'controlsY' | 'frontPages'>

/** Displays phase controls and settlement; owns no network subscriptions or transitions. */
export class TablePhasePresenter {
  private readonly settlementView = new TableSettlementView()
  private readonly playActionPolicy = new TablePlayActionPolicy()
  constructor (private readonly dependencies: Dependencies) {}
  public clear (): void { this.settlementView.clear() }
  public animateEntrance (): void {
    const overlay = this.dependencies.controls.overlayLabel
    if (!overlay) return
    overlay.node.setScale(new Vec3(0.82, 0.82, 1))
    tween(overlay.node).to(0.24, { scale: Vec3.ONE }, { easing: 'backOut' }).start()
  }

  public renderPhaseOverlay (
    snapshot: GameSnapshot,
    humanId: PlayerId,
    settlementTitle: string | null,
    matchEnded: LobbySnapshot['matchEnded'],
    isPlaying: boolean,
  ): void {
    const overlay = this.dependencies.controls.overlayLabel
    if (!overlay) return
    if (snapshot.phase !== 'settlement') this.settlementView.clear()
    overlay.node.active = Boolean(matchEnded || (!isPlaying && snapshot.phase !== 'tribute'))
    if (matchEnded && !snapshot.settlement) {
      const presentation = projectMatchEndedPresentation(matchEnded, humanId, this.dependencies.lobby.snapshot.duplicate)
      overlay.string = `${presentation.title}\n${presentation.detail}`
    } else if (snapshot.phase === 'settlement' && snapshot.settlement) {
      const { session, lobby } = this.dependencies
      this.settlementView.render(overlay, projectSettlementContent(snapshot, humanId, settlementTitle,
        session.snapshot.isMultiplayer, lobby.snapshot.roundReadyPlayerIds ?? [], matchEnded, lobby.snapshot.duplicate))
      const button = this.dependencies.controls.nextRound
      if (button?.active) {
        button.setPosition(new Vec3(0, -172, 0))
        if (button.parent) button.setSiblingIndex(button.parent.children.length - 1)
      }
    }
  }

  public layoutActionControls (snapshot: GameSnapshot, humanId: PlayerId, humanFinished: boolean): void {
    const { controls, turnClock, lobby, session, handInteraction, hud } = this.dependencies
    const actionNodes = [controls.hint, controls.pass, controls.play, controls.confirmTribute, controls.finishTribute, controls.nextRound]
    actionNodes.forEach(node => { if (node) node.active = false })
    const controlsY = this.dependencies.controlsY()
    turnClock.update({ snapshot, humanId, humanFinished, controlsY })
    if (session.snapshot.isObserver) return
    if (lobby.snapshot.matchEnded) {
      this.showNextRoundButton(lobby.snapshot.matchEnded.reason === 'single-round' ? '再来一场' : '本场结束 · 返回大厅', controlsY, snapshot)
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
      this.showNextRoundButton(label, controlsY, snapshot)
      return
    }
    if (session.snapshot.isMultiplayer && lobby.snapshot.trustees?.[humanId]) return
    if (humanFinished || snapshot.state.currentTurn !== humanId) return
    const visible = this.playActionPolicy.resolve(snapshot.state, humanId).map(key => controls[key]).filter((node): node is Node => Boolean(node))
    const startX = -126 * (visible.length - 1) / 2
    visible.forEach((node, index) => {
      node.active = true
      if (hud.mounted) return
      tween(node).stop().to(0.12, { position: new Vec3(startX + index * 126, controlsY, 0) }, { easing: 'quadOut' }).start()
    })
  }

  private showNextRoundButton (text: string, controlsY: number, snapshot: GameSnapshot): void {
    const button = this.dependencies.controls.nextRound
    if (!button) return
    const label = button.getComponentInChildren(Label)
    const { frontPages, lobby } = this.dependencies
    const tournamentEnded = (lobby.snapshot.matchEnded || snapshot.settlement?.isGameWon) && frontPages.isTournamentRoom?.(lobby.snapshot.roomId)
    if (label) { label.string = tournamentEnded ? '返回赛事' : text; label.enableWrapText = false }
    button.active = true
    button.setPosition(new Vec3(0, controlsY, 0))
  }



}
