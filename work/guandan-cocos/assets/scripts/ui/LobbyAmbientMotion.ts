import { _decorator, Component, Game, game, Node, Rect, Size, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc'
import { loadGameAsset } from '../services/GameAssetLoader'
import { LOBBY_MOTION, type LobbyMotionClock, stepLobbyMotion } from './LobbyMotionPolicy'

type MotionOptions = { width: number, height: number, clock: LobbyMotionClock, allowed: () => boolean }

/** One bounded accent on the primary action. Never moves its target or listens for touches. */
@_decorator.ccclass('LobbyAmbientMotion')
export class LobbyAmbientMotion extends Component {
  private options: MotionOptions | null = null
  private frames: SpriteFrame[] = []
  private star: Sprite | null = null
  private cancelLoad: (() => void) | null = null
  private foreground = true
  private lastFrame = -2
  private motionPreference: { matches: boolean } | null = null

  public init (options: MotionOptions): void {
    this.options = options
    if (typeof globalThis.matchMedia === 'function') this.motionPreference = globalThis.matchMedia('(prefers-reduced-motion: reduce)')
    const { width, height } = options
    const star = new Node('QuickStartStar')
    star.parent = this.node
    star.layer = this.node.layer
    star.addComponent(UITransform).setContentSize(width, height)
    this.star = star.addComponent(Sprite)
    this.star.sizeMode = Sprite.SizeMode.CUSTOM
    this.star.enabled = false
    this.cancelLoad = loadGameAsset(LOBBY_MOTION.texture, Texture2D, (error, texture) => {
      if (!this.isValid || !this.node.isValid) return
      if (error || !texture) { console.warn('[LobbyMotion] Optional star sheet unavailable; static button retained'); return }
      const { frameWidth, frameHeight, columns, rows, frames, contentInset } = LOBBY_MOTION
      if (texture.width !== frameWidth * columns || texture.height !== frameHeight * rows) {
        console.warn('[LobbyMotion] Unexpected star sheet dimensions; static button retained')
        return
      }
      // Use the same content window for every frame (including blank ones).
      // Removing the authored transparent border fills the button without
      // enlarging its hit box or trimming frames individually and causing jitter.
      const contentWidth = frameWidth - contentInset * 2
      const contentHeight = frameHeight - contentInset * 2
      for (let i = 0; i < frames; i++) {
        const frame = new SpriteFrame()
        frame.reset({ texture, rect: new Rect(i % columns * frameWidth + contentInset, Math.floor(i / columns) * frameHeight + contentInset, contentWidth, contentHeight), originalSize: new Size(contentWidth, contentHeight) })
        frame.packable = false
        this.frames.push(frame)
      }
    })
  }

  protected onEnable (): void { this.foreground = true; game.on(Game.EVENT_HIDE, this.hide, this); game.on(Game.EVENT_SHOW, this.show, this) }
  protected onDisable (): void {
    game.off(Game.EVENT_HIDE, this.hide, this)
    game.off(Game.EVENT_SHOW, this.show, this)
    if (this.options) this.options.clock.elapsed = 0
    this.paint(-1)
  }
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
  decoration.layer = button.layer
  decoration.addComponent(LobbyAmbientMotion).init(options)
}
