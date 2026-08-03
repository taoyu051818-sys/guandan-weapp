import { _decorator, Color, Component, Label, Node, UITransform, Vec3, tween } from 'cc'

export type CardPresentation = { id: string, rank: string, suit: string, red: boolean, selected: boolean }

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
    const label = (this.getComponent(Label) ?? this.addComponent(Label))!
    this.label = label
    this.node.on(Node.EventType.TOUCH_END, this.toggle, this)
  }

  public bind (card: CardPresentation): void {
    this.card = card
    if (!this.label) return
    this.label.string = `${card.rank}\n${card.suit}`
    this.label.color = card.red ? new Color(190, 44, 44) : new Color(245, 240, 220)
    this.setSelected(card.selected, false)
  }

  public setSelected (selected: boolean, animated = true): void {
    if (!this.card) return
    this.card.selected = selected
    const target = new Vec3(this.node.position.x, selected ? 24 : 0, this.node.position.z)
    if (animated) tween(this.node).stop().to(0.12, { position: target }).start()
    else this.node.setPosition(target)
  }

  private toggle (): void {
    if (!this.card) return
    this.setSelected(!this.card.selected)
    this.node.emit('guandan:card-toggle', this.card.id)
  }
}
