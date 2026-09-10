import { drawUiFrame } from './UiFrameStyle'
import { BlockInputEvents, Color, Graphics, Label, Node, Sprite, SpriteFrame, Texture2D, Tween, UIOpacity, UITransform, Vec3, tween } from 'cc'
import type { TableViewport } from './ScreenAdapter'
import { applyForegroundTextStyle, RUNTIME_MIN_TEXT_SIZE } from './RuntimeUiFactory'

export type StartupFailureCode = 'GD-S01' | 'GD-S02' | 'GD-S03' | 'GD-S04'

const FALLBACK_VIEWPORT: TableViewport = {
  width: 1280,
  height: 720,
  halfWidth: 640,
  halfHeight: 360,
  safeLeft: 0,
  safeRight: 0,
  safeTop: 0,
  safeBottom: 0,
}

const createLabel = (parent: Node, name: string, fontSize: number, color: Color): Label => {
  const resolvedFontSize = Math.max(RUNTIME_MIN_TEXT_SIZE, Math.round(fontSize))
  const node = new Node(name)
  node.parent = parent
  const transform = node.addComponent(UITransform)
  transform.setContentSize(600, Math.max(38, resolvedFontSize + 14))
  const label = node.addComponent(Label)
  label.fontSize = resolvedFontSize
  label.lineHeight = resolvedFontSize + 6
  label.color = color
  label.overflow = Label.Overflow.SHRINK
  label.enableWrapText = false
  label.horizontalAlign = Label.HorizontalAlign.CENTER
  label.verticalAlign = Label.VerticalAlign.CENTER
  return applyForegroundTextStyle(label, new Color(19, 32, 32, 255), 2)
}

/**
 * Input-blocking startup surface used while the resources bundle is prepared.
 * The artwork always uses cover sizing so resize and safe-area changes cannot
 * expose the canvas behind it.
 */
export class StartupLoadingOverlay {
  public readonly node: Node

  private readonly opacity: UIOpacity
  private readonly backgroundNode: Node
  private readonly backgroundTransform: UITransform
  private readonly fallbackTransform: UITransform
  private readonly fallbackGraphics: Graphics
  private readonly bandGraphics: Graphics
  private readonly trackGraphics: Graphics
  private readonly fillGraphics: Graphics
  private readonly titleLabel: Label
  private readonly statusLabel: Label
  private readonly percentLabel: Label
  private readonly retryNode: Node
  private readonly retryGraphics: Graphics
  private readonly retryLabel: Label
  private readonly backgroundFrame: SpriteFrame | null
  private readonly sourceWidth: number
  private readonly sourceHeight: number

  private progress = 0
  private progressWidth = 600
  private progressHeight = 8
  private retryCallback: (() => void) | null = null
  private fadePromise: Promise<void> | null = null
  private resolveFade: (() => void) | null = null
  private disposed = false

