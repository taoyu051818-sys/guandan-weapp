import { Component, Label, Node } from 'cc'
import { GameManager, type GameSnapshot } from '../game/GameManager'
import { HandController } from '../ui/HandController'

/** Attach this to the Game scene root and bind editor nodes in the Inspector. */
export class GameScene extends Component {
  public gameManager: GameManager | null = null
  public hand: HandController | null = null
  public hintLabel: Label | null = null
  public playButton: Node | null = null
  public passButton: Node | null = null

  protected onLoad (): void {
    if (!this.gameManager) this.gameManager = this.getComponent(GameManager) ?? this.addComponent(GameManager)
    this.gameManager.node.on('guandan:state', this.render, this)
    this.hand?.node.on('guandan:card-toggle', this.gameManager.toggleCard, this.gameManager)
    this.playButton?.on(Node.EventType.TOUCH_END, this.gameManager.playSelected, this.gameManager)
    this.passButton?.on(Node.EventType.TOUCH_END, this.gameManager.pass, this.gameManager)
  }

  protected start (): void {
    // The listener is now bound, so the first deal cannot be missed.
    this.gameManager?.startRound()
  }

  protected onDestroy (): void {
    this.gameManager?.node.off('guandan:state', this.render, this)
  }

  private render (snapshot: GameSnapshot): void {
    this.hand?.render(snapshot.state.players.p1.hand, snapshot.selectedCardIds)
    if (this.hintLabel) this.hintLabel.string = snapshot.hint
  }
}
