import { Color, type Label, Node, UITransform, Vec3, tween } from 'cc'
import {
  type FriendRoomSettings,
  LobbyController,
  type LobbySnapshot,
} from '../../network/LobbyController'
import type { FrontPageGateways, MatchQueueId, MatchRecoveryEntry, UserProfile } from '../../services/FrontPageGatewayContracts'
import { WechatFriendInvite } from '../../services/WechatFriendInvite'
import { GameSession } from '../../session/GameSession'
import { ScreenAdapter } from '../../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { resolveLobbyLayout } from '../../ui/LobbyLayoutPolicy'
import { lobbyLabel, renderLobbyEntries, renderLobbyShop } from '../../ui/LobbyMenuView'
import { attachLobbyAmbientMotion } from '../../ui/LobbyAmbientMotion'
import { PageRouter } from '../PageRouter'
import { FriendRoomSettingsPresenter } from './FriendRoomSettingsPresenter'
import { FriendRoomPlatformFlow } from './FriendRoomPlatformFlow'
import { FriendRoomWaitingPresenter } from './FriendRoomWaitingPresenter'
import { FrontPagePlayerState } from './FrontPagePlayerState'
import { FrontPageWalletState } from './FrontPageWalletState'
import { CLASSIC_ROOM_MODES, CLASSIC_ROOM_TIERS, LOBBY_ART, type ClassicRoomMode } from './LobbyPageCatalog'
import { LobbyPlayerProfilePresenter } from './LobbyPlayerProfilePresenter'

type LobbyMatchReturnPage = 'menu' | 'online' | 'classic-rooms'
type Settled<T> = { status: 'fulfilled', value: T } | { status: 'rejected', reason: unknown }

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> => promise.then(
  value => ({ status: 'fulfilled', value }),
  reason => ({ status: 'rejected', reason }),
)

export type LobbyPageDependencies = {
  profileLoaded?: (profile: UserProfile) => void
  router: PageRouter
  session: GameSession
  lobby: LobbyController
  screen: ScreenAdapter
  gateways: FrontPageGateways
  player: FrontPagePlayerState
  wallet: FrontPageWalletState
  isDisposed: () => boolean
  issuePageRequest: () => number
  currentPageRequest: () => number
  invalidateMatchAttempt: () => void
  closeModal: () => void
  setTableVisible: (visible: boolean) => void
  setFriendRoomWaitingVisible: (visible: boolean) => void
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  getLobbyEndpoint: () => string
  showNotice: (title: string, detail?: string) => void
  showCompetition: () => void
  showPlayerCenter: () => void
  editProfile: () => void
  showShop: () => void
  beginMatch: (queueId: MatchQueueId, queueName: string, returnPage: LobbyMatchReturnPage) => void
}

/** Owns the lobby landing page, classic rooms, room connection flow, and waiting UI. */
export class LobbyPageDomain {
  private friendRoomEntryReturnPage: 'menu' | 'friend-room-settings' = 'menu'
  private classicRoomMode: ClassicRoomMode = 'classic'
  private pendingFriendRoomSettings: FriendRoomSettings | null = null
  private readonly friendRoomSettingsPresenter: FriendRoomSettingsPresenter
  private readonly friendRoomPlatformFlow: FriendRoomPlatformFlow | null
  private readonly friendRoomWaitingPresenter: FriendRoomWaitingPresenter
  private readonly wechatInvite: WechatFriendInvite
  private readonly playerProfilePresenter: LobbyPlayerProfilePresenter
  private destroyed = false
  private reflowing = false
  private recoveryPending = false
  private renderedRecoveryAvailable = false
  private readonly ambientClock = { elapsed: 0 }
  private primaryAction: { node: Node, title: Label, subtitle: Label } | null = null

