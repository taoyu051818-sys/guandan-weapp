import { Node, Vec3 } from 'cc'
import { ReplayTimeline } from '../../replay/ReplayTimeline'
import {
  shouldStopSpectatorPolling,
  SPECTATOR_POLL_INTERVAL_SECONDS,
  spectatorRetryDelaySeconds,
} from '../../replay/SpectatorPollingPolicy'
import {
  DevelopmentSpectatorGateway,
  type FrontPageGateways,
  type ReplayDetail,
  type ReplaySummary,
  type SpectatorFeed,
  type SpectatorGateway,
  type SpectatorMatchSummary,
} from '../../services/DevelopmentApis'
import { renderReplayBoard } from '../../ui/ReplayBoardView'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { PageRouter } from '../PageRouter'

export type ReplayReturnPage = 'replay-list' | 'player-center'

type SpectatorFeedSession = {
  matchId: string
  gateway: SpectatorGateway
  isDemo: boolean
  requestToken: number
  timeline: ReplayTimeline
  feed: SpectatorFeed | null
  syncStatus: string
  consecutiveFailures: number
}

export type ReplaySpectatorPageDependencies = {
  router: PageRouter
  gateways: FrontPageGateways
  isDisposed: () => boolean
  issuePageRequest: () => number
  currentPageRequest: () => number
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  showNotice: (title: string, detail?: string) => void
  showPlayerCenter: () => void
  showMoreMenu: () => void
}

/** Owns replay browsing/playback and the complete delayed-spectator lifecycle. */
export class ReplaySpectatorPageDomain {
  private replayPlaybackToken = 0
  private spectatorPollingToken = 0
  private spectatorBackgrounded = false
  private spectatorFeedSession: SpectatorFeedSession | null = null
  private activeReplayTimeline: ReplayTimeline | null = null
  private readonly spectatorDemoGateway = new DevelopmentSpectatorGateway()
  private destroyed = false

  public constructor (private readonly dependencies: ReplaySpectatorPageDependencies) {}

  public showReplayList (): void {
    if (this.isDisposed()) return
    this.stopSpectatorPolling(true)
    this.stopReplayPlayback(true)
    const token = this.dependencies.issuePageRequest()
    this.renderReplayList([], '正在同步牌谱…')
    void this.refreshReplayList(token)
  }

  public showReplayDetail (replayId: string, returnPage: ReplayReturnPage = 'replay-list'): void {
    if (this.isDisposed()) return
    this.stopSpectatorPolling(true)
    this.stopReplayPlayback(true)
    const token = this.dependencies.issuePageRequest()
    this.renderReplayDetail(null, '正在读取牌谱…', returnPage)
    void this.refreshReplayDetail(replayId, returnPage, token)
  }

  public showSpectatorList (): void {
    if (this.isDisposed()) return
    this.stopSpectatorPolling(true)
    this.stopReplayPlayback(true)
    const token = this.dependencies.issuePageRequest()
    this.renderSpectatorList([], `${this.dependencies.gateways.configured ? '' : '开发模拟观战 · '}正在同步公开牌桌…`)
    void this.refreshSpectatorList(token)
  }

  public showSpectatorDemo (): void {
    this.showSpectatorFeed('demo-live-match', this.spectatorDemoGateway, true)
  }

  public showSpectatorFeed (
    matchId: string,
    gateway: SpectatorGateway = this.dependencies.gateways.spectator,
    isDemo = false,
  ): void {
    if (this.isDisposed()) return
    if (!matchId) {
      this.dependencies.showNotice('无法观战', '该对局没有联机比赛 ID。')
      return
    }
    this.stopSpectatorPolling(true)
    this.stopReplayPlayback(true)
    const requestToken = this.dependencies.issuePageRequest()
    const session: SpectatorFeedSession = {
      matchId,
      gateway,
      isDemo,
      requestToken,
      timeline: new ReplayTimeline(),
      feed: null,
      syncStatus: `${isDemo ? '固定演示数据 · ' : this.dependencies.gateways.configured ? '' : '开发模拟观战 · '}正在读取延迟 30 秒的公开进程并建立自动追帧…`,
      consecutiveFailures: 0,
    }
    this.spectatorFeedSession = session
    const ui = this.dependencies.router.open('spectator-feed')
    this.renderSpectatorFeed(session, ui)
    this.startSpectatorPolling(session)
  }

