import { _decorator, Color, Component, Graphics, Label, Node, UITransform, Vec3, tween } from 'cc'

export type CardPresentation = { id: string, rank: string, suit: string, red: boolean, selected: boolean, interactive?: boolean }

const { ccclass } = _decorator

/** A code-only fallback card view; replace Label nodes with a card prefab later. */
@ccclass('CardView')
export class CardView extends Component {
  private card?: CardPresentation
  private label?: Label

  protected onLoad (): void {
    let transform = this.getComponent(UITransform)
    if (!transform) transform = this.addComponent(UITransform)
    transform!.setContentSize(82, 118)
    const surface = this.getComponent(Graphics) ?? this.addComponent(Graphics)
    surface!.clear()
    surface!.fillColor = new Color(249, 245, 232, 255)
    surface!.strokeColor = new Color(177, 141, 68, 255)
    surface!.lineWidth = 2
    surface!.roundRect(-39, -57, 78, 114, 8)
    surface!.fill()
    surface!.stroke()
    const labelNode = new Node('CardText')
    labelNode.parent = this.node
    labelNode.addComponent(UITransform).setContentSize(72, 106)
    const label = labelNode.addComponent(Label)
    this.label = label
    label.fontSize = 24
    label.lineHeight = 30
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    label.verticalAlign = Label.VerticalAlign.CENTER
    this.node.on(Node.EventType.TOUCH_END, this.toggle, this)
    if (this.card) this.applyCard()
  }

  public bind (card: CardPresentation): void {
    this.card = card
    this.applyCard()
  }

  private applyCard (): void {
    if (!this.card || !this.label) return
    this.label.string = `${this.card.rank}\n${this.card.suit}`
    this.label.color = this.card.red ? new Color(190, 44, 44) : new Color(32, 43, 50)
    this.setSelected(this.card.selected, false)
  }

  public setSelected (selected: boolean, animated = true): void {
    if (!this.card) return
    this.card.selected = selected
    const target = new Vec3(this.node.position.x, selected ? 24 : 0, this.node.position.z)
    if (animated) tween(this.node).stop().to(0.12, { position: target }).start()
    else this.node.setPosition(target)
  }

  private toggle (): void {
    if (!this.card || this.card.interactive === false) return
    this.setSelected(!this.card.selected)
    this.node.emit('guandan:card-toggle', this.card.id)
    // Cocos custom Node events do not bubble: forward explicitly to HandController.
    this.node.parent?.emit('guandan:card-toggle', this.card.id)
  }
}
