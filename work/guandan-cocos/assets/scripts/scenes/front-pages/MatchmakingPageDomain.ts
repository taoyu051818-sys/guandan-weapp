import { Color, Graphics, Label, Node, UITransform, Vec3, tween } from 'cc'
import type { FrontPageGateways, MatchQueueId, MatchTicket } from '../../services/FrontPageGatewayContracts'
import { PlatformApiError } from '../../services/PlatformApi'
import { matchWaitingText, type MatchWaitingStage } from '../../services/MatchWaitingPresentation'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { PageRouter } from '../PageRouter'

export type MatchReturnPage = 'menu' | 'online' | 'competition' | 'classic-rooms'
export type MatchAssignment = { tournamentId: string, assignmentId: string }
const MAX_TRACKED_MATCH_IDS = 32

export type MatchmakingPageDependencies = {
  router: PageRouter
  gateways: FrontPageGateways
  isDisposed: () => boolean
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  showNotice: (title: string, detail?: string) => void
  enterMatchedGame: (ticket: MatchTicket) => void
  showMenu: () => void
  showOnlinePlay: () => void
  showCompetition: () => void
  showClassicRooms: () => void
}

/** Owns the matching page, polling, ticket validation, and cancel/assignment reconciliation. */
export class MatchmakingPageDomain {
  private matchAttemptToken = 0
  private activeMatchTicketId: string | null = null
  private matchingStatusLabel: Label | null = null
  private matchingStartedAt = 0
  private matchingQueueName = ''
  private matchingStage: MatchWaitingStage = 'requesting'
  private matchingReturnPage: MatchReturnPage = 'menu'
  private readonly reconciledMatchIds = new Set<string>()
  private readonly uncertainMatchIds = new Set<string>()
  private readonly reconciliationTasks = new Map<string, Promise<boolean>>()
  private destroyed = false

  public constructor (private readonly dependencies: MatchmakingPageDependencies) {}

  public begin (
    queueId: MatchQueueId,
    queueName: string,
    returnPage: MatchReturnPage,
    assignment?: MatchAssignment,
  ): void {
    if (this.isDisposed()) return
    this.invalidate()
    const token = this.matchAttemptToken
    this.matchingStartedAt = Date.now()
    this.matchingQueueName = queueName
    this.matchingStage = 'requesting'
    this.matchingReturnPage = returnPage
    this.renderMatching()
    this.scheduleMatchingWaitTick(token)
    this.dependencies.scheduleOnce(() => { void this.requestMatch(queueId, token, returnPage, assignment) }, 0.65)
  }

  public reflow (): void {
    if (!this.isDisposed() && this.dependencies.router.current === 'matching') this.renderMatching()
  }

  /** Invalidates delayed callbacks and reconciles any queue ticket still owned by this page. */
  public invalidate (): void {
    this.matchAttemptToken += 1
    const ticketId = this.activeMatchTicketId
    this.activeMatchTicketId = null
    this.matchingStatusLabel = null
    this.matchingStartedAt = 0
    this.matchingQueueName = ''
    this.matchingStage = 'requesting'
    if (ticketId) void this.cancelOrRecoverAssignedMatch(ticketId)
  }

  /** Stops the reusable domain without permanently disabling future matching. */
  public stop (): void {
    this.invalidate()
  }

  public destroy (): void {
    if (this.destroyed) return
    this.stop()
    this.destroyed = true
  }

  private renderMatching (): void {
    const ui = this.dependencies.router.open('matching')
    ui.menuLabel('正在匹配', 0, 185, 44)
    this.matchingStatusLabel = ui.menuLabel('', 0, -5, 22)
    this.refreshMatchingWaitLabel()
    this.createMatchingShuffle(ui)
    this.pageButton(ui, '取消匹配', -105, () => this.showReturnPage(this.matchingReturnPage))
  }

