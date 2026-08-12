import { game, Game, Node, Vec3 } from 'cc'
import { LobbyController, type LobbySnapshot } from '../network/LobbyController'
import {
  createDevelopmentGateways,
  SAMPLE_DASHBOARD,
} from '../services/DevelopmentApis'
import type { FrontPageGateways, MatchRecoveryEntry, MatchTicket } from '../services/FrontPageGatewayContracts'
import { GameSession } from '../session/GameSession'
import type { EffectQuality } from '../effects/EffectTypes'
import { ScreenAdapter } from '../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../ui/RuntimeUiFactory'
import { PageRouter } from './PageRouter'
import { CompetitionPageDomain } from './front-pages/CompetitionPageDomain'
import { EffectLabPageDomain } from './front-pages/EffectLabPageDomain'
import { FrontPagePlayerState } from './front-pages/FrontPagePlayerState'
import { FrontPageWalletState } from './front-pages/FrontPageWalletState'
import { LobbyPageDomain } from './front-pages/LobbyPageDomain'
import { MatchmakingPageDomain } from './front-pages/MatchmakingPageDomain'
import { PlayerCenterPageDomain } from './front-pages/PlayerCenterPageDomain'
import { ReplaySpectatorPageDomain } from './front-pages/ReplaySpectatorPageDomain'
import { SettingsRulesPageDomain } from './front-pages/SettingsRulesPageDomain'
import { ShopPageDomain } from './front-pages/ShopPageDomain'

export type FrontPageHost = {
  setTableVisible: (visible: boolean) => void
  setFriendRoomWaitingVisible: (visible: boolean) => void
  closeModal: () => void
  showNotice: (title: string, detail?: string) => void
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  getLobbyEndpoint: () => string
  enterMatchedGame: (ticket: MatchTicket) => void
  startMasterBotTest: () => void
  listEffectLabFixtures: () => readonly { id: string, label: string, kind: string, description: string }[]
  previewEffectLabFixture: (id: string, quality: EffectQuality) => void
}
/** Owns front-page navigation and construction; it never mutates a live round. */
export class FrontPageController {
  private readonly router: PageRouter
  private pageRequestToken = 0
  private disposed = false
  private readonly walletState: FrontPageWalletState
  private readonly playerState: FrontPagePlayerState
  private readonly shopPage: ShopPageDomain
  private readonly competitionPage: CompetitionPageDomain
  private readonly effectLabPage: EffectLabPageDomain
  private readonly lobbyPage: LobbyPageDomain
  private readonly matchmakingPage: MatchmakingPageDomain
  private readonly playerCenterPage: PlayerCenterPageDomain
  private readonly replaySpectatorPage: ReplaySpectatorPageDomain
  private readonly settingsRulesPage: SettingsRulesPageDomain

