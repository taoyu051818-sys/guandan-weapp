import { Node, Vec3 } from 'cc'
import { ReplayTimeline } from '../../replay/ReplayTimeline'
import type { FrontPageGateways, ReplayDetail, ReplaySummary } from '../../services/FrontPageGatewayContracts'
import { renderReplayBoard } from '../../ui/ReplayBoardView'
import { neutralReplayViewpoint, playerReplayViewpoint } from '../../ui/ReplayViewpoint'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { PageRouter } from '../PageRouter'

export type ReplayReturnPage = 'replay-list' | 'player-center'
export type ReplayPageDependencies = {
  router: PageRouter
  gateways: FrontPageGateways
  isDisposed: () => boolean
  issuePageRequest: () => number
  currentPageRequest: () => number
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  showNotice: (title: string, detail?: string) => void
  showPlayerCenter: () => void
}

/** Owns completed-match replay only. Live friend-room viewing belongs to the game table. */
export class ReplayPageDomain {
  private replayPlaybackToken = 0
  private activeReplayTimeline: ReplayTimeline | null = null
  private destroyed = false
  private replayListView: { replays: ReplaySummary[], status: string } = { replays: [], status: '' }
  private replayDetailView: { replay: ReplayDetail | null, status: string, returnPage: ReplayReturnPage, timeline?: ReplayTimeline } | null = null
  public constructor (private readonly dependencies: ReplayPageDependencies) {}

  public showReplayList (): void {
    if (this.isDisposed()) return
    this.stopReplayPlayback(true)
    const token = this.dependencies.issuePageRequest()
    this.renderReplayList([], '正在同步牌谱…')
    void this.refreshReplayList(token)
  }

  public showReplayDetail (replayId: string, returnPage: ReplayReturnPage = 'replay-list'): void {
    if (this.isDisposed()) return
    this.stopReplayPlayback(true)
    const token = this.dependencies.issuePageRequest()
    this.renderReplayDetail(null, '正在读取牌谱…', returnPage)
    void this.refreshReplayDetail(replayId, returnPage, token)
  }

  public handleApplicationHide (): void { this.stopReplayPlayback(false) }
  public stop (): void { this.stopReplayPlayback(true) }
  public destroy (): void { if (!this.destroyed) { this.stop(); this.destroyed = true } }
  public reflow (): void {
    if (this.dependencies.router.current === 'replay-list') this.renderReplayList(this.replayListView.replays, this.replayListView.status)
    else if (this.dependencies.router.current === 'replay-detail' && this.replayDetailView) {
      const view = this.replayDetailView
      this.renderReplayDetail(view.replay, view.status, view.returnPage, view.timeline)
    }
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

  private renderReplayList (replays: ReplaySummary[], status: string): void {
    this.replayListView = { replays, status }
    const ui = this.dependencies.router.open('replay-list')
    ui.menuLabel('我的对局', 0, 220, 42)
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
    this.replayDetailView = { replay, status, returnPage, timeline }
    const ui = this.dependencies.router.open('replay-detail')
    ui.menuLabel('牌谱回放', 0, 300, 40)
    ui.menuLabel(status, 0, 262, 16)
    if (replay && timeline) {
      ui.menuLabel(`房间 ${replay.roomId || '-'} · 胜方 ${replay.winnerTeam || '-'} · 名次 ${replay.ranking.join(' > ')}`, 0, 225, 18)
      renderReplayBoard(ui, timeline.state, replay.participants, replay.viewerSeat ? playerReplayViewpoint(replay.viewerSeat) : neutralReplayViewpoint())
      this.renderReplayControls(ui, timeline, () => this.renderReplayDetail(replay, status, returnPage, timeline))
    }
    this.sizedButton(ui, returnPage === 'player-center' ? '返回个人中心' : '返回牌谱', 0, -310, 220, 40, 17, () => {
      this.stopReplayPlayback(true)
      if (returnPage === 'player-center') this.dependencies.showPlayerCenter()
      else this.showReplayList()
    })
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
        || this.dependencies.router.current !== 'replay-detail') return
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

  private isCurrentRequest (token: number, route: 'replay-list' | 'replay-detail'): boolean {
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
