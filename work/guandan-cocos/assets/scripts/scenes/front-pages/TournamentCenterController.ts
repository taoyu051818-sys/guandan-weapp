import type { FrontPageGateways, TournamentState, TournamentSummary } from '../../services/FrontPageGatewayContracts'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { PageRouter } from '../PageRouter'
import { canWithdrawTournament, tournamentAction, type TournamentCenterState, type TournamentTab } from './TournamentCenterModel'
import { renderTournamentCenter } from './TournamentCenterView'

type Dependencies = {
  router: PageRouter
  gateways: FrontPageGateways
  screen: ScreenAdapter
  isDisposed: () => boolean
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  setTableVisible: (visible: boolean) => void
  showMenu: () => void
  enter: (tournament: TournamentSummary, state: TournamentState) => void
}
/** Owns only tournament-page requests and polling. Server owns enrollment, roster and scoring. */
export class TournamentCenterController {
  public enteredRoomId: string | null = null
  private generation = 0
  private active = false
  private disposed = false
  private scheduled = false
  private pendingRefresh: Promise<void> | null = null
  private view: TournamentCenterState = { tournament: null, state: null, standings: null, busy: false, error: '', tab: 'status', rankingPage: 0 }
  constructor (private readonly deps: Dependencies) {}
  public open (): void {
    if (this.disposed || this.deps.isDisposed()) return
    this.suspend()
    this.active = true
    this.deps.setTableVisible(false)
    this.view = { ...this.view, busy: false, error: '' }
    this.render()
    void this.refresh(true)
  }
  public suspend (): void { this.active = false; this.generation++; this.scheduled = false; this.view.busy = false; this.pendingRefresh = null }
  public resume (): void {
    if (this.deps.router.current === 'tournament-center' && !this.active) this.open()
  }
  public destroy (): void { this.suspend(); this.disposed = true }
  public reflow (): void { if (this.active && this.deps.router.current === 'tournament-center') this.render() }
  private current (token: number): boolean {
    return this.active && !this.disposed && !this.deps.isDisposed() && token === this.generation && this.deps.router.current === 'tournament-center'
  }
  private render (): void {
    renderTournamentCenter(this.deps.router.open('tournament-center'), this.deps.screen.viewport, this.view, {
      back: () => { this.suspend(); this.deps.showMenu() },
      withdraw: () => { void this.act(true) },
      action: () => { void this.act() },
      tab: tab => this.changeTab(tab),
      page: delta => { this.view.rankingPage = Math.max(0, this.view.rankingPage + delta); this.render() },
    })
  }
  private changeTab (tab: TournamentTab): void { this.view.tab = tab; this.render() }
  private refresh (visible: boolean): Promise<void> {
    if (this.pendingRefresh) return this.pendingRefresh
    if (!this.active || this.view.busy) return Promise.resolve()
    const task = this.sync(visible)
    this.pendingRefresh = task
    void task.finally(() => { if (this.pendingRefresh === task) this.pendingRefresh = null })
    return task
  }
  private async sync (visible: boolean): Promise<void> {
    const token = this.generation
    const before = JSON.stringify(this.view)
    if (visible) this.view.busy = true
    if (visible) this.render()
    try {
      const api = this.deps.gateways.tournaments
      if (!this.deps.gateways.configured || !api) throw new Error('赛事需要连接正式账号，请检查网络后重试。')
      const list = await api.listTournaments()
      if (!this.current(token)) return
      // First release opens only the tested, free fixed-16 format. No sample events or paid registration.
      const supported = list.filter(t => t.format === 'fixed16-latin-3' && t.capacity === 16 && t.roundsTotal === 3 && t.entryPoints === 0)
      const tournament = supported.find(t => t.id === this.view.tournament?.id) ?? supported.find(t => t.enrolled && t.status !== 'finished') ?? supported.find(t => t.status === 'open') ?? supported[0] ?? null
      if (!tournament) { this.view = { ...this.view, tournament: null, state: null, standings: null, error: '暂无开放的免费 16 人赛事。' }; return }
      const [state, standings] = await Promise.all([api.getState(tournament.id), api.getStandings(tournament.id)])
      if (!this.current(token)) return
      this.view = { ...this.view, tournament, state, standings, error: '' }
    } catch (error) {
      if (this.current(token)) this.view.error = error instanceof Error ? error.message : '赛事同步失败，正在自动重试。'
    } finally {
      if (this.current(token)) {
        this.view.busy = false
        if (visible || JSON.stringify(this.view) !== before) this.render()
        this.poll(token)
      }
    }
  }
  private poll (token: number): void {
    if (this.scheduled || !this.current(token)) return
    this.scheduled = true
    this.deps.scheduleOnce(() => {
      if (!this.current(token)) return
      this.scheduled = false
      void this.refresh(false)
    }, 1)
  }
  private async act (withdraw = false): Promise<void> {
    // A silent one-second poll must not swallow a tap. Wait, then validate fresh state.
    const intentToken = this.generation
    if (this.pendingRefresh) await this.pendingRefresh
    if (!this.current(intentToken)) return
    if (!this.active || this.view.busy) return
    const action = withdraw && canWithdrawTournament(this.view) ? { kind: 'withdraw' } : withdraw ? { kind: 'none' } : tournamentAction(this.view)
    const t = this.view.tournament, s = this.view.state
    if (!t || !s) return
    if (action.kind === 'rank') { this.changeTab('standings'); return }
    if (action.kind === 'enter') { this.suspend(); this.deps.enter(t, s); return }
    if (action.kind !== 'enroll' && action.kind !== 'check-in' && action.kind !== 'withdraw') return
    const token = this.generation
    this.view.busy = true
    this.render()
    try {
      const api = this.deps.gateways.tournaments!
      if (action.kind === 'enroll') await api.enroll(t.id, 0)
      else if (action.kind === 'withdraw') await api.withdraw(t.id)
      else await api.checkIn(t.id)
      if (!this.current(token)) return
      this.view.busy = false
      await this.refresh(true)
    } catch (error) {
      if (this.current(token)) {
        this.view.busy = false
        this.view.error = error instanceof Error ? error.message : '操作失败，正在重新同步。'
        this.render()
        this.poll(token)
      }
    }
  }
}