  /** Suspends network polling while retaining the current public board. */
  public handleApplicationHide (): void {
    if (this.isDisposed()) return
    this.spectatorBackgrounded = true
    this.stopSpectatorPolling(false)
  }

  /** Restarts polling only for the same still-current spectator session. */
  public handleApplicationShow (): void {
    if (this.isDisposed()) return
    this.spectatorBackgrounded = false
    const session = this.spectatorFeedSession
    if (!session || !this.isCurrentSpectatorSession(session) || (session.feed && shouldStopSpectatorPolling(session.feed))) return
    session.syncStatus = '已回到前台，正在同步最新公开进展…'
    this.renderSpectatorFeed(session)
    this.startSpectatorPolling(session)
  }

  /** Called by the router when spectator-feed is no longer the active page. */
  public leaveSpectatorFeed (): void {
    this.stopSpectatorPolling(true)
  }

  /** Stops timers and playback without destroying the reusable page domain. */
  public stop (): void {
    this.stopSpectatorPolling(true)
    this.stopReplayPlayback(true)
  }

  public destroy (): void {
    if (this.destroyed) return
    this.stop()
    this.destroyed = true
  }

  private async refreshReplayList (token: number): Promise<void> {
    try {
      const replays = await this.dependencies.gateways.replays.list()
      if (!this.isCurrentRequest(token, 'replay-list')) return
      const status = this.dependencies.gateways.configured
        ? replays.length ? '最近完成的对局' : '暂无牌谱'
        : replays.length ? '开发模拟牌谱 · 不代表真实战绩' : '开发模拟牌谱 · 暂无记录'
      this.renderReplayList(replays, status)
    } catch (error) {
      if (!this.isCurrentRequest(token, 'replay-list')) return
      this.renderReplayList([], this.errorDetail(error, '牌谱暂时无法获取'))
    }
  }

  private async refreshReplayDetail (replayId: string, returnPage: ReplayReturnPage, token: number): Promise<void> {
    try {
      const replay = await this.dependencies.gateways.replays.get(replayId)
      if (!this.isCurrentRequest(token, 'replay-detail')) return
      const timeline = new ReplayTimeline(replay.events)
      this.activeReplayTimeline = timeline
      const status = `${this.dependencies.gateways.configured ? '' : '开发模拟牌谱 · '}仅复原公开动作，不包含任何隐藏手牌`
      this.renderReplayDetail(replay, status, returnPage, timeline)
    } catch (error) {
      if (!this.isCurrentRequest(token, 'replay-detail')) return
      this.renderReplayDetail(null, this.errorDetail(error, '牌谱读取失败'), returnPage)
    }
  }

  private async refreshSpectatorList (token: number): Promise<void> {
    try {
      const matches = await this.dependencies.gateways.spectator.list(30)
      if (!this.isCurrentRequest(token, 'spectator-list')) return
      const status = matches.length ? '运行中、已结束与已终止牌桌 · 公开进程延迟 30 秒' : '暂无公开牌桌'
      this.renderSpectatorList(matches, `${this.dependencies.gateways.configured ? '' : '开发模拟观战 · '}${status}`)
    } catch (error) {
      if (!this.isCurrentRequest(token, 'spectator-list')) return
      this.renderSpectatorList([], this.errorDetail(error, '观战列表暂时无法获取'))
    }
  }