  private createMatchingShuffle (ui: RuntimeUiFactory): void {
    ;[-1, 0, 1].forEach((slot, index) => {
      const node = new Node(`MatchingCard-${index}`)
      node.parent = ui.parent
      node.setPosition(new Vec3(slot * 42, 90 + Math.abs(slot) * 4, index))
      node.addComponent(UITransform).setContentSize(58, 82)
      const graphics = node.addComponent(Graphics)
      graphics.fillColor = new Color(17, 82, 61, 255)
      graphics.strokeColor = new Color(239, 201, 90, 255)
      graphics.lineWidth = 3
      graphics.roundRect(-29, -41, 58, 82, 8)
      graphics.fill()
      graphics.stroke()
      graphics.strokeColor = new Color(108, 225, 204, 190)
      graphics.lineWidth = 2
      graphics.roundRect(-19, -31, 38, 62, 6)
      graphics.stroke()
      tween(node).delay(index * 0.12).repeatForever(
        tween().to(0.46, { position: new Vec3(-slot * 48, 103 + index * 3, index), angle: slot * 7 }, { easing: 'sineInOut' })
          .to(0.46, { position: new Vec3(slot * 42, 90 + Math.abs(slot) * 4, index), angle: -slot * 5 }, { easing: 'sineInOut' }),
      ).start()
    })
  }

  private async requestMatch (
    queueId: MatchQueueId,
    token: number,
    returnPage: MatchReturnPage,
    assignment?: MatchAssignment,
  ): Promise<void> {
    if (!this.isCurrentAttempt(token)) return
    try {
      const enteredPriorMatch = await this.reconcileUncertainMatches()
      if (!this.isCurrentAttempt(token) || enteredPriorMatch) return
      if (this.uncertainMatchIds.size > 0) {
        this.showReturnPage(returnPage)
        this.dependencies.showNotice('正在确认上次匹配', '上次匹配状态尚未确认，已保留凭证并将在下次重试')
        return
      }
      const ticket = await this.dependencies.gateways.matchmaking.joinQueue(queueId, assignment)
      if (!this.isCurrentAttempt(token)) {
        void this.reconcileStaleMatch(ticket)
        return
      }
      this.activeMatchTicketId = ticket.ticketId
      this.matchingStage = 'queued'
      this.refreshMatchingWaitLabel()
      this.acceptMatchTicket(ticket, token, returnPage)
    } catch (error) {
      if (this.isDisposed() || token !== this.matchAttemptToken) return
      this.showReturnPage(returnPage)
      this.dependencies.showNotice('比赛匹配失败', this.matchErrorDetail(error))
    }
  }

  private acceptMatchTicket (ticket: MatchTicket, token: number, returnPage: MatchReturnPage): void {
    if (!this.isCurrentAttempt(token)) return
    if (ticket.status === 'matched') {
      const usable = this.isUsableMatchTicket(ticket)
      this.activeMatchTicketId = null
      if (usable) {
        this.markReconciled(ticket.ticketId)
        this.dependencies.enterMatchedGame(ticket)
        return
      }
      void this.cancelOrRecoverAssignedMatch(ticket.ticketId)
      this.showReturnPage(returnPage)
      this.dependencies.showNotice('比赛匹配失败', '匹配服务返回的房间凭证不完整或已过期')
      return
    }
    if (ticket.status === 'cancelled') {
      this.activeMatchTicketId = null
      this.markReconciled(ticket.ticketId)
      this.showReturnPage(returnPage)
      return
    }
    if (ticket.status === 'playing' || ticket.status === 'completed' || ticket.status === 'aborted') {
      this.activeMatchTicketId = null
      this.markReconciled(ticket.ticketId)
      this.showReturnPage(returnPage)
      const copy = ticket.status === 'playing'
        ? ['牌局已开始', '当前匹配已进入牌桌，不能继续等待或重复入桌。']
        : ticket.status === 'completed'
          ? ['牌局已完成', '当前匹配已经结算，可前往个人中心查看牌谱。']
          : ['牌局已终止', '当前匹配已安全终止，请重新发起匹配。']
      this.dependencies.showNotice(copy[0], copy[1])
      return
    }
    this.dependencies.scheduleOnce(() => { void this.pollMatch(ticket.ticketId, token, returnPage) }, 1)
  }

