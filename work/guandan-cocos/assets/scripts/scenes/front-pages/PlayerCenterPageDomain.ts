import type { FrontPageGateways, PlayerDashboard, SeasonTaskList } from '../../services/FrontPageGatewayContracts'
import type { TableViewport } from '../../ui/ScreenAdapter'
import { secondaryErrorText } from '../../ui/SecondaryPagePolicy'
import { renderPlayerCenter, renderSeasonTasks } from './PlayerCenterPageView'
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
  viewport?: () => TableViewport
}

/** Owns the player overview and season-task pages. */
export class PlayerCenterPageDomain {
  private pendingSeasonTaskId: string | null = null
  private tasksReturnToLobby = false
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
    const points = this.dependencies.wallet.fresh ? String(Math.max(0, Math.round(this.dependencies.wallet.value.points))) : '--'
    renderPlayerCenter(page, dashboard, status, points, this.dependencies.gateways.auth, {
      back: this.dependencies.showMenu, retry: () => { void this.show() }, edit: this.dependencies.editProfile,
      tasks: () => { this.tasksReturnToLobby = false; void this.showSeasonTasks() },
      records: this.dependencies.showReplayList, ranking: () => this.dependencies.showFriendRanking?.(),
    }, this.dependencies.viewport?.())
  }

  public async showLobbyTasks (): Promise<void> {
    this.tasksReturnToLobby = true
    await this.showSeasonTasks()
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
    renderSeasonTasks(ui, taskList, status, this.dependencies.gateways.configured, this.pendingSeasonTaskId, {
      back: () => { if (this.tasksReturnToLobby) this.dependencies.showMenu(); else void this.show() },
      retry: () => { void this.showSeasonTasks() }, claim: id => { void this.claimSeasonTask(id) },
    }, this.dependencies.viewport?.())
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
    this.reflow()
    try {
      await this.dependencies.gateways.seasons.claim(taskId)
      if (!this.isCurrent(token, 'season-tasks')) return
      this.dependencies.showNotice('领取成功', '奖励积分已入账。')
      await this.showSeasonTasks()
    } catch (error) {
      if (this.isCurrent(token, 'season-tasks')) this.dependencies.showNotice('暂时无法领取', this.errorDetail(error, '请稍后重试'))
    } finally {
      if (this.pendingSeasonTaskId === taskId) {
        this.pendingSeasonTaskId = null
        if (!this.dependencies.isDisposed() && this.dependencies.router.current === 'season-tasks') this.reflow()
      }
    }
  }

  private isCurrent (token: number, page: 'player-center' | 'season-tasks'): boolean {
    return !this.dependencies.isDisposed() && token === this.dependencies.currentPageRequest() && this.dependencies.router.current === page
  }

  private errorDetail (error: unknown, fallback: string): string {
    return secondaryErrorText(error, fallback)
  }
}
