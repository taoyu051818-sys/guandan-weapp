import { _decorator, Color, Component, Label, Node, UITransform, Vec3 } from 'cc'
import { GameManager, type GameSnapshot } from '../game/GameManager'
import { HandController } from '../ui/HandController'
import { GameSession } from '../session/GameSession'

const { ccclass, property } = _decorator

/** Attach this to the Game scene root and bind editor nodes in the Inspector. */
@ccclass('GameScene')
export class GameScene extends Component {
  @property(GameSession)
  public session: GameSession | null = null

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
    if (!this.session) this.session = this.getComponent(GameSession) ?? this.addComponent(GameSession)
    if (!this.gameManager) this.gameManager = this.getComponent(GameManager) ?? this.addComponent(GameManager)
    const manager = this.gameManager!
    manager.session = this.session
    this.ensureFallbackUi()
    manager.node.on('guandan:state', this.render, this)
    this.hand?.node.on('guandan:card-toggle', manager.toggleCard, manager)
    this.playButton?.on(Node.EventType.TOUCH_END, manager.playSelected, manager)
    this.passButton?.on(Node.EventType.TOUCH_END, manager.pass, manager)
    this.confirmTributeButton?.on(Node.EventType.TOUCH_END, manager.confirmTribute, manager)
    this.finishTributeButton?.on(Node.EventType.TOUCH_END, manager.finishTribute, manager)
    this.nextRoundButton?.on(Node.EventType.TOUCH_END, manager.nextRound, manager)
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

  /** Lets the first playable scene run before the art prefabs are bound in Creator. */
  private ensureFallbackUi (): void {
    if (!this.hand) {
      const handNode = new Node('HumanHand')
      handNode.parent = this.node
      handNode.setPosition(new Vec3(0, -265, 0))
      handNode.addComponent(UITransform).setContentSize(1040, 150)
      this.hand = handNode.addComponent(HandController)
    }
    this.hintLabel ??= this.makeLabel('Hint', 0, -150, 24)
    this.phaseLabel ??= this.makeLabel('Phase', 0, 282, 30)
    this.scoreLabel ??= this.makeLabel('Score', 0, 232, 22)
    this.overlayLabel ??= this.makeLabel('Overlay', 0, 42, 30)
    this.playButton ??= this.makeButton('PlayButton', '出牌', -115)
    this.passButton ??= this.makeButton('PassButton', '不要', 0)
    this.confirmTributeButton ??= this.makeButton('ConfirmTributeButton', '确认贡牌', 115)
    this.finishTributeButton ??= this.makeButton('FinishTributeButton', '开始本局', 115)
    this.nextRoundButton ??= this.makeButton('NextRoundButton', '下一局', 115)
  }

  private makeLabel (name: string, x: number, y: number, fontSize: number): Label {
    const node = new Node(name)
    node.parent = this.node
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(1100, 80)
    const label = node.addComponent(Label)
    label.fontSize = fontSize
    label.lineHeight = fontSize + 8
    label.color = new Color(245, 239, 215)
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    return label
  }

  private makeButton (name: string, text: string, x: number): Node {
    const label = this.makeLabel(name, x, -205, 28)
    label.string = `【${text}】`
    return label.node
  }
}
