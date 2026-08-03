import { _decorator, Component, Label, Node } from 'cc'
import { GameManager, type GameSnapshot } from '../game/GameManager'
import { HandController } from '../ui/HandController'

const { ccclass, property } = _decorator

/** Attach this to the Game scene root and bind editor nodes in the Inspector. */
@ccclass('GameScene')
export class GameScene extends Component {
  @property(GameManager)
  public gameManager: GameManager | null = null

  @property(HandController)
  public hand: HandController | null = null

  @property(Label)
  public hintLabel: Label | null = null

  @property(Label)
  public phaseLabel: Label | null = null

  @property(Label)
  public scoreLabel: Label | null = null

  @property(Label)
  public overlayLabel: Label | null = null

  @property(Node)
  public playButton: Node | null = null

  @property(Node)
  public passButton: Node | null = null

  @property(Node)
  public confirmTributeButton: Node | null = null

  @property(Node)
  public finishTributeButton: Node | null = null

  @property(Node)
  public nextRoundButton: Node | null = null

  protected onLoad (): void {
    if (!this.gameManager) this.gameManager = this.getComponent(GameManager) ?? this.addComponent(GameManager)
    this.gameManager.node.on('guandan:state', this.render, this)
    this.hand?.node.on('guandan:card-toggle', this.gameManager.toggleCard, this.gameManager)
    this.playButton?.on(Node.EventType.TOUCH_END, this.gameManager.playSelected, this.gameManager)
    this.passButton?.on(Node.EventType.TOUCH_END, this.gameManager.pass, this.gameManager)
    this.confirmTributeButton?.on(Node.EventType.TOUCH_END, this.gameManager.confirmTribute, this.gameManager)
    this.finishTributeButton?.on(Node.EventType.TOUCH_END, this.gameManager.finishTribute, this.gameManager)
    this.nextRoundButton?.on(Node.EventType.TOUCH_END, this.gameManager.nextRound, this.gameManager)
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
    if (this.phaseLabel) this.phaseLabel.string = snapshot.phase === 'playing' ? `级牌 ${snapshot.state.currentLevel}` : snapshot.phase === 'tribute' ? '进贡与还贡' : '本局结算'
    if (this.scoreLabel) this.scoreLabel.string = `我方 ${snapshot.teamLevels.teamA} 级 · ${snapshot.scores.teamA} 分    对方 ${snapshot.teamLevels.teamB} 级 · ${snapshot.scores.teamB} 分`

    const isPlaying = snapshot.phase === 'playing'
    const isTribute = snapshot.phase === 'tribute'
    const isSettlement = snapshot.phase === 'settlement'
    if (this.playButton) this.playButton.active = isPlaying
    if (this.passButton) this.passButton.active = isPlaying
    if (this.confirmTributeButton) this.confirmTributeButton.active = isTribute && !snapshot.tribute?.isAntiTribute && snapshot.tribute?.phase !== 'done'
    if (this.finishTributeButton) this.finishTributeButton.active = isTribute && Boolean(snapshot.tribute?.isAntiTribute || snapshot.tribute?.phase === 'done')
    if (this.nextRoundButton) this.nextRoundButton.active = isSettlement

    if (this.overlayLabel) {
      this.overlayLabel.node.active = !isPlaying
      if (isTribute && snapshot.tribute) {
        const title = snapshot.tribute.isAntiTribute ? '抗贡成立' : snapshot.tribute.phase === 'tributing' ? '进贡阶段' : snapshot.tribute.phase === 'returning' ? '还贡阶段' : '贡还完成'
        const actions = snapshot.tribute.actions.map(action => `${action.from} → ${action.to}`).join('\n')
        this.overlayLabel.string = `${title}\n${actions}`
      } else if (isSettlement && snapshot.settlement) {
        this.overlayLabel.string = `${snapshot.settlement.winnerTeam === 'teamA' ? '本局胜利' : '本局失利'}\n${snapshot.settlement.message}\n${snapshot.settlement.fullRank.join(' · ')}`
      }
    }
  }
}
