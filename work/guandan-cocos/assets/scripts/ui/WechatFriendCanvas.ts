import { ImageAsset, Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc'

type OpenContext = { canvas: HTMLCanvasElement, postMessage: (message: Record<string, unknown>) => void }
/** Displays the shared canvas as a texture; no friend data is read back into this domain. */
export class WechatFriendCanvas {
  private readonly context: OpenContext
  private readonly image = new ImageAsset()
  private readonly texture = new Texture2D()
  private readonly frame = new SpriteFrame()
  private readonly sprite: Sprite
  private readonly timer: ReturnType<typeof setInterval>
  private disposed = false
  public constructor (parent: Node) {
    const wx = (globalThis as unknown as { wx?: { getOpenDataContext?: () => OpenContext } }).wx
    if (!wx?.getOpenDataContext) throw new Error('好友排行仅支持微信小游戏，请在微信中打开。')
    this.context = wx.getOpenDataContext()
    if (!this.context?.canvas) throw new Error('开放数据域未就绪，请重新进入游戏。')
    const canvas = this.context.canvas
    canvas.width = 1020
    canvas.height = 450
    const node = new Node('FriendRankingSharedCanvas')
    node.parent = parent
    node.setPosition(0, -2, 0)
    node.addComponent(UITransform).setContentSize(680, 300)
    this.sprite = node.addComponent(Sprite)
    this.sprite.sizeMode = Sprite.SizeMode.CUSTOM
    this.image.reset(canvas)
    this.texture.image = this.image
    this.texture.create(canvas.width, canvas.height)
    this.frame.texture = this.texture
    this.sprite.spriteFrame = this.frame
    this.timer = setInterval(() => {
      if (!this.disposed && node.isValid && node.activeInHierarchy) {
        this.image.reset(canvas)
        this.texture.uploadData(canvas)
      }
    }, 100)
  }
  public send (action: 'open' | 'next' | 'previous' | 'close'): void {
    if (!this.disposed) this.context.postMessage({ type: 'friend-ranking', action })
  }
  public destroy (): void {
    if (this.disposed) return
    try { this.send('close') } catch { /* bridge may already be shutting down */ }
    this.disposed = true
    clearInterval(this.timer)
    this.sprite.spriteFrame = null
    this.sprite.node.destroy()
    this.frame.destroy()
    this.texture.destroy()
    this.image.destroy()
  }
}
