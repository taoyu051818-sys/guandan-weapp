import { Color, Node, Sprite, SpriteFrame, Texture2D, Tween, UIOpacity, UITransform, Vec3, tween } from 'cc'
import { loadGameAssetAsync } from '../services/GameAssetLoader'
import type { TableViewport } from '../ui/ScreenAdapter'

export type SceneBackdropMode = 'lobby' | 'table'

export const SCENE_BACKDROP_ASSETS: Readonly<Record<SceneBackdropMode, Readonly<{ path: string, width: number, height: number }>>> = Object.freeze({
  lobby: Object.freeze({ path: 'backgrounds/lobby-lingshui-coast-v1/texture', width: 1600, height: 719 }),
  table: Object.freeze({ path: 'backgrounds/table-perspective-blue-v2/texture', width: 1280, height: 720 }),
})

const BACKDROP_MODES: readonly SceneBackdropMode[] = Object.freeze(['lobby', 'table'])
const DEFAULT_VIEWPORT: TableViewport = Object.freeze({
  width: 1280,
  height: 720,
  halfWidth: 640,
  halfHeight: 360,
  safeLeft: 0,
  safeRight: 0,
  safeTop: 0,
  safeBottom: 0,
})

/** Owns background assets, transitions and cover sizing for the Game scene. */
export class SceneBackdropController {
  private backdropNode: Node | null = null
  private sprite: Sprite | null = null
  private opacity: UIOpacity | null = null
  private mode: SceneBackdropMode = 'lobby'
  private displayedMode: SceneBackdropMode | null = null
  private readonly frames = new Map<SceneBackdropMode, SpriteFrame>()
  private readonly sourceSizes = new Map<SceneBackdropMode, Readonly<{ width: number, height: number }>>()
  private readonly pendingLoads = new Map<SceneBackdropMode, Promise<void>>()
  private sourceSize = { width: SCENE_BACKDROP_ASSETS.lobby.width, height: SCENE_BACKDROP_ASSETS.lobby.height }
  private viewport: TableViewport
  private transitionRevision = 0
  private disposed = false

  public constructor (
    private readonly sceneRoot: Node,
    getInitialViewport: () => TableViewport | null,
  ) {
    this.viewport = getInitialViewport() ?? DEFAULT_VIEWPORT
  }

  /** Creates the render node after startup resources have settled. */
  public mount (): void {
    if (this.disposed || this.backdropNode) return
    const node = new Node('TableBackdrop')
    node.parent = this.sceneRoot
    node.addComponent(UITransform)
    const sprite = node.addComponent(Sprite)
    sprite.sizeMode = Sprite.SizeMode.CUSTOM
    const opacity = node.addComponent(UIOpacity)
    opacity.opacity = 0
    this.backdropNode = node
    this.sprite = sprite
    this.opacity = opacity
    this.resize(this.viewport)
    node.setSiblingIndex(0)
    BACKDROP_MODES.forEach(mode => {
      void this.preload(mode).catch(error => {
        if (!this.disposed) console.warn(`Unable to load the ${mode} backdrop texture.`, error)
      })
    })
  }

  /** Allows the loading screen to prime the lobby frame before the backdrop mounts. */
  public preload (mode: SceneBackdropMode): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.frames.has(mode)) {
      if (this.mode === mode) this.apply(mode)
      return Promise.resolve()
    }
    const pending = this.pendingLoads.get(mode)
    if (pending) return pending
    const load = this.load(mode)
    this.pendingLoads.set(mode, load)
    return load
  }

  public setMode (mode: SceneBackdropMode): void {
    if (this.disposed) return
    this.mode = mode
    this.apply(mode)
  }

  public resize (viewport: TableViewport): void {
    if (this.disposed) return
    this.viewport = viewport
    const node = this.backdropNode
    const transform = node?.getComponent(UITransform)
    if (!node || !transform) return
    const sourceWidth = Math.max(1, this.sourceSize.width)
    const sourceHeight = Math.max(1, this.sourceSize.height)
    const coverScale = Math.max(viewport.width / sourceWidth, viewport.height / sourceHeight)
    transform.setContentSize(sourceWidth * coverScale, sourceHeight * coverScale)
    node.setPosition(Vec3.ZERO)
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.transitionRevision += 1
    if (this.opacity?.isValid) Tween.stopAllByTarget(this.opacity)
    if (this.sprite?.isValid) this.sprite.spriteFrame = null
    if (this.backdropNode?.isValid) this.backdropNode.destroy()
    this.frames.forEach(frame => { if (frame.isValid) frame.destroy() })
    this.backdropNode = null
    this.sprite = null
    this.opacity = null
    this.frames.clear()
    this.sourceSizes.clear()
    this.pendingLoads.clear()
  }

  private async load (mode: SceneBackdropMode): Promise<void> {
    try {
      const texture = await loadGameAssetAsync(SCENE_BACKDROP_ASSETS[mode].path, Texture2D)
      if (!this.disposed) this.cacheTexture(mode, texture)
    } finally {
      this.pendingLoads.delete(mode)
    }
  }

  private cacheTexture (mode: SceneBackdropMode, texture: Texture2D): void {
    if (this.disposed) return
    if (!this.frames.has(mode)) {
      const frame = new SpriteFrame()
      frame.texture = texture
      this.frames.set(mode, frame)
    }
    this.sourceSizes.set(mode, { width: texture.width, height: texture.height })
    if (this.mode === mode) this.apply(mode)
  }

  private apply (mode: SceneBackdropMode): void {
    const frame = this.frames.get(mode)
    const sprite = this.sprite
    const opacity = this.opacity
    if (this.disposed || !frame || !sprite?.isValid || !opacity?.isValid) return
    const revision = ++this.transitionRevision
    Tween.stopAllByTarget(opacity)
    const commit = (): void => {
      if (this.disposed || revision !== this.transitionRevision || this.mode !== mode || !sprite.isValid) return
      sprite.spriteFrame = frame
      sprite.color = Color.WHITE
      this.sourceSize = this.sourceSizes.get(mode) ?? SCENE_BACKDROP_ASSETS[mode]
      this.displayedMode = mode
      this.resize(this.viewport)
    }
    if (this.displayedMode === null) {
      commit()
      opacity.opacity = 0
      tween(opacity).to(0.2, { opacity: 255 }).start()
      return
    }
    if (this.displayedMode === mode) {
      commit()
      opacity.opacity = 255
      return
    }
    tween(opacity)
      .to(0.1, { opacity: 0 })
      .call(commit)
      .to(0.18, { opacity: 255 })
      .start()
  }
}
