import { Component, UITransform, Vec3, view } from 'cc'

/** Keeps the table inside safe horizontal bounds on 16:9, 19.5:9 and tablets. */
export class TableLayout extends Component {
  private readonly designWidth = 1280
  private readonly designHeight = 720

  protected onEnable (): void {
    view.on('canvas-resize', this.layout, this)
    this.layout()
  }

  protected onDisable (): void {
    view.off('canvas-resize', this.layout, this)
  }

  public layout (): void {
    const visible = view.getVisibleSize()
    const scale = Math.min(visible.width / this.designWidth, visible.height / this.designHeight)
    const transform = this.getComponent(UITransform)
    if (!transform) return
    transform.setContentSize(this.designWidth, this.designHeight)
    this.node.setScale(new Vec3(scale, scale, 1))
  }
}
