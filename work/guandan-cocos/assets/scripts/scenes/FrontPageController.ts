import { game, Game, Node } from 'cc'
import { LobbyController, type LobbySnapshot } from '../network/LobbyController'
import type { FrontPagePreviewData } from '../services/FrontPagePreviewData'
import type { FrontPageGateways, MatchRecoveryEntry, MatchTicket } from '../services/FrontPageGatewayContracts'
import { GameSession } from '../session/GameSession'
import { ScreenAdapter } from '../ui/ScreenAdapter'
import { PageRouter } from './PageRouter'
import { FrontPagePlayerState } from './front-pages/FrontPagePlayerState'
import { FrontPageWalletState } from './front-pages/FrontPageWalletState'
import { LobbyPageDomain } from './front-pages/LobbyPageDomain'
import { MatchmakingPageDomain } from './front-pages/MatchmakingPageDomain'
import { PlayerCenterPageDomain } from './front-pages/PlayerCenterPageDomain'
import { ReplayPageDomain } from './front-pages/ReplayPageDomain'
import { ShopPageDomain } from './front-pages/ShopPageDomain'
import { ProfileEditorModal } from './front-pages/ProfileEditorModal'
import { profileAvatarFrame } from '../ui/ProfileAvatar'
import { ProfileSaveCoordinator } from '../services/ProfileSaveCoordinator'
import { WechatProfileSync } from '../services/WechatProfileSync'
import { WechatFriendScoreSync } from '../services/WechatFriendRanking'
import { FriendRankingModal } from './front-pages/FriendRankingModal'
import { TournamentCenterController } from './front-pages/TournamentCenterController'

export type FrontPageHost = {
  refreshProfile?: () => void
  setTableVisible: (visible: boolean) => void
  setFriendRoomWaitingVisible: (visible: boolean) => void
  closeModal: () => void
  showNotice: (title: string, detail?: string) => void
  showToast: (message: string) => void
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  getLobbyEndpoint: () => string
  enterMatchedGame: (ticket: MatchTicket) => void
}
/** Owns front-page navigation and construction; it never mutates a live round. */
export class FrontPageController {
  private readonly profileEditor: ProfileEditorModal
  private readonly profileSync: WechatProfileSync
  private readonly friendScores = new WechatFriendScoreSync()
  private readonly friendRanking: FriendRankingModal
  private readonly router: PageRouter
  private pageRequestToken = 0
  private disposed = false
  private readonly walletState: FrontPageWalletState
  private readonly playerState: FrontPagePlayerState
  private readonly shopPage: ShopPageDomain
  private readonly lobbyPage: LobbyPageDomain
  private readonly matchmakingPage: MatchmakingPageDomain
  private readonly playerCenterPage: PlayerCenterPageDomain
  private readonly replayPage: ReplayPageDomain
  private readonly tournamentPage: TournamentCenterController

