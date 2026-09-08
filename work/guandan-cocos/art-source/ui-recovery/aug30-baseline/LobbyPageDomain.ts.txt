import { Color, EditBox, Node, UITransform, Vec3, tween } from 'cc'
import {
  type FriendRoomSettings,
  LobbyController,
  type LobbySnapshot,
} from '../../network/LobbyController'
import type { FrontPageGateways, MatchQueueId, MatchRecoveryEntry } from '../../services/FrontPageGatewayContracts'
import { writeClipboardText } from '../../services/ClipboardService'
import { GameSession } from '../../session/GameSession'
import { ScreenAdapter } from '../../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { PageRouter } from '../PageRouter'
import { FriendRoomSettingsPresenter } from './FriendRoomSettingsPresenter'
import { FriendRoomPlatformFlow } from './FriendRoomPlatformFlow'
import { FriendRoomPlatformPresenter } from './FriendRoomPlatformPresenter'
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
  dismissRulesState: () => void
  rulesVisible: () => boolean
  showRules: () => void
  showMoreMenu: () => void
  showCompetition: () => void
  showPlayerCenter: () => void
  showShop: () => void
  beginMatch: (queueId: MatchQueueId, queueName: string, returnPage: LobbyMatchReturnPage) => void
}

/** Owns the lobby landing page, classic rooms, room connection flow, and waiting UI. */
export class LobbyPageDomain {
  private roomCodeInput: EditBox | null = null
  private classicRoomMode: ClassicRoomMode = 'classic'
  private pendingFriendRoomSettings: FriendRoomSettings | null = null
  private readonly friendRoomSettingsPresenter: FriendRoomSettingsPresenter
  private readonly friendRoomPlatformFlow: FriendRoomPlatformFlow | null
  private readonly friendRoomPlatformPresenter: FriendRoomPlatformPresenter
  private readonly friendRoomWaitingPresenter: FriendRoomWaitingPresenter
  private readonly playerProfilePresenter: LobbyPlayerProfilePresenter
  private destroyed = false
  private reflowing = false

