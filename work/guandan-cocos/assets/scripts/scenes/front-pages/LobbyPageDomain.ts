import { Color, EditBox, Node, sys, UITransform, Vec3, tween } from 'cc'
import type { PlayerId } from '../../core/generated'
import {
  DEFAULT_FRIEND_ROOM_SETTINGS,
  type FriendRoomSettings,
  LobbyController,
  type LobbySnapshot,
} from '../../network/LobbyController'
import type { FrontPageGateways, MatchQueueId } from '../../services/DevelopmentApis'
import { GameSession } from '../../session/GameSession'
import { ScreenAdapter } from '../../ui/ScreenAdapter'
import { resolveSafeHorizontalLane } from '../../ui/SafeAreaLayout'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { PageRouter } from '../PageRouter'
import { FrontPagePlayerState } from './FrontPagePlayerState'
import { FrontPageWalletState } from './FrontPageWalletState'

type ClassicRoomMode = 'classic' | 'consecutive' | 'no-shuffle' | 'team-turn' | 'upgrade80'
type LobbyMatchReturnPage = 'menu' | 'online' | 'classic-rooms'
type Settled<T> = { status: 'fulfilled', value: T } | { status: 'rejected', reason: unknown }

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> => promise.then(
  value => ({ status: 'fulfilled', value }),
  reason => ({ status: 'rejected', reason }),
)

const LOCAL_ACCOUNT_ID_STORAGE_KEY = 'guandan-local-account-id-v1'

const LOBBY_ART = Object.freeze({
  entryClassic: 'ui/lobby/entry-classic/texture',
  entryFriend: 'ui/lobby/entry-friend/texture',
  entryTournament: 'ui/lobby/entry-tournament/texture',
  friendBackground: 'ui/lobby/friend-room-green/texture',
  shopChick: 'ui/lobby/shop-float-chick/texture',
  coin: 'ui/lobby/coin/texture',
  defaultAvatar: 'ui/common/default-avatar/texture',
  tierGreen: 'ui/lobby/tier-green/texture',
  tierBlue: 'ui/lobby/tier-blue/texture',
  tierViolet: 'ui/lobby/tier-violet/texture',
  tierGold: 'ui/lobby/tier-gold/texture',
})

const CLASSIC_ROOM_MODES: ReadonlyArray<{ id: ClassicRoomMode, label: string, available: boolean }> = [
  { id: 'classic', label: '经典玩法', available: true },
  { id: 'consecutive', label: '连打过A', available: false },
  { id: 'no-shuffle', label: '不洗牌', available: false },
  { id: 'team-turn', label: '团团转', available: false },
  { id: 'upgrade80', label: '升级80分', available: false },
]

const CLASSIC_ROOM_TIERS: ReadonlyArray<{ name: string, score: number, queueId: MatchQueueId, art: string, accent: Color }> = [
  { name: '初级场', score: 50, queueId: 'classic_50', art: LOBBY_ART.tierGreen, accent: new Color(75, 160, 78) },
  { name: '中级场', score: 300, queueId: 'classic_300', art: LOBBY_ART.tierBlue, accent: new Color(53, 139, 218) },
  { name: '高级场', score: 2000, queueId: 'classic_2000', art: LOBBY_ART.tierViolet, accent: new Color(139, 79, 211) },
  { name: '大师场', score: 10000, queueId: 'classic_10000', art: LOBBY_ART.tierGold, accent: new Color(230, 123, 42) },
]

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

/** Owns the lobby landing page, classic rooms, friend-room setup, and room waiting UI. */
export class LobbyPageDomain {
  private roomCodeInput: EditBox | null = null
  private classicRoomMode: ClassicRoomMode = 'classic'
  private friendRoomSettings: FriendRoomSettings = { ...DEFAULT_FRIEND_ROOM_SETTINGS }
  private friendSettingsTab: 'rules' | 'experience' = 'rules'
  private pendingFriendRoomCreation = false
  private readonly localAccountId = this.resolveLocalAccountId()

  public constructor (private readonly dependencies: LobbyPageDependencies) {}