  private renderSpectatorList (matches: SpectatorMatchSummary[], status: string): void {
    const ui = this.dependencies.router.open('spectator-list')
    ui.menuLabel('延迟观战（实验）', 0, 220, 42)
    ui.menuLabel(status, 0, 174, 18)
    matches.slice(0, 4).forEach((match, index) => {
      const state = match.status === 'running'
        ? `进行中 · 已公开${match.availableEventCount}条`
        : match.status === 'aborted'
          ? match.timelineComplete ? `已终止 · ${match.totalEventCount}条完整记录` : '已终止 · 最后进程延迟中'
          : match.timelineComplete ? `已结束 · ${match.totalEventCount}条完整记录` : '已结束 · 最后进程延迟中'
      const time = new Date(match.startedAt).toLocaleString()
      this.sizedButton(ui, `${match.tableLabel}    ${state}\n${time} · 延迟${match.delaySeconds}秒`, 0, 105 - index * 67, 600, 56, 18, () => {
        this.showSpectatorFeed(match.matchId)
      })
    })
    this.pageButton(ui, '返回更多功能', -205, this.dependencies.showMoreMenu)
  }

  private renderReplayList (replays: ReplaySummary[], status: string): void {
    const ui = this.dependencies.router.open('replay-list')
    ui.menuLabel('我的牌谱', 0, 220, 42)
    ui.menuLabel(status, 0, 174, 18)
    replays.slice(0, 4).forEach((replay, index) => {
      const time = new Date(replay.finishedAt).toLocaleString()
      this.sizedButton(ui, `房间 ${replay.roomId || '-'}    ${time}\n${replay.ranking.join(' > ')}    ${replay.eventCount}条事件`, 0, 105 - index * 67, 600, 56, 18, () => {
        this.showReplayDetail(replay.id)
      })
    })
    this.pageButton(ui, '返回个人中心', -205, this.dependencies.showPlayerCenter)
  }

  private renderReplayDetail (
    replay: ReplayDetail | null,
    status: string,
    returnPage: ReplayReturnPage,
    timeline?: ReplayTimeline,
  ): void {
    const ui = this.dependencies.router.open('replay-detail')
    ui.menuLabel('牌谱回放', 0, 300, 40)
    ui.menuLabel(status, 0, 262, 16)
    if (replay && timeline) {
      ui.menuLabel(`房间 ${replay.roomId || '-'} · 胜方 ${replay.winnerTeam || '-'} · 名次 ${replay.ranking.join(' > ')}`, 0, 225, 18)
      renderReplayBoard(ui, timeline.state, replay.participants)
      this.renderReplayControls(ui, timeline, () => this.renderReplayDetail(replay, status, returnPage, timeline))
    }
    this.sizedButton(ui, returnPage === 'player-center' ? '返回个人中心' : '返回牌谱', 0, -310, 220, 40, 17, () => {
      this.stopReplayPlayback(true)
      if (returnPage === 'player-center') this.dependencies.showPlayerCenter()
      else this.showReplayList()
    })
  }

  private startSpectatorPolling (session: SpectatorFeedSession): void {
    if (!this.isCurrentSpectatorSession(session) || this.spectatorBackgrounded) return
    const token = ++this.spectatorPollingToken
    void this.pollSpectatorFeed(session, token)
  }

  private async pollSpectatorFeed (session: SpectatorFeedSession, token: number): Promise<void> {
    if (!this.isCurrentSpectatorPoll(session, token)) return
    try {
      const feed = await session.gateway.getFeed(session.matchId, 30)
      if (!this.isCurrentSpectatorPoll(session, token)) return
      const merge = session.timeline.merge(feed.events)
      session.feed = feed
      session.consecutiveFailures = 0
      if (shouldStopSpectatorPolling(feed)) {
        session.syncStatus = '公开时间线已完整，自动追帧已停止'
      } else if (merge.addedCount && merge.followedEnd) {
        session.syncStatus = `已自动追到最新 · 新增 ${merge.addedCount} 条公开事件`
      } else if (merge.addedCount) {
        session.syncStatus = `有新进展 · 保留当前回看位置 · 尚有 ${session.timeline.newerEventCount} 条`
      } else {
        session.syncStatus = `自动追帧中 · 每 ${SPECTATOR_POLL_INTERVAL_SECONDS} 秒检查公开进展`
      }
      this.renderSpectatorFeed(session)
      if (!shouldStopSpectatorPolling(feed)) this.scheduleSpectatorPoll(session, token, SPECTATOR_POLL_INTERVAL_SECONDS)
    } catch (error) {
      if (!this.isCurrentSpectatorPoll(session, token)) return
      session.consecutiveFailures += 1
      const retryDelay = spectatorRetryDelaySeconds(session.consecutiveFailures)
      session.syncStatus = `同步暂时失败，已保留当前画面 · ${retryDelay} 秒后重试 · ${this.errorDetail(error, '网络暂不可用')}`
      this.renderSpectatorFeed(session)
      this.scheduleSpectatorPoll(session, token, retryDelay)
    }
  }