  private async pollMatch (ticketId: string, token: number, returnPage: MatchReturnPage): Promise<void> {
    if (!this.isCurrentAttempt(token, ticketId)) return
    try {
      const ticket = await this.getTicketStatus(ticketId)
      if (!this.isCurrentAttempt(token, ticketId)) {
        void this.reconcileStaleMatch(ticket)
        return
      }
      this.acceptMatchTicket(ticket, token, returnPage)
    } catch (error) {
      if (this.isDisposed() || token !== this.matchAttemptToken) return
      this.showReturnPage(returnPage)
      this.dependencies.showNotice('比赛匹配失败', this.matchErrorDetail(error))
    }
  }

  private showReturnPage (returnPage: MatchReturnPage): void {
    this.invalidate()
    if (returnPage === 'menu') this.dependencies.showMenu()
    else if (returnPage === 'competition') this.dependencies.showCompetition()
    else if (returnPage === 'classic-rooms') this.dependencies.showClassicRooms()
    else this.dependencies.showOnlinePlay()
  }

  private refreshMatchingWaitLabel (): void {
    if (!this.matchingStatusLabel || !this.matchingStartedAt) return
    this.matchingStatusLabel.string = matchWaitingText(
      this.matchingQueueName,
      this.matchingStage,
      Date.now() - this.matchingStartedAt,
    )
  }

  private scheduleMatchingWaitTick (token: number): void {
    this.dependencies.scheduleOnce(() => {
      if (!this.isCurrentAttempt(token)) return
      this.refreshMatchingWaitLabel()
      this.scheduleMatchingWaitTick(token)
    }, 1)
  }

  private async reconcileStaleMatch (ticket: MatchTicket): Promise<void> {
    if (!ticket.ticketId || this.reconciledMatchIds.has(ticket.ticketId)) return
    if (ticket.status === 'matched') {
      if (this.isUsableMatchTicket(ticket) && !this.isDisposed()) {
        this.markReconciled(ticket.ticketId)
        this.dependencies.showNotice('匹配已完成', '取消请求到达时牌桌已分配，正在进入对局')
        this.dependencies.enterMatchedGame(ticket)
      } else await this.cancelOrRecoverAssignedMatch(ticket.ticketId)
      return
    }
    if (ticket.status === 'cancelled') {
      this.markReconciled(ticket.ticketId)
      return
    }
    if (ticket.status === 'playing' || ticket.status === 'completed' || ticket.status === 'aborted') {
      this.markReconciled(ticket.ticketId)
      return
    }
    await this.cancelOrRecoverAssignedMatch(ticket.ticketId)
  }

  private async cancelOrRecoverAssignedMatch (ticketId: string): Promise<boolean> {
    if (!ticketId || this.reconciledMatchIds.has(ticketId)) return false
    this.rememberUncertain(ticketId)
    const existing = this.reconciliationTasks.get(ticketId)
    if (existing) return existing
    const task = this.reconcileTicket(ticketId, false).finally(() => {
      if (this.reconciliationTasks.get(ticketId) === task) this.reconciliationTasks.delete(ticketId)
    })
    this.reconciliationTasks.set(ticketId, task)
    return task
  }

  /** A new queue request must account for every prior uncertain ticket first. */
  private async reconcileUncertainMatches (): Promise<boolean> {
    let enteredPriorMatch = false
    for (const ticketId of Array.from(this.uncertainMatchIds)) {
      const existing = this.reconciliationTasks.get(ticketId)
      if (existing) enteredPriorMatch = await existing || enteredPriorMatch
      if (!this.uncertainMatchIds.has(ticketId)) continue
      const task = this.reconcileTicket(ticketId, true).finally(() => {
        if (this.reconciliationTasks.get(ticketId) === task) this.reconciliationTasks.delete(ticketId)
      })
      this.reconciliationTasks.set(ticketId, task)
      enteredPriorMatch = await task || enteredPriorMatch
    }
    return enteredPriorMatch
  }

  private async reconcileTicket (ticketId: string, statusFirst: boolean): Promise<boolean> {
    if (statusFirst) {
      try {
        return await this.reconcileTicketStatus(await this.getTicketStatus(ticketId))
      } catch {
        // The authoritative read is uncertain; a cancel retry may still close it.
      }
    }
    try {
      await this.dependencies.gateways.matchmaking.cancel(ticketId)
      this.markReconciled(ticketId)
      return false
    } catch {
      // Cancellation may cross assignment. Query before allowing another join.
    }
    try {
      return await this.reconcileTicketStatus(await this.getTicketStatus(ticketId))
    } catch {
      this.rememberUncertain(ticketId)
      return false
    }
  }