  public constructor (private readonly dependencies: LobbyPageDependencies) {
    this.friendRoomSettingsPresenter = new FriendRoomSettingsPresenter({
      router: dependencies.router,
      screen: dependencies.screen,
      backgroundArt: LOBBY_ART.friendBackground,
      updateSessionSettings: settings => dependencies.session.updateSettings(settings),
      createRoom: settings => this.openLobby(settings),
      joinRoom: roomId => this.joinRoomNumber(roomId),
      goBack: () => this.showMenu(),
    })
    this.friendRoomWaitingPresenter = new FriendRoomWaitingPresenter(
      dependencies.screen, dependencies.lobby, LOBBY_ART.defaultAvatar, () => this.leaveFriendRoomToMenu(),
    )
    this.friendRoomPlatformFlow = dependencies.gateways.configured
      ? new FriendRoomPlatformFlow({
          gateway: dependencies.gateways.friendRooms,
          isDisposed: () => this.isDisposed(),
          enterMatchedRoom: entry => dependencies.lobby.enterMatchedRoom({
            entryAttemptId: entry.entryAttemptId,
            matchId: entry.matchId,
            ticketPurpose: entry.ticketPurpose,
            roomId: entry.roomId,
            gameEndpoint: entry.gameEndpoint,
            gameTicket: entry.gameTicket,
            seat: entry.seat,
            expiresAt: entry.expiresAt,
            displayName: dependencies.player.dashboard?.user.displayName ?? '陵水玩家',
          }),
          showNotice: (title, detail) => {
            // A failed HTTP reservation returns to its origin, keeping the rule
            // draft. It must not strand the player on an empty entry screen.
            if (dependencies.session.snapshot.status === 'lobby' && !dependencies.lobby.snapshot.roomId &&
              !this.friendRoomPlatformFlow?.snapshot.busy && !this.friendRoomPlatformFlow?.snapshot.entry) {
              if (this.friendRoomEntryReturnPage === 'friend-room-settings') this.showFriendRoomSettings()
              else this.showMenu()
            }
            dependencies.showNotice(title, detail)
          },
          onChanged: () => {
            if (dependencies.router.current === 'lobby' && dependencies.session.snapshot.status === 'lobby') this.renderLobby(dependencies.lobby.snapshot)
          },
        })
      : null
    this.wechatInvite = new WechatFriendInvite(text => {
      const flow = this.friendRoomPlatformFlow
      if (this.isDisposed() || !flow || flow.snapshot.busy) return
      if (this.recoveryPending) return false
      if (flow.snapshot.entry?.roomId === text.split('.')[0]) return
      if (dependencies.lobby.snapshot.roomId || dependencies.lobby.snapshot.recoveryAvailable || !['menu', 'lobby'].includes(dependencies.session.snapshot.status)) {
        dependencies.showNotice('请先退出当前房间', '结束当前牌局后，再打开好友邀请')
        return
      }
      this.openLobby()
      void flow.join(text)
    })
    this.playerProfilePresenter = new LobbyPlayerProfilePresenter({
      player: dependencies.player, wallet: dependencies.wallet,
      platformConfigured: dependencies.gateways.configured, showPlayerCenter: dependencies.showPlayerCenter,
      auth: dependencies.gateways.auth, editProfile: dependencies.editProfile,
    })
  }

  public showMenu (preserveFriendReservation = false): void {
    if (this.isDisposed()) return
    this.friendRoomSettingsPresenter.hide()
    this.dependencies.issuePageRequest()
    this.dependencies.invalidateMatchAttempt()
    if (this.dependencies.gateways.configured) {
      this.dependencies.player.invalidate()
      this.dependencies.wallet.invalidate()
    }
    this.dependencies.closeModal()
    this.dependencies.setTableVisible(false)
    this.dependencies.setFriendRoomWaitingVisible(false)
    if (this.dependencies.session.snapshot.status !== 'menu') this.dependencies.session.leaveToMenu()
    if (!this.reflowing && !preserveFriendReservation) this.friendRoomPlatformFlow?.leave()
    this.renderMenu()
    if (this.friendRoomPlatformFlow) this.dependencies.scheduleOnce(() => { if (!this.isDisposed()) this.wechatInvite.activate() }, 0)
  }