  public showMenu (): void {
    if (this.dependencies.isDisposed()) return
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
    this.renderMenu()
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
    this.renderLobbyPlayerProfile(ui, cardsLeft - 14)
    this.renderShopShortcut(ui, safeWidth, safeHeight)
    const utilityY = this.dependencies.screen.safeTopY(112)
    this.compactButton(ui, '规则', this.dependencies.screen.safeLeftX(62), utilityY, 84, 44, 22, this.dependencies.showRules)
    this.compactButton(ui, '更多', this.dependencies.screen.safeLeftX(156), utilityY, 84, 44, 22, this.dependencies.showMoreMenu)
    const quickWidth = Math.min(286, Math.max(232, safeWidth * 0.225))
    const quickHeight = Math.min(76, Math.max(62, safeHeight * 0.105))
    const quickX = this.dependencies.screen.safeRightX(quickWidth / 2 + 22)
    const quickY = this.dependencies.screen.safeBottomY(quickHeight / 2 + 18)
    this.coloredButton(ui, '快速开始\n经典 · 初级场', quickX, quickY, quickWidth, quickHeight, Math.max(22, Math.min(26, quickHeight * 0.34)), new Color(232, 175, 45, 248), () => {
      this.dependencies.beginMatch('classic_50', '经典 · 初级场 · 底分50', 'menu')
    })
    this.refreshLobbyDashboard(this.dependencies.currentPageRequest())
  }

