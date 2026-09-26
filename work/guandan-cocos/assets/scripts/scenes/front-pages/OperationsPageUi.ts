import { Color, Label, Node, UITransform, Vec3 } from 'cc'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { TableViewport } from '../../ui/ScreenAdapter'

export const operationsPalette = {
  panel: new Color(16, 43, 48, 248), line: new Color(150, 191, 184, 200),
  text: new Color(249, 244, 222), muted: new Color(198, 218, 214),
  gold: new Color(248, 208, 112), button: new Color(49, 100, 94), primary: new Color(133, 87, 28),
}

/** Match the existing coastal panel grid; safe-area fit and generous touch controls. */
export class OperationsPageUi {
  public readonly ui: RuntimeUiFactory

  public constructor (parent: RuntimeUiFactory, viewport: TableViewport) {
    const node = new Node('OperationsSurface')
    node.parent = parent.parent
    node.addComponent(UITransform).setContentSize(1180, 560)
    const width = viewport.width - (viewport.safeLeft || 0) - (viewport.safeRight || 0)
    const height = viewport.height - (viewport.safeTop || 0) - (viewport.safeBottom || 0)
    const scale = Math.min(width / 1240, height / 600)
    node.setScale(new Vec3(scale, scale, 1))
    node.setPosition(new Vec3(((viewport.safeLeft || 0) - (viewport.safeRight || 0)) / 2, ((viewport.safeBottom || 0) - (viewport.safeTop || 0)) / 2, 0))
    this.ui = new RuntimeUiFactory(node)
    this.ui.panel('OperationsBody', 0, -7, 1160, 394, { fill: operationsPalette.panel, stroke: operationsPalette.line, frame: 'panel' })
  }

  public text (name: string, value: string, x: number, y: number, width: number, height: number, size = 26, color = operationsPalette.text): Label {
    const label = this.ui.label(name, x, y, size)
    label.string = value; label.color = color; label.lineHeight = size + 10
    label.node.getComponent(UITransform)?.setContentSize(width, height)
    label.enableWrapText = true; label.overflow = Label.Overflow.SHRINK
    return label
  }

  public button (name: string, text: string, x: number, y: number, width: number, action: () => void, primary = false, disabled = false): void {
    const node = this.ui.button(name, text, x, width, 80, 28, {
      frame: 'control', fill: primary ? operationsPalette.primary : operationsPalette.button,
      stroke: primary ? operationsPalette.gold : operationsPalette.line, disabled,
    })
    node.setPosition(new Vec3(x, y, 0))
    if (!disabled) node.on(Node.EventType.TOUCH_END, action)
  }
}