  public handoffFriendRoomReservation (): void { this.friendRoomPlatformFlow?.handoffReservation() }

  public restoreFriendRoomReservation (entry: Extract<MatchRecoveryEntry, { roomKind: 'friend' }>): void {
    this.friendRoomPlatformFlow?.restoreReservation(entry)
  }

  public setRecoveryPending (pending: boolean): void {
    if (this.isDisposed() || this.recoveryPending === pending) return
    this.recoveryPending = pending
    if (this.dependencies.router.current === 'menu') this.refreshPrimaryAction()
    if (!pending) this.wechatInvite.activate()
  }

  public renderMenu (): void {
    const ui = this.dependencies.router.open('menu')
    const safeWidth = this.dependencies.screen.safeSize().x
    const safeHeight = this.dependencies.screen.safeSize().y
    const layout = resolveLobbyLayout({ width: safeWidth, height: safeHeight,
      left: this.dependencies.screen.safeLeftX(0), right: this.dependencies.screen.safeRightX(0),
      top: this.dependencies.screen.safeTopY(0), bottom: this.dependencies.screen.safeBottomY(0) })
    renderLobbyEntries(ui, layout, ([
      { name: 'ClassicEntryCard', kind: 'classic', art: LOBBY_ART.entryClassic, action: () => this.showClassicRooms() },
      { name: 'FriendEntryCard', kind: 'friend', art: LOBBY_ART.entryFriend, action: () => this.showFriendRoomSettings() },
      { name: 'TournamentEntryCard', kind: 'tournament', art: LOBBY_ART.entryTournament, action: this.dependencies.showCompetition },
    ] as const).map(entry => ({ ...entry, action: () => {
        if (this.recoveryPending) this.dependencies.showNotice('正在恢复牌局', '请等待当前牌局确认后再选择玩法')
        else entry.action()
    } })))
    this.playerProfilePresenter.render(ui, layout)
    renderLobbyShop(ui, layout, LOBBY_ART.shopChick, this.dependencies.showShop)
    const { x, y, width, height } = layout.quick
    this.renderQuickStart(ui, x, y, width, height, layout.scale)
    if (!this.reflowing) this.refreshLobbyDashboard(this.dependencies.currentPageRequest())
  }