  private scheduleSpectatorPoll (session: SpectatorFeedSession, token: number, delaySeconds: number): void {
    if (!this.isCurrentSpectatorPoll(session, token)) return
    this.dependencies.scheduleOnce(() => {
      if (this.isCurrentSpectatorPoll(session, token)) void this.pollSpectatorFeed(session, token)
    }, delaySeconds)
  }

  private isCurrentSpectatorSession (session: SpectatorFeedSession): boolean {
    return !this.isDisposed()
      && session.requestToken === this.dependencies.currentPageRequest()
      && this.spectatorFeedSession === session
      && this.dependencies.router.current === 'spectator-feed'
  }

  private isCurrentSpectatorPoll (session: SpectatorFeedSession, token: number): boolean {
    return !this.spectatorBackgrounded
      && token === this.spectatorPollingToken
      && this.isCurrentSpectatorSession(session)
  }

  private stopSpectatorPolling (clearSession: boolean): void {
    this.spectatorPollingToken += 1
    const session = this.spectatorFeedSession
    if (session) {
      session.timeline.pause()
      this.replayPlaybackToken += 1
    }
    if (clearSession) this.spectatorFeedSession = null
  }

  private renderSpectatorFeed (session: SpectatorFeedSession, currentUi?: RuntimeUiFactory): void {
    if (!this.isCurrentSpectatorSession(session)) return
    const { feed, timeline } = session
    const ui = currentUi ?? this.dependencies.router.open('spectator-feed')
    const source = session.isDemo ? '示例 · ' : this.dependencies.gateways.configured ? '' : '模拟 · '
    ui.menuLabel(`${source}${feed?.tableLabel ?? '延迟观战'} · 延迟 ${feed?.delaySeconds ?? 30} 秒`, 0, 300, 36)
    const state = !feed
      ? '正在建立公开时间线'
      : feed.status === 'running'
        ? `对局进行中 · 当前公开 ${timeline.eventCount}/${feed.totalEventCount} 条`
        : feed.status === 'aborted'
          ? feed.timelineComplete ? `牌桌已终止 · ${feed.abortReason ?? '安全退出'}` : '牌桌已终止 · 最后进程延迟中'
          : feed.timelineComplete ? '对局已结束 · 时间线完整' : '对局已结束 · 最后进程延迟中'
    ui.menuLabel(`${state} · 不展示任何隐藏手牌`, 0, 258, 16)
    ui.menuLabel(session.syncStatus, 0, 228, 16)
    renderReplayBoard(ui, timeline.state)
    this.renderReplayControls(ui, timeline, () => this.renderSpectatorFeed(session))
    if (timeline.newerEventCount > 0) {
      this.sizedButton(ui, `有新进展 ${timeline.newerEventCount} 条 · 回到最新`, 0, -282, 330, 36, 17, () => {
        timeline.pause()
        this.replayPlaybackToken += 1
        timeline.toEnd()
        session.syncStatus = `已回到最新 · 自动追帧中 · 每 ${SPECTATOR_POLL_INTERVAL_SECONDS} 秒检查`
        this.renderSpectatorFeed(session)
      })
    }
    if (session.isDemo) {
      this.sizedButton(ui, '公开牌桌', -125, -326, 210, 38, 17, () => {
        this.stopSpectatorPolling(true)
        this.showSpectatorList()
      })
      this.sizedButton(ui, '结束示例', 125, -326, 210, 38, 17, () => {
        this.stopSpectatorPolling(true)
        this.dependencies.showMoreMenu()
      })
    } else {
      this.sizedButton(ui, '返回观战列表', 0, -326, 230, 38, 17, () => {
        this.stopSpectatorPolling(true)
        this.showSpectatorList()
      })
    }
  }

