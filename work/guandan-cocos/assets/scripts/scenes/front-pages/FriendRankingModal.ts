import { BlockInputEvents, Color, Game, game, Node, Tween, UITransform } from 'cc'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { SecondaryPageUi, secondaryColors as colors } from '../../ui/SecondaryPageUi'
import { secondaryPagePlacement, secondaryErrorText } from '../../ui/SecondaryPagePolicy'
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
    const placement = secondaryPagePlacement(this.screen.viewport, 760, 550)
    if (panel) { panel.setScale(placement.scale, placement.scale, 1); panel.setPosition(placement.x, placement.y, 0) }
    this.root.getChildByName('FriendRankingShade')?.getComponent(UITransform)?.setContentSize(this.screen.viewport.width, this.screen.viewport.height)
  }
  private render (message: string, pending = false): Node | null {
    if (!this.root?.isValid) return null
    this.canvas?.destroy(); this.canvas = null
    for (const node of this.root.children.slice()) { this.stop(node); node.removeFromParent(); node.destroy() }
    const ui = new RuntimeUiFactory(this.root)
    ui.panel('FriendRankingShade', 0, 0, this.screen.viewport.width, this.screen.viewport.height, { fill: new Color(2, 12, 20, 220), frame: 'square', lineWidth: 0 })
    const panel = ui.panel('FriendRankingPanel', 0, 0, 760, 550, { fill: colors.panel, stroke: colors.line, frame: 'panel', lineWidth: 1 })
    const face = new SecondaryPageUi(new RuntimeUiFactory(panel))
    face.text('RankingTitle', '好友综合分排行', -50, 225, 580, 48, 32, colors.text, true, true)
    face.button('RankingClose', '关闭', 292, 225, 104, () => this.close())
    face.text('RankingSubtitle', '微信好友 · 按综合分排序', 0, 177, 680, 32, 20, colors.muted)
    if (message) face.text('RankingStatus', message, 0, 0, 650, 140, 24, colors.muted, false)
    if (!message) {
      face.button('RankingPrevious', '上一页', -260, -191, 142, () => this.canvas?.send('previous'))
      face.button('RankingNext', '下一页', -95, -191, 142, () => this.canvas?.send('next'))
    }
    if (!pending && wechatRankingApi()) {
      face.button('RankingRefresh', '刷新', message ? -110 : 85, -191, 128, () => { void this.load() }, true)
      if (wechatRankingApi()?.openSetting) face.button('RankingPermissions', '权限设置', message ? 110 : 261, -191, 166, () => { void this.settings() })
    }
    face.text('RankingPrivacy', '仅展示已同步分数的微信好友；好友信息不传入游戏服务器。', 0, -243, 698, 28, 18, colors.muted, false)
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
      if (current()) this.render(secondaryErrorText(error, '好友排行加载失败，请重试。'))
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
