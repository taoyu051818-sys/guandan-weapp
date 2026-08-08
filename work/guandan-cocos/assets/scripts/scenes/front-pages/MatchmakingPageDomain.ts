import { Color, Graphics, Label, Node, UITransform, Vec3, tween } from 'cc'
import type { FrontPageGateways, MatchQueueId, MatchTicket } from '../../services/DevelopmentApis'
import { PlatformApiError } from '../../services/PlatformApi'
import { matchWaitingText, type MatchWaitingStage } from '../../services/MatchWaitingPresentation'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { PageRouter } from '../PageRouter'

export type MatchReturnPage = 'menu' | 'online' | 'competition' | 'classic-rooms'
export type MatchAssignment = { tournamentId: string, assignmentId: string }

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
  private readonly reconciledMatchIds = new Set<string>()
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
    const ui = this.dependencies.router.open('matching')
    ui.menuLabel('正在匹配', 0, 185, 44)
    this.matchingStartedAt = Date.now()
    this.matchingQueueName = queueName
    this.matchingStage = 'requesting'
    this.matchingStatusLabel = ui.menuLabel('', 0, -5, 22)
    this.refreshMatchingWaitLabel()
    this.scheduleMatchingWaitTick(token)
    this.createMatchingShuffle(ui)
    this.pageButton(ui, '取消匹配', -105, () => this.showReturnPage(returnPage))
    this.dependencies.scheduleOnce(() => { void this.requestMatch(queueId, token, returnPage, assignment) }, 0.65)
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
        this.reconciledMatchIds.add(ticket.ticketId)
        this.dependencies.enterMatchedGame(ticket)
        return
      }
      void this.dependencies.gateways.matchmaking.cancel(ticket.ticketId).catch(() => undefined)
      this.showReturnPage(returnPage)
      this.dependencies.showNotice('比赛匹配失败', '匹配服务返回的房间凭证不完整或已过期')
      return
    }
    if (ticket.status === 'cancelled') {
      this.showReturnPage(returnPage)
      return
    }
    this.dependencies.scheduleOnce(() => { void this.pollMatch(ticket.ticketId, token, returnPage) }, 1)
  }

  private async pollMatch (ticketId: string, token: number, returnPage: MatchReturnPage): Promise<void> {
    if (!this.isCurrentAttempt(token, ticketId)) return
    try {
      const ticket = await this.dependencies.gateways.matchmaking.getStatus(ticketId)
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
        this.reconciledMatchIds.add(ticket.ticketId)
        this.dependencies.showNotice('匹配已完成', '取消请求到达时牌桌已分配，正在进入对局')
        this.dependencies.enterMatchedGame(ticket)
      } else await this.dependencies.gateways.matchmaking.cancel(ticket.ticketId).catch(() => undefined)
      return
    }
    if (ticket.status === 'cancelled') {
      this.reconciledMatchIds.add(ticket.ticketId)
      return
    }
    await this.cancelOrRecoverAssignedMatch(ticket.ticketId)
  }

  private async cancelOrRecoverAssignedMatch (ticketId: string): Promise<void> {
    if (!ticketId || this.reconciledMatchIds.has(ticketId)) return
    try {
      await this.dependencies.gateways.matchmaking.cancel(ticketId)
      this.reconciledMatchIds.add(ticketId)
      return
    } catch {
      // Cancellation may cross the assignment boundary; reconcile once so a
      // completed table is never silently stranded after the player cancels.
    }
    try {
      const current = await this.dependencies.gateways.matchmaking.getStatus(ticketId)
      if (current.status === 'matched' && this.isUsableMatchTicket(current) && !this.isDisposed()) {
        this.reconciledMatchIds.add(ticketId)
        this.dependencies.showNotice('匹配已完成', '取消请求到达时牌桌已分配，正在进入对局')
        this.dependencies.enterMatchedGame(current)
      } else if (current.status === 'cancelled') this.reconciledMatchIds.add(ticketId)
      else await this.dependencies.gateways.matchmaking.cancel(ticketId).then(() => this.reconciledMatchIds.add(ticketId)).catch(() => undefined)
    } catch {
      // A later explicit queue entry can reconcile an uncertain cancellation.
    }
  }

  private isCurrentAttempt (token: number, ticketId?: string): boolean {
    return !this.isDisposed()
      && token === this.matchAttemptToken
      && this.dependencies.router.current === 'matching'
      && (ticketId === undefined || this.activeMatchTicketId === ticketId)
  }

  private isUsableMatchTicket (ticket: MatchTicket): boolean {
    return Boolean(ticket.ticketId && ticket.status === 'matched' && ticket.roomId && ticket.gameEndpoint && ticket.joinToken && ticket.seat && (!ticket.expiresAt || ticket.expiresAt > Date.now()))
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