  private renderReplayControls (ui: RuntimeUiFactory, timeline: ReplayTimeline, rerender: () => void): void {
    const event = timeline.currentEvent
    const round = timeline.state.roundSequence ? `第 ${timeline.state.roundSequence} 局 · ` : ''
    const progress = timeline.eventCount ? `${timeline.cursor + 1}/${timeline.eventCount}` : '0/0'
    const actor = event?.playerId ? ` · ${event.playerId.toUpperCase()}` : ''
    ui.menuLabel(`${round}公开事件 ${progress} · ${event?.type ?? '暂无'}${actor}`, 0, -172, 17)

    ;([0, 0.25, 0.5, 0.75, 1] as const).forEach((ratio, index) => {
      this.sizedButton(ui, `${Math.round(ratio * 100)}%`, -184 + index * 92, -206, 78, 36, 17, () => {
        timeline.pause()
        this.replayPlaybackToken += 1
        timeline.seekRatio(ratio)
        rerender()
      })
    })
    this.sizedButton(ui, '上一条', -146, -250, 122, 40, 18, () => {
      timeline.pause()
      this.replayPlaybackToken += 1
      timeline.previous()
      rerender()
    })
    this.sizedButton(ui, timeline.isPlaying ? '暂停' : '播放', 0, -250, 122, 40, 18, () => this.toggleReplayPlayback(timeline, rerender))
    this.sizedButton(ui, '下一条', 146, -250, 122, 40, 18, () => {
      timeline.pause()
      this.replayPlaybackToken += 1
      timeline.next()
      rerender()
    })
  }

  private toggleReplayPlayback (timeline: ReplayTimeline, rerender: () => void): void {
    if (timeline.isPlaying) {
      timeline.pause()
      this.replayPlaybackToken += 1
      rerender()
      return
    }
    if (!timeline.eventCount) return
    if (timeline.cursor >= timeline.eventCount - 1) timeline.toStart()
    if (!timeline.play()) return
    rerender()
    const token = ++this.replayPlaybackToken
    const advance = (): void => {
      if (this.isDisposed()
        || token !== this.replayPlaybackToken
        || !timeline.isPlaying
        || !['replay-detail', 'spectator-feed'].includes(this.dependencies.router.current ?? '')) return
      const moved = timeline.next()
      if (!moved || timeline.cursor >= timeline.eventCount - 1) timeline.pause()
      rerender()
      if (timeline.isPlaying) this.dependencies.scheduleOnce(advance, 0.8)
    }
    this.dependencies.scheduleOnce(advance, 0.8)
  }

  private stopReplayPlayback (clearActiveTimeline: boolean): void {
    this.activeReplayTimeline?.pause()
    this.replayPlaybackToken += 1
    if (clearActiveTimeline) this.activeReplayTimeline = null
  }

  private isCurrentRequest (token: number, route: 'replay-list' | 'replay-detail' | 'spectator-list'): boolean {
    return !this.isDisposed()
      && token === this.dependencies.currentPageRequest()
      && this.dependencies.router.current === route
  }

  private isDisposed (): boolean {
    return this.destroyed || this.dependencies.isDisposed()
  }

  private pageButton (ui: RuntimeUiFactory, text: string, y: number, action: () => void): Node {
    const node = ui.button('MenuButton', text, 0)
    node.setPosition(new Vec3(0, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private sizedButton (
    ui: RuntimeUiFactory,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    action: () => void,
  ): Node {
    const node = ui.button('PageButton', text, x, width, height, fontSize)
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private errorDetail (error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
  }
}
