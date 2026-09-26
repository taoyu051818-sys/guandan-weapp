import { _decorator, Color, Component, Game, game, Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc'
import { loadGameAsset } from '../services/GameAssetLoader'
import { STAR_GLINT_TEXTURE, sampleStarGlint, stepStarGlint, type StarGlintClock, type StarGlintProfile, type StarGlintSequence } from './StarGlintPolicy'

type SharedOptions = {
  scale?: number, allowed: () => boolean, clock?: StarGlintClock, pressTarget?: Node, intensity?: () => number,
}
type PointOptions = SharedOptions & { x: number, y: number, profile: StarGlintProfile }
type SequenceOptions = SharedOptions & { width: number, height: number, points: StarGlintSequence }
type Options = PointOptions | SequenceOptions
type RenderPoint = { node: Node, sprite: Sprite, profile: StarGlintProfile, tint: Color }

/** One clock, one shared texture/frame, and no input handlers for either a single glint or a sequence. */
@_decorator.ccclass('StarGlint')
export class StarGlint extends Component {
  private options: Options | null = null
  private clock: StarGlintClock = { elapsed: 0 }
  private points: RenderPoint[] = []
  private frame: SpriteFrame | null = null
  private texture: Texture2D | null = null
  private cancelLoad: (() => void) | null = null
  private foreground = true
  private disposed = false
  private preference: { matches: boolean } | null = null

  public init (options: Options): void {
    this.options = options
    this.clock = options.clock ?? this.clock
    if (typeof globalThis.matchMedia === 'function') this.preference = globalThis.matchMedia('(prefers-reduced-motion: reduce)')
    if ('points' in options) {
      for (const point of options.points) {
        const node = new Node('StarGlintPoint')
        node.parent = this.node; node.layer = this.node.layer
        node.setPosition((point.x - .5) * options.width, (.5 - point.y) * options.height, 0)
        this.addPoint(node, point.profile, options.scale ?? 1)
      }
    } else this.addPoint(this.node, options.profile, options.scale ?? 1)
    this.cancelLoad = loadGameAsset(STAR_GLINT_TEXTURE, Texture2D, (error, texture) => {
      if (this.disposed || !this.isValid || !this.node.isValid) return
      if (error || !texture) { console.warn('[StarGlint] Optional texture unavailable; keeping static artwork'); return }
      texture.addRef(); this.texture = texture
      this.frame = new SpriteFrame(); this.frame.reset({ texture }); this.frame.packable = false
      for (const point of this.points) point.sprite.spriteFrame = this.frame
    })
  }
  private addPoint (node: Node, profile: StarGlintProfile, scale: number): void {
    node.addComponent(UITransform).setContentSize(profile.size * scale, profile.size * scale)
    const sprite = node.addComponent(Sprite)
    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.enabled = false
    this.points.push({ node, sprite, profile, tint: new Color(255, 255, 255, 0) })
  }
  protected onEnable (): void { this.foreground = true; game.on(Game.EVENT_HIDE, this.hide, this); game.on(Game.EVENT_SHOW, this.show, this) }
  protected onDisable (): void {
    game.off(Game.EVENT_HIDE, this.hide, this); game.off(Game.EVENT_SHOW, this.show, this)
    this.hidePoints()
    // The view owns shared clocks: redraws must not replay a completed reward.
  }
  private hidePoints (): void { for (const point of this.points) if (point.sprite.isValid) point.sprite.enabled = false }
  private hide (): void { this.foreground = false; this.clock.elapsed = 0; this.hidePoints() }
  private show (): void { this.foreground = true }
  protected update (dt: number): void {
    const o = this.options, first = this.points[0]
    if (!o || !first || this.disposed) return
    const allowed = this.foreground && !this.preference?.matches && !!this.frame && o.allowed() && (o.pressTarget?.scale.x ?? 1) >= .999
    const firstStrength = stepStarGlint(this.clock, dt, allowed, first.profile)
    if (!allowed || !Number.isFinite(dt) || dt < 0 || dt > .25 || this.clock.completed) { this.hidePoints(); return }
    const gain = Math.max(0, Math.min(1, o.intensity?.() ?? 1))
    for (const point of this.points) {
      const strength = (point === first ? firstStrength : sampleStarGlint(this.clock.elapsed, point.profile)) * gain
      point.sprite.enabled = strength > .005
      if (!point.sprite.enabled) continue
      point.tint.a = Math.round(255 * strength); point.sprite.color = point.tint
      const scale = .72 + .28 * strength / point.profile.strength
      point.node.setScale(scale, scale, 1); point.node.angle = -8 + 3 * strength
    }
  }
  protected onDestroy (): void {
    this.disposed = true
    this.cancelLoad?.(); this.cancelLoad = null
    for (const point of this.points) if (point.sprite.isValid) point.sprite.spriteFrame = null
    this.frame?.destroy(); this.frame = null
    this.texture?.decRef(); this.texture = null
    this.points = []; this.options = null
  }
}

export function attachStarGlint (parent: Node, options: PointOptions): Node {
  const node = new Node('MetalStarGlint')
  node.parent = parent; node.layer = parent.layer
  node.setPosition(options.x, options.y, 0)
  node.addComponent(StarGlint).init(options)
  return node
}

export function attachStarGlintSequence (parent: Node, options: SequenceOptions): Node {
  const node = new Node('MetalStarGlintSequence')
  node.parent = parent; node.layer = parent.layer
  node.addComponent(StarGlint).init(options)
  return node
}
