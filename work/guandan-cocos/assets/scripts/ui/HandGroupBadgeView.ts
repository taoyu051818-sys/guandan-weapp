import { drawUiFrame } from './UiFrameStyle'
import { Color, Graphics, Label, Node, UITransform, Vec3 } from 'cc'
import type { HandGroupBadge } from '../game/HandStackLayout'

/** A non-interactive stamp inside the bottom card; never owns layout or selection. */
export class HandGroupBadgeView {
  private readonly node: Node
  private readonly graphics: Graphics
  private readonly label: Label
  private key = ''

  public constructor (parent: Node) {
    this.node = new Node('HandGroupBadge')
    this.node.parent = parent
    this.node.addComponent(UITransform)
    this.graphics = this.node.addComponent(Graphics)
    const text = new Node('HandGroupBadgeText')
    text.parent = this.node
    text.addComponent(UITransform)
    this.label = text.addComponent(Label)
    this.label.fontSize = 16
    this.label.lineHeight = 16
    this.label.horizontalAlign = Label.HorizontalAlign.CENTER
    this.label.verticalAlign = Label.VerticalAlign.CENTER
    this.node.active = false
  }

  public render (badge?: HandGroupBadge): void {
    this.node.active = Boolean(badge)
    if (!badge) return
    const key = `${badge.tone}:${badge.label}`
    if (key === this.key) return
    this.key = key
    const height = Array.from(badge.label).length * 16 + 6
    const width = 20
    this.node.setPosition(new Vec3(-27, -53 + height / 2, 12))
    this.node.getComponent(UITransform)!.setContentSize(width, height)
    this.label.node.getComponent(UITransform)!.setContentSize(width, height)
    this.label.string = Array.from(badge.label).join('\n')
    const color = badge.tone === 'purple' ? new Color(135, 68, 157) : new Color(25, 123, 135)
    this.label.color = color
    this.graphics.clear()
    this.graphics.fillColor = new Color(251, 252, 248, 238)
    this.graphics.strokeColor = color
    this.graphics.lineWidth = 1.3
    drawUiFrame(this.graphics, -width / 2, -height / 2, width, height, 'tag')
    this.graphics.fill()
    this.graphics.stroke()
  }
}