  public constructor (root: Node, texture: Texture2D | null, sourceWidth: number, sourceHeight: number) {
    this.node = new Node('StartupLoadingOverlay')
    this.node.parent = root
    this.node.addComponent(UITransform).setContentSize(FALLBACK_VIEWPORT.width, FALLBACK_VIEWPORT.height)
    this.node.addComponent(BlockInputEvents)
    this.opacity = this.node.addComponent(UIOpacity)

    this.backgroundNode = new Node('LoadingArtwork')
    this.backgroundNode.parent = this.node
    this.backgroundTransform = this.backgroundNode.addComponent(UITransform)
    this.backgroundFrame = texture ? new SpriteFrame() : null
    if (texture && this.backgroundFrame) {
      this.backgroundFrame.texture = texture
      const sprite = this.backgroundNode.addComponent(Sprite)
      sprite.spriteFrame = this.backgroundFrame
      sprite.sizeMode = Sprite.SizeMode.CUSTOM
    }
    const fallbackNode = new Node('ArtworkShade')
    fallbackNode.parent = this.backgroundNode
    this.fallbackTransform = fallbackNode.addComponent(UITransform)
    this.fallbackGraphics = fallbackNode.addComponent(Graphics)
    this.sourceWidth = Math.max(1, sourceWidth || texture?.width || FALLBACK_VIEWPORT.width)
    this.sourceHeight = Math.max(1, sourceHeight || texture?.height || FALLBACK_VIEWPORT.height)

    const bandNode = new Node('LoadingInformationBand')
    bandNode.parent = this.node
    bandNode.addComponent(UITransform)
    this.bandGraphics = bandNode.addComponent(Graphics)

    this.titleLabel = createLabel(bandNode, 'LoadingTitle', 27, new Color(255, 245, 220, 255))
    this.titleLabel.string = '正在准备牌桌'
    this.statusLabel = createLabel(bandNode, 'LoadingStatus', 18, new Color(225, 229, 226, 255))
    this.statusLabel.string = '正在检查游戏资源...'
    this.percentLabel = createLabel(bandNode, 'LoadingPercent', 18, new Color(255, 211, 102, 255))
    this.percentLabel.string = '0%'

    const trackNode = new Node('ProgressTrack')
    trackNode.parent = bandNode
    trackNode.addComponent(UITransform)
    this.trackGraphics = trackNode.addComponent(Graphics)

    const fillNode = new Node('ProgressFill')
    fillNode.parent = trackNode
    fillNode.addComponent(UITransform)
    this.fillGraphics = fillNode.addComponent(Graphics)

    this.retryNode = new Node('RetryButton')
    this.retryNode.parent = bandNode
    this.retryNode.addComponent(UITransform).setContentSize(156, 42)
    this.retryGraphics = this.retryNode.addComponent(Graphics)
    this.retryLabel = createLabel(this.retryNode, 'RetryLabel', 17, new Color(255, 230, 164, 255))
    this.retryLabel.string = '重新加载'
    this.retryLabel.node.getComponent(UITransform)?.setContentSize(144, 38)
    this.retryNode.on(Node.EventType.TOUCH_END, this.handleRetry, this)
    this.retryNode.active = false

    this.resize(FALLBACK_VIEWPORT)
  }

  public setProgress (progress: number, status: string): void {
    if (this.disposed) return
    this.progress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
    this.titleLabel.string = '正在准备牌桌'
    this.statusLabel.string = status
    this.percentLabel.string = `${Math.round(this.progress * 100)}%`
    this.retryNode.active = false
    this.retryCallback = null
    this.redrawProgress()
  }

  public showError (message: string, retry: () => void, code: StartupFailureCode): void {
    if (this.disposed) return
    const title = { 'GD-S01': '资源下载失败', 'GD-S02': '画面准备失败', 'GD-S03': '游戏初始化失败', 'GD-S04': '重新进入失败' }[code]
    this.titleLabel.string = `${title}（${code}）`
    this.statusLabel.string = message
    this.retryLabel.string = code === 'GD-S01' || code === 'GD-S02' ? '重试加载' : '重新进入'
    this.retryCallback = retry
    this.retryNode.active = true
    this.bringToFront()
  }

  public resize (viewport: TableViewport): void {
    if (this.disposed) return
    const transform = this.node.getComponent(UITransform)
    transform?.setContentSize(viewport.width, viewport.height)
    this.node.setPosition(Vec3.ZERO)

    const coverScale = Math.max(viewport.width / this.sourceWidth, viewport.height / this.sourceHeight)
    const artworkWidth = this.sourceWidth * coverScale
    const artworkHeight = this.sourceHeight * coverScale
    this.backgroundTransform.setContentSize(artworkWidth, artworkHeight)
    this.fallbackTransform.setContentSize(artworkWidth, artworkHeight)
    this.backgroundNode.setPosition(Vec3.ZERO)
    this.redrawFallback(artworkWidth, artworkHeight)

    const bandHeight = Math.min(172, Math.max(150, viewport.height * 0.25)) + viewport.safeBottom
    const bandY = -viewport.halfHeight + bandHeight / 2
    const bandNode = this.bandGraphics.node
    bandNode.getComponent(UITransform)?.setContentSize(viewport.width, bandHeight)
    bandNode.setPosition(new Vec3(0, bandY, 2))
    this.redrawBand(viewport.width, bandHeight)

    const safeWidth = Math.max(280, viewport.width - viewport.safeLeft - viewport.safeRight - 48)
    const contentWidth = Math.min(680, safeWidth)
    // The bottom-anchored band lifts its centre by only half the inset. Add the
    // remaining half so every content/control edge stays above the safe area.
    const contentOffsetY = viewport.safeBottom / 2 + 4
    this.progressWidth = Math.max(260, contentWidth - 80)
    this.progressHeight = 8
    this.titleLabel.node.setPosition(new Vec3(0, 49 + contentOffsetY, 1))
    this.statusLabel.node.setPosition(new Vec3(-40, 16 + contentOffsetY, 1))
    this.statusLabel.node.getComponent(UITransform)?.setContentSize(Math.max(200, contentWidth - 130), 28)
    this.percentLabel.node.setPosition(new Vec3(contentWidth / 2 - 55, 16 + contentOffsetY, 1))
    this.percentLabel.node.getComponent(UITransform)?.setContentSize(70, 28)
    this.trackGraphics.node.setPosition(new Vec3(0, -14 + contentOffsetY, 1))
    this.trackGraphics.node.getComponent(UITransform)?.setContentSize(this.progressWidth, this.progressHeight)
    this.retryNode.setPosition(new Vec3(0, -52 + contentOffsetY, 1))
    this.redrawProgress()
    this.redrawRetry()
  }

