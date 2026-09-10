import { BlockInputEvents, Color, Game, game, Node, Tween, UITransform } from 'cc'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { coastalButton, coastalText } from '../../ui/CoastalUi'
import { WechatFriendCanvas } from '../../ui/WechatFriendCanvas'
import { authorizeRanking, rankingCall, wechatRankingApi, WechatFriendScoreSync } from '../../services/WechatFriendRanking'

/** A private-data canvas lives only while this modal is open. */
export class FriendRankingModal {
  private root: Node | null = null
  private canvas: WechatFriendCanvas | null = null
  private revision = 0
  private busy = false
  public constructor (private readonly parent: Node, private readonly screen: ScreenAdapter,
    private readonly scores: WechatFriendScoreSync, private readonly score: () => Promise<{ userId: string, score: number }>) {}
  public get open (): boolean { return Boolean(this.root?.isValid) }
  public show (): void {
    if (this.open) return
    this.root = new Node('FriendRankingModal')
    this.root.parent = this.parent
    this.root.addComponent(UITransform)
    this.root.addComponent(BlockInputEvents)
    this.reflow()
    game.on(Game.EVENT_HIDE, this.close, this)
    void this.load()
  }
  public reflow (): void {
    if (!this.root) return
    this.root.getComponent(UITransform)!.setContentSize(this.screen.viewport.width, this.screen.viewport.height)
    const panel = this.root.getChildByName('FriendRankingPanel')
    const scale = Math.min(1, (this.screen.safeSize().x - 24) / 760, (this.screen.safeSize().y - 24) / 550)
    if (panel) panel.setScale(scale, scale, 1)
    this.root.getChildByName('FriendRankingShade')?.getComponent(UITransform)?.setContentSize(this.screen.viewport.width, this.screen.viewport.height)
  }
  private render (message: string, pending = false): Node | null {
    if (!this.root?.isValid) return null
    this.canvas?.destroy(); this.canvas = null
    for (const node of this.root.children.slice()) { this.stop(node); node.removeFromParent(); node.destroy() }
    const ui = new RuntimeUiFactory(this.root)
    ui.panel('FriendRankingShade', 0, 0, this.screen.viewport.width, this.screen.viewport.height, { fill: new Color(2, 12, 20, 220), frame: 'square', lineWidth: 0 })
    const panel = ui.panel('FriendRankingPanel', 0, 0, 760, 550, { fill: new Color(17, 52, 72, 255), stroke: new Color(109, 160, 181), frame: 'panel' })
    const face = new RuntimeUiFactory(panel)
    coastalText(face, '好友综合分排行', -50, 225, 540, 48, 32, { bold: true })
    coastalButton(face, '关闭', 292, 225, 104, 48, () => this.close())
    coastalText(face, '微信好友 · 综合分从高到低', 0, 177, 680, 32, 20, { color: new Color(168, 204, 218) })
    if (message) coastalText(face, message, 0, 0, 650, 140, 24)
    if (!message) {
      coastalButton(face, '上一页', -260, -191, 142, 48, () => this.canvas?.send('previous'))
      coastalButton(face, '下一页', -95, -191, 142, 48, () => this.canvas?.send('next'))
    }
    if (!pending && wechatRankingApi()) {
      coastalButton(face, '刷新', message ? -110 : 85, -191, 128, 48, () => { void this.load() }, true)
      if (wechatRankingApi()?.openSetting) coastalButton(face, '权限设置', message ? 110 : 261, -191, 166, 48, () => { void this.settings() })
    }
    coastalText(face, '仅展示已同步分数的微信好友；好友信息不传入游戏服务器。', 0, -243, 698, 28, 18, { color: new Color(168, 204, 218) })
    this.reflow()
    return panel
  }
  private async load (): Promise<void> {
    if (this.busy || !this.open) return
    this.busy = true
    const token = ++this.revision
    const current = (): boolean => this.open && token === this.revision
    this.render('正在连接微信好友排行…', true)
    try {
      const api = wechatRankingApi()
      if (!api) throw new Error('请在微信小游戏中查看真实好友排行。\n浏览器预览不提供好友数据。')
      await authorizeRanking(api, current)
      if (!current()) return
      const own = await this.score()
      if (!current()) return
      await this.scores.publish(own.userId, own.score, false, current)
      if (!current()) return
      const panel = this.render('')
      if (panel) { this.canvas = new WechatFriendCanvas(panel); this.canvas.send('open') }
    } catch (error) {
      if (current()) this.render(error instanceof Error ? error.message : '好友排行加载失败，请重试。')
    } finally { if (current()) this.busy = false }
  }
  private async settings (): Promise<void> {
    const api = wechatRankingApi()
    if (this.busy || !api?.openSetting) return
    const token = this.revision
    try { await rankingCall(cb => api.openSetting!(cb)); if (this.open && token === this.revision) void this.load() }
    catch { if (this.open && token === this.revision) this.render('无法打开微信权限设置，请稍后重试。') }
  }
  private stop (node: Node): void { Tween.stopAllByTarget(node); node.children.forEach(child => this.stop(child)) }
  public close (): void {
    this.revision++; this.busy = false
    this.canvas?.destroy(); this.canvas = null
    game.off(Game.EVENT_HIDE, this.close, this)
    if (this.root?.isValid) { this.stop(this.root); this.root.active = false; this.root.removeFromParent(); this.root.destroy() }
    this.root = null
  }
}
