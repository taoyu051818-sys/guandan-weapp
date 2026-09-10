import { Color, Node, Vec3 } from 'cc'
import type { FrontPageGateways, PlayerDashboard, SeasonTaskList } from '../../services/FrontPageGatewayContracts'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { coastalText, coastalButton } from '../../ui/CoastalUi'
import type { PageRouter } from '../PageRouter'
import type { FrontPagePlayerState } from './FrontPagePlayerState'
import type { FrontPageWalletState } from './FrontPageWalletState'

type Settled<T> = { status: 'fulfilled', value: T } | { status: 'rejected', reason: unknown }
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> => promise.then(
  value => ({ status: 'fulfilled', value }),
  reason => ({ status: 'rejected', reason }),
)

export type PlayerCenterPageDependencies = {
  editProfile: () => void
  showFriendRanking?: () => void
  profileLoaded?: (dashboard: PlayerDashboard) => void
  router: PageRouter
  gateways: FrontPageGateways
  player: FrontPagePlayerState
  wallet: FrontPageWalletState
  isDisposed: () => boolean
  issuePageRequest: () => number
  currentPageRequest: () => number
  showMenu: () => void
  showReplayList: () => void
  showNotice: (title: string, detail?: string) => void
}

/** Owns the player overview and season-task pages. */
export class PlayerCenterPageDomain {
  private pendingSeasonTaskId: string | null = null
  private dashboardView: { dashboard: PlayerDashboard | null, status: string } = { dashboard: null, status: '' }
  private taskView: { taskList: SeasonTaskList | null, status: string } = { taskList: null, status: '' }

  public constructor (private readonly dependencies: PlayerCenterPageDependencies) {}

  public async show (): Promise<void> {
    if (this.dependencies.isDisposed()) return
    const token = this.dependencies.issuePageRequest()
    this.render(null, '正在同步个人数据…')
    const [dashboardResult, walletResult] = await Promise.all([
      settle(this.dependencies.gateways.playerCenter.getDashboard()),
      settle(this.dependencies.gateways.wallet.getWallet()),
    ])
    if (!this.isCurrent(token, 'player-center')) return
    if (walletResult.status === 'fulfilled') this.dependencies.wallet.update(walletResult.value)
    else this.dependencies.wallet.invalidate()
    if (dashboardResult.status === 'rejected') {
      this.render(null, this.errorDetail(dashboardResult.reason, '个人数据暂时无法获取'))
      return
    }
    this.dependencies.player.updateDashboard(dashboardResult.value)
    const walletStatus = walletResult.status === 'fulfilled' ? '' : ' · 积分暂时无法同步'
    this.render(dashboardResult.value, `${this.dependencies.gateways.configured ? '已同步平台数据' : '开发演示数据'}${walletStatus}`)
    this.dependencies.profileLoaded?.(dashboardResult.value)
  }

  private render (dashboard: PlayerDashboard | null, status: string): void {
    this.dashboardView = { dashboard, status }
    const page = this.dependencies.router.open('player-center')
    const panel = page.panel('PlayerCenterSurface', 0, 0, 760, 540, {
      fill: new Color(17, 52, 72, 247), stroke: new Color(109, 160, 181), lineWidth: 1, frame: 'panel',
    })
    const ui = new RuntimeUiFactory(panel)
    coastalText(ui, '个人中心', 0, 218, 650, 52, 36, { bold: true })
    coastalText(ui, status, 0, 172, 680, 34, 21, { color: new Color(168, 204, 218) })
    if (dashboard) {
      const games = Math.max(0, dashboard.rating.games)
      const wins = Math.max(0, dashboard.rating.wins)
      const winRate = games ? Math.round(wins * 100 / games) : 0
      const season = dashboard.season ? `${dashboard.season.name}  ${dashboard.season.progress.score}分 · ${dashboard.season.progress.gamesPlayed}场` : '暂无赛季'
      const points = this.dependencies.wallet.fresh ? String(Math.max(0, Math.round(this.dependencies.wallet.value.points))) : '--'
      coastalText(ui, `${dashboard.user.displayName}    账号 ${dashboard.user.accountId}\n积分  ${points}    综合分  ${Math.round(dashboard.rating.comprehensiveScore)}\n总场数  ${games}    胜率  ${winRate}%    头游  ${dashboard.stats.firstPlaceFinishes}\n${season}`, 0, 76, 680, 144, 24)
    }
    coastalButton(ui, '赛季任务', -150, -62, 270, 58, () => { void this.showSeasonTasks() })
    coastalButton(ui, '我的对局', 150, -62, 270, 58, this.dependencies.showReplayList)
    coastalButton(ui, '修改昵称和头像', -170, -132, 310, 58, this.dependencies.editProfile, true)
    coastalButton(ui, '好友综合分排行', 170, -132, 310, 58, () => this.dependencies.showFriendRanking?.())
    coastalButton(ui, '返回大厅', 0, -208, 230, 56, this.dependencies.showMenu)
  }