  public showClassicRooms (): void {
    if (this.isDisposed()) return
    if (!this.reflowing) {
      this.friendRoomSettingsPresenter.hide()
      this.dependencies.issuePageRequest()
      this.dependencies.invalidateMatchAttempt()
      this.dependencies.setTableVisible(false)
    }
    const ui = this.dependencies.router.open('classic-rooms')
    const safeWidth = this.dependencies.screen.safeSize().x
    const safeHeight = this.dependencies.screen.safeSize().y
    const leftWidth = Math.min(190, Math.max(140, safeWidth * 0.17))
    const leftX = this.dependencies.screen.safeLeftX(leftWidth / 2 + 14)
    const panelHeight = Math.min(500, safeHeight - 92)
    ui.panel('ClassicModePanel', leftX, -8, leftWidth, panelHeight, {
      fill: new Color(24, 48, 65, 218),
      stroke: new Color(159, 204, 231, 210),
      lineWidth: 2,
      frame: 'control',
    })
    ui.outlinedLabel('经典掼蛋', leftX, this.dependencies.screen.safeTopY(96), Math.min(32, Math.max(26, safeHeight * 0.058)), {
      width: leftWidth + 20,
      color: new Color(255, 239, 172),
      outlineColor: new Color(48, 35, 22),
      outlineWidth: 4,
    })
    const modeGap = Math.min(64, (panelHeight - 62) / CLASSIC_ROOM_MODES.length)
    const modeStartY = panelHeight / 2 - 54
    CLASSIC_ROOM_MODES.forEach((mode, index) => {
      const active = mode.id === this.classicRoomMode
      const node = ui.button('ClassicModeTab', mode.available ? mode.label : `${mode.label}  锁`, leftX, leftWidth - 18, 48, Math.max(22, Math.min(24, leftWidth * 0.13)), {
        fill: active ? new Color(232, 178, 61, 245) : new Color(31, 61, 81, 235),
        pressedFill: new Color(198, 140, 40, 245),
        stroke: active ? new Color(255, 239, 163) : new Color(99, 145, 171, 180),
        textColor: active ? new Color(68, 44, 17) : new Color(235, 242, 238),
        textOutlineColor: active ? new Color(255, 235, 157) : new Color(28, 36, 32),
        textOutlineWidth: active ? 0 : 1,
        disabled: !mode.available,
        frame: 'tag',
      })
      node.setPosition(new Vec3(leftX, modeStartY - index * modeGap, 0))
      if (mode.available) node.on(Node.EventType.TOUCH_END, () => { this.classicRoomMode = mode.id; this.showClassicRooms() })
    })

    const contentLeft = leftX + leftWidth / 2 + 20
    const contentRight = this.dependencies.screen.safeRightX(18)
    const contentWidth = Math.max(460, contentRight - contentLeft)
    const gap = Math.max(8, Math.min(15, contentWidth * 0.018))
    const cardWidth = Math.min(188, (contentWidth - gap * 3) / 4)
    const cardHeight = cardWidth * 1.5
    const firstX = contentLeft + cardWidth / 2
    const cardY = Math.max(-12, Math.min(4, (safeHeight - cardHeight) * -0.01))
    CLASSIC_ROOM_TIERS.forEach((tier, index) => {
      const targetX = firstX + index * (cardWidth + gap)
      const card = ui.imageCard(`ClassicTier${tier.score}`, tier.art, targetX, cardY, cardWidth, cardHeight, () => this.startClassicTier(tier), 0.04 + index * 0.05)
      card.setPosition(new Vec3(targetX + Math.min(520, safeWidth * 0.48), cardY, 0))
      tween(card).delay(index * 0.06).to(0.34, { position: new Vec3(targetX, cardY, 0) }, { easing: 'quadOut' }).start()
      ui.outlinedLabel(tier.name, 0, -cardHeight * 0.22, Math.max(20, cardWidth * 0.14), {
        parent: card, width: cardWidth - 20, color: tier.accent,
        outlineColor: new Color(255, 255, 255, 255), outlineWidth: 2,
      })
      ui.outlinedLabel('底分', 0, -cardHeight * 0.34, Math.max(20, cardWidth * 0.1), {
        parent: card, width: cardWidth - 20, color: new Color(58, 68, 77),
        outlineColor: new Color(255, 255, 255, 255), outlineWidth: 2,
      })
      ui.outlinedLabel(String(tier.score), 0, -cardHeight * 0.425, Math.max(22, cardWidth * 0.16), {
        parent: card, width: cardWidth - 18, color: tier.accent,
        outlineColor: new Color(255, 255, 255, 255), outlineWidth: 2,
      })
    })
    ui.outlinedLabel('胜方每席 +底分 · 败方每席 -底分 · 匹配期间会预留一份底分', (contentLeft + contentRight) / 2, this.dependencies.screen.safeBottomY(30), Math.max(20, Math.min(22, safeHeight * 0.038)), {
      width: contentRight - contentLeft, height: 36,
      color: new Color(255, 239, 182),
      outlineColor: new Color(29, 55, 64),
      outlineWidth: 3,
    })
    this.compactButton(ui, '返回', this.dependencies.screen.safeLeftX(62), this.dependencies.screen.safeTopY(44), 84, 42, 22, () => this.showMenu())
  }

  public showFriendRoomSettings (): void {
    if (this.isDisposed()) return
    if (!this.reflowing) {
      this.dependencies.issuePageRequest()
      this.dependencies.invalidateMatchAttempt()
      this.dependencies.setTableVisible(false)
      this.dependencies.setFriendRoomWaitingVisible(false)
      if (this.dependencies.session.snapshot.status !== 'menu') this.dependencies.session.leaveToMenu()
    }
    this.friendRoomSettingsPresenter.show()
  }

