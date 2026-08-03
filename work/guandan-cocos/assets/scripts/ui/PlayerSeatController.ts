import { _decorator, Color, Component, Graphics, Label, Node, UITransform, Vec3 } from 'cc'
import type { Player } from '../core/generated'

const { ccclass } = _decorator

/** Reusable four-seat player panel, corresponding to the desktop PlayerArea. */
@ccclass('PlayerSeatController')
export class PlayerSeatController extends Component {
  private label: Label | null = null
  private graphics: Graphics | null = null
  private chatLabel: Label | null = null

  protected onLoad (): void {
    const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform)
    transform!.setContentSize(220, 72)
    this.graphics = this.getComponent(Graphics) ?? this.addComponent(Graphics)
    this.label = this.getComponent(Label) ?? this.addComponent(Label)
    this.label!.fontSize = 19
    this.label!.lineHeight = 25
    this.label!.horizontalAlign = Label.HorizontalAlign.CENTER
    this.label!.verticalAlign = Label.VerticalAlign.CENTER
    const bubble = new Node('ChatBubble')
    bubble.parent = this.node
    bubble.setPosition(new Vec3(0, 64, 0))
    bubble.addComponent(UITransform).setContentSize(280, 48)
    const bubbleGraphics = bubble.addComponent(Graphics)
    bubbleGraphics.fillColor = new Color(249, 245, 232, 250)
    bubbleGraphics.strokeColor = new Color(188, 143, 57, 255)
    bubbleGraphics.lineWidth = 2
    bubbleGraphics.roundRect(-140, -24, 280, 48, 14)
    bubbleGraphics.fill()
    bubbleGraphics.stroke()
    this.chatLabel = bubble.addComponent(Label)
    this.chatLabel.fontSize = 16
    this.chatLabel.lineHeight = 22
    this.chatLabel.horizontalAlign = Label.HorizontalAlign.CENTER
    this.chatLabel.verticalAlign = Label.VerticalAlign.CENTER
    this.chatLabel.color = new Color(43, 48, 49)
    bubble.active = false
  }

  public render (player: Player, isTurn: boolean, showHand = false, chat?: string): void {
    const graphic = this.graphics!
    graphic.clear()
    graphic.fillColor = isTurn ? new Color(85, 62, 24, 245) : new Color(22, 34, 39, 230)
    graphic.strokeColor = isTurn ? new Color(239, 201, 90, 255) : new Color(101, 123, 129, 220)
    graphic.lineWidth = isTurn ? 3 : 1
    graphic.roundRect(-110, -36, 220, 72, 18)
    graphic.fill()
    graphic.stroke()
    const team = player.team === 'teamA' ? '我方' : '对方'
    this.label!.color = isTurn ? new Color(255, 229, 157) : new Color(231, 236, 232)
    this.label!.string = `${isTurn ? '▶ ' : ''}${player.name}  ·  ${team}\n${showHand ? `明牌 ${player.hand.length} 张` : `剩余手牌 ${player.hand.length} 张`}`
    if (this.chatLabel) {
      this.chatLabel.string = chat ?? ''
      this.chatLabel.node.active = Boolean(chat)
    }
  }
}
