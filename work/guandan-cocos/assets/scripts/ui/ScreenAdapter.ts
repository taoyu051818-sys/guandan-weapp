import { _decorator, Component, EventTarget, Size, UITransform, Vec2, Vec3, sys, view } from 'cc'
import { readWechatCapsule, type SceneExclusionRect, type WechatWindowApi } from './WechatCapsuleLayout'

export type TableViewport = {
  width: number
  height: number
  halfWidth: number
  halfHeight: number
  safeLeft: number
  safeRight: number
  safeTop: number
  safeBottom: number
  nativeCapsule?: SceneExclusionRect
}

const { ccclass } = _decorator

/**
 * Single responsive-layout authority for the Cocos table.
 * Coordinates stay centered at (0, 0), while width/height and safe insets
 * are refreshed for notches, tablets, foldables and ultrawide displays.
 */
@ccclass('ScreenAdapter')
export class ScreenAdapter extends Component {
  public readonly events = new EventTarget()
  public viewport: TableViewport = { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 }

  protected onEnable (): void {
    view.on('canvas-resize', this.refresh, this)
    this.refresh()
  }

  protected onDisable (): void { view.off('canvas-resize', this.refresh, this) }

  public refresh (): void {
    const visible = view.getVisibleSize()
    const safe = sys.getSafeAreaRect()
    const width = visible.width
    const height = visible.height
    const safeLeft = Math.max(0, safe.x)
    const safeBottom = Math.max(0, safe.y)
    const safeRight = Math.max(0, width - safe.x - safe.width)
    const safeTop = Math.max(0, height - safe.y - safe.height)
    const nativeCapsule = readWechatCapsule(width, height, (globalThis as unknown as { wx?: WechatWindowApi }).wx)
    this.viewport = { width, height, halfWidth: width / 2, halfHeight: height / 2, safeLeft, safeRight, safeTop, safeBottom, nativeCapsule }
    const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform)
    transform!.setContentSize(new Size(width, height))
    this.node.setPosition(Vec3.ZERO)
    this.events.emit('guandan:viewport', this.viewport)
  }

  /** Converts the screen's safe left edge to centered GameRoot coordinates. */
  public safeLeftX (margin = 0): number { return -this.viewport.halfWidth + this.viewport.safeLeft + margin }
  /** Converts the screen's safe right edge to centered GameRoot coordinates. */
  public safeRightX (margin = 0): number { return this.viewport.halfWidth - this.viewport.safeRight - margin }
  public safeBottomY (margin = 0): number { return -this.viewport.halfHeight + this.viewport.safeBottom + margin }
  public safeTopY (margin = 0): number { return this.viewport.halfHeight - this.viewport.safeTop - margin }
  public safeSize (): Vec2 { return new Vec2(this.viewport.width - this.viewport.safeLeft - this.viewport.safeRight, this.viewport.height - this.viewport.safeTop - this.viewport.safeBottom) }
}
