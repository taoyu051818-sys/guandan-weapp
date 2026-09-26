import { _decorator, Color, Component, Game, game, Graphics, Node, Sprite, UIOpacity, UITransform } from 'cc'

type Options = { scale: number, allowed: () => boolean, pressTarget: Node }
type Crop = { x: number, y: number, width: number, height: number }
export const FRIEND_STEAM_PERIOD = 3.6

/** Source pixel centre of the spout opening in the unchanged 675×900 artwork.
 * Use the actual SpriteFrame crop, so cover, texture import size and UI scale agree. */
export function projectFriendSpout (texture: { width: number, height: number }, crop: Crop, size: { width: number, height: number }) {
  return {
    x: ((texture.width * (156 / 675) - crop.x) / crop.width - .5) * size.width,
    y: (.5 - (texture.height * (276 / 900) - crop.y) / crop.height) * size.height,
  }
}

/** A periodic upward travelling wave with an immovable origin and fading tip. */
export function sampleFriendSteam (height: number, elapsed: number, lane: number) {
  const phase = elapsed / FRIEND_STEAM_PERIOD * Math.PI * 2 + lane * Math.PI * 2 / 3
  return {
    x: height * (Math.sin(height * Math.PI * 2 - phase) * 5 + (lane - 1) * 2),
    y: height * 52,
    strength: (.76 + .24 * Math.sin(height * Math.PI * 2 - phase)) * (1 - height) ** 1.1,
  }
}

/** Continuous source-anchored steam. No timers, textures, touch targets or frame-reset gaps. */
@_decorator.ccclass('FriendEntrySteam')
export class FriendEntrySteam extends Component {
  private options: Options | null = null
  private graphics: Graphics | null = null
  private opacity: UIOpacity | null = null
  private elapsed = 0
  private drawElapsed = 0
  private foreground = true
  private preference: { matches: boolean } | null = null
  private readonly tint = new Color(248, 253, 255, 0)

  public init (options: Options): void {
    this.options = options
    if (typeof globalThis.matchMedia === 'function') this.preference = globalThis.matchMedia('(prefers-reduced-motion: reduce)')
    this.node.addComponent(UITransform).setContentSize(26 * options.scale, 52 * options.scale)
    this.opacity = this.node.addComponent(UIOpacity)
    this.opacity.opacity = 0
    this.graphics = this.node.addComponent(Graphics)
  }

  private draw (): void {
    const g = this.graphics, o = this.options
    if (!g || !o) return
    g.clear()
    // Bounded reusable geometry at 30 Hz. Layers soften the plume instead of
    // moving an entire S-shaped sprite away from the spout.
    for (let lane = 0; lane < 3; lane++) {
      for (const [width, alpha, r, green, b] of [[16, 24, 108, 157, 178], [12, 28, 248, 253, 255], [8, 46, 248, 253, 255], [5, 66, 248, 253, 255], [2.8, 80, 255, 255, 255]]) {
        this.tint.r = r; this.tint.g = green; this.tint.b = b
        for (let i = 0; i < 16; i++) {
          const a = sampleFriendSteam(i / 16, this.elapsed, lane)
          const b = sampleFriendSteam((i + 1) / 16, this.elapsed, lane)
          this.tint.a = Math.round(alpha * (a.strength + b.strength) / 2)
          g.strokeColor = this.tint
          g.lineWidth = width * o.scale * (.32 + i / 16 * .68)
          g.moveTo(a.x * o.scale, a.y * o.scale)
          g.lineTo(b.x * o.scale, b.y * o.scale)
          g.stroke()
        }
      }
    }
  }

  protected onEnable (): void { this.foreground = true; game.on(Game.EVENT_HIDE, this.hide, this); game.on(Game.EVENT_SHOW, this.show, this) }
  protected onDisable (): void {
    game.off(Game.EVENT_HIDE, this.hide, this); game.off(Game.EVENT_SHOW, this.show, this)
    this.clear()
  }
  private clear (): void { this.elapsed = 0; this.drawElapsed = 0; if (this.opacity) this.opacity.opacity = 0 }
  private hide (): void { this.foreground = false; this.clear() }
  private show (): void { this.foreground = true }
  protected update (dt: number): void {
    const o = this.options
    if (!o) return
    const slice = this.node.parent?.children.find(child => child.name === 'ArtworkSlice')
    const frame = slice?.getComponent(Sprite)?.spriteFrame
    const size = slice?.getComponent(UITransform)
    if (!this.foreground || this.preference?.matches || !o.allowed() || o.pressTarget.scale.x < .999 ||
      !frame?.texture || !size || !slice || !Number.isFinite(dt) || dt < 0 || dt > .25) { this.clear(); return }
    const anchor = projectFriendSpout(frame.texture, frame.rect, size)
    this.node.setPosition(slice.position.x + anchor.x, slice.position.y + anchor.y, 0)
    this.elapsed += dt
    if (this.opacity) this.opacity.opacity = Math.round(255 * Math.min(1, this.elapsed / .45))
    this.drawElapsed += dt
    if (this.drawElapsed >= 1 / 30) { this.drawElapsed %= 1 / 30; this.draw() }
  }
  protected onDestroy (): void { this.options = null; this.graphics = null; this.opacity = null }
}

export function attachFriendEntrySteam (artwork: Node, options: Options): void {
  // The 52px plume crosses the card top without enlarging its clickable area.
  const node = new Node('FriendEntrySteam')
  node.parent = artwork; node.layer = artwork.layer
  node.addComponent(FriendEntrySteam).init(options)
}
