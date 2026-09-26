import { _decorator, Component, Game, game, Node, Rect, Size, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc'
import { loadGameAsset } from '../services/GameAssetLoader'
import { CLASSIC_ENTRY_ANIMATION as P, classicEntryFrameRect, stepClassicEntry, type ClassicEntryClock } from './ClassicEntryAnimationPolicy'

type Options = { width: number, height: number, allowed: () => boolean, clock: ClassicEntryClock, pressTarget: Node }

/** Only owns the illustrated area; labels, layout and button input remain with the lobby. */
@_decorator.ccclass('ClassicEntryAnimation')
export class ClassicEntryAnimation extends Component {
  private options: Options | null = null
  private sprite: Sprite | null = null
  private frames: SpriteFrame[] = []
  private textures: Texture2D[] = []
  private poster: SpriteFrame | null = null
  private cancels: Array<() => void> = []
  private loading = false
  private failed = false
  private disposed = false
  private foreground = true
  private lastFrame = -1
  private preference: { matches: boolean } | null = null

  public init (options: Options): void {
    this.options = options
    options.clock.elapsed = 0; options.clock.playing = false
    if (typeof globalThis.matchMedia === 'function') this.preference = globalThis.matchMedia('(prefers-reduced-motion: reduce)')
    this.node.addComponent(UITransform).setContentSize(options.width, options.height)
    this.sprite = this.node.addComponent(Sprite)
    this.sprite.sizeMode = Sprite.SizeMode.CUSTOM
    this.sprite.enabled = false
    this.cancels.push(loadGameAsset(P.assetPrefix + 'poster/texture', Texture2D, (error, texture) => {
      if (this.disposed || !this.isValid || !this.node.isValid || error || !texture) return
      // This small frame stays usable even when atlas loading or motion is disabled.
      texture.addRef(); this.textures.push(texture)
      this.poster = new SpriteFrame(); this.poster.reset({ texture }); this.poster.packable = false
      this.paint(Math.max(0, this.lastFrame))
    }))
  }

  protected onEnable (): void { this.foreground = true; game.on(Game.EVENT_HIDE, this.hide, this); game.on(Game.EVENT_SHOW, this.show, this) }
  protected onDisable (): void { game.off(Game.EVENT_HIDE, this.hide, this); game.off(Game.EVENT_SHOW, this.show, this); this.reset() }
  private reset (): void {
    if (this.options) { this.options.clock.elapsed = 0; this.options.clock.playing = false }
    this.paint(0)
  }
  private hide (): void { this.foreground = false; this.reset() }
  private show (): void { this.foreground = true }

  protected update (dt: number): void {
    const o = this.options
    if (!o || this.disposed) return
    const allowed = this.foreground && !this.preference?.matches && o.allowed() && o.pressTarget.scale.x >= .999
    // At most one pending page. Loading is optional and never delays navigation.
    if (allowed && !this.loading && !this.failed && this.frames.length < P.frames) this.loadPage(this.frames.length / (P.columns * P.rows))
    const ready = this.frames.length === P.frames && !this.failed
    this.paint(stepClassicEntry(o.clock, dt, allowed && ready))
  }

  private loadPage (page: number): void {
    this.loading = true
    this.cancels.push(loadGameAsset(P.assetPrefix + page + '/texture', Texture2D, (error, texture) => {
      if (this.disposed || !this.isValid || !this.node.isValid) return
      this.loading = false
      if (error || !texture || texture.width !== (P.width + 2 * P.padding) * P.columns || texture.height !== (P.height + 2 * P.padding) * P.rows) {
        this.failed = true; this.reset()
        console.warn('[ClassicEntryAnimation] Optional atlas unavailable; static artwork retained')
        return
      }
      texture.addRef(); this.textures.push(texture)
      for (let cell = 0; cell < P.columns * P.rows; cell++) {
        const r = classicEntryFrameRect(page * P.columns * P.rows + cell)
        const frame = new SpriteFrame()
        frame.reset({ texture, rect: new Rect(r.x, r.y, r.width, r.height), originalSize: new Size(r.width, r.height) })
        frame.packable = false
        this.frames.push(frame)
      }
    }))
  }

  private paint (index: number): void {
    if (!this.sprite?.isValid) return
    const frame = index === 0 && this.poster ? this.poster : this.frames[index]
    if (!frame) return // Existing static artwork underneath is the final fallback.
    if (this.lastFrame === index && this.sprite.spriteFrame === frame) return
    this.lastFrame = index
    this.sprite.spriteFrame = frame
    this.sprite.enabled = true
  }

  protected onDestroy (): void {
    this.disposed = true
    this.reset()
    this.cancels.forEach(cancel => cancel()); this.cancels = []
    if (this.sprite?.isValid) this.sprite.spriteFrame = null
    this.frames.forEach(frame => frame.destroy()); this.frames = []
    this.poster?.destroy(); this.poster = null
    this.textures.forEach(texture => texture.decRef()); this.textures = []
    this.options = null
  }
}

export function attachClassicEntryAnimation (artwork: Node, options: Options): void {
  const node = new Node('ClassicEntryAnimation')
  node.parent = artwork; node.layer = artwork.layer
  node.addComponent(ClassicEntryAnimation).init(options)
}