  private async showSeasonTasks (): Promise<void> {
    if (this.dependencies.isDisposed()) return
    const token = this.dependencies.issuePageRequest()
    this.renderSeasonTasks(null, '正在同步赛季任务…')
    try {
      const taskList = await this.dependencies.gateways.seasons.listTasks()
      if (!this.isCurrent(token, 'season-tasks')) return
      this.renderSeasonTasks(taskList, this.dependencies.gateways.configured ? '任务进度已同步' : '开发演示 · 仅展示任务样式与进度')
    } catch (error) {
      if (this.isCurrent(token, 'season-tasks')) this.renderSeasonTasks(null, this.errorDetail(error, '赛季任务暂时无法获取'))
    }
  }

  private renderSeasonTasks (taskList: SeasonTaskList | null, status: string): void {
    this.taskView = { taskList, status }
    const ui = this.dependencies.router.open('season-tasks')
    ui.menuLabel(taskList?.season?.name ?? '赛季任务', 0, 220, 42)
    ui.menuLabel(status, 0, 174, 18)
    taskList?.tasks.slice(0, 5).forEach((task, index) => {
      const claimable = this.dependencies.gateways.configured && task.completed && !task.claimed
      const state = task.claimed ? '已领取' : claimable ? '可领取' : task.completed ? '演示完成' : `${Math.min(task.progress, task.target)}/${task.target}`
      const label = `${task.name}    +${task.rewardPoints}积分    ${state}`
      if (claimable) this.sizedButton(ui, label, 0, 115 - index * 55, 560, 45, 19, () => { void this.claimSeasonTask(task.id) })
      else ui.menuLabel(label, 0, 115 - index * 55, 19)
    })
    this.pageButton(ui, '返回个人中心', -205, () => { void this.show() })
  }

  public reflow (): void {
    if (this.dependencies.router.current === 'player-center') {
      const dashboard = this.dashboardView.dashboard
      const profile = this.dependencies.player.profile
      this.render(dashboard && profile ? { ...dashboard, user: { ...profile } } : dashboard, this.dashboardView.status)
    }
    else if (this.dependencies.router.current === 'season-tasks') this.renderSeasonTasks(this.taskView.taskList, this.taskView.status)
  }

  private async claimSeasonTask (taskId: string): Promise<void> {
    if (this.dependencies.isDisposed() || !this.dependencies.gateways.configured || this.pendingSeasonTaskId) return
    const token = this.dependencies.currentPageRequest()
    this.pendingSeasonTaskId = taskId
    try {
      await this.dependencies.gateways.seasons.claim(taskId)
      if (!this.isCurrent(token, 'season-tasks')) return
      this.dependencies.showNotice('领取成功', '奖励积分已入账。')
      await this.showSeasonTasks()
    } catch (error) {
      if (this.isCurrent(token, 'season-tasks')) this.dependencies.showNotice('暂时无法领取', this.errorDetail(error, '请稍后重试'))
    } finally {
      if (this.pendingSeasonTaskId === taskId) this.pendingSeasonTaskId = null
    }
  }

  private isCurrent (token: number, page: 'player-center' | 'season-tasks'): boolean {
    return !this.dependencies.isDisposed() && token === this.dependencies.currentPageRequest() && this.dependencies.router.current === page
  }

  private pageButton (ui: RuntimeUiFactory, text: string, y: number, action: () => void): Node {
    const node = ui.button('MenuButton', text, 0)
    node.setPosition(new Vec3(0, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private sizedButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, action: () => void): Node {
    const node = ui.button('PageButton', text, x, width, height, fontSize)
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private errorDetail (error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim() ? error.message : fallback
  }
}