  public constructor (
    root: Node,
    private readonly session: GameSession,
    private readonly lobby: LobbyController,
    private readonly screen: ScreenAdapter,
    private readonly host: FrontPageHost,
    private readonly gateways: FrontPageGateways,
    previews: FrontPagePreviewData,
  ) {
    this.router = new PageRouter(root, (previous, next) => {
      if (previous === 'tournament-center' && next !== previous) this.tournamentPage?.suspend()
      // Matching shares the empty-table presentation used by room waiting;
      // do not enable stale hands/HUD before the authoritative snapshot arrives.
      if (previous === 'matching' || next === 'matching') this.host.setFriendRoomWaitingVisible(next === 'matching')
    })
    this.walletState = new FrontPageWalletState(gateways.configured)
    this.playerState = new FrontPagePlayerState(gateways.configured, previews.dashboard)
    const saves = new ProfileSaveCoordinator(gateways.auth, profile => {
      if (this.disposed) return
      this.playerState.updateProfile(profile)
      if (this.router.current === 'menu') this.lobbyPage.renderMenu()
      if (this.router.current === 'player-center') this.playerCenterPage.reflow()
      this.host.refreshProfile?.()
    })
    this.profileEditor = new ProfileEditorModal(root, screen, gateways.auth, () => {}, saves)
    this.profileSync = new WechatProfileSync(saves, () => !this.disposed && !this.profileEditor.open)
    this.friendRanking = new FriendRankingModal(root, screen, this.friendScores, async () => {
      if (!gateways.configured) throw new Error('请先连接正式游戏账号，演示数据不参与好友排行。')
      const dashboard = await gateways.playerCenter.getDashboard()
      return { userId: dashboard.user.id, score: dashboard.rating.comprehensiveScore }
    })
    this.shopPage = new ShopPageDomain({
      previewProducts: previews.products,
      router: this.router,
      screen: this.screen,
      isDisposed: () => this.disposed,
      issuePageRequest: () => ++this.pageRequestToken,
      setTableVisible: visible => this.host.setTableVisible(visible),
      showMenu: () => this.lobbyPage.showMenu(),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
    })
    this.replayPage = new ReplayPageDomain({
      router: this.router,
      gateways: this.gateways,
      isDisposed: () => this.disposed,
      issuePageRequest: () => ++this.pageRequestToken,
      currentPageRequest: () => this.pageRequestToken,
      scheduleOnce: (callback, delaySeconds) => this.host.scheduleOnce(callback, delaySeconds),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
      showPlayerCenter: () => { void this.playerCenterPage.show() },
    })
    this.playerCenterPage = new PlayerCenterPageDomain({
      showFriendRanking: () => this.friendRanking.show(),
      profileLoaded: dashboard => { this.syncWechatIdentity(dashboard.user, dashboard.rating.comprehensiveScore) },
      editProfile: () => this.showProfileEditor(),
      router: this.router,
      gateways: this.gateways,
      player: this.playerState,
      wallet: this.walletState,
      isDisposed: () => this.disposed,
      issuePageRequest: () => ++this.pageRequestToken,
      currentPageRequest: () => this.pageRequestToken,
      showMenu: () => this.lobbyPage.showMenu(),
      showReplayList: () => this.replayPage.showReplayList(),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
    })
    this.matchmakingPage = new MatchmakingPageDomain({
      animationsEnabled: () => this.session.snapshot.settings.effectQuality === 'full',
      router: this.router,
      gateways: this.gateways,
      isDisposed: () => this.disposed,
      scheduleOnce: (callback, delaySeconds) => this.host.scheduleOnce(callback, delaySeconds),
      showNotice: (title, detail) => this.host.showNotice(title, detail),
      enterMatchedGame: ticket => {
        this.restoreMatchOrigin(ticket.roomId ?? null, ticket.queueId)
        this.host.enterMatchedGame(ticket)
      },
      showMenu: () => this.lobbyPage.showMenu(),
      showOnlinePlay: () => this.lobbyPage.showOnlinePlay(),
      showClassicRooms: () => this.lobbyPage.showClassicRooms(),
      showTournament: () => this.tournamentPage.open(),
    })
    this.tournamentPage = new TournamentCenterController({
      router: this.router, gateways, screen, isDisposed: () => this.disposed,
      scheduleOnce: (callback, delay) => host.scheduleOnce(callback, delay),
      setTableVisible: visible => host.setTableVisible(visible), showMenu: () => this.lobbyPage.showMenu(),
      enter: (tournament, state) => {
        if (state.assignment) this.matchmakingPage.begin(tournament.queueId, tournament.name, 'tournament-center', {
          tournamentId: tournament.id, assignmentId: state.assignment.assignmentId,
        })
      },
    })
    this.lobbyPage = new LobbyPageDomain({
      profileLoaded: profile => this.syncWechatIdentity(profile, profile.comprehensiveScore),
      editProfile: () => this.showProfileEditor(),
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
      showCompetition: () => this.tournamentPage.open(),
      showPlayerCenter: () => { void this.playerCenterPage.show() },
      showShop: () => this.shopPage.showPreview(),
      beginMatch: (queueId, queueName, returnPage) => this.matchmakingPage.begin(queueId, queueName, returnPage),
    })
    game.on(Game.EVENT_HIDE, this.handleApplicationHide)
    game.on(Game.EVENT_SHOW, this.handleApplicationShow)
  }

  public showMenu (): void { this.lobbyPage.showMenu() }
  public showClassicRooms (): void { this.lobbyPage.showClassicRooms() }