  public showOnlinePlay (): void {
    if (this.isDisposed()) return
    if (!this.reflowing) {
      this.friendRoomSettingsPresenter.hide()
      this.dependencies.issuePageRequest()
      this.dependencies.invalidateMatchAttempt()
      this.dependencies.setTableVisible(false)
      if (this.dependencies.session.snapshot.status !== 'menu') this.dependencies.session.leaveToMenu()
    }
    const ui = this.dependencies.router.open('online')
    ui.menuLabel('在线对战', 0, 215, 44)
    ui.menuLabel('选择匹配方式', 0, 165, 20)
    this.sizedButton(ui, '快速匹配\n自动寻找三名玩家', 0, 85, 520, 72, 23, () => this.dependencies.beginMatch('quick', '快速匹配', 'online'))
    this.sizedButton(ui, '比赛场\n日赛 · 周赛 · 月赛 · 主题赛事', 0, 0, 520, 72, 23, this.dependencies.showCompetition)
    this.sizedButton(ui, '好友房\n设置规则，与微信好友同玩', 0, -85, 520, 72, 23, () => this.showFriendRoomSettings())
    this.pageButton(ui, '返回大厅', -180, () => this.showMenu())
  }

  public showLobby (compensateReservation = true): void {
    if (compensateReservation) this.friendRoomPlatformFlow?.handleRoomClosed()
    this.openLobby()
  }

  public renderLobby (snapshot: LobbySnapshot): void {
    if (!this.isDisposed() && this.dependencies.router.current === 'menu' && this.renderedRecoveryAvailable !== Boolean(snapshot.recoveryAvailable)) this.refreshPrimaryAction()
    if (this.isDisposed() || this.dependencies.session.snapshot.status !== 'lobby') return
    this.friendRoomSettingsPresenter.hide()
    if (!this.reflowing && this.pendingFriendRoomSettings && snapshot.connected && snapshot.roomStatus === 'idle' && !snapshot.roomId) {
      const settings = this.pendingFriendRoomSettings
      this.pendingFriendRoomSettings = null
      this.dependencies.scheduleOnce(() => {
        if (!this.isDisposed() && this.dependencies.router.current === 'lobby' && this.dependencies.lobby.snapshot.connected && !this.dependencies.lobby.snapshot.roomId) {
          this.dependencies.lobby.createRoom('玩家', settings)
        }
      }, 0)
    }
    const ui = this.dependencies.router.open('lobby')
    // HTTP creation, WebSocket entry and occupied seats all use the same table.
    // Never enable old hands/HUD until an authoritative game snapshot arrives.
    this.dependencies.setFriendRoomWaitingVisible(true)
    if (snapshot.roomId) {
      this.renderFriendTableLobby(ui, snapshot)
      return
    }
    const busy = this.friendRoomPlatformFlow?.snapshot.busy
    // A previous socket/recovery error must not cover a new HTTP request.
    const status = busy === 'creating' ? '正在创建房间…' : busy === 'joining' ? '正在加入好友房…'
      : snapshot.error ?? (snapshot.roomStatus === 'rejoining' ? '正在恢复房间…' : '正在进入牌桌…')
    this.friendRoomWaitingPresenter.renderEntering(ui, status)
  }

  public reflow (): void {
    if (this.isDisposed()) return
    const route = this.dependencies.router.current
    this.reflowing = true
    try {
      if (route === 'menu') this.renderMenu()
      else if (route === 'classic-rooms') this.showClassicRooms()
      else if (route === 'online') this.showOnlinePlay()
      else if (route === 'friend-room-settings') this.showFriendRoomSettings()
      else if (route === 'lobby') this.renderLobby(this.dependencies.lobby.snapshot)
    } finally {
      this.reflowing = false
    }
  }

  public hide (): void {
    this.pendingFriendRoomSettings = null
    this.friendRoomSettingsPresenter.hide()
  }

