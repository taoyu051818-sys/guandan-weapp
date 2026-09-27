import { Color, EditBox, Graphics, Label, Mask, Node, ScrollView, UITransform, Vec2, Vec3 } from 'cc'
import { RuntimeUiFactory, type RuntimeTextInputOptions } from './RuntimeUiFactory'
import { coastalText } from './CoastalUi'
import { drawUiFrame } from './UiFrameStyle'
import { SECONDARY_FRAME, secondaryPagePlacement } from './SecondaryPagePolicy'
import type { TableViewport } from './ScreenAdapter'

export const secondaryColors = {
  panel: new Color(18, 43, 63, 253), raised: new Color(28, 61, 82), inset: new Color(13, 34, 51),
  line: new Color(62, 97, 116), text: new Color(238, 245, 248), muted: new Color(171, 194, 207),
  gold: new Color(245, 207, 128), ink: new Color(53, 42, 25), blue: new Color(132, 207, 228),
}

/** Scoped primitives. No runtime-factory defaults or game-table styles are changed. */
export class SecondaryPageUi {
  public constructor (public readonly ui: RuntimeUiFactory) {}

  public text (name: string, value: string, x: number, y: number, width: number, height: number,
    size = 24, color = secondaryColors.text, left = true, bold = false): Label {
    const label = coastalText(this.ui, value, x, y, width, height, size, { color, left, bold })
    label.node.name = name
    return label
  }

  public panel (name: string, x: number, y: number, width: number, height: number, fill = secondaryColors.raised): Node {
    return this.ui.panel(name, x, y, width, height, { fill, stroke: secondaryColors.line, lineWidth: 1, frame: 'panel' })
  }

  public button (name: string, value: string, x: number, y: number, width: number, action: () => void,
    primary = false, disabled = false, height = 64): Node {
    const node = this.ui.button(name, value, x, width, height, 24, {
      fill: primary ? secondaryColors.gold : secondaryColors.raised,
      pressedFill: primary ? new Color(222, 183, 104) : new Color(43, 83, 108),
      stroke: primary ? secondaryColors.gold : secondaryColors.line, lineWidth: 1, frame: 'control', disabled,
      textColor: primary ? secondaryColors.ink : secondaryColors.text,
    })
    node.setPosition(x, y, 0)
    node.getComponent(UITransform)?.setContentSize(width, Math.max(72, height))
    const label = node.getChildByName('ButtonText')?.getComponent(Label)
    if (label) { label.enableOutline = false; label.isBold = true; label.enableWrapText = false }
    if (!disabled) node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  public input (name: string, placeholder: string, x: number, y: number, options: RuntimeTextInputOptions): EditBox {
    const edit = this.ui.formInput(name, placeholder, x, y, options)
    const graphics = edit.node.parent?.getComponent(Graphics)
    if (graphics) {
      const width = options.width ?? 330, height = options.height ?? 50
      graphics.clear(); graphics.fillColor = secondaryColors.inset; graphics.strokeColor = secondaryColors.line; graphics.lineWidth = 1
      drawUiFrame(graphics, -width / 2, -height / 2, width, height, 'control'); graphics.fill(); graphics.stroke()
    }
    for (const label of [edit.textLabel, edit.placeholderLabel]) if (label) {
      label.enableOutline = false; label.isBold = false; label.horizontalAlign = Label.HorizontalAlign.LEFT
      label.color = label === edit.textLabel ? secondaryColors.text : secondaryColors.muted
    }
    return edit
  }

  public scroll (name: string, x: number, top: number, bottom: number, width: number, contentHeight: number,
    position?: { offsetY: number, changed: (offset: number) => void }): SecondaryPageUi {
    const height = top - bottom
    const clip = new Node(name); clip.parent = this.ui.parent; clip.setPosition(x, (top + bottom) / 2, 0)
    clip.addComponent(UITransform).setContentSize(width, height); clip.addComponent(Mask)
    const content = new Node(name + 'Content'); content.parent = clip
    const transform = content.addComponent(UITransform); transform.setAnchorPoint(0.5, 1)
    transform.setContentSize(width, Math.max(height, contentHeight)); content.setPosition(0, height / 2, 0)
    const scroll = clip.addComponent(ScrollView); scroll.content = content; scroll.horizontal = false; scroll.elastic = false
    if (position) {
      scroll.scrollToOffset(new Vec2(0, Math.max(0, Math.min(position.offsetY, contentHeight - height))), 0)
      clip.on(ScrollView.EventType.SCROLLING, () => position.changed(scroll.getScrollOffset().y))
    }
    return new SecondaryPageUi(new RuntimeUiFactory(content))
  }

  public empty (title: string, detail: string, retry?: () => void): void {
    this.text('EmptyTitle', title, 0, 38, 860, 54, 30, secondaryColors.text, false, true)
    this.text('EmptyDetail', detail, 0, -20, 840, 68, 22, secondaryColors.muted, false)
    if (retry) this.button('EmptyRetry', '重新加载', 0, -104, 180, retry, true)
  }
}

export class SecondaryPageShell extends SecondaryPageUi {
  public constructor (parent: RuntimeUiFactory, title: string, back: () => void, viewport?: TableViewport) {
    const size = parent.parent.getComponent(UITransform)?.contentSize ?? { width: 1280, height: 590 }
    const placement = secondaryPagePlacement(viewport ?? size)
    const panel = parent.panel('SecondaryPageSurface', placement.x, placement.y, SECONDARY_FRAME.width, SECONDARY_FRAME.height,
      { fill: secondaryColors.panel, stroke: secondaryColors.line, lineWidth: 1, frame: 'panel' })
    panel.setScale(new Vec3(placement.scale, placement.scale, 1))
    super(new RuntimeUiFactory(panel))
    this.button('SecondaryBack', '返回', -471, 212, 122, back)
    this.text('SecondaryTitle', title, -125, 212, 514, 58, 34, secondaryColors.text, true, true)
    this.ui.panel('HeaderDivider', 0, 171, 1064, 1, { fill: secondaryColors.line, lineWidth: 0, frame: 'square' })
  }
}
