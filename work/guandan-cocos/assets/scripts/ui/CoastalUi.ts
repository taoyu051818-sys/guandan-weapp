import { Color, Graphics, Label, Node, UITransform, Vec3 } from 'cc'
import type { RuntimeUiFactory } from './RuntimeUiFactory'

/** Solid-surface typography: no automatic heavy outline or per-label backing. */
export const coastalText = (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, size = 24, options: {
  parent?: Node, color?: Color, bold?: boolean, left?: boolean,
} = {}): Label => {
  const node = new Node('CoastalText')
  node.parent = options.parent ?? ui.parent
  node.setPosition(new Vec3(x, y, 0))
  node.addComponent(UITransform).setContentSize(width, height)
  const label = node.addComponent(Label)
  label.string = text
  label.fontSize = size
  label.lineHeight = size + 8
  label.overflow = Label.Overflow.SHRINK
  label.enableWrapText = true
  label.horizontalAlign = options.left ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER
  label.verticalAlign = Label.VerticalAlign.CENTER
  label.color = options.color ?? new Color(236, 247, 249)
  label.isBold = options.bold ?? false
  label.enableOutline = false
  return label
}

export const coastalButton = (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, action: () => void, primary = false): Node => {
  const node = ui.panel('CoastalButton', x, y, width, height, {
    fill: primary ? new Color(250, 207, 100) : new Color(32, 81, 104, 250),
    stroke: primary ? new Color(255, 237, 176) : new Color(107, 156, 173),
    lineWidth: 1, frame: 'control',
  })
  coastalText(ui, text, 0, 0, width - 24, height - 8, 25, {
    parent: node, bold: true, color: primary ? new Color(75, 53, 26) : new Color(229, 245, 248),
  })
  ui.makeInteractive(node, action, 0.97)
  return node
}

export type CoastalIcon = 'shop' | 'gift' | 'rules' | 'resume' | 'cards' | 'more'
/** One coherent code-native icon family; no placeholder Chinese glyphs or emoji. */
export const coastalIcon = (parent: Node, kind: CoastalIcon, x: number, y: number, size: number): Node => {
  const node = new Node(`CoastalIcon-${kind}`)
  node.parent = parent
  node.setPosition(new Vec3(x, y, 0))
  node.addComponent(UITransform).setContentSize(size, size)
  const g = node.addComponent(Graphics)
  g.strokeColor = new Color(255, 229, 159)
  g.fillColor = new Color(255, 229, 159, 36)
  g.lineWidth = Math.max(2, size * 0.055)
  const s = size / 2
  const line = (x1: number, y1: number, x2: number, y2: number): void => { g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke() }
  if (kind === 'more') {
    g.fillColor = g.strokeColor
    for (const xx of [-.65, 0, .65]) { g.circle(s * xx, 0, s * .15); g.fill() }
  } else if (kind === 'shop') {
    g.roundRect(-s * .72, -s * .75, s * 1.44, s * 1.3, s * .13); g.fill(); g.stroke()
    g.arc(0, s * .45, s * .36, 0, Math.PI, false); g.stroke()
  } else if (kind === 'gift') {
    g.rect(-s * .7, -s * .7, s * 1.4, s * 1.2); g.fill(); g.stroke()
    line(-s * .84, s * .16, s * .84, s * .16); line(0, -s * .7, 0, s * .65)
    g.ellipse(-s * .28, s * .66, s * .28, s * .19); g.stroke()
    g.ellipse(s * .28, s * .66, s * .28, s * .19); g.stroke()
  } else if (kind === 'rules') {
    g.roundRect(-s * .75, -s * .7, s * 1.5, s * 1.4, s * .1); g.fill(); g.stroke()
    line(0, -s * .7, 0, s * .7)
    for (const yy of [-.25, .15, .45]) { line(-s * .55, s * yy, -s * .18, s * yy); line(s * .18, s * yy, s * .55, s * yy) }
  } else if (kind === 'resume') {
    g.arc(0, 0, s * .72, Math.PI * .25, Math.PI * 1.9, false); g.stroke()
    line(s * .7, -s * .28, s * .77, s * .12); line(s * .7, -s * .28, s * .3, -s * .22)
  } else {
    g.roundRect(-s * .7, -s * .55, s * .9, s * 1.3, s * .1); g.fill(); g.stroke()
    g.roundRect(-s * .15, -s * .75, s * .9, s * 1.3, s * .1); g.fill(); g.stroke()
  }
  return node
}
