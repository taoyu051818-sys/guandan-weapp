import { _decorator, Color, Component, Graphics, Label, UITransform } from 'cc'
import type { Player } from '../core/generated'

const { ccclass } = _decorator

/** Reusable four-seat player panel, corresponding to the desktop PlayerArea. */
@ccclass('PlayerSeatController')
export class PlayerSeatController extends Component {
  private label: Label | null = null
  private graphics: Graphics | null = null

  protected onLoad (): void {
    const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform)
    transform!.setContentSize(220, 72)
    this.graphics = this.getComponent(Graphics) ?? this.addComponent(Graphics)
    this.label = this.getComponent(Label) ?? this.addComponent(Label)
    this.label!.fontSize = 19
    this.label!.lineHeight = 25
    this.label!.horizontalAlign = Label.HorizontalAlign.CENTER
    this.label!.verticalAlign = Label.VerticalAlign.CENTER
  }

  public render (player: Player, isTurn: boolean, showHand = false): void {
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
  }
}