  public constructor (private readonly dependencies: LobbyPageDependencies) {
    this.friendRoomSettingsPresenter = new FriendRoomSettingsPresenter({
      router: dependencies.router,
      screen: dependencies.screen,
      backgroundArt: LOBBY_ART.friendBackground,
      updateSessionSettings: settings => dependencies.session.updateSettings(settings),
      joinRoom: () => this.openLobby(),
      createRoom: settings => this.openLobby(settings),
      goBack: () => this.showMenu(),
    })
    this.friendRoomPlatformPresenter = new FriendRoomPlatformPresenter(dependencies.screen)
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
          showNotice: dependencies.showNotice,
          onChanged: () => {
            if (dependencies.router.current === 'lobby' && dependencies.session.snapshot.status === 'lobby') this.renderLobby(dependencies.lobby.snapshot)
          },
          copyText: writeClipboardText,
        })
      : null
    this.playerProfilePresenter = new LobbyPlayerProfilePresenter({
      screen: dependencies.screen, session: dependencies.session, player: dependencies.player, wallet: dependencies.wallet,
      platformConfigured: dependencies.gateways.configured, showPlayerCenter: dependencies.showPlayerCenter,
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
    this.dependencies.dismissRulesState()
    this.dependencies.setTableVisible(false)
    this.dependencies.setFriendRoomWaitingVisible(false)
    if (this.dependencies.session.snapshot.status !== 'menu') this.dependencies.session.leaveToMenu()
    if (!this.reflowing && !preserveFriendReservation) this.friendRoomPlatformFlow?.leave()
    this.renderMenu()
  }

  public handoffFriendRoomReservation (): void { this.friendRoomPlatformFlow?.handoffReservation() }

  public restoreFriendRoomReservation (entry: Extract<MatchRecoveryEntry, { roomKind: 'friend' }>): void {
    this.friendRoomPlatformFlow?.restoreReservation(entry)
  }

  public renderMenu (): void {
    const ui = this.dependencies.router.open('menu')
    const safeWidth = this.dependencies.screen.safeSize().x
    const safeHeight = this.dependencies.screen.safeSize().y
    const cardsAreaWidth = Math.min(650, safeWidth * 0.61)
    const gap = Math.max(10, Math.min(18, cardsAreaWidth * 0.028))
    const cardWidth = Math.min(190, (cardsAreaWidth - gap * 2) / 3)
    const cardHeight = cardWidth * 4 / 3
    const areaRight = this.dependencies.screen.safeRightX(22)
    const firstCardX = areaRight - cardsAreaWidth + cardWidth / 2
    const cardY = Math.min(28, Math.max(-2, safeHeight * 0.025))
    const titleX = firstCardX + (cardWidth * 3 + gap * 2) / 2 - cardWidth / 2
    ui.outlinedLabel('陵水掼蛋', titleX, this.dependencies.screen.safeTopY(52), Math.min(42, Math.max(31, safeHeight * 0.07)), {
      width: cardsAreaWidth,
      color: new Color(255, 239, 164),
      outlineColor: new Color(58, 44, 24),
      outlineWidth: 4,
    })
    const entries: ReadonlyArray<{ name: string, art: string, action: () => void }> = [
      { name: 'ClassicEntryCard', art: LOBBY_ART.entryClassic, action: () => this.showClassicRooms() },
      { name: 'FriendEntryCard', art: LOBBY_ART.entryFriend, action: () => this.showFriendRoomSettings() },
      { name: 'TournamentEntryCard', art: LOBBY_ART.entryTournament, action: this.dependencies.showCompetition },
    ]
    entries.forEach((entry, index) => {
      ui.imageCard(entry.name, entry.art, firstCardX + index * (cardWidth + gap), cardY, cardWidth, cardHeight, entry.action, 0.04 + index * 0.07)
    })
    const cardsLeft = firstCardX - cardWidth / 2
    this.playerProfilePresenter.render(ui, cardsLeft - 14)
    this.renderShopShortcut(ui, safeWidth, safeHeight)
    const utilityY = this.dependencies.screen.safeTopY(112)
    this.compactButton(ui, '规则', this.dependencies.screen.safeLeftX(62), utilityY, 84, 44, 22, this.dependencies.showRules)
    this.compactButton(ui, '更多', this.dependencies.screen.safeLeftX(156), utilityY, 84, 44, 22, this.dependencies.showMoreMenu)
    if (this.dependencies.gateways.configured && this.dependencies.lobby.snapshot.recoveryAvailable) {
      this.compactButton(ui, '继续牌局', this.dependencies.screen.safeLeftX(260), utilityY, 108, 44, 22, () => this.dependencies.lobby.recoverActiveMatch())
    }
    const quickWidth = Math.min(286, Math.max(232, safeWidth * 0.225))
    const quickHeight = Math.min(76, Math.max(62, safeHeight * 0.105))
    const quickX = this.dependencies.screen.safeRightX(quickWidth / 2 + 22)
    const quickY = this.dependencies.screen.safeBottomY(quickHeight / 2 + 18)
    this.coloredButton(ui, '快速开始\n经典 · 初级场', quickX, quickY, quickWidth, quickHeight, Math.max(22, Math.min(26, quickHeight * 0.34)), new Color(232, 175, 45, 248), () => {
      this.dependencies.beginMatch('classic_50', '经典 · 初级场 · 底分50', 'menu')
    })
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
      radius: 6,
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
        textOutlineWidth: active ? 0 : 1,
        disabled: !mode.available,
        radius: 5,
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
    this.sizedButton(ui, '好友房\n设置规则、创建房间或输入六位房间码', 0, -85, 520, 72, 23, () => this.showFriendRoomSettings())
    this.pageButton(ui, '返回大厅', -180, () => this.showMenu())
  }

  public showLobby (compensateReservation = true): void {
    if (compensateReservation) this.friendRoomPlatformFlow?.handleRoomClosed()
    this.openLobby()
  }

  public renderLobby (snapshot: LobbySnapshot): void {
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
    const draftRoomCode = this.roomCodeInput?.string ?? ''
    const ui = this.dependencies.router.open('lobby')
    this.roomCodeInput = null
    this.dependencies.setFriendRoomWaitingVisible(Boolean(snapshot.roomId))
    if (snapshot.roomId) {
      this.renderFriendTableLobby(ui, snapshot)
      return
    }
    if (this.friendRoomPlatformFlow) {
      this.friendRoomPlatformPresenter.renderEntry(ui, this.friendRoomPlatformFlow.snapshot, {
        create: () => this.showFriendRoomSettings(),
        join: inviteText => { void this.friendRoomPlatformFlow?.join(inviteText) },
        cancel: () => this.friendRoomPlatformFlow?.leave(),
        back: () => this.showMenu(),
      })
      return
    }
    ui.menuLabel('多人联机大厅', 0, 220, 42)
    const connectionText = snapshot.roomStatus === 'rejoining'
      ? '连接已恢复，正在验证房间身份…'
      : snapshot.roomStatus === 'joining'
        ? '正在进入房间…'
        : snapshot.connected
          ? '服务已连接 · 发现附近房间'
          : '正在连接服务…'
    ui.menuLabel(snapshot.error ?? connectionText, 0, 165, 20)
    if (snapshot.roomStatus === 'joining' && !snapshot.roomId) {
      ui.menuLabel('请稍候，正在等待服务器确认', 0, 105, 22)
      this.pageButton(ui, '取消进入', 30, () => this.dependencies.lobby.leaveRoom())
    } else {
      this.pageButton(ui, '设置并创建好友房', 95, () => this.showFriendRoomSettings())
      this.pageButton(ui, '刷新房间列表', 35, () => this.dependencies.lobby.refreshRooms())
      const input = ui.roomCodeInput(0, -28)
      this.roomCodeInput = input.getComponentInChildren(EditBox)
      if (this.roomCodeInput) this.roomCodeInput.string = draftRoomCode
      this.pageButton(ui, '加入输入的房间', -85, () => this.dependencies.lobby.joinRoom(this.roomCodeInput?.string.trim() ?? ''))
      snapshot.rooms.slice(0, 3).forEach((room, index) => {
        this.pageButton(ui, `加入 ${room.hostName} 的房间 ${room.roomId}（${room.playerCount}/4）`, -140 - index * 48, () => this.dependencies.lobby.joinRoom(room.roomId))
      })
    }
    this.pageButton(ui, '返回大厅', -210, () => { this.dependencies.lobby.leaveRoom(); this.showMenu() })
  }

  /** Releases transient input state when another domain clears or replaces the page tree. */
  public resetInput (): void {
    this.roomCodeInput = null
    this.friendRoomPlatformPresenter.resetInput()
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
    this.resetInput()
  }

  public destroy (): void {
    if (this.destroyed) return
    this.destroyed = true
    this.hide()
    this.friendRoomPlatformFlow?.destroy()
    this.friendRoomSettingsPresenter.dispose()
  }

  private openLobby (settings: FriendRoomSettings | null = null): void {
    if (this.isDisposed()) return
    this.friendRoomSettingsPresenter.hide()
    this.dependencies.setTableVisible(false)
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

  private startClassicTier (tier: (typeof CLASSIC_ROOM_TIERS)[number]): void {
    if (this.classicRoomMode !== 'classic') {
      this.dependencies.showNotice('该玩法尚未开放', '当前规则引擎仅支持四人经典掼蛋')
      return
    }
    this.dependencies.beginMatch(tier.queueId, `${tier.name} · 底分${tier.score}`, 'classic-rooms')
  }

  private renderFriendTableLobby (ui: RuntimeUiFactory, snapshot: LobbySnapshot): void {
    const platformEntry = this.friendRoomPlatformFlow?.snapshot.entry ?? null
    this.friendRoomWaitingPresenter.render(ui, snapshot, Boolean(platformEntry))
    this.friendRoomPlatformPresenter.renderInviteShare(
      ui,
      platformEntry?.roomId === snapshot.roomId ? this.friendRoomPlatformFlow?.snapshot.inviteText ?? null : null,
      () => { void this.friendRoomPlatformFlow?.copyInvite() },
    )
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
      if (dashboardResult.status === 'fulfilled') this.dependencies.player.dashboard = dashboardResult.value
      if (walletResult.status === 'fulfilled') this.dependencies.wallet.update(walletResult.value)
      else this.dependencies.wallet.invalidate()
      if (!this.isDisposed() && requestToken === this.dependencies.currentPageRequest() && this.dependencies.router.current === 'menu' && !this.dependencies.rulesVisible()) this.renderMenu()
    })
  }

  private renderShopShortcut (ui: RuntimeUiFactory, safeWidth: number, safeHeight: number): void {
    const size = Math.min(168, Math.max(92, Math.min(safeWidth * 0.14, safeHeight * 0.31)))
    const x = this.dependencies.screen.safeLeftX(size / 2 + 18)
    const y = this.dependencies.screen.safeBottomY(size / 2 + 16)
    const shortcut = new Node('ShopShortcut')
    shortcut.parent = ui.parent
    shortcut.setPosition(new Vec3(x, y, 0))
    shortcut.addComponent(UITransform).setContentSize(size + 6, size + 6)
    ui.image('ShopChickArtwork', LOBBY_ART.shopChick, 0, 0, size, size, shortcut)
    ui.outlinedLabel('商城', 0, -size * 0.34, Math.max(24, size * 0.18), {
      parent: shortcut,
      width: size - 12,
      color: new Color(255, 226, 105),
      outlineColor: new Color(58, 35, 17),
      outlineWidth: 4,
    })
    ui.makeInteractive(shortcut, this.dependencies.showShop, 0.95)
  }

  private isDisposed (): boolean { return this.destroyed || this.dependencies.isDisposed() }

  private compactButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, action: () => void): Node {
    const node = ui.button('CompactButton', text, x, width, height, fontSize, {
      fill: new Color(26, 51, 56, 224), pressedFill: new Color(52, 83, 72, 240), stroke: new Color(241, 207, 101, 245), textColor: new Color(255, 240, 181), textOutlineWidth: 2, radius: 6,
    })
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private coloredButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, fill: Color, action: () => void): Node {
    const node = ui.button('ColoredButton', text, x, width, height, fontSize, {
      fill,
      pressedFill: new Color(Math.max(0, fill.r - 28), Math.max(0, fill.g - 28), Math.max(0, fill.b - 28), fill.a),
      stroke: new Color(255, 235, 151, 255),
      textColor: new Color(255, 252, 224),
      textOutlineColor: new Color(43, 58, 37, 255),
      textOutlineWidth: 3,
      radius: 7,
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
