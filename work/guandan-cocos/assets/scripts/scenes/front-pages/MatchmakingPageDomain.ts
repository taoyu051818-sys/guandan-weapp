import type { Label } from 'cc'
import type { FrontPageGateways, MatchQueueId, MatchTicket } from '../../services/FrontPageGatewayContracts'
import { matchErrorDetail } from '../../services/MatchmakingErrorPresentation'
import { matchWaitingText, type MatchWaitingStage } from '../../services/MatchWaitingPresentation'
import type { PageRouter } from '../PageRouter'
import { renderMatchmakingPage } from './MatchmakingPageView'

export type MatchReturnPage = 'menu' | 'online' | 'classic-rooms' | 'tournament-center'
export type MatchAssignment = { tournamentId: string, assignmentId: string }
const MAX_TRACKED_MATCH_IDS = 32
export type MatchmakingPageDependencies = {
  animationsEnabled: () => boolean
  router: PageRouter
  gateways: FrontPageGateways
  isDisposed: () => boolean
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  showNotice: (title: string, detail?: string) => void
  enterMatchedGame: (ticket: MatchTicket) => void
  showMenu: () => void
  showOnlinePlay: () => void
  showClassicRooms: () => void
  showTournament?: () => void
}

/** Owns the matching page, polling, ticket validation, and cancel/assignment reconciliation. */
export class MatchmakingPageDomain {
  private matchAttemptToken = 0
  private activeMatchTicketId: string | null = null
  private matchingStatusLabel: Label | null = null
  private matchingStartedAt = 0
  private matchingQueueName = ''
  private matchingBotFillEnabled = false
  private matchingStage: MatchWaitingStage = 'requesting'
  private matchingReturnPage: MatchReturnPage = 'menu'
  private pendingRequest: Promise<void> | null = null
  private matchingError: string | null = null
  private retryRequest: (() => void) | null = null
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
    if (this.isDisposed() || (this.dependencies.router.current === 'matching' && this.matchingStartedAt && this.matchingStage !== 'failed')) return
    this.invalidate()
    const token = this.matchAttemptToken
    this.matchingStartedAt = Date.now()
    this.matchingQueueName = queueName
    this.matchingBotFillEnabled = queueId === 'quick' || queueId.startsWith('classic_')
    this.matchingStage = 'requesting'
    this.matchingReturnPage = returnPage
    this.retryRequest = () => this.begin(queueId, queueName, returnPage, assignment)
    this.renderMatching()
    this.scheduleMatchingWaitTick(token)
    this.dependencies.scheduleOnce(() => {
      if (!this.isCurrentAttempt(token) || this.isCancelling()) return
      const pending = this.requestMatch(queueId, token, returnPage, assignment).finally(() => {
        if (this.pendingRequest === pending) this.pendingRequest = null
      })
      this.pendingRequest = pending
    }, 0)
  }

  public reflow (): void {
    if (!this.isDisposed() && this.dependencies.router.current === 'matching') this.renderMatching()
  }
  public get entering (): boolean { return this.matchingStage === 'entering' && this.dependencies.router.current === 'matching' }

  /** Invalidates delayed callbacks and reconciles any queue ticket still owned by this page. */
  public invalidate (): void {
    this.matchAttemptToken += 1
    const ticketId = this.activeMatchTicketId
    this.activeMatchTicketId = null
    this.matchingStatusLabel = null
    this.matchingStartedAt = 0
    this.matchingQueueName = ''
    this.matchingBotFillEnabled = false
    this.matchingStage = 'requesting'
    this.matchingError = null
    if (ticketId) void this.cancelOrRecoverAssignedMatch(ticketId)
  }

  public stop (): void { this.invalidate() }
  public destroy (): void {
    if (this.destroyed) return
    this.invalidate()
    this.destroyed = true
  }

  private renderMatching (): void {
    const ui = this.dependencies.router.open('matching')
    this.matchingStatusLabel = renderMatchmakingPage(ui, this.matchingStage, this.matchingError,
      () => { void this.cancelMatch() }, () => this.retryRequest?.(), () => this.deferUncertainMatch(), this.dependencies.animationsEnabled())
    this.refreshMatchingWaitLabel()
  }

  private async cancelMatch (): Promise<void> {
    if (this.isDisposed() || this.matchingStage === 'cancelling' || this.matchingStage === 'entering') return
    const token = this.matchAttemptToken
    this.matchingStage = 'cancelling'
    this.matchingError = null
    this.renderMatching()
    // Keep this page visible until both the in-flight join and cancel have an outcome.
    await this.pendingRequest
    if (!this.isCurrentAttempt(token)) return
    const ticketId = this.activeMatchTicketId
    if (ticketId && await this.cancelOrRecoverAssignedMatch(ticketId)) return
    if (!this.isCurrentAttempt(token)) return
    if (ticketId && this.uncertainMatchIds.has(ticketId)) {
      this.matchingStage = 'cancel-uncertain'
      this.renderMatching()
    } else this.showReturnPage(this.matchingReturnPage)
  }

  private enterTicket (ticket: MatchTicket): void {
    this.activeMatchTicketId = null
    this.matchingStage = 'entering'
    if (this.dependencies.router.current === 'matching') this.renderMatching()
    this.dependencies.enterMatchedGame(ticket)
  }

  private deferUncertainMatch (): void {
    if (this.matchingStage !== 'cancel-uncertain') return
    // Keep the uncertain credential for the next preflight, without a background
    // cancel that could navigate away from the lobby after the player leaves.
    this.activeMatchTicketId = null
    this.showReturnPage(this.matchingReturnPage)
  }

  private failMatch (detail: string): void {
    this.matchingStage = 'failed'
    this.matchingError = detail
    this.renderMatching()
  }

  private async requestMatch (
    queueId: MatchQueueId,
    token: number,
    returnPage: MatchReturnPage,
    assignment?: MatchAssignment,
  ): Promise<void> {
    if (!this.isCurrentAttempt(token) || this.isCancelling()) return
    try {
      const enteredPriorMatch = await this.reconcileUncertainMatches()
      if (!this.isCurrentAttempt(token) || enteredPriorMatch || this.isCancelling()) return
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
      if (this.isCancelling()) return
      this.matchingStage = 'queued'
      this.refreshMatchingWaitLabel()
      this.acceptMatchTicket(ticket, token, returnPage)
    } catch (error) {
      if (this.isDisposed() || token !== this.matchAttemptToken) return
      if (!this.isCancelling()) this.failMatch(matchErrorDetail(error))
    }
  }

  private acceptMatchTicket (ticket: MatchTicket, token: number, returnPage: MatchReturnPage): void {
    if (!this.isCurrentAttempt(token)) return
    if (ticket.status === 'matched') {
      const usable = this.isUsableMatchTicket(ticket)
      if (usable) {
        this.markReconciled(ticket.ticketId)
        this.enterTicket(ticket)
        return
      }
      this.failMatch('匹配服务返回的房间凭证不完整或已过期，请重新匹配')
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
    if (!this.isCurrentAttempt(token, ticketId) || this.matchingStage !== 'queued') return
    try {
      const ticket = await this.getTicketStatus(ticketId)
      if (!this.isCurrentAttempt(token, ticketId)) {
        void this.reconcileStaleMatch(ticket)
        return
      }
      if (this.matchingStage === 'queued') this.acceptMatchTicket(ticket, token, returnPage)
    } catch (error) {
      if (this.isDisposed() || token !== this.matchAttemptToken) return
      if (this.matchingStage === 'queued') this.failMatch(matchErrorDetail(error))
    }
  }

  private showReturnPage (returnPage: MatchReturnPage): void {
    this.invalidate()
    if (returnPage === 'menu') this.dependencies.showMenu()
    else if (returnPage === 'classic-rooms') this.dependencies.showClassicRooms()
    else if (returnPage === 'tournament-center') (this.dependencies.showTournament ?? this.dependencies.showMenu)()
    else this.dependencies.showOnlinePlay()
  }

  private refreshMatchingWaitLabel (): void {
    if (!this.matchingStatusLabel || !this.matchingStartedAt || this.matchingError) return
    this.matchingStatusLabel.string = matchWaitingText(
      this.matchingQueueName,
      this.matchingStage,
      Date.now() - this.matchingStartedAt,
      this.matchingBotFillEnabled,
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
    if (this.uncertainMatchIds.has(ticket.ticketId) && this.dependencies.router.current !== 'matching') return
    if (ticket.status === 'matched') {
      if (this.isUsableMatchTicket(ticket) && !this.isDisposed()) {
        this.markReconciled(ticket.ticketId)
        this.dependencies.showNotice('匹配已完成', '取消请求到达时牌桌已分配，正在进入对局')
        this.enterTicket(ticket)
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
      this.enterTicket(ticket)
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

  private isCancelling (): boolean { return this.matchingStage === 'cancelling' }
  private isDisposed (): boolean { return this.destroyed || this.dependencies.isDisposed() }
}