  private async reconcileTicketStatus (ticket: MatchTicket): Promise<boolean> {
    const ticketId = ticket.ticketId
    if (ticket.status === 'matched' && this.isUsableMatchTicket(ticket) && !this.isDisposed()) {
      this.markReconciled(ticketId)
      this.dependencies.showNotice('匹配已完成', '取消请求到达时牌桌已分配，正在进入对局')
      this.dependencies.enterMatchedGame(ticket)
      return true
    }
    if (ticket.status === 'cancelled' || ticket.status === 'playing' || ticket.status === 'completed' || ticket.status === 'aborted') {
      this.markReconciled(ticketId)
      return false
    }
    try {
      await this.dependencies.gateways.matchmaking.cancel(ticketId)
      this.markReconciled(ticketId)
    } catch {
      this.rememberUncertain(ticketId)
    }
    return false
  }

  private async getTicketStatus (ticketId: string): Promise<MatchTicket> {
    const ticket = await this.dependencies.gateways.matchmaking.getStatus(ticketId)
    if (ticket.ticketId !== ticketId) throw new Error('匹配状态响应与请求不一致')
    return ticket
  }

  private rememberUncertain (ticketId: string): void {
    if (!ticketId || this.reconciledMatchIds.has(ticketId)) return
    this.uncertainMatchIds.delete(ticketId)
    this.uncertainMatchIds.add(ticketId)
    this.trimMatchIds(this.uncertainMatchIds)
  }

  private markReconciled (ticketId: string): void {
    if (!ticketId) return
    this.uncertainMatchIds.delete(ticketId)
    this.reconciledMatchIds.delete(ticketId)
    this.reconciledMatchIds.add(ticketId)
    this.trimMatchIds(this.reconciledMatchIds)
  }

  private trimMatchIds (ids: Set<string>): void {
    while (ids.size > MAX_TRACKED_MATCH_IDS) {
      const oldest = ids.values().next().value as string | undefined
      if (!oldest) break
      ids.delete(oldest)
    }
  }

  private isCurrentAttempt (token: number, ticketId?: string): boolean {
    return !this.isDisposed()
      && token === this.matchAttemptToken
      && this.dependencies.router.current === 'matching'
      && (ticketId === undefined || this.activeMatchTicketId === ticketId)
  }

  private isUsableMatchTicket (ticket: MatchTicket): boolean {
    return Boolean(ticket.ticketId && ticket.entryAttemptId && ticket.status === 'matched' && ticket.roomId && ticket.gameEndpoint && ticket.joinToken && ticket.seat && (!ticket.expiresAt || ticket.expiresAt > Date.now()))
  }

  private pageButton (ui: RuntimeUiFactory, text: string, y: number, action: () => void): Node {
    const node = ui.button('MenuButton', text, 0)
    node.setPosition(new Vec3(0, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private matchErrorDetail (error: unknown): string {
    if (error instanceof PlatformApiError) {
      if (error.status === 401 || error.status === 403) return '登录状态已失效，请重新进入游戏'
      if (error.status === 429) return '当前匹配请求较多，请稍后重试'
      if (error.retryable) return '匹配服务暂时不可用，请稍后重试'
      if (error.code === 'MATCH_TICKET_EXPIRED') return '本次匹配凭证已过期，请重新匹配'
      if (error.code === 'INSUFFICIENT_CLASSIC_STAKE') {
        const details = error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : null
        const required = details && typeof details.required === 'number' && Number.isFinite(details.required)
          ? Math.max(0, Math.round(details.required))
          : null
        return required === null ? '积分不足，无法进入该场' : `积分不足：进入该场至少需要 ${required} 积分`
      }
    }
    if (error instanceof Error && error.message.includes('功能正在开发中')) return '比赛匹配服务暂未开放'
    return '请稍后重试'
  }

  private isDisposed (): boolean {
    return this.destroyed || this.dependencies.isDisposed()
  }
}