  public showRecoveryMenu (): void { this.lobbyPage.showMenu(true) }

  public showOnlinePlay (): void { this.lobbyPage.showOnlinePlay() }
  public showTournament (): void { this.tournamentPage.open() }
  public isTournamentRoom (roomId: string | null): boolean { return Boolean(roomId && roomId === this.tournamentPage.enteredRoomId) }
  public restoreMatchOrigin (roomId: string | null, queueId?: string): void {
    this.tournamentPage.enteredRoomId = queueId === 'lingshui_16_cup' ? roomId : null
  }

  public showLobby (compensateReservation = true): void { this.lobbyPage.showLobby(compensateReservation) }

  public handoffFriendRoomReservation (): void { this.lobbyPage.handoffFriendRoomReservation() }

  public restoreFriendRoomReservation (entry: Extract<MatchRecoveryEntry, { roomKind: 'friend' }>): void {
    this.lobbyPage.restoreFriendRoomReservation(entry)
  }

  public renderLobby (snapshot: LobbySnapshot): void {
    // Keep a matched join from flashing the private-room waiting layout before
    // its identity is confirmed. Errors still go through the existing room flow.
    if (this.matchmakingPage.entering && snapshot.roomId && !snapshot.error && (snapshot.roomStatus === 'joining' || snapshot.roomStatus === 'rejoining')) return
    this.lobbyPage.renderLobby(snapshot)
  }
  public setRecoveryPending (pending: boolean): void { this.lobbyPage.setRecoveryPending(pending) }
  public get profileEditorOpen (): boolean { return this.profileEditor.open || this.friendRanking.open }
  public get ownProfile () { return this.playerState.profile ?? this.playerState.dashboard?.user ?? null }
  public ownAvatarFrame () { return profileAvatarFrame(this.ownProfile, this.gateways.auth) }
  public showProfileEditor (): void { this.profileSync.cancel(); void this.profileEditor.show(this.ownProfile) }

  public hideAll (): void {
    if (this.disposed) return
    this.friendRanking.close()
    this.pageRequestToken += 1
    this.matchmakingPage.stop()
    this.replayPage.stop()
    this.tournamentPage.suspend()
    this.lobbyPage.hide()
    this.router.clear()
  }

  public resize (width: number, height: number): void {
    this.profileEditor.reflow()
    this.friendRanking.reflow()
    this.router.resize(width, height)
    if (this.disposed) return
    const route = this.router.current
    if (route && ['menu', 'online', 'classic-rooms', 'friend-room-settings', 'lobby'].includes(route)) this.lobbyPage.reflow()
    else if (route && ['shop', 'product'].includes(route)) this.shopPage.reflow()
    else if (route && ['player-center', 'season-tasks'].includes(route)) this.playerCenterPage.reflow()
    else if (route && ['replay-list', 'replay-detail'].includes(route)) this.replayPage.reflow()
    else if (route === 'matching') this.matchmakingPage.reflow()
    else if (route === 'tournament-center') this.tournamentPage.reflow()
  }

  private readonly handleApplicationHide = (): void => {
    this.replayPage.handleApplicationHide()
    this.tournamentPage.suspend()
  }
  private readonly handleApplicationShow = (): void => { this.tournamentPage.resume() }

  public destroy (): void {
    this.friendRanking.close()
    this.friendScores.cancel()
    this.profileSync.cancel()
    this.profileEditor.close()
    if (this.disposed) return
    this.pageRequestToken += 1
    game.off(Game.EVENT_HIDE, this.handleApplicationHide)
    game.off(Game.EVENT_SHOW, this.handleApplicationShow)
    this.tournamentPage.destroy()
    this.matchmakingPage.destroy()
    this.replayPage.destroy()
    this.lobbyPage.destroy()
    this.disposed = true
    this.router.destroy()
  }

  private syncWechatIdentity (profile: NonNullable<FrontPageController['ownProfile']>, score: number): void {
    if (!this.gateways.configured || this.disposed) return
    void this.profileSync.run(profile)
    void this.friendScores.publish(profile.id, score, true, () => !this.disposed && this.ownProfile?.id === profile.id).catch(() => {})
  }


}