  public constructor (
    root: Node,
    private readonly session: GameSession,
    private readonly lobby: LobbyController,
    private readonly screen: ScreenAdapter,
    private readonly host: FrontPageHost,
    private readonly gateways: FrontPageGateways = createDevelopmentGateways(),
  ) {
    this.router = new PageRouter(root, (previous, next) => {
      if (previous === 'spectator-feed' && next !== 'spectator-feed') this.replaySpectatorPage.leaveSpectatorFeed()
      if (previous === 'effect-lab' && next !== 'effect-lab') this.effectLabPage.cancelPending()
      if (next !== 'menu') this.settingsRulesPage.dismissRulesState()
    })
    this.walletState = new FrontPageWalletState(gateways.configured)
    this.playerState = new FrontPagePlayerState(gateways.configured, SAMPLE_DASHBOARD)
    this.shopPage = new ShopPageDomain({
      router: this.router,
      screen: this.screen,
      gateways: this.gateways,
      wallet: this.walletState,
      isDisposed: () => this.disposed,
      issuePageRequest: () => ++this.pageRequestToken,
      currentPageRequest: () => this.pageRequestToken,
      setTableVisible: visible => this.host.setTableVisible(visible),
      showMenu: () => this.lobbyPage.showMenu(),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
    })
    this.competitionPage = new CompetitionPageDomain({
      router: this.router,
      screen: this.screen,
      gateways: this.gateways,
      wallet: this.walletState,
      isDisposed: () => this.disposed,
      issuePageRequest: () => ++this.pageRequestToken,
      currentPageRequest: () => this.pageRequestToken,
      invalidateMatchAttempt: () => this.matchmakingPage.invalidate(),
      showMenu: () => this.lobbyPage.showMenu(),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
      beginMatch: (queueId, queueName, assignment) => this.matchmakingPage.begin(queueId, queueName, 'competition', assignment),
    })
    this.effectLabPage = new EffectLabPageDomain({
      router: this.router,
      screen: this.screen,
      isDisposed: () => this.disposed,
      listFixtures: () => this.host.listEffectLabFixtures(),
      previewFixture: (id, quality) => this.host.previewEffectLabFixture(id, quality),
      scheduleOnce: (callback, delaySeconds) => this.host.scheduleOnce(callback, delaySeconds),
      showMenu: () => this.lobbyPage.showMenu(),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
    })
    this.replaySpectatorPage = new ReplaySpectatorPageDomain({
      router: this.router,
      gateways: this.gateways,
      isDisposed: () => this.disposed,
      issuePageRequest: () => ++this.pageRequestToken,
      currentPageRequest: () => this.pageRequestToken,
      scheduleOnce: (callback, delaySeconds) => this.host.scheduleOnce(callback, delaySeconds),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
      showPlayerCenter: () => { void this.playerCenterPage.show() },
      showMoreMenu: () => this.showMoreMenu(),
    })
    this.playerCenterPage = new PlayerCenterPageDomain({
      router: this.router,
      gateways: this.gateways,
      player: this.playerState,
      wallet: this.walletState,
      isDisposed: () => this.disposed,
      issuePageRequest: () => ++this.pageRequestToken,
      currentPageRequest: () => this.pageRequestToken,
      showMenu: () => this.lobbyPage.showMenu(),
      showReplayList: () => this.replaySpectatorPage.showReplayList(),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
    })
    this.settingsRulesPage = new SettingsRulesPageDomain({
      router: this.router,
      screen: this.screen,
      session: this.session,
      renderMenu: () => this.lobbyPage.renderMenu(),
      showMoreMenu: () => this.showMoreMenu(),
    })
    this.matchmakingPage = new MatchmakingPageDomain({
      router: this.router,
      gateways: this.gateways,
      isDisposed: () => this.disposed,
      scheduleOnce: (callback, delaySeconds) => this.host.scheduleOnce(callback, delaySeconds),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
      enterMatchedGame: ticket => this.host.enterMatchedGame(ticket),
      showMenu: () => this.lobbyPage.showMenu(),
      showOnlinePlay: () => this.lobbyPage.showOnlinePlay(),
      showCompetition: () => this.competitionPage.show(),
      showClassicRooms: () => this.lobbyPage.showClassicRooms(),
    })
    this.lobbyPage = new LobbyPageDomain({
      router: this.router,
      session: this.session,
      lobby: this.lobby,
      screen: this.screen,
      gateways: this.gateways,
      player: this.playerState,
      wallet: this.walletState,
      isDisposed: () => this.disposed,
      issuePageRequest: () => ++this.pageRequestToken,
      currentPageRequest: () => this.pageRequestToken,
      invalidateMatchAttempt: () => this.matchmakingPage.invalidate(),
      closeModal: () => this.host.closeModal(),
      setTableVisible: visible => this.host.setTableVisible(visible),
      setFriendRoomWaitingVisible: visible => this.host.setFriendRoomWaitingVisible(visible),
      scheduleOnce: (callback, delaySeconds) => this.host.scheduleOnce(callback, delaySeconds),
      getLobbyEndpoint: () => this.host.getLobbyEndpoint(),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
      dismissRulesState: () => this.settingsRulesPage.dismissRulesState(),
      rulesVisible: () => this.settingsRulesPage.rulesVisible,
      showRules: () => this.settingsRulesPage.showRules(),
      showMoreMenu: () => this.showMoreMenu(),
      showCompetition: () => this.competitionPage.show(),
      showPlayerCenter: () => { void this.playerCenterPage.show() },
      showShop: () => this.shopPage.show(),
      beginMatch: (queueId, queueName, returnPage) => this.matchmakingPage.begin(queueId, queueName, returnPage),
    })
    game.on(Game.EVENT_HIDE, this.handleApplicationHide)
    game.on(Game.EVENT_SHOW, this.handleApplicationShow)
  }

