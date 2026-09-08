import { _decorator, Color, Component, Game, game, Graphics, Node, Rect, Size, Sprite, SpriteFrame, Texture2D, UIOpacity, UITransform } from 'cc'
import { loadGameAsset } from '../services/GameAssetLoader'
import { LOBBY_MOTION, type LobbyMotionClock, stepLobbyMotion } from './LobbyMotionPolicy'

type MotionOptions = { width: number, height: number, scale: number, clock: LobbyMotionClock, allowed: () => boolean }

/** One bounded accent on the primary action. Never moves its target or listens for touches. */
@_decorator.ccclass('LobbyAmbientMotion')
export class LobbyAmbientMotion extends Component {
  private options: MotionOptions | null = null
  private frames: SpriteFrame[] = []
  private star: Sprite | null = null
  private rim: UIOpacity | null = null
  private cancelLoad: (() => void) | null = null
  private foreground = true
  private lastFrame = -2
  private motionPreference: { matches: boolean } | null = null

  public init (options: MotionOptions): void {
    this.options = options
    if (typeof globalThis.matchMedia === 'function') this.motionPreference = globalThis.matchMedia('(prefers-reduced-motion: reduce)')
    const { width, height, scale: s } = options
    const outline = new Node('SoftRim')
    outline.parent = this.node
    const g = outline.addComponent(Graphics)
    g.lineWidth = 1.3 * s
    g.strokeColor = new Color(255, 247, 204)
    g.roundRect(-width / 2 + 3 * s, -height / 2 + 3 * s, width - 6 * s, height - 6 * s, 6 * s)
    g.stroke()
    this.rim = outline.addComponent(UIOpacity)
    this.rim.opacity = 0
    const star = new Node('CornerGlint')
    star.parent = this.node
    star.setPosition(width / 2 - 12 * s, height / 2 - 12 * s)
    star.addComponent(UITransform).setContentSize(22 * s, 22 * s)
    this.star = star.addComponent(Sprite)
    this.star.sizeMode = Sprite.SizeMode.CUSTOM
    this.star.enabled = false
    this.cancelLoad = loadGameAsset('effects/lobby-v1/button-glint/texture', Texture2D, (error, texture) => {
      if (!this.isValid || !this.node.isValid) return
      if (error || !texture) { console.warn('[LobbyMotion] Optional glint unavailable; static button retained'); return }
      const { cell, columns, frames } = LOBBY_MOTION
      if (texture.width !== cell * columns || texture.height !== cell * 2) {
        console.warn('[LobbyMotion] Unexpected glint atlas dimensions; static button retained')
        return
      }
      for (let i = 0; i < frames; i++) {
        const frame = new SpriteFrame()
        frame.reset({ texture, rect: new Rect(i % columns * cell, Math.floor(i / columns) * cell, cell, cell), originalSize: new Size(cell, cell) })
        frame.packable = false
        this.frames.push(frame)
      }
    })
  }

  protected onEnable (): void { game.on(Game.EVENT_HIDE, this.hide, this); game.on(Game.EVENT_SHOW, this.show, this) }
  protected onDisable (): void { game.off(Game.EVENT_HIDE, this.hide, this); game.off(Game.EVENT_SHOW, this.show, this); this.paint(-1) }
  private hide (): void { this.foreground = false; if (this.options) this.options.clock.elapsed = 0; this.paint(-1) }
  private show (): void { this.foreground = true }

  protected update (dt: number): void {
    const o = this.options
    if (!o) return
    // Parent is the existing button; its own press animation stays the sole transform owner.
    const pressed = (this.node.parent?.scale.x ?? 1) < .999
    const allowed = this.foreground && !pressed && !this.motionPreference?.matches && o.allowed() && this.frames.length === LOBBY_MOTION.frames
    this.paint(stepLobbyMotion(o.clock, dt, allowed))
  }

  private paint (frame: number): void {
    if (frame === this.lastFrame) return
    this.lastFrame = frame
    if (this.star) {
      this.star.enabled = frame >= 0
      if (frame >= 0) this.star.spriteFrame = this.frames[frame]
    }
    if (this.rim) this.rim.opacity = frame < 0 ? 0 : Math.round(55 * Math.sin(Math.PI * frame / (LOBBY_MOTION.frames - 1)))
  }

  protected onDestroy (): void {
    this.cancelLoad?.()
    this.cancelLoad = null
    if (this.star?.isValid) this.star.spriteFrame = null
    this.frames.forEach(frame => frame.destroy())
    this.frames = []
    this.options = null
  }
}

export function attachLobbyAmbientMotion (button: Node, options: MotionOptions): void {
  const decoration = new Node('LobbyAmbientDecoration')
  decoration.parent = button
  decoration.addComponent(LobbyAmbientMotion).init(options)
}