  public destroy (): void {
    if (this.destroyed) return
    this.destroyed = true
    this.hide()
    this.friendRoomPlatformFlow?.destroy()
    this.wechatInvite.dispose()
    this.friendRoomSettingsPresenter.dispose()
  }

  private openLobby (settings: FriendRoomSettings | null = null): void {
    if (this.isDisposed()) return
    this.friendRoomSettingsPresenter.hide()
    this.dependencies.setTableVisible(false)
    this.friendRoomEntryReturnPage = settings ? 'friend-room-settings' : 'menu'
    this.pendingFriendRoomSettings = settings
    this.dependencies.session.enterLobby()
    if (this.friendRoomPlatformFlow) {
      this.pendingFriendRoomSettings = null
      this.renderLobby(this.dependencies.lobby.snapshot)
      if (settings) void this.friendRoomPlatformFlow.create(settings)
      return
    }
    const endpoint = this.dependencies.getLobbyEndpoint()
    if (!endpoint) {
      this.pendingFriendRoomSettings = null
      this.renderLobby({ connected: false, rooms: [], roomId: null, gameVersion: 0, members: [], myPlayerId: null, roomStatus: 'idle', error: '未配置联机服务地址：请在 GameRoot 的 lobbyEndpoint 填入 wss:// 域名（本地开发可填 ws://局域网IP:3002/weapp）' })
      return
    }
    this.dependencies.lobby.connect(endpoint)
    this.renderLobby(this.dependencies.lobby.snapshot)
  }

  private joinRoomNumber (roomId: string): void {
    const flow = this.friendRoomPlatformFlow
    if (!flow) { this.dependencies.showNotice('暂时无法加入', '房号加入需要平台服务，请检查服务配置'); return }
    if (this.isDisposed() || flow.snapshot.busy || this.recoveryPending) return
    this.openLobby()
    this.friendRoomEntryReturnPage = 'friend-room-settings'
    void flow.joinRoomNumber(roomId)
  }

  private startClassicTier (tier: (typeof CLASSIC_ROOM_TIERS)[number]): void {
    if (this.classicRoomMode !== 'classic') {
      this.dependencies.showNotice('该玩法尚未开放', '当前规则引擎仅支持四人经典掼蛋')
      return
    }
    this.dependencies.beginMatch(tier.queueId, `${tier.name} · 底分${tier.score}`, 'classic-rooms')
  }

  private renderFriendTableLobby (ui: RuntimeUiFactory, snapshot: LobbySnapshot): void {
    const platformEntry = this.friendRoomPlatformFlow?.snapshot.entry ?? null
    const inviteText = platformEntry?.roomId === snapshot.roomId ? this.friendRoomPlatformFlow?.snapshot.inviteText : null
    this.friendRoomWaitingPresenter.render(ui, snapshot, Boolean(platformEntry), inviteText ? () => {
      try {
        this.wechatInvite.share(inviteText)
      } catch (error) {
        this.dependencies.showNotice('暂时无法邀请', error instanceof Error ? error.message : '请稍后重试')
      }
    } : undefined)
  }

  private leaveFriendRoomToMenu (): void {
    this.dependencies.lobby.leaveRoom()
    this.friendRoomPlatformFlow?.leave()
    this.showMenu()
  }

  private refreshLobbyDashboard (requestToken: number): void {
    if (!this.dependencies.gateways.configured || this.dependencies.player.loading || Date.now() - this.dependencies.player.loadedAt < 30_000) return
    this.dependencies.player.loading = true
    void Promise.all([
      settle(this.dependencies.gateways.playerCenter.getDashboard()),
      settle(this.dependencies.gateways.wallet.getWallet()),
    ]).then(([dashboardResult, walletResult]) => {
      this.dependencies.player.loading = false
      this.dependencies.player.loadedAt = Date.now()
      if (dashboardResult.status === 'fulfilled') this.dependencies.player.updateDashboard(dashboardResult.value)
      if (walletResult.status === 'fulfilled') this.dependencies.wallet.update(walletResult.value)
      else this.dependencies.wallet.invalidate()
      if (!this.isDisposed() && requestToken === this.dependencies.currentPageRequest() && this.dependencies.router.current === 'menu') this.renderMenu()
      if (!this.isDisposed() && dashboardResult.status === 'fulfilled') this.dependencies.profileLoaded?.(dashboardResult.value.user)
    })
  }