  public showClassicRooms (): void {
    if (this.dependencies.isDisposed()) return
    this.dependencies.issuePageRequest()
    this.dependencies.invalidateMatchAttempt()
    this.dependencies.setTableVisible(false)
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
    if (this.dependencies.isDisposed()) return
    this.dependencies.issuePageRequest()
    this.dependencies.invalidateMatchAttempt()
    this.dependencies.setTableVisible(false)
    if (this.dependencies.session.snapshot.status !== 'menu') this.dependencies.session.leaveToMenu()
    const ui = this.dependencies.router.open('friend-room-settings')
    const viewport = this.dependencies.screen.viewport
    const sourceWidth = 1672
    const sourceHeight = 941
    const coverScale = Math.max(viewport.width / sourceWidth, viewport.height / sourceHeight)
    ui.image('FriendRoomBackdrop', LOBBY_ART.friendBackground, 0, 0, sourceWidth * coverScale, sourceHeight * coverScale)
    ui.panel('FriendRoomTint', 0, 0, viewport.width, viewport.height, { fill: new Color(7, 42, 24, 78), lineWidth: 0, radius: 0 })
    const safeWidth = this.dependencies.screen.safeSize().x
    const safeHeight = this.dependencies.screen.safeSize().y
    const leftWidth = Math.min(205, Math.max(138, safeWidth * 0.18))
    const leftX = this.dependencies.screen.safeLeftX(leftWidth / 2 + 14)
    const panelHeight = Math.min(525, safeHeight - 84)
    const contentLeft = leftX + leftWidth / 2 + 18
    const contentRight = this.dependencies.screen.safeRightX(18)
    const contentWidth = Math.max(310, contentRight - contentLeft)
    const contentX = (contentLeft + contentRight) / 2
    ui.panel('FriendModePanel', leftX, -8, leftWidth, panelHeight, {
      fill: new Color(12, 58, 36, 208), lineWidth: 0, radius: 0,
    })
    ui.outlinedLabel('好友房', leftX, this.dependencies.screen.safeTopY(94), Math.min(32, Math.max(26, safeHeight * 0.058)), {
      width: leftWidth, color: new Color(255, 239, 174), outlineColor: new Color(38, 68, 31), outlineWidth: 4,
    })
    const friendModes = ['经典掼蛋', '转蛋', '斗地主', '掼蛋复式'] as const
    friendModes.forEach((mode, index) => {
      const available = index === 0
      const node = ui.button('FriendModeTab', available ? mode : `${mode}  锁`, leftX, leftWidth - 18, 50, Math.max(22, Math.min(24, leftWidth * 0.13)), {
        fill: available ? new Color(222, 170, 54, 245) : new Color(24, 76, 49, 225),
        stroke: available ? new Color(255, 240, 165) : new Color(112, 151, 105, 190),
        textColor: available ? new Color(61, 43, 20) : new Color(183, 198, 181),
        disabled: !available,
        radius: 5,
      })
      node.setPosition(new Vec3(leftX, panelHeight / 2 - 62 - index * Math.min(64, (panelHeight - 75) / 5), 0))
    })

    const tabY = panelHeight / 2 - 30
    const tabWidth = Math.min(136, Math.max(102, contentWidth * 0.2))
    const tabGap = 10
    ;(['rules', 'experience'] as const).forEach((tab, index) => {
      const active = this.friendSettingsTab === tab
      const x = contentLeft + tabWidth / 2 + index * (tabWidth + tabGap)
      const node = ui.button('FriendSettingsTab', tab === 'rules' ? '基础规则' : '体验设置', x, tabWidth, 44, 22, {
        fill: active ? new Color(45, 137, 70, 242) : new Color(10, 52, 34, 205),
        stroke: active ? new Color(249, 214, 92, 250) : new Color(117, 157, 105, 210),
        textColor: active ? new Color(255, 246, 203) : new Color(210, 225, 207),
        textOutlineColor: new Color(35, 65, 41), textOutlineWidth: 2, radius: 6,
      })
      node.setPosition(new Vec3(x, tabY, 0))
      if (!active) node.on(Node.EventType.TOUCH_END, () => { this.friendSettingsTab = tab; this.showFriendRoomSettings() })
    })
    this.compactButton(ui, '重置', contentRight - 44, tabY, 82, 42, 22, () => {
      this.friendRoomSettings = { ...DEFAULT_FRIEND_ROOM_SETTINGS }
      this.dependencies.session.updateSettings({ sortOrder: this.friendRoomSettings.sortOrder })
      this.showFriendRoomSettings()
    })
    ui.outlinedLabel('经典过A · 四人组队 · 服务器验牌', contentX, tabY - 42, Math.max(20, Math.min(22, safeHeight * 0.036)), {
      width: contentWidth - 20, height: 28, color: new Color(223, 239, 215), outlineColor: new Color(28, 61, 38), outlineWidth: 2,
    })

    const rowGap = Math.max(37, Math.min(57, (panelHeight - 100) / 5))
    const rowStart = tabY - 72
    if (this.friendSettingsTab === 'rules') {
      this.friendStepperRow(ui, '局数', contentX, contentWidth, rowStart, this.friendRoomSettings.rounds, '局', 4, 32, 4, value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, rounds: value }
        this.showFriendRoomSettings()
      })
      this.friendChoiceRow(ui, '计分', contentX, contentWidth, rowStart - rowGap, ['双下3分', '双下4分'], this.friendRoomSettings.scoring === 'double-3' ? '双下3分' : '双下4分', value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, scoring: value === '双下4分' ? 'double-4' : 'double-3' }
        this.showFriendRoomSettings()
      })
      this.friendChoiceRow(ui, '比分', contentX, contentWidth, rowStart - rowGap * 2, ['实时显示', '结算显示'], this.friendRoomSettings.scoreVisibility === 'live' ? '实时显示' : '结算显示', value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, scoreVisibility: value === '实时显示' ? 'live' : 'hidden' }
        this.showFriendRoomSettings()
      })
      this.friendChoiceRow(ui, '首出', contentX, contentWidth, rowStart - rowGap * 3, ['20秒', '40秒', '60秒'], `${this.friendRoomSettings.turnSeconds}秒`, value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, turnSeconds: Number(value.replace('秒', '')) as 20 | 40 | 60 }
        this.showFriendRoomSettings()
      })
      this.friendChoiceRow(ui, '托管', contentX, contentWidth, rowStart - rowGap * 4, ['无托管', '15秒', '30秒', '60秒'], this.friendRoomSettings.trusteeSeconds === 0 ? '无托管' : `${this.friendRoomSettings.trusteeSeconds}秒`, value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, trusteeSeconds: value === '无托管' ? 0 : Number(value.replace('秒', '')) as 0 | 15 | 30 | 60 }
        this.showFriendRoomSettings()
      })
    } else {
      this.friendChoiceRow(ui, '总时长', contentX, contentWidth, rowStart, ['不限制', '20分钟', '30分钟', '60分钟'], this.friendRoomSettings.totalTimeMinutes === 0 ? '不限制' : `${this.friendRoomSettings.totalTimeMinutes}分钟`, value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, totalTimeMinutes: value === '不限制' ? 0 : Number(value.replace('分钟', '')) as 0 | 20 | 30 | 60 }
        this.showFriendRoomSettings()
      })
      this.friendChoiceRow(ui, '观战', contentX, contentWidth, rowStart - rowGap, ['禁止观战', '实时观战', '延迟1局'], this.friendRoomSettings.spectator === 'off' ? '禁止观战' : this.friendRoomSettings.spectator === 'live' ? '实时观战' : '延迟1局', value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, spectator: value === '实时观战' ? 'live' : value === '延迟1局' ? 'delayed-round' : 'off' }
        this.showFriendRoomSettings()
      })
      this.friendChoiceRow(ui, '一键理牌', contentX, contentWidth, rowStart - rowGap * 2, ['开启', '关闭'], this.friendRoomSettings.autoSort ? '开启' : '关闭', value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, autoSort: value === '开启' }
        this.showFriendRoomSettings()
      })
      this.friendChoiceRow(ui, '互动', contentX, contentWidth, rowStart - rowGap * 3, ['禁止互动', '允许互动'], this.friendRoomSettings.disableInteraction ? '禁止互动' : '允许互动', value => {
        this.friendRoomSettings = { ...this.friendRoomSettings, disableInteraction: value === '禁止互动' }
        this.showFriendRoomSettings()
      })
      this.friendChoiceRow(ui, '牌序', contentX, contentWidth, rowStart - rowGap * 4, ['大牌在左', '小牌在左'], this.friendRoomSettings.sortOrder === 'desc' ? '大牌在左' : '小牌在左', value => {
        const sortOrder = value === '小牌在左' ? 'asc' : 'desc'
        this.friendRoomSettings = { ...this.friendRoomSettings, sortOrder }
        this.dependencies.session.updateSettings({ sortOrder })
        this.showFriendRoomSettings()
      })
    }
    const actionY = -panelHeight / 2 + 34
    this.coloredButton(ui, '加入房间', contentX - Math.min(145, contentWidth * 0.2), actionY, Math.min(240, contentWidth * 0.34), 52, 22, new Color(44, 151, 103), () => this.openLobby(false))
    this.coloredButton(ui, '创建房间', contentX + Math.min(145, contentWidth * 0.2), actionY, Math.min(240, contentWidth * 0.34), 52, 22, new Color(223, 164, 47), () => this.openLobby(true))
    this.compactButton(ui, '返回', this.dependencies.screen.safeLeftX(62), this.dependencies.screen.safeTopY(44), 84, 42, 22, () => this.showMenu())
  }

  public showOnlinePlay (): void {
    if (this.dependencies.isDisposed()) return
    this.dependencies.issuePageRequest()
    this.dependencies.invalidateMatchAttempt()
    this.dependencies.setTableVisible(false)
    if (this.dependencies.session.snapshot.status !== 'menu') this.dependencies.session.leaveToMenu()
    const ui = this.dependencies.router.open('online')
    ui.menuLabel('在线对战', 0, 215, 44)
    ui.menuLabel('选择匹配方式', 0, 165, 20)
    this.sizedButton(ui, '快速匹配\n自动寻找三名玩家', 0, 85, 520, 72, 23, () => this.dependencies.beginMatch('quick', '快速匹配', 'online'))
    this.sizedButton(ui, '比赛场\n日赛 · 周赛 · 月赛 · 主题赛事', 0, 0, 520, 72, 23, this.dependencies.showCompetition)
    this.sizedButton(ui, '好友房\n设置规则、创建房间或输入六位房间码', 0, -85, 520, 72, 23, () => this.showFriendRoomSettings())
    this.pageButton(ui, '返回大厅', -180, () => this.showMenu())
  }

  public showLobby (): void { this.openLobby(false) }

  public renderLobby (snapshot: LobbySnapshot): void {
    if (this.dependencies.isDisposed() || this.dependencies.session.snapshot.status !== 'lobby') return
    if (this.pendingFriendRoomCreation && snapshot.connected && snapshot.roomStatus === 'idle' && !snapshot.roomId) {
      this.pendingFriendRoomCreation = false
      this.dependencies.scheduleOnce(() => {
        if (!this.dependencies.isDisposed() && this.dependencies.router.current === 'lobby' && this.dependencies.lobby.snapshot.connected && !this.dependencies.lobby.snapshot.roomId) {
          this.dependencies.lobby.createRoom('玩家', this.friendRoomSettings)
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
  public resetInput (): void { this.roomCodeInput = null }

  public hide (): void {
    this.pendingFriendRoomCreation = false
    this.resetInput()
  }

  private openLobby (createWithSettings: boolean): void {
    if (this.dependencies.isDisposed()) return
    this.dependencies.setTableVisible(false)
    this.pendingFriendRoomCreation = createWithSettings
    this.dependencies.session.enterLobby()
    const endpoint = this.dependencies.getLobbyEndpoint()
    if (!endpoint) {
      this.pendingFriendRoomCreation = false
      this.renderLobby({ connected: false, rooms: [], roomId: null, members: [], myPlayerId: null, roomStatus: 'idle', error: '未配置联机服务地址：请在 GameRoot 的 lobbyEndpoint 填入 wss:// 域名（本地开发可填 ws://局域网IP:3002/weapp）' })
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
    const roomId = snapshot.roomId
    const myPlayerId = snapshot.myPlayerId
    if (!roomId || !myPlayerId) return
    const safeWidth = this.dependencies.screen.safeSize().x
    const safeHeight = this.dependencies.screen.safeSize().y
    const readyPlayers = new Set(snapshot.lobbyReadyPlayerIds ?? [])
    const bots = new Set(snapshot.botPlayerIds ?? [])
    const members = new Set(snapshot.members)
    const occupied = new Set<PlayerId>([...snapshot.members, ...(snapshot.botPlayerIds ?? [])])
    const host = myPlayerId === 'p1'
    const rules = snapshot.roomSettings
    this.compactButton(ui, '返回', this.dependencies.screen.safeLeftX(60), this.dependencies.screen.safeTopY(42), 82, 42, 22, () => this.dependencies.lobby.leaveRoom())
    ui.outlinedLabel(`好友房 ${roomId}`, 0, this.dependencies.screen.safeTopY(38), 28, {
      width: Math.min(330, safeWidth * 0.38), height: 42,
      color: new Color(255, 232, 139), outlineColor: new Color(41, 48, 35), outlineWidth: 4,
    })
    const ruleText = rules
      ? `${rules.rounds}局 · ${rules.scoring === 'double-4' ? '双下4分' : '双下3分'} · ${rules.scoreVisibility === 'live' ? '实时比分' : '结算比分'} · 首出${rules.turnSeconds}秒 · ${rules.trusteeSeconds ? `托管${rules.trusteeSeconds}秒` : '无托管'}`
      : '经典过A · 正在同步房间规则'
    ui.outlinedLabel(ruleText, 0, this.dependencies.screen.safeTopY(78), 20, {
      width: Math.min(680, safeWidth * 0.76), height: 30,
      color: new Color(225, 239, 226), outlineColor: new Color(34, 61, 54), outlineWidth: 2,
    })
    if (snapshot.error) ui.outlinedLabel(snapshot.error, 0, this.dependencies.screen.safeTopY(112), 20, {
      width: Math.min(680, safeWidth * 0.76), height: 32,
      color: new Color(255, 170, 139), outlineColor: new Color(72, 31, 27), outlineWidth: 2,
    })

    const ids: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
    const viewerIndex = ids.indexOf(myPlayerId)
    const ordered = ids.map((_, index) => ids[(viewerIndex + index) % ids.length])
    const sideX = Math.max(92, Math.min(118, safeWidth * 0.105))
    const seats = [
      new Vec3(0, this.dependencies.screen.safeBottomY(74), 4),
      new Vec3(this.dependencies.screen.safeRightX(sideX), 4, 4),
      new Vec3(-72, this.dependencies.screen.safeTopY(126), 4),
      new Vec3(this.dependencies.screen.safeLeftX(sideX), 4, 4),
    ]
    ordered.forEach((playerId, index) => {
      const seat = new Node(`FriendSeat-${playerId}`)
      seat.parent = ui.parent
      seat.setPosition(seats[index])
      seat.addComponent(UITransform).setContentSize(180, 126)
      const isBot = bots.has(playerId)
      const isMember = members.has(playerId)
      if (isBot || isMember) {
        ui.image(`FriendAvatar-${playerId}`, LOBBY_ART.defaultAvatar, 0, 25, 64, 64, seat)
        const display = playerId === myPlayerId ? '我' : isBot ? '机器人 · 大师' : `玩家 ${playerId.slice(1)}`
        const badge = playerId === 'p1' ? ' · 房主' : ''
        ui.outlinedLabel(`${display}${badge}`, 0, -17, 20, {
          parent: seat, width: 176, height: 26,
          color: isBot ? new Color(159, 234, 205) : new Color(255, 238, 174), outlineColor: new Color(37, 48, 37), outlineWidth: 2,
        })
        const removableBot = host && playerId !== 'p1' && isBot
        const kickableMember = host && playerId !== 'p1' && isMember && !readyPlayers.has(playerId)
        const seatStatus = removableBot ? '已准备 · 点击移除' : kickableMember ? '未准备 · 点击移出' : isBot || readyPlayers.has(playerId) ? '已准备' : '未准备'
        ui.outlinedLabel(seatStatus, 0, -45, 20, {
          parent: seat, width: 164, height: 28,
          color: isBot || readyPlayers.has(playerId) ? new Color(139, 239, 177) : new Color(236, 220, 201), outlineColor: new Color(30, 57, 48), outlineWidth: 2,
        })
        if (removableBot) ui.makeInteractive(seat, () => this.dependencies.lobby.removeBot(playerId), 0.96)
        else if (kickableMember) ui.makeInteractive(seat, () => this.dependencies.lobby.kickMember(playerId), 0.96)
        return
      }
      ui.outlinedLabel('+', 0, 24, 44, {
        parent: seat, width: 64, height: 64,
        color: new Color(230, 242, 221), outlineColor: new Color(37, 72, 61), outlineWidth: 3,
      })
      ui.outlinedLabel('空座位', 0, -17, 20, {
        parent: seat, width: 120, height: 28,
        color: new Color(230, 239, 225), outlineColor: new Color(37, 62, 55), outlineWidth: 2,
      })
      ui.outlinedLabel(host ? '设为机器人' : '等待加入', 0, -45, 20, { parent: seat, width: 150, height: 28, color: new Color(200, 218, 209), outlineWidth: 2 })
      if (host) ui.makeInteractive(seat, () => this.dependencies.lobby.addBot(playerId), 0.96)
    })

    const isReady = readyPlayers.has(myPlayerId)
    const humansReady = snapshot.members.filter(playerId => !bots.has(playerId)).every(playerId => readyPlayers.has(playerId))
    const canStart = occupied.size === 4 && humansReady
    const actionY = safeHeight < 500 ? -8 : -36
    const readyX = host || snapshot.lobbyReadyRequired === false ? -108 : 0
    if (snapshot.lobbyReadyRequired !== false) {
      this.coloredButton(ui, isReady ? '取消准备' : '准备', host ? readyX : 0, actionY, 190, 44, 20, isReady ? new Color(78, 105, 102) : new Color(45, 157, 102), () => {
        if (isReady) this.dependencies.lobby.cancelLobbyReady()
        else this.dependencies.lobby.setLobbyReady()
      })
    }
    if (host && canStart) {
      this.coloredButton(ui, '开始游戏', 108, actionY, 190, 44, 20, new Color(222, 165, 50), () => this.dependencies.lobby.startGame())
    } else {
      const emptyCount = Math.max(0, 4 - occupied.size)
      const status = emptyCount > 0
        ? host ? `还差 ${emptyCount} 个座位 · 可点击空座加入机器人` : `等待 ${emptyCount} 名牌友加入`
        : host ? '等待其他玩家准备' : '等待房主开始'
      ui.outlinedLabel(status, host ? 125 : 0, actionY, 20, {
        width: host ? Math.min(280, safeWidth * 0.33) : Math.min(440, safeWidth * 0.52), height: 36,
        color: new Color(247, 232, 185), outlineColor: new Color(46, 55, 40), outlineWidth: 2,
      })
    }
  }

  private renderLobbyPlayerProfile (ui: RuntimeUiFactory, requestedRight: number): void {
    const hasRemoteDashboard = this.dependencies.player.dashboard !== null
    const awaitingRemoteDashboard = this.dependencies.gateways.configured && !hasRemoteDashboard
    const stats = this.dependencies.player.dashboard?.stats ?? this.dependencies.session.snapshot.playerStats
    const rating = this.dependencies.player.dashboard?.rating
    const displayName = awaitingRemoteDashboard ? '账号同步中' : this.dependencies.player.dashboard?.user.displayName.trim() || '陵水玩家'
    const remoteAccountId = this.dependencies.player.dashboard?.user.accountId.trim() ?? ''
    const accountId = /^\d{8}$/.test(remoteAccountId) ? remoteAccountId : this.dependencies.gateways.configured ? '同步中' : this.localAccountId
    const games = Math.max(0, rating?.games ?? stats.gamesPlayed)
    const wins = Math.max(0, rating?.wins ?? stats.wins)
    const rawWinRate = games > 0 ? wins * 100 / games : 0
    const rawWinRateText = awaitingRemoteDashboard ? '--' : games > 0 ? rawWinRate.toFixed(1) : '0'
    const comprehensiveScore = awaitingRemoteDashboard
      ? null
      : Math.round(rating?.comprehensiveScore ?? this.dependencies.player.dashboard?.user.comprehensiveScore ?? this.fallbackComprehensiveScore(stats.elo, wins, games))
    const pointsText = this.dependencies.gateways.configured && !this.dependencies.wallet.fresh ? '积分 --' : `积分 ${Math.max(0, Math.round(this.dependencies.wallet.value.points))}`
    const comprehensiveText = `综合分 ${comprehensiveScore ?? '--'}`
    const winRateText = `胜率 ${rawWinRateText}${rawWinRateText === '--' ? '' : '%'}`
    const gamesText = `场次 ${awaitingRemoteDashboard ? '--' : games}`
    const estimatedWidth = (text: string, fontSize: number, padding: number): number => Math.ceil(
      Array.from(text).reduce((width, character) => width + (/^[\u0000-\u00ff]$/.test(character) ? fontSize * 0.58 : fontSize), 0) + padding,
    )
    const identityWidth = Math.max(140, Math.min(190, Math.max(estimatedWidth(displayName, 20, 30), estimatedWidth(`ID ${accountId}`, 20, 24))))
    const left = this.dependencies.screen.safeLeftX(14)
    const right = Math.max(left + 220, Math.min(requestedRight, this.dependencies.screen.safeRightX(14)))
    const y = this.dependencies.screen.safeTopY(52)
    const placements = resolveSafeHorizontalLane(left, right, [
      { id: 'avatar', preferredWidth: 64, minWidth: 60, priority: 100, canHide: false },
      { id: 'identity', preferredWidth: identityWidth, minWidth: 112, priority: 95, canHide: false },
      { id: 'points', preferredWidth: estimatedWidth(pointsText, 20, 38), minWidth: 94, priority: 85 },
      { id: 'win-rate', preferredWidth: estimatedWidth(winRateText, 20, 24), minWidth: 88, priority: 60 },
      { id: 'games', preferredWidth: estimatedWidth(gamesText, 20, 24), minWidth: 78, priority: 50 },
      { id: 'comprehensive', preferredWidth: estimatedWidth(comprehensiveText, 20, 24), minWidth: 108, priority: 90, canHide: false },
    ], 5)
    const place = (id: string) => placements.find(item => item.id === id)
    const avatar = place('avatar')
    if (avatar?.visible) {
      ui.panel('LobbyAvatarBacking', avatar.x, y, 64, 64, { fill: new Color(5, 9, 8, 178), lineWidth: 0, radius: 32 })
      ui.image('LobbyDefaultAvatar', LOBBY_ART.defaultAvatar, avatar.x, y, 58, 58)
    }
    const identity = place('identity')
    if (identity?.visible) {
      ui.panel('LobbyIdentityPill', identity.x, y, identity.width, 64, { fill: new Color(4, 8, 8, 172), lineWidth: 0, radius: 32 })
      ui.outlinedLabel(displayName, identity.x, y + 13, 20, {
        width: identity.width - 18, height: 28, color: new Color(255, 241, 178), outlineColor: new Color(46, 36, 24), outlineWidth: 3,
      })
      ui.outlinedLabel(`ID ${accountId}`, identity.x, y - 15, 20, {
        width: identity.width - 18, height: 28, color: new Color(225, 241, 235), outlineColor: new Color(30, 62, 62), outlineWidth: 2,
      })
    }
    const renderPill = (id: string, text: string, fontSize: number, color: Color): void => {
      const placement = place(id)
      if (!placement?.visible) return
      ui.panel(`Lobby-${id}-Pill`, placement.x, y, placement.width, 36, { fill: new Color(4, 8, 8, 172), lineWidth: 0, radius: 18 })
      ui.outlinedLabel(text, placement.x, y, fontSize, {
        width: placement.width - 12, height: 30, color, outlineColor: new Color(28, 36, 32), outlineWidth: 2,
      })
    }
    const points = place('points')
    if (points?.visible) {
      ui.panel('Lobby-points-Pill', points.x, y, points.width, 36, { fill: new Color(4, 8, 8, 172), lineWidth: 0, radius: 18 })
      const iconX = points.x - points.width / 2 + 15
      ui.image('LobbyCoinIcon', LOBBY_ART.coin, iconX, y, 22, 23)
      ui.outlinedLabel(pointsText, points.x + 10, y, 20, {
        width: Math.max(48, points.width - 30), height: 28, color: new Color(255, 238, 168), outlineColor: new Color(47, 49, 35), outlineWidth: 2,
      })
    }
    renderPill('win-rate', winRateText, 20, new Color(230, 239, 232))
    renderPill('games', gamesText, 20, new Color(230, 239, 232))
    renderPill('comprehensive', comprehensiveText, 20, new Color(137, 241, 204))
    const hitArea = new Node('LobbyPlayerProfileHitArea')
    hitArea.parent = ui.parent
    hitArea.setPosition(new Vec3((left + right) / 2, y, 2))
    hitArea.addComponent(UITransform).setContentSize(right - left, 70)
    hitArea.on(Node.EventType.TOUCH_END, this.dependencies.showPlayerCenter)
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
      if (!this.dependencies.isDisposed() && requestToken === this.dependencies.currentPageRequest() && this.dependencies.router.current === 'menu' && !this.dependencies.rulesVisible()) this.renderMenu()
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

  private friendStepperRow (
    ui: RuntimeUiFactory,
    label: string,
    centerX: number,
    width: number,
    y: number,
    value: number,
    suffix: string,
    minimum: number,
    maximum: number,
    step: number,
    onChange: (value: number) => void,
  ): void {
    ui.panel('FriendSettingsRowBand', centerX, y, width, 42, { fill: new Color(8, 47, 31, 138), lineWidth: 0, radius: 4 })
    const labelWidth = Math.min(112, width * 0.19)
    const labelX = centerX - width / 2 + labelWidth / 2 + 14
    ui.outlinedLabel(label, labelX, y, Math.max(20, Math.min(22, width * 0.036)), {
      width: labelWidth, color: new Color(235, 242, 217), outlineColor: new Color(31, 65, 40), outlineWidth: 2,
    })
    const controlsCenter = centerX + labelWidth * 0.36
    const valueWidth = Math.min(150, Math.max(92, width * 0.22))
    ui.panel('FriendStepperValuePill', controlsCenter, y, valueWidth, 34, { fill: new Color(224, 234, 213, 245), stroke: new Color(129, 158, 117), lineWidth: 1, radius: 17 })
    ui.outlinedLabel(`${value}${suffix}`, controlsCenter, y, 20, {
      width: valueWidth - 12, height: 28, color: new Color(49, 82, 54), outlineColor: new Color(255, 255, 255), outlineWidth: 1,
    })
    this.compactButton(ui, '-', controlsCenter - valueWidth / 2 - 28, y, 38, 34, 22, () => onChange(Math.max(minimum, value - step)))
    this.compactButton(ui, '+', controlsCenter + valueWidth / 2 + 28, y, 38, 34, 22, () => onChange(Math.min(maximum, value + step)))
  }

  private friendChoiceRow (
    ui: RuntimeUiFactory,
    label: string,
    centerX: number,
    width: number,
    y: number,
    values: readonly string[],
    selected: string,
    onSelect: (value: string) => void,
  ): void {
    ui.panel('FriendSettingsRowBand', centerX, y, width, 42, { fill: new Color(8, 47, 31, 138), lineWidth: 0, radius: 4 })
    const labelWidth = Math.min(112, width * 0.19)
    const labelX = centerX - width / 2 + labelWidth / 2 + 14
    ui.outlinedLabel(label, labelX, y, Math.max(20, Math.min(22, width * 0.036)), {
      width: labelWidth, color: new Color(235, 242, 217), outlineColor: new Color(31, 65, 40), outlineWidth: 2,
    })
    const choicesLeft = centerX - width / 2 + labelWidth + 24
    const choicesWidth = width - labelWidth - 42
    const gap = 9
    const buttonWidth = Math.min(158, (choicesWidth - gap * (values.length - 1)) / values.length)
    const usedWidth = buttonWidth * values.length + gap * (values.length - 1)
    const firstX = choicesLeft + (choicesWidth - usedWidth) / 2 + buttonWidth / 2
    values.forEach((value, index) => {
      const active = value === selected
      const node = ui.button('FriendChoice', value, firstX + index * (buttonWidth + gap), buttonWidth, 44, Math.max(22, Math.min(24, buttonWidth * 0.17)), {
        fill: active ? new Color(71, 174, 83, 248) : new Color(223, 232, 212, 245),
        pressedFill: new Color(57, 150, 70, 248),
        stroke: active ? new Color(232, 201, 77, 255) : new Color(124, 150, 113, 220),
        textColor: active ? new Color(255, 252, 225) : new Color(59, 82, 61),
        textOutlineColor: active ? new Color(40, 86, 39) : new Color(255, 255, 255),
        textOutlineWidth: 2,
        radius: 5,
      })
      node.setPosition(new Vec3(firstX + index * (buttonWidth + gap), y, 0))
      if (!active) node.on(Node.EventType.TOUCH_END, () => onSelect(value))
    })
  }

  private resolveLocalAccountId (): string {
    const existing = sys.localStorage.getItem(LOCAL_ACCOUNT_ID_STORAGE_KEY)?.trim() ?? ''
    if (/^\d{8}$/.test(existing)) return existing
    const randomSource = globalThis as typeof globalThis & { crypto?: { getRandomValues?: (values: Uint32Array) => Uint32Array } }
    const randomValues = new Uint32Array(1)
    const random = randomSource.crypto?.getRandomValues
      ? randomSource.crypto.getRandomValues(randomValues)[0]
      : Math.floor(Math.random() * 0x1_0000_0000)
    const accountId = String(10_000_000 + random % 90_000_000)
    sys.localStorage.setItem(LOCAL_ACCOUNT_ID_STORAGE_KEY, accountId)
    return accountId
  }

  private fallbackComprehensiveScore (legacyElo: number, wins: number, games: number): number {
    const safeGames = Math.max(0, games)
    const adjustedWinRate = (Math.max(0, wins) + 25) / (safeGames + 50)
    const experience = 0.3 + 0.7 * Math.log1p(safeGames) / Math.log(101)
    const baseScore = 60_000 * Math.pow(adjustedWinRate, 1.8) * experience
    return Math.max(1_000, Math.round(baseScore + Math.max(0, legacyElo) - 1_000))
  }

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
