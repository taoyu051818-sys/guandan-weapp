import { Color, Graphics, Node, type Sprite } from 'cc'
import { configureTransform, nodeContentSize, type TableGameHudSuit } from './TableGameHudFoundation'

/** Neutral code-drawn silhouettes avoid black-on-dark textures and device-dependent font glyphs. */
export const renderSuitAvailability = (sprite: Sprite, suit: TableGameHudSuit, available: boolean): void => {
  let disabled = sprite.node.getChildByName('UnavailableSuit')
  if (!disabled && !available) {
    const { width, height } = nodeContentSize(sprite.node, 36, 36)
    disabled = new Node('UnavailableSuit')
    disabled.parent = sprite.node
    configureTransform(disabled, width, height)
    const g = disabled.addComponent(Graphics)
    const s = Math.min(width, height) / 2
    g.fillColor = new Color(155, 162, 171)
    if (suit === 'diamond') {
      g.moveTo(0, s); g.lineTo(s * .7, 0); g.lineTo(0, -s); g.lineTo(-s * .7, 0); g.close(); g.fill()
    } else if (suit === 'club') {
      g.circle(0, s * .48, s * .45); g.fill()
      g.circle(-s * .43, -s * .05, s * .45); g.fill()
      g.circle(s * .43, -s * .05, s * .45); g.fill()
    } else {
      const d = suit === 'heart' ? 1 : -1
      g.moveTo(0, -s * d)
      g.bezierCurveTo(-s * 1.6, s * .15 * d, -s * .75, s * 1.4 * d, 0, s * .5 * d)
      g.bezierCurveTo(s * .75, s * 1.4 * d, s * 1.6, s * .15 * d, 0, -s * d)
      g.fill()
    }
    if (suit === 'club' || suit === 'spade') {
      g.moveTo(0, 0); g.lineTo(-s * .32, -s); g.lineTo(s * .32, -s); g.close(); g.fill()
    }
  }
  if (disabled) disabled.active = !available
  sprite.enabled = available
  sprite.color = new Color(255, 255, 255, 255)
}