  private isDisposed (): boolean { return this.destroyed || this.dependencies.isDisposed() }

  /** Lobby-only treatment: preserve the existing footprint and match route. */
  private renderQuickStart (ui: RuntimeUiFactory, x: number, y: number, width: number, height: number, s: number): void {
    const button = ui.button('LobbyQuickStart', '', x, width, height, 22, {
      fill: new Color(239, 187, 79), pressedFill: new Color(232, 177, 66),
      stroke: new Color(255, 235, 173), lineWidth: 2 * s, frame: 'panel', frameScale: s,
    })
    button.setPosition(new Vec3(x, y, 0))
    // All decorative layers stay inside the original hit box and inherit its
    // press/cancel feedback; they never register their own input handlers.
    ui.panel('QuickStartInnerRim', 0, 0, width - 8 * s, height - 8 * s, {
      fill: new Color(255, 224, 145, 0), stroke: new Color(174, 110, 27, 125), lineWidth: s, frame: 'control', frameScale: s,
    }, button)
    const title = lobbyLabel(ui, '快速开始', 0, 7 * s, 23, width - 24 * s, s, button, new Color(101, 66, 28))
    const subtitle = lobbyLabel(ui, '随机级牌 · 单局对战', 0, -11 * s, 12, width - 24 * s, s, button, new Color(101, 66, 28), 0, false)
    title.node.getComponent(UITransform)?.setContentSize(width - 24 * s, 23 * s)
    subtitle.node.getComponent(UITransform)?.setContentSize(width - 24 * s, 12 * s)
    button.on(Node.EventType.TOUCH_END, () => {
      if (this.isDisposed() || this.recoveryPending || this.dependencies.router.current !== 'menu') return
      if (this.dependencies.gateways.configured && this.dependencies.lobby.snapshot.recoveryAvailable) this.dependencies.lobby.recoverActiveMatch()
      else this.dependencies.beginMatch('classic_50', '经典 · 初级场 · 底分50', 'menu')
    })
    this.primaryAction = { node: button, title, subtitle }
    attachLobbyAmbientMotion(button, { width, height, scale: s, clock: this.ambientClock, allowed: () =>
      !this.recoveryPending && !this.isDisposed() && this.dependencies.router.current === 'menu' &&
      this.dependencies.session.snapshot.settings.effectQuality === 'full' &&
      !ui.parent.parent?.children.some(node => node.active && node.name.startsWith('Modal-')),
    })
    this.refreshPrimaryAction()
  }

  private refreshPrimaryAction (): void {
    if (!this.primaryAction?.node.isValid) return
    const { node, title, subtitle } = this.primaryAction
    const recovery = this.dependencies.gateways.configured && Boolean(this.dependencies.lobby.snapshot.recoveryAvailable)
    this.renderedRecoveryAvailable = recovery
    title.string = this.recoveryPending ? '正在恢复' : recovery ? '继续牌局' : '快速开始'
    subtitle.string = this.recoveryPending ? '正在确认牌局状态' : recovery ? '返回尚未结束的牌局' : '随机级牌 · 单局对战'
    // Keep the existing node, skin and all other lobby artwork still. Pausing
    // input does not dim readable labels or replay the card entrance tweens.
    if (this.recoveryPending) node.pauseSystemEvents(true)
    else node.resumeSystemEvents(true)
  }

  private compactButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, action: () => void): Node {
    const node = ui.button('CompactButton', text, x, width, height, fontSize, {
      fill: new Color(26, 51, 56, 224), pressedFill: new Color(52, 83, 72, 240), stroke: new Color(241, 207, 101, 245), textColor: new Color(255, 240, 181), textOutlineWidth: 2, frame: 'control',
    })
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
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
}