  public bringToFront (): void {
    if (this.disposed || !this.node.isValid || !this.node.parent) return
    this.node.setSiblingIndex(this.node.parent.children.length - 1)
  }

  public fadeOut (): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.fadePromise) return this.fadePromise
    this.retryNode.active = false
    this.retryCallback = null
    Tween.stopAllByTarget(this.opacity)
    this.fadePromise = new Promise(resolve => {
      this.resolveFade = resolve
      tween(this.opacity)
        .to(0.24, { opacity: 0 })
        .call(() => this.dispose())
        .start()
    })
    return this.fadePromise
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    Tween.stopAllByTarget(this.opacity)
    this.retryNode.off(Node.EventType.TOUCH_END, this.handleRetry, this)
    this.retryCallback = null
    if (this.node.isValid) {
      this.node.active = false
      this.node.destroy()
    }
    this.backgroundFrame?.destroy()
    const resolve = this.resolveFade
    this.resolveFade = null
    resolve?.()
  }

  private readonly handleRetry = (): void => {
    const retry = this.retryCallback
    if (!retry) return
    this.retryNode.active = false
    this.retryCallback = null
    this.titleLabel.string = '正在准备牌桌'
    this.statusLabel.string = '正在重新连接...'
    retry()
  }

  private redrawFallback (width: number, height: number): void {
    const graphics = this.fallbackGraphics
    graphics.clear()
    graphics.fillColor = this.backgroundFrame ? new Color(0, 0, 0, 18) : new Color(20, 53, 51, 255)
    graphics.rect(-width / 2, -height / 2, width, height)
    graphics.fill()
  }

  private redrawBand (width: number, height: number): void {
    const graphics = this.bandGraphics
    graphics.clear()
    graphics.fillColor = new Color(8, 18, 20, 205)
    graphics.rect(-width / 2, -height / 2, width, height)
    graphics.fill()
    graphics.fillColor = new Color(222, 177, 72, 150)
    graphics.rect(-width / 2, height / 2 - 2, width, 2)
    graphics.fill()
  }

  private redrawProgress (): void {
    const track = this.trackGraphics
    track.clear()
    track.fillColor = new Color(255, 255, 255, 50)
    drawUiFrame(track, -this.progressWidth / 2, -this.progressHeight / 2, this.progressWidth, this.progressHeight, 'progress')
    track.fill()

    const fill = this.fillGraphics
    fill.clear()
    if (this.progress <= 0) return
    const width = Math.max(this.progressHeight, this.progressWidth * this.progress)
    fill.fillColor = new Color(244, 188, 62, 255)
    drawUiFrame(fill, -this.progressWidth / 2, -this.progressHeight / 2, width, this.progressHeight, 'progress')
    fill.fill()
  }

  private redrawRetry (): void {
    const graphics = this.retryGraphics
    graphics.clear()
    graphics.fillColor = new Color(13, 28, 30, 230)
    graphics.strokeColor = new Color(232, 191, 93, 255)
    graphics.lineWidth = 2
    drawUiFrame(graphics, -78, -21, 156, 42, 'control')
    graphics.fill()
    graphics.stroke()
  }
}