  public showMenu (): void { this.lobbyPage.showMenu() }

  public showRecoveryMenu (): void { this.lobbyPage.showMenu(true) }

  public showOnlinePlay (): void { this.lobbyPage.showOnlinePlay() }

  public showLobby (compensateReservation = true): void { this.lobbyPage.showLobby(compensateReservation) }

  public handoffFriendRoomReservation (): void { this.lobbyPage.handoffFriendRoomReservation() }

  public restoreFriendRoomReservation (entry: Extract<MatchRecoveryEntry, { roomKind: 'friend' }>): void {
    this.lobbyPage.restoreFriendRoomReservation(entry)
  }

  public renderLobby (snapshot: LobbySnapshot): void { this.lobbyPage.renderLobby(snapshot) }

  public hideAll (): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    this.matchmakingPage.stop()
    this.replaySpectatorPage.stop()
    this.effectLabPage.handleShellHidden()
    this.lobbyPage.hide()
    this.router.clear()
  }

  public resize (width: number, height: number): void {
    this.router.resize(width, height)
    if (this.disposed) return
    const route = this.router.current
    const reopenRules = this.settingsRulesPage.rulesVisible
    if (route && ['menu', 'online', 'classic-rooms', 'friend-room-settings', 'lobby'].includes(route)) this.lobbyPage.reflow()
    else if (route && ['shop', 'product'].includes(route)) this.shopPage.reflow()
    else if (route && ['competition', 'tournament-flow', 'tournament-standings'].includes(route)) this.competitionPage.reflow()
    else if (route && ['player-center', 'season-tasks'].includes(route)) this.playerCenterPage.reflow()
    else if (route && ['replay-list', 'replay-detail', 'spectator-list', 'spectator-feed'].includes(route)) this.replaySpectatorPage.reflow()
    else if (route === 'settings') this.settingsRulesPage.reflow()
    else if (route === 'matching') this.matchmakingPage.reflow()
    else if (route === 'effect-lab') this.effectLabPage.reflow()
    else if (route === 'more') this.showMoreMenu()
    if (reopenRules) this.settingsRulesPage.showRules()
  }

  private readonly handleApplicationHide = (): void => {
    this.replaySpectatorPage.handleApplicationHide()
  }

  private readonly handleApplicationShow = (): void => {
    this.replaySpectatorPage.handleApplicationShow()
  }

  public destroy (): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    game.off(Game.EVENT_HIDE, this.handleApplicationHide)
    game.off(Game.EVENT_SHOW, this.handleApplicationShow)
    this.matchmakingPage.destroy()
    this.replaySpectatorPage.destroy()
    this.effectLabPage.cancelPending()
    this.lobbyPage.destroy()
    this.disposed = true
    this.router.destroy()
  }

  private showMoreMenu (): void {
    const ui = this.router.open('more')
    ui.menuLabel('更多功能', 0, 220, 42)
    const entries: Array<[string, () => void]> = [
      ['游戏设置', () => this.settingsRulesPage.showSettings()],
      ['延迟观战（实验）\n一键进入30秒示例', () => this.replaySpectatorPage.showSpectatorDemo()],
      ['快速开始·人机测试\n最高难度 · 三位策略机器人', () => this.startMasterBotTest()],
    ]
    if (this.host.listEffectLabFixtures().length) entries.push(['牌桌特效测试', () => this.openEffectLabTable()])
    entries.forEach(([label, action], index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      this.sizedButton(ui, label, column ? 165 : -165, 136 - row * 76, 292, 64, 22, action)
    })
    this.pageButton(ui, '返回大厅', -220, () => this.showMenu())
  }

  private startMasterBotTest (): void {
    this.host.startMasterBotTest()
  }

  /** Compatibility facade used by the scene host and development tooling. */
  public openEffectLabTable (): void { this.effectLabPage.openTable() }

  public showEffectLab (page = 0): void { this.effectLabPage.show(page) }

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

}
