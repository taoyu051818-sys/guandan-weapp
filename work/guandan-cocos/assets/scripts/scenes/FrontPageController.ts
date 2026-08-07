import { BlockInputEvents, Color, EditBox, game, Game, Graphics, Label, Node, sys, UITransform, Vec3, tween } from 'cc'
import type { PlayerId } from '../core/generated'
import { DEFAULT_FRIEND_ROOM_SETTINGS, LobbyController, type FriendRoomSettings, type LobbySnapshot } from '../network/LobbyController'
import { ReplayTimeline } from '../replay/ReplayTimeline'
import { shouldStopSpectatorPolling, SPECTATOR_POLL_INTERVAL_SECONDS, spectatorRetryDelaySeconds } from '../replay/SpectatorPollingPolicy'
import {
  createDevelopmentGateways,
  DevelopmentSpectatorGateway,
  SAMPLE_DASHBOARD,
  SAMPLE_PRODUCTS,
  SAMPLE_TOURNAMENTS,
  type FrontPageGateways,
  type MatchQueueId,
  type MatchTicket,
  type MerchantConsole,
  type MerchantRole,
  type PlayerDashboard,
  type ReplayDetail,
  type ReplaySummary,
  type SeasonTaskList,
  type ShopProduct,
  type SpectatorFeed,
  type SpectatorGateway,
  type SpectatorMatchSummary,
  type TournamentState,
  type TournamentStandings,
  type TournamentSummary,
  type WalletSnapshot,
} from '../services/DevelopmentApis'
import { PlatformApiError } from '../services/PlatformApi'
import { matchWaitingText, type MatchWaitingStage } from '../services/MatchWaitingPresentation'
import { GameSession } from '../session/GameSession'
import type { EffectQuality } from '../effects/EffectTypes'
import { ScreenAdapter } from '../ui/ScreenAdapter'
import { resolveSafeHorizontalLane } from '../ui/SafeAreaLayout'
import { renderReplayBoard } from '../ui/ReplayBoardView'
import { RuntimeUiFactory } from '../ui/RuntimeUiFactory'
import { PageRouter } from './PageRouter'

type RemoteDataState = 'development' | 'loading' | 'fresh' | 'empty' | 'stale' | 'unavailable'
type ClassicRoomMode = 'classic' | 'consecutive' | 'no-shuffle' | 'team-turn' | 'upgrade80'
type CompetitionCategory = 'championship' | 'hometown' | 'alumni' | 'custom' | 'mine'
type MatchReturnPage = 'menu' | 'online' | 'competition' | 'classic-rooms'
type Settled<T> = { status: 'fulfilled', value: T } | { status: 'rejected', reason: unknown }
type SpectatorFeedSession = {
  matchId: string
  gateway: SpectatorGateway
  isDemo: boolean
  timeline: ReplayTimeline
  feed: SpectatorFeed | null
  syncStatus: string
  consecutiveFailures: number
}
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> => promise.then(
  value => ({ status: 'fulfilled', value }),
  reason => ({ status: 'rejected', reason }),
)
const LOCAL_ACCOUNT_ID_STORAGE_KEY = 'guandan-local-account-id-v1'

const RULE_PAGES = Object.freeze([
  Object.freeze({
    icon: '♠',
    title: '基础与目标',
    content: '四人分成两队，对面座位互为队友，使用两副牌共108张。\n每局按座位顺序轮流行动；首家可出任意合法牌型，其他玩家依次压牌或选择不出。\n一轮中其余三家都不出时，最后出牌者获得下一轮首出权。先出完手牌者为头游。',
  }),
  Object.freeze({
    icon: '♦',
    title: '牌型与识别',
    content: '普通牌型：单张、对子、三张、三带二。\n连续牌型：五张顺子、三连对（连续三组对子）、钢板（连续两组三张）。\n特殊牌型：四张及以上同点数炸弹、五张同花顺、四王炸。\n除红桃级牌“逢人配”外，其他花色的级牌不能直接组成连续牌型；一次选牌必须组成一种完整合法牌型。',
  }),
  Object.freeze({
    icon: '↕',
    title: '大小与压牌',
    content: '普通牌只能用相同牌型、相同张数比较，比较该牌型的主点数。\n炸弹可以压普通牌；同为炸弹时先比较张数，再比较点数。\n经典规则中，同花顺按五张半炸弹比较：高于五张炸弹、低于六张及以上炸弹。\n四王炸为最高牌型。没有合法更大牌时应选择不出。',
  }),
  Object.freeze({
    icon: '★',
    title: '出牌与配合',
    content: '红桃级牌是“逢人配”，可代替除大小王外的点数，系统会显示它代表的牌。\n队友坐在正对面：队友接近出完时应优先送出其可能接住的小牌，避免无意义压队友牌。\n对手接近出完时要控制出牌权，必要时用炸弹拦截。提示只给合法候选，最终选择仍由玩家确认。',
  }),
  Object.freeze({
    icon: '杯',
    title: '升级与胜负',
    content: '头游与队友包揽前二为“双下”，本队升3级；队友第三名升2级；队友末游升1级。\n下一局通常由末游向头游进贡最大合法牌，赢家还一张不高于10的牌；双下时双方各进贡一次。\n单贡方持有至少两张王可抗贡；双贡两人合计四张王，或合计至少两张大王，也可抗贡。打到A级后仍需取得至少升2级的结果才能“过A”。',
  }),
] as const)

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

const COMPETITION_CATEGORIES: ReadonlyArray<{ id: CompetitionCategory, label: string, badge: string }> = [
  { id: 'championship', label: '锦标赛', badge: '杯' },
  { id: 'hometown', label: '老乡赛', badge: '城' },
  { id: 'alumni', label: '校友赛', badge: '校' },
  { id: 'custom', label: '自建赛', badge: '建' },
  { id: 'mine', label: '我的比赛', badge: '我' },
]

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
  private rulesPage = 0
  private rulesDialogVisible = false
  private matchAttemptToken = 0
  private pageRequestToken = 0
  private activeMatchTicketId: string | null = null
  private matchingStatusLabel: Label | null = null
  private matchingStartedAt = 0
  private matchingQueueName = ''
  private matchingStage: MatchWaitingStage = 'requesting'
  private roomCodeInput: EditBox | null = null
  private pendingProductId: string | null = null
  private pendingTournamentId: string | null = null
  private pendingSeasonTaskId: string | null = null
  private pendingMerchantAction: 'apply' | 'store' | 'employee' | 'grant' | null = null
  private products: ShopProduct[] = []
  private tournaments: TournamentSummary[] = []
  private wallet: WalletSnapshot = { points: 10_000, diamonds: 0 }
  private playerDashboard: PlayerDashboard | null = null
  private playerDashboardLoading = false
  private playerDashboardLoadedAt = 0
  private productDataState: RemoteDataState = 'development'
  private tournamentDataState: RemoteDataState = 'development'
  private walletFresh = false
  private readonly reconciledMatchIds = new Set<string>()
  private disposed = false
  private effectLabPage = 0
  private effectLabQuality: EffectQuality = 'full'
  private replayPlaybackToken = 0
  private spectatorPollingToken = 0
  private spectatorBackgrounded = false
  private spectatorFeedSession: SpectatorFeedSession | null = null
  private readonly spectatorDemoGateway = new DevelopmentSpectatorGateway()
  private classicRoomMode: ClassicRoomMode = 'classic'
  private competitionCategory: CompetitionCategory = 'championship'
  private friendRoomSettings: FriendRoomSettings = { ...DEFAULT_FRIEND_ROOM_SETTINGS }
  private friendSettingsTab: 'rules' | 'experience' = 'rules'
  private pendingFriendRoomCreation = false
  private readonly localAccountId = this.resolveLocalAccountId()

  public constructor (
    root: Node,
    private readonly session: GameSession,
    private readonly lobby: LobbyController,
    private readonly screen: ScreenAdapter,
    private readonly host: FrontPageHost,
    private readonly gateways: FrontPageGateways = createDevelopmentGateways(),
  ) {
    this.router = new PageRouter(root, (previous, next) => {
      if (previous === 'spectator-feed' && next !== 'spectator-feed') this.stopSpectatorPolling(true)
      if (next !== 'menu') this.rulesDialogVisible = false
    })
    game.on(Game.EVENT_HIDE, this.handleApplicationHide)
    game.on(Game.EVENT_SHOW, this.handleApplicationShow)
    this.products = gateways.configured ? [] : SAMPLE_PRODUCTS
    this.tournaments = gateways.configured ? [] : SAMPLE_TOURNAMENTS
    this.playerDashboard = gateways.configured ? null : SAMPLE_DASHBOARD
    this.productDataState = gateways.configured ? 'loading' : 'development'
    this.tournamentDataState = gateways.configured ? 'loading' : 'development'
    this.walletFresh = !gateways.configured
  }

  public showMenu (): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    this.invalidateMatchAttempt()
    if (this.gateways.configured) {
      this.playerDashboard = null
      this.playerDashboardLoadedAt = 0
      this.walletFresh = false
    }
    this.host.closeModal()
    this.rulesDialogVisible = false
    this.host.setTableVisible(false)
    this.host.setFriendRoomWaitingVisible(false)
    if (this.session.snapshot.status !== 'menu') this.session.leaveToMenu()
    this.renderMenuPage()
  }

  private renderMenuPage (): void {
    const ui = this.router.open('menu')
    const safeWidth = this.screen.safeSize().x
    const safeHeight = this.screen.safeSize().y
    const cardsAreaWidth = Math.min(650, safeWidth * 0.61)
    const gap = Math.max(10, Math.min(18, cardsAreaWidth * 0.028))
    const cardWidth = Math.min(190, (cardsAreaWidth - gap * 2) / 3)
    const cardHeight = cardWidth * 4 / 3
    const areaRight = this.screen.safeRightX(22)
    const firstCardX = areaRight - cardsAreaWidth + cardWidth / 2
    const cardY = Math.min(28, Math.max(-2, safeHeight * 0.025))
    const titleX = firstCardX + (cardWidth * 3 + gap * 2) / 2 - cardWidth / 2
    ui.outlinedLabel('陵水掼蛋', titleX, this.screen.safeTopY(52), Math.min(42, Math.max(31, safeHeight * 0.07)), {
      width: cardsAreaWidth,
      color: new Color(255, 239, 164),
      outlineColor: new Color(58, 44, 24),
      outlineWidth: 4,
    })
    const entries: ReadonlyArray<{ name: string, art: string, action: () => void }> = [
      { name: 'ClassicEntryCard', art: LOBBY_ART.entryClassic, action: () => this.showClassicRooms() },
      { name: 'FriendEntryCard', art: LOBBY_ART.entryFriend, action: () => this.showFriendRoomSettings() },
      { name: 'TournamentEntryCard', art: LOBBY_ART.entryTournament, action: () => this.showCompetition() },
    ]
    entries.forEach((entry, index) => {
      ui.imageCard(entry.name, entry.art, firstCardX + index * (cardWidth + gap), cardY, cardWidth, cardHeight, entry.action, 0.04 + index * 0.07)
    })
    const cardsLeft = firstCardX - cardWidth / 2
    this.renderLobbyPlayerProfile(ui, cardsLeft - 14)
    this.renderShopShortcut(ui, safeWidth, safeHeight)
    const utilityY = this.screen.safeTopY(112)
    this.compactButton(ui, '规则', this.screen.safeLeftX(58), utilityY, 72, 38, 16, () => this.showRulesDialog())
    this.compactButton(ui, '更多', this.screen.safeLeftX(140), utilityY, 72, 38, 16, () => this.showMoreMenu())
    const quickWidth = Math.min(286, Math.max(232, safeWidth * 0.225))
    const quickHeight = Math.min(76, Math.max(62, safeHeight * 0.105))
    const quickX = this.screen.safeRightX(quickWidth / 2 + 22)
    const quickY = this.screen.safeBottomY(quickHeight / 2 + 18)
    this.coloredButton(ui, '快速开始\n经典 · 初级场', quickX, quickY, quickWidth, quickHeight, Math.max(19, Math.min(24, quickHeight * 0.32)), new Color(232, 175, 45, 248), () => {
      this.beginMatch('classic_50', '经典 · 初级场 · 底分50', 'menu')
    })
    this.refreshLobbyDashboard(this.pageRequestToken)
  }

  private showClassicRooms (): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    this.invalidateMatchAttempt()
    this.host.setTableVisible(false)
    const ui = this.router.open('classic-rooms')
    const safeWidth = this.screen.safeSize().x
    const safeHeight = this.screen.safeSize().y
    const leftWidth = Math.min(190, Math.max(140, safeWidth * 0.17))
    const leftX = this.screen.safeLeftX(leftWidth / 2 + 14)
    const panelHeight = Math.min(500, safeHeight - 92)
    ui.panel('ClassicModePanel', leftX, -8, leftWidth, panelHeight, {
      fill: new Color(24, 48, 65, 218),
      stroke: new Color(159, 204, 231, 210),
      lineWidth: 2,
      radius: 6,
    })
    ui.outlinedLabel('经典掼蛋', leftX, this.screen.safeTopY(96), Math.min(32, Math.max(26, safeHeight * 0.058)), {
      width: leftWidth + 20,
      color: new Color(255, 239, 172),
      outlineColor: new Color(48, 35, 22),
      outlineWidth: 4,
    })
    const modeGap = Math.min(64, (panelHeight - 62) / CLASSIC_ROOM_MODES.length)
    const modeStartY = panelHeight / 2 - 54
    CLASSIC_ROOM_MODES.forEach((mode, index) => {
      const active = mode.id === this.classicRoomMode
      const node = ui.button('ClassicModeTab', mode.available ? mode.label : `${mode.label}  锁`, leftX, leftWidth - 18, 44, Math.min(20, leftWidth * 0.12), {
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
    const contentRight = this.screen.safeRightX(18)
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
        parent: card,
        width: cardWidth - 20,
        color: tier.accent,
        outlineColor: new Color(255, 255, 255, 255),
        outlineWidth: 2,
      })
      ui.outlinedLabel('底分', 0, -cardHeight * 0.34, Math.max(14, cardWidth * 0.09), {
        parent: card,
        width: cardWidth - 20,
        color: new Color(58, 68, 77),
        outlineColor: new Color(255, 255, 255, 255),
        outlineWidth: 1,
      })
      ui.outlinedLabel(String(tier.score), 0, -cardHeight * 0.425, Math.max(22, cardWidth * 0.16), {
        parent: card,
        width: cardWidth - 18,
        color: tier.accent,
        outlineColor: new Color(255, 255, 255, 255),
        outlineWidth: 2,
      })
    })
    ui.outlinedLabel('胜方每席 +底分 · 败方每席 -底分 · 匹配期间会预留一份底分', (contentLeft + contentRight) / 2, this.screen.safeBottomY(20), Math.max(14, Math.min(18, safeHeight * 0.035)), {
      width: contentRight - contentLeft,
      color: new Color(255, 239, 182),
      outlineColor: new Color(29, 55, 64),
      outlineWidth: 3,
    })
    this.compactButton(ui, '返回', this.screen.safeLeftX(58), this.screen.safeTopY(42), 76, 38, 18, () => this.showMenu())
  }

  private startClassicTier (tier: (typeof CLASSIC_ROOM_TIERS)[number]): void {
    if (this.classicRoomMode !== 'classic') {
      this.host.showNotice('该玩法尚未开放', '当前规则引擎仅支持四人经典掼蛋')
      return
    }
    this.beginMatch(tier.queueId, `${tier.name} · 底分${tier.score}`, 'classic-rooms')
  }

  private showFriendRoomSettings (): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    this.invalidateMatchAttempt()
    this.host.setTableVisible(false)
    if (this.session.snapshot.status !== 'menu') this.session.leaveToMenu()
    const ui = this.router.open('friend-room-settings')
    const viewport = this.screen.viewport
    const sourceWidth = 1672
    const sourceHeight = 941
    const coverScale = Math.max(viewport.width / sourceWidth, viewport.height / sourceHeight)
    ui.image('FriendRoomBackdrop', LOBBY_ART.friendBackground, 0, 0, sourceWidth * coverScale, sourceHeight * coverScale)
    ui.panel('FriendRoomTint', 0, 0, viewport.width, viewport.height, { fill: new Color(7, 42, 24, 78), lineWidth: 0, radius: 0 })
    const safeWidth = this.screen.safeSize().x
    const safeHeight = this.screen.safeSize().y
    const leftWidth = Math.min(205, Math.max(138, safeWidth * 0.18))
    const leftX = this.screen.safeLeftX(leftWidth / 2 + 14)
    const panelHeight = Math.min(525, safeHeight - 84)
    const contentLeft = leftX + leftWidth / 2 + 18
    const contentRight = this.screen.safeRightX(18)
    const contentWidth = Math.max(310, contentRight - contentLeft)
    const contentX = (contentLeft + contentRight) / 2
    ui.panel('FriendModePanel', leftX, -8, leftWidth, panelHeight, {
      fill: new Color(12, 58, 36, 208), lineWidth: 0, radius: 0,
    })
    ui.outlinedLabel('好友房', leftX, this.screen.safeTopY(94), Math.min(32, Math.max(26, safeHeight * 0.058)), {
      width: leftWidth, color: new Color(255, 239, 174), outlineColor: new Color(38, 68, 31), outlineWidth: 4,
    })
    const friendModes = ['经典掼蛋', '转蛋', '斗地主', '掼蛋复式'] as const
    friendModes.forEach((mode, index) => {
      const available = index === 0
      const node = ui.button('FriendModeTab', available ? mode : `${mode}  锁`, leftX, leftWidth - 18, 48, Math.min(20, leftWidth * 0.115), {
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
      const node = ui.button('FriendSettingsTab', tab === 'rules' ? '基础规则' : '体验设置', x, tabWidth, 38, 18, {
        fill: active ? new Color(45, 137, 70, 242) : new Color(10, 52, 34, 205),
        stroke: active ? new Color(249, 214, 92, 250) : new Color(117, 157, 105, 210),
        textColor: active ? new Color(255, 246, 203) : new Color(210, 225, 207),
        textOutlineColor: new Color(35, 65, 41), textOutlineWidth: 2, radius: 6,
      })
      node.setPosition(new Vec3(x, tabY, 0))
      if (!active) node.on(Node.EventType.TOUCH_END, () => { this.friendSettingsTab = tab; this.showFriendRoomSettings() })
    })
    this.compactButton(ui, '重置', contentRight - 40, tabY, 72, 36, 16, () => {
      this.friendRoomSettings = { ...DEFAULT_FRIEND_ROOM_SETTINGS }
      this.session.updateSettings({ sortOrder: this.friendRoomSettings.sortOrder })
      this.showFriendRoomSettings()
    })
    ui.outlinedLabel('经典过A · 四人组队 · 服务器验牌', contentX, tabY - 38, Math.max(14, Math.min(17, safeHeight * 0.032)), {
      width: contentWidth - 20, height: 24, color: new Color(223, 239, 215), outlineColor: new Color(28, 61, 38), outlineWidth: 2,
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
        this.session.updateSettings({ sortOrder })
        this.showFriendRoomSettings()
      })
    }
    const actionY = -panelHeight / 2 + 34
    this.coloredButton(ui, '加入房间', contentX - Math.min(145, contentWidth * 0.2), actionY, Math.min(240, contentWidth * 0.34), 48, 20, new Color(44, 151, 103), () => this.openLobby(false))
    this.coloredButton(ui, '创建房间', contentX + Math.min(145, contentWidth * 0.2), actionY, Math.min(240, contentWidth * 0.34), 48, 20, new Color(223, 164, 47), () => this.openLobby(true))
    this.compactButton(ui, '返回', this.screen.safeLeftX(58), this.screen.safeTopY(42), 76, 38, 18, () => this.showMenu())
  }

  public showOnlinePlay (): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    this.invalidateMatchAttempt()
    this.host.setTableVisible(false)
    if (this.session.snapshot.status !== 'menu') this.session.leaveToMenu()
    const ui = this.router.open('online')
    ui.menuLabel('在线对战', 0, 215, 44)
    ui.menuLabel('选择匹配方式', 0, 165, 19)
    this.sizedButton(ui, '快速匹配\n自动寻找三名玩家', 0, 85, 520, 72, 23, () => this.beginMatch('quick', '快速匹配', 'online'))
    this.sizedButton(ui, '比赛场\n日赛 · 周赛 · 月赛 · 主题赛事', 0, 0, 520, 72, 23, () => this.showCompetition())
    this.sizedButton(ui, '好友房\n设置规则、创建房间或输入六位房间码', 0, -85, 520, 72, 23, () => this.showFriendRoomSettings())
    this.pageButton(ui, '返回大厅', -180, () => this.showMenu())
  }

  public showLobby (): void { this.openLobby(false) }

  private openLobby (createWithSettings: boolean): void {
    if (this.disposed) return
    this.host.setTableVisible(false)
    this.pendingFriendRoomCreation = createWithSettings
    this.session.enterLobby()
    const endpoint = this.host.getLobbyEndpoint()
    if (!endpoint) {
      this.pendingFriendRoomCreation = false
      this.renderLobby({ connected: false, rooms: [], roomId: null, members: [], myPlayerId: null, roomStatus: 'idle', error: '未配置联机服务地址：请在 GameRoot 的 lobbyEndpoint 填入 wss:// 域名（本地开发可填 ws://局域网IP:3002/weapp）' })
      return
    }
    this.lobby.connect(endpoint)
    this.renderLobby(this.lobby.snapshot)
  }

  public renderLobby (snapshot: LobbySnapshot): void {
    if (this.disposed || this.session.snapshot.status !== 'lobby') return
    if (this.pendingFriendRoomCreation && snapshot.connected && snapshot.roomStatus === 'idle' && !snapshot.roomId) {
      this.pendingFriendRoomCreation = false
      this.host.scheduleOnce(() => {
        if (!this.disposed && this.router.current === 'lobby' && this.lobby.snapshot.connected && !this.lobby.snapshot.roomId) {
          this.lobby.createRoom('玩家', this.friendRoomSettings)
        }
      }, 0)
    }
    const draftRoomCode = this.roomCodeInput?.string ?? ''
    const ui = this.router.open('lobby')
    this.roomCodeInput = null
    this.host.setFriendRoomWaitingVisible(Boolean(snapshot.roomId))
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
    ui.menuLabel(snapshot.error ?? connectionText, 0, 165, 19)
    if (snapshot.roomStatus === 'joining' && !snapshot.roomId) {
      ui.menuLabel('请稍候，正在等待服务器确认', 0, 105, 22)
      this.pageButton(ui, '取消进入', 30, () => this.lobby.leaveRoom())
    } else {
      this.pageButton(ui, '设置并创建好友房', 95, () => this.showFriendRoomSettings())
      this.pageButton(ui, '刷新房间列表', 35, () => this.lobby.refreshRooms())
      const input = ui.roomCodeInput(0, -28)
      this.roomCodeInput = input.getComponentInChildren(EditBox)
      if (this.roomCodeInput) this.roomCodeInput.string = draftRoomCode
      this.pageButton(ui, '加入输入的房间', -85, () => this.lobby.joinRoom(this.roomCodeInput?.string.trim() ?? ''))
      snapshot.rooms.slice(0, 3).forEach((room, index) => {
        this.pageButton(ui, `加入 ${room.hostName} 的房间 ${room.roomId}（${room.playerCount}/4）`, -140 - index * 48, () => this.lobby.joinRoom(room.roomId))
      })
    }
    this.pageButton(ui, '返回大厅', -210, () => { this.lobby.leaveRoom(); this.showMenu() })
  }

  private renderFriendTableLobby (ui: RuntimeUiFactory, snapshot: LobbySnapshot): void {
    const roomId = snapshot.roomId
    const myPlayerId = snapshot.myPlayerId
    if (!roomId || !myPlayerId) return
    const safeWidth = this.screen.safeSize().x
    const safeHeight = this.screen.safeSize().y
    const readyPlayers = new Set(snapshot.lobbyReadyPlayerIds ?? [])
    const bots = new Set(snapshot.botPlayerIds ?? [])
    const members = new Set(snapshot.members)
    const occupied = new Set<PlayerId>([...snapshot.members, ...(snapshot.botPlayerIds ?? [])])
    const host = myPlayerId === 'p1'
    const rules = snapshot.roomSettings
    this.compactButton(ui, '返回', this.screen.safeLeftX(54), this.screen.safeTopY(38), 74, 36, 17, () => this.lobby.leaveRoom())
    ui.outlinedLabel(`好友房 ${roomId}`, 0, this.screen.safeTopY(38), 28, {
      width: Math.min(330, safeWidth * 0.38), height: 42,
      color: new Color(255, 232, 139), outlineColor: new Color(41, 48, 35), outlineWidth: 4,
    })
    const ruleText = rules
      ? `${rules.rounds}局 · ${rules.scoring === 'double-4' ? '双下4分' : '双下3分'} · ${rules.scoreVisibility === 'live' ? '实时比分' : '结算比分'} · 首出${rules.turnSeconds}秒 · ${rules.trusteeSeconds ? `托管${rules.trusteeSeconds}秒` : '无托管'}`
      : '经典过A · 正在同步房间规则'
    ui.outlinedLabel(ruleText, 0, this.screen.safeTopY(73), 15, {
      width: Math.min(620, safeWidth * 0.7), height: 26,
      color: new Color(225, 239, 226), outlineColor: new Color(34, 61, 54), outlineWidth: 2,
    })
    if (snapshot.error) ui.outlinedLabel(snapshot.error, 0, this.screen.safeTopY(103), 15, {
      width: Math.min(620, safeWidth * 0.72), height: 28,
      color: new Color(255, 170, 139), outlineColor: new Color(72, 31, 27), outlineWidth: 2,
    })

    const ids: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
    const viewerIndex = ids.indexOf(myPlayerId)
    const ordered = ids.map((_, index) => ids[(viewerIndex + index) % ids.length])
    const sideX = Math.max(92, Math.min(118, safeWidth * 0.105))
    const seats = [
      new Vec3(0, this.screen.safeBottomY(74), 4),
      new Vec3(this.screen.safeRightX(sideX), 4, 4),
      new Vec3(-72, this.screen.safeTopY(126), 4),
      new Vec3(this.screen.safeLeftX(sideX), 4, 4),
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
        ui.outlinedLabel(`${display}${badge}`, 0, -18, 17, {
          parent: seat, width: 176, height: 26,
          color: isBot ? new Color(159, 234, 205) : new Color(255, 238, 174), outlineColor: new Color(37, 48, 37), outlineWidth: 2,
        })
        const removableBot = host && playerId !== 'p1' && isBot
        const kickableMember = host && playerId !== 'p1' && isMember && !readyPlayers.has(playerId)
        const seatStatus = removableBot ? '已准备 · 点击移除' : kickableMember ? '未准备 · 点击移出' : isBot || readyPlayers.has(playerId) ? '已准备' : '未准备'
        ui.outlinedLabel(seatStatus, 0, -42, 14, {
          parent: seat, width: 120, height: 22,
          color: isBot || readyPlayers.has(playerId) ? new Color(139, 239, 177) : new Color(236, 220, 201), outlineColor: new Color(30, 57, 48), outlineWidth: 2,
        })
        if (removableBot) ui.makeInteractive(seat, () => this.lobby.removeBot(playerId), 0.96)
        else if (kickableMember) ui.makeInteractive(seat, () => this.lobby.kickMember(playerId), 0.96)
        return
      }
      ui.outlinedLabel('+', 0, 24, 44, {
        parent: seat, width: 64, height: 64,
        color: new Color(230, 242, 221), outlineColor: new Color(37, 72, 61), outlineWidth: 3,
      })
      ui.outlinedLabel('空座位', 0, -18, 16, {
        parent: seat, width: 120, height: 24,
        color: new Color(230, 239, 225), outlineColor: new Color(37, 62, 55), outlineWidth: 2,
      })
      ui.outlinedLabel(host ? '设为机器人' : '等待加入', 0, -43, 14, { parent: seat, width: 132, height: 22, color: new Color(200, 218, 209), outlineWidth: 2 })
      if (host) ui.makeInteractive(seat, () => this.lobby.addBot(playerId), 0.96)
    })

    const isReady = readyPlayers.has(myPlayerId)
    const humansReady = snapshot.members.filter(playerId => !bots.has(playerId)).every(playerId => readyPlayers.has(playerId))
    const canStart = occupied.size === 4 && humansReady
    const actionY = safeHeight < 500 ? -8 : -36
    const readyX = host || snapshot.lobbyReadyRequired === false ? -108 : 0
    if (snapshot.lobbyReadyRequired !== false) {
      this.coloredButton(ui, isReady ? '取消准备' : '准备', host ? readyX : 0, actionY, 190, 44, 20, isReady ? new Color(78, 105, 102) : new Color(45, 157, 102), () => {
        if (isReady) this.lobby.cancelLobbyReady()
        else this.lobby.setLobbyReady()
      })
    }
    if (host && canStart) {
      this.coloredButton(ui, '开始游戏', 108, actionY, 190, 44, 20, new Color(222, 165, 50), () => this.lobby.startGame())
    } else {
      const emptyCount = Math.max(0, 4 - occupied.size)
      const status = emptyCount > 0
        ? host ? `还差 ${emptyCount} 个座位 · 可点击空座加入机器人` : `等待 ${emptyCount} 名牌友加入`
        : host ? '等待其他玩家准备' : '等待房主开始'
      ui.outlinedLabel(status, host ? 125 : 0, actionY, 15, {
        width: host ? Math.min(260, safeWidth * 0.31) : Math.min(420, safeWidth * 0.5), height: 30,
        color: new Color(247, 232, 185), outlineColor: new Color(46, 55, 40), outlineWidth: 2,
      })
    }
  }

  public hideAll (): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    this.invalidateMatchAttempt()
    this.stopSpectatorPolling(true)
    this.roomCodeInput = null
    this.router.clear()
  }

  public resize (width: number, height: number): void {
    this.router.resize(width, height)
    if (this.disposed) return
    if (this.router.current === 'menu') {
      const reopenRules = this.rulesDialogVisible
      this.renderMenuPage()
      if (reopenRules) this.showRulesDialog()
    }
    else if (this.router.current === 'lobby') this.renderLobby(this.lobby.snapshot)
    else if (this.router.current === 'effect-lab') this.showEffectLab(this.effectLabPage)
  }

  private readonly handleApplicationHide = (): void => {
    this.spectatorBackgrounded = true
    this.stopSpectatorPolling(false)
  }

  private readonly handleApplicationShow = (): void => {
    if (this.disposed) return
    this.spectatorBackgrounded = false
    const session = this.spectatorFeedSession
    if (!session || this.router.current !== 'spectator-feed' || (session.feed && shouldStopSpectatorPolling(session.feed))) return
    session.syncStatus = '已回到前台，正在同步最新公开进展…'
    this.renderSpectatorFeed(session)
    this.startSpectatorPolling(session)
  }

  public destroy (): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    this.invalidateMatchAttempt()
    game.off(Game.EVENT_HIDE, this.handleApplicationHide)
    game.off(Game.EVENT_SHOW, this.handleApplicationShow)
    this.stopSpectatorPolling(true)
    this.disposed = true
    this.roomCodeInput = null
    this.router.destroy()
  }

  private showMoreMenu (): void {
    const ui = this.router.open('more')
    ui.menuLabel('更多功能', 0, 220, 42)
    const entries: Array<[string, () => void]> = [
      ['游戏设置', () => this.showSettings()],
      ['延迟观战（实验）\n一键进入30秒示例', () => { this.showSpectatorDemo() }],
      ['快速开始·人机测试\n最高难度 · 三位策略机器人', () => this.startMasterBotTest()],
    ]
    if (this.host.listEffectLabFixtures().length) entries.push(['牌桌特效测试', () => this.openEffectLabTable()])
    entries.forEach(([label, action], index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      this.sizedButton(ui, label, column ? 165 : -165, 140 - row * 58, 280, 48, 19, action)
    })
    this.pageButton(ui, '返回大厅', -220, () => this.showMenu())
  }

  private startMasterBotTest (): void {
    this.host.startMasterBotTest()
  }

  /** Starts the deterministic table first, then mounts the development drawer above it. */
  public openEffectLabTable (): void {
    if (!this.host.listEffectLabFixtures().some(fixture => fixture.id === 'match-opening')) {
      this.host.showNotice('实验室不可用', '缺少固定测试牌局。')
      return
    }
    this.host.previewEffectLabFixture('match-opening', 'full')
    this.host.scheduleOnce(() => {
      if (!this.disposed) this.showEffectLab(0)
    }, 0)
  }

  /** Development/debug-only drawer. The table remains visible behind it. */
  public showEffectLab (page = 0): void {
    const fixtures = this.host.listEffectLabFixtures()
    if (!fixtures.length) { this.host.showNotice('实验室不可用', '正式构建不包含开发实验室。'); return }
    const safeWidth = this.screen.safeSize().x
    const safeHeight = this.screen.safeSize().y
    const compact = safeHeight < 650
    const pageSize = compact ? 3 : 4
    const pageCount = Math.max(1, Math.ceil(fixtures.length / pageSize))
    this.effectLabPage = Math.max(0, Math.min(pageCount - 1, page))
    const ui = this.router.open('effect-lab')
    const drawerWidth = Math.min(390, Math.max(340, safeWidth * (compact ? 0.46 : 0.36)))
    const drawerX = this.screen.safeRightX(drawerWidth / 2 + 8)
    const drawerTop = this.screen.safeTopY(8)
    const drawerBottom = this.screen.safeBottomY(8)
    const drawer = ui.panel('EffectLabDrawer', drawerX, (drawerTop + drawerBottom) / 2, drawerWidth, Math.max(1, drawerTop - drawerBottom), {
      fill: new Color(8, 29, 39, 247), stroke: new Color(215, 173, 70, 245), lineWidth: 2, radius: 8,
    })
    drawer.addComponent(BlockInputEvents)
    const top = this.screen.safeTopY(compact ? 30 : 48)
    ui.outlinedLabel('牌桌特效测试', drawerX, top, 25, {
      width: drawerWidth - 20, height: 36, color: new Color(255, 229, 139), outlineColor: new Color(45, 48, 35), outlineWidth: 3,
    })
    ui.outlinedLabel(`开发环境 · ${this.effectLabPage + 1}/${pageCount}`, drawerX, top - 31, 14, {
      width: drawerWidth - 20, height: 22, color: new Color(220, 235, 227), outlineColor: new Color(35, 57, 50), outlineWidth: 2,
    })
    const qualityWidth = (drawerWidth - 40) / 3
    ;(['full', 'reduced', 'off'] as const).forEach((quality, index) => {
      const labels: Record<EffectQuality, string> = { full: '完整', reduced: '精简', off: '关闭' }
      this.sizedButton(
        ui,
        `${labels[quality]}${this.effectLabQuality === quality ? ' ✓' : ''}`,
        drawerX + (index - 1) * (qualityWidth + 8),
        top - (compact ? 55 : 65),
        qualityWidth,
        compact ? 28 : 32,
        compact ? 14 : 15,
        () => { this.effectLabQuality = quality; this.showEffectLab(this.effectLabPage) },
      )
    })
    const fixtureStartY = top - (compact ? 88 : 108)
    const fixtureStep = compact ? 42 : 48
    fixtures.slice(this.effectLabPage * pageSize, (this.effectLabPage + 1) * pageSize).forEach((fixture, index) => {
      this.sizedButton(ui, `${fixture.label} · ${fixture.kind}\n${fixture.description}`, drawerX, fixtureStartY - index * fixtureStep, drawerWidth - 24, compact ? 35 : 40, compact ? 14 : 15, () => {
        this.host.previewEffectLabFixture(fixture.id, this.effectLabQuality)
        if (fixture.id === 'match-opening') this.host.scheduleOnce(() => this.showEffectLab(this.effectLabPage), 0)
      })
    })
    const navigationY = this.screen.safeBottomY(compact ? 72 : 78)
    const navigationWidth = (drawerWidth - 54) / 2
    if (this.effectLabPage > 0) {
      this.sizedButton(ui, '上一页', drawerX - (navigationWidth + 10) / 2, navigationY, navigationWidth, compact ? 30 : 34, 15, () => this.showEffectLab(this.effectLabPage - 1))
    }
    if (this.effectLabPage + 1 < pageCount) {
      this.sizedButton(ui, '下一页', drawerX + (navigationWidth + 10) / 2, navigationY, navigationWidth, compact ? 30 : 34, 15, () => this.showEffectLab(this.effectLabPage + 1))
    }
    this.sizedButton(ui, '结束测试', drawerX, this.screen.safeBottomY(compact ? 26 : 28), Math.min(190, drawerWidth - 40), compact ? 32 : 36, 16, () => this.showMenu())
  }

  private async showMerchantConsole (successMessage = ''): Promise<void> {
    if (this.disposed) return
    const token = ++this.pageRequestToken
    this.renderMerchantLoading(this.gateways.configured ? '正在同步商户权限与经营数据…' : '正在载入只读演示数据…')
    try {
      const merchantConsole = await this.gateways.merchant.getConsole()
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'merchant-console') return
      const status = successMessage || (this.gateways.configured ? '已同步平台商户数据' : '只读演示 · 未连接平台服务 · 不会提交任何写入')
      this.renderMerchantConsole(merchantConsole, status)
    } catch (error) {
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'merchant-console') return
      if (this.gateways.configured && error instanceof PlatformApiError && error.status === 403) {
        this.renderMerchantApplication('当前账号没有商户权限，可填写资料申请入驻。提交后需等待外部审核。')
        return
      }
      this.renderMerchantUnavailable(this.errorDetail(error, '商户后台暂时无法获取'))
    }
  }

  private renderMerchantLoading (status: string): void {
    const ui = this.router.open('merchant-console')
    ui.menuLabel('商户后台 · 技术预览', 0, 220, 40)
    ui.menuLabel(status, 0, 155, 20)
    this.pageButton(ui, '返回更多功能', -210, () => this.showMoreMenu())
  }

  private renderMerchantUnavailable (status: string): void {
    const ui = this.router.open('merchant-console')
    ui.menuLabel('商户后台 · 技术预览', 0, 220, 40)
    ui.menuLabel(status, 0, 125, 22)
    this.sizedButton(ui, '重新同步', -150, -65, 250, 48, 19, () => { void this.showMerchantConsole() })
    this.sizedButton(ui, '返回更多功能', 150, -65, 250, 48, 19, () => this.showMoreMenu())
  }

  private renderMerchantConsole (merchantConsole: MerchantConsole, status: string): void {
    const ui = this.router.open('merchant-console')
    const merchantStatus = this.merchantStatusText(merchantConsole.merchant.status)
    const role = this.merchantRoleText(merchantConsole.role)
    ui.menuLabel('商户后台 · 技术预览', 0, 225, 38)
    ui.menuLabel(status, 0, 187, 16)
    ui.menuLabel(`${merchantConsole.merchant.name} · ${merchantStatus} · 当前角色：${role}\n日发放限额 ${merchantConsole.merchant.dailyPointLimit} · 最近记录发放 ${merchantConsole.grantedPoints} 积分`, 0, 137, 21)

    if (merchantConsole.merchant.status !== 'active') {
      const detail = merchantConsole.merchant.status === 'pending'
        ? '申请已经提交，审核通过前不能创建门店、管理员工或发放积分。'
        : merchantConsole.merchant.status === 'rejected'
          ? '申请未通过；当前接口没有重新提交或申诉流程，请联系运营人员。'
          : '商户账户当前不可用，所有写入按钮已关闭。'
      ui.menuLabel(detail, 0, 45, 21)
      this.sizedButton(ui, '刷新审核状态', -150, -85, 250, 46, 18, () => { void this.showMerchantConsole() })
      this.sizedButton(ui, '返回更多功能', 150, -85, 250, 46, 18, () => this.showMoreMenu())
      return
    }

    const columnX = Math.min(300, Math.max(220, this.screen.safeSize().x * 0.24))
    const storeLines = merchantConsole.stores.slice(0, 3).map(store => `${store.status === 'active' ? '营业' : '停用'} · ${store.name}\n${store.address || '未填写地址'} · ${store.id}`).join('\n')
    const employeeLines = merchantConsole.employees.slice(0, 3).map(employee => `${employee.role === 'manager' ? '管理员' : '收银员'} · ${employee.userId} · ${employee.status === 'active' ? '启用' : '停用'}`).join('\n')
    ui.menuLabel(`门店（${merchantConsole.stores.length}）\n${storeLines || '暂无门店'}`, -columnX, 65, 17)
    ui.menuLabel(`员工（${merchantConsole.employees.length}）\n${employeeLines || '暂无员工'}`, columnX, 65, 17)
    const grantLines = merchantConsole.grants.slice(0, 2).map(grant => `${grant.amount} 积分 → ${grant.recipientUserId} · ${grant.note || '无备注'}`).join('\n')
    ui.menuLabel(`最近发放\n${grantLines || '暂无积分发放记录'}`, 0, -45, 17)

    if (!this.gateways.configured) {
      ui.menuLabel('以上均为合成演示数据；写入按钮仅在已配置平台并取得 active 权限后出现。', 0, -135, 17)
    } else {
      const actions: Array<[string, () => void]> = []
      if (merchantConsole.role === 'owner' || merchantConsole.role === 'manager') actions.push(['创建门店', () => this.showMerchantStoreForm(merchantConsole)])
      if (merchantConsole.role === 'owner') actions.push(['添加员工', () => this.showMerchantEmployeeForm(merchantConsole)])
      actions.push(['发放积分', () => this.showMerchantGrantForm(merchantConsole)])
      const actionGap = actions.length === 3 ? 260 : 300
      actions.forEach(([label, action], index) => {
        const x = (index - (actions.length - 1) / 2) * actionGap
        this.sizedButton(ui, label, x, -150, 220, 44, 18, action)
      })
    }
    this.sizedButton(ui, '刷新', -145, -218, 240, 44, 18, () => { void this.showMerchantConsole() })
    this.sizedButton(ui, '返回更多功能', 145, -218, 240, 44, 18, () => this.showMoreMenu())
  }

  private renderMerchantApplication (status: string): void {
    const ui = this.router.open('merchant-apply')
    ui.menuLabel('申请商户入驻', 0, 220, 39)
    ui.menuLabel(status, 0, 174, 17)
    ui.menuLabel('商户名称', 0, 122, 18)
    const nameInput = ui.formInput('MerchantNameInput', '输入商户名称', 0, 83, { width: 480, maxLength: 60 })
    ui.menuLabel('联系人（可选）', 0, 35, 18)
    const contactInput = ui.formInput('MerchantContactInput', '输入联系人姓名', 0, -4, { width: 480, maxLength: 40 })
    this.sizedButton(ui, '提交入驻申请', -150, -95, 250, 48, 19, () => {
      void this.submitMerchantApplication(nameInput.string, contactInput.string)
    })
    this.sizedButton(ui, '返回更多功能', 150, -95, 250, 48, 19, () => this.showMoreMenu())
    ui.menuLabel('提交只会创建 pending 申请；审核、撤回与申诉仍由运营系统处理。', 0, -165, 16)
  }

  private async submitMerchantApplication (name: string, contactName: string): Promise<void> {
    if (this.disposed || this.pendingMerchantAction) return
    const pageToken = this.pageRequestToken
    this.pendingMerchantAction = 'apply'
    try {
      await this.gateways.merchant.apply({ name, contactName })
      if (this.disposed || pageToken !== this.pageRequestToken || this.router.current !== 'merchant-apply') return
      void this.showMerchantConsole('入驻申请已提交 · 当前状态以平台返回为准')
    } catch (error) {
      if (!this.disposed && pageToken === this.pageRequestToken && this.router.current === 'merchant-apply') this.host.showNotice('商户申请失败', this.errorDetail(error, '请核对资料后重试'))
    } finally {
      if (this.pendingMerchantAction === 'apply') this.pendingMerchantAction = null
    }
  }

  private showMerchantStoreForm (_merchantConsole: MerchantConsole): void {
    if (this.disposed || !this.gateways.configured) return
    this.pageRequestToken += 1
    const ui = this.router.open('merchant-store')
    ui.menuLabel('创建门店', 0, 220, 39)
    ui.menuLabel('仅 active 的负责人或管理员可提交；重复响应会复用同一幂等键。', 0, 174, 17)
    ui.menuLabel('门店名称', 0, 122, 18)
    const nameInput = ui.formInput('MerchantStoreNameInput', '输入门店名称', 0, 83, { width: 500, maxLength: 60 })
    ui.menuLabel('门店地址（可选）', 0, 35, 18)
    const addressInput = ui.formInput('MerchantStoreAddressInput', '输入门店地址', 0, -4, { width: 620, maxLength: 120, fontSize: 19 })
    this.sizedButton(ui, '确认创建', -150, -100, 250, 48, 19, () => { void this.submitMerchantStore(nameInput.string, addressInput.string) })
    this.sizedButton(ui, '取消', 150, -100, 250, 48, 19, () => { void this.showMerchantConsole() })
  }

  private async submitMerchantStore (name: string, address: string): Promise<void> {
    if (this.disposed || this.pendingMerchantAction) return
    const pageToken = this.pageRequestToken
    this.pendingMerchantAction = 'store'
    try {
      await this.gateways.merchant.createStore({ name, address })
      if (this.disposed || pageToken !== this.pageRequestToken || this.router.current !== 'merchant-store') return
      void this.showMerchantConsole('门店创建成功 · 已重新同步商户数据')
    } catch (error) {
      if (!this.disposed && pageToken === this.pageRequestToken && this.router.current === 'merchant-store') this.host.showNotice('创建门店失败', this.errorDetail(error, '请核对门店资料后重试'))
    } finally {
      if (this.pendingMerchantAction === 'store') this.pendingMerchantAction = null
    }
  }

  private showMerchantEmployeeForm (_merchantConsole: MerchantConsole): void {
    if (this.disposed || !this.gateways.configured) return
    this.pageRequestToken += 1
    const ui = this.router.open('merchant-employee')
    let role: Exclude<MerchantRole, 'owner'> = 'cashier'
    ui.menuLabel('添加或更新员工', 0, 220, 39)
    ui.menuLabel('只有商户负责人可操作；请输入对方平台用户 ID，不会自动选择真实用户。', 0, 174, 17)
    ui.menuLabel('员工用户 ID', 0, 118, 18)
    const userInput = ui.formInput('MerchantEmployeeUserInput', '输入平台用户 ID', 0, 78, { width: 560, maxLength: 100, fontSize: 19 })
    const roleLabel = ui.menuLabel('当前角色：收银员', 0, 25, 18)
    this.sizedButton(ui, '收银员', -135, -20, 220, 44, 18, () => { role = 'cashier'; roleLabel.string = '当前角色：收银员' })
    this.sizedButton(ui, '管理员', 135, -20, 220, 44, 18, () => { role = 'manager'; roleLabel.string = '当前角色：管理员' })
    this.sizedButton(ui, '确认添加', -150, -100, 250, 48, 19, () => { void this.submitMerchantEmployee(userInput.string, role) })
    this.sizedButton(ui, '取消', 150, -100, 250, 48, 19, () => { void this.showMerchantConsole() })
  }

  private async submitMerchantEmployee (employeeUserId: string, role: Exclude<MerchantRole, 'owner'>): Promise<void> {
    if (this.disposed || this.pendingMerchantAction) return
    const pageToken = this.pageRequestToken
    this.pendingMerchantAction = 'employee'
    try {
      await this.gateways.merchant.addEmployee({ employeeUserId, role })
      if (this.disposed || pageToken !== this.pageRequestToken || this.router.current !== 'merchant-employee') return
      void this.showMerchantConsole('员工信息已更新 · 已重新同步商户数据')
    } catch (error) {
      if (!this.disposed && pageToken === this.pageRequestToken && this.router.current === 'merchant-employee') this.host.showNotice('添加员工失败', this.errorDetail(error, '请确认用户 ID 和操作权限'))
    } finally {
      if (this.pendingMerchantAction === 'employee') this.pendingMerchantAction = null
    }
  }

  private showMerchantGrantForm (merchantConsole: MerchantConsole): void {
    if (this.disposed || !this.gateways.configured) return
    const firstStore = merchantConsole.stores.find(store => store.status === 'active')
    if (!firstStore) { this.host.showNotice('暂时不能发放积分', '请先由负责人或管理员创建一个启用门店'); return }
    this.pageRequestToken += 1
    const ui = this.router.open('merchant-grant')
    const columnX = Math.min(270, Math.max(220, this.screen.safeSize().x * 0.22))
    ui.menuLabel('商户积分发放', 0, 220, 39)
    ui.menuLabel('每次提交都需明确门店、接收用户和积分数；不能向负责人或员工自发分。', 0, 174, 17)
    ui.menuLabel('门店 ID', -columnX, 125, 18)
    const storeInput = ui.formInput('MerchantGrantStoreInput', '输入门店 ID', -columnX, 86, { width: 420, maxLength: 100, fontSize: 17, initialValue: firstStore.id })
    ui.menuLabel('接收用户 ID', columnX, 125, 18)
    const recipientInput = ui.formInput('MerchantGrantRecipientInput', '输入平台用户 ID', columnX, 86, { width: 420, maxLength: 100, fontSize: 17 })
    ui.menuLabel('积分数（1—1000）', -columnX, 28, 18)
    const amountInput = ui.formInput('MerchantGrantAmountInput', '输入积分数', -columnX, -11, { width: 420, maxLength: 4, inputMode: EditBox.InputMode.NUMERIC })
    ui.menuLabel('备注（可选）', columnX, 28, 18)
    const noteInput = ui.formInput('MerchantGrantNoteInput', '输入发放备注', columnX, -11, { width: 420, maxLength: 80, fontSize: 18 })
    this.sizedButton(ui, '确认发放', -150, -105, 250, 48, 19, () => {
      void this.submitMerchantGrant(storeInput.string, recipientInput.string, Number(amountInput.string.trim()), noteInput.string)
    })
    this.sizedButton(ui, '取消', 150, -105, 250, 48, 19, () => { void this.showMerchantConsole() })
  }

  private async submitMerchantGrant (storeId: string, recipientUserId: string, amount: number, note: string): Promise<void> {
    if (this.disposed || this.pendingMerchantAction) return
    const pageToken = this.pageRequestToken
    this.pendingMerchantAction = 'grant'
    try {
      await this.gateways.merchant.grantPoints({ storeId, recipientUserId, amount, note })
      if (this.disposed || pageToken !== this.pageRequestToken || this.router.current !== 'merchant-grant') return
      void this.showMerchantConsole('积分发放成功 · 已重新同步最近记录')
    } catch (error) {
      if (!this.disposed && pageToken === this.pageRequestToken && this.router.current === 'merchant-grant') this.host.showNotice('积分发放失败', this.errorDetail(error, '请核对门店、接收用户和积分数'))
    } finally {
      if (this.pendingMerchantAction === 'grant') this.pendingMerchantAction = null
    }
  }

  private merchantStatusText (status: MerchantConsole['merchant']['status']): string {
    return status === 'active' ? '已启用' : status === 'pending' ? '审核中' : status === 'rejected' ? '未通过' : '已停用'
  }

  private merchantRoleText (role: MerchantRole): string {
    return role === 'owner' ? '负责人' : role === 'manager' ? '管理员' : '收银员'
  }

  private showCompetition (category: CompetitionCategory = this.competitionCategory): void {
    if (this.disposed) return
    this.invalidateMatchAttempt()
    this.competitionCategory = category
    const token = ++this.pageRequestToken
    const shouldRefresh = category === 'championship' && this.gateways.configured && this.tournamentDataState !== 'fresh'
    if (shouldRefresh) {
      this.tournamentDataState = 'loading'
      this.walletFresh = false
    }
    this.renderCompetition(shouldRefresh ? '正在同步赛事与积分…' : this.gateways.configured ? '赛事服务已连接' : '赛事模板与本地晋级演示')
    if (shouldRefresh) void this.refreshCompetition(token)
  }

  private renderCompetition (statusText: string): void {
    const ui = this.router.open('competition')
    const safeWidth = this.screen.safeSize().x
    const safeHeight = this.screen.safeSize().y
    const leftWidth = Math.min(195, Math.max(150, safeWidth * 0.17))
    const leftX = this.screen.safeLeftX(leftWidth / 2 + 14)
    const panelHeight = Math.min(520, safeHeight - 82)
    const contentLeft = leftX + leftWidth / 2 + 18
    const contentRight = this.screen.safeRightX(18)
    const contentWidth = Math.max(500, contentRight - contentLeft)
    const contentX = (contentLeft + contentRight) / 2
    ui.panel('CompetitionNavigation', leftX, -8, leftWidth, panelHeight, {
      fill: new Color(28, 47, 92, 224), stroke: new Color(157, 184, 238, 220), lineWidth: 2, radius: 6,
    })
    ui.outlinedLabel('赛事玩法', leftX, this.screen.safeTopY(94), Math.min(32, Math.max(26, safeHeight * 0.058)), {
      width: leftWidth, color: new Color(250, 241, 196), outlineColor: new Color(34, 46, 84), outlineWidth: 4,
    })
    const navGap = Math.min(64, (panelHeight - 66) / COMPETITION_CATEGORIES.length)
    COMPETITION_CATEGORIES.forEach((item, index) => {
      const active = item.id === this.competitionCategory
      const node = ui.button('CompetitionCategoryTab', `${item.badge}  ${item.label}`, leftX, leftWidth - 18, 46, Math.min(20, leftWidth * 0.115), {
        fill: active ? new Color(232, 195, 88, 248) : new Color(39, 65, 119, 235),
        pressedFill: new Color(204, 164, 65, 248),
        stroke: active ? new Color(255, 245, 190) : new Color(112, 145, 205, 200),
        textColor: active ? new Color(49, 48, 75) : new Color(238, 243, 255),
        radius: 5,
      })
      node.setPosition(new Vec3(leftX, panelHeight / 2 - 57 - index * navGap, 0))
      node.on(Node.EventType.TOUCH_END, () => this.showCompetition(item.id))
    })
    const heading = COMPETITION_CATEGORIES.find(item => item.id === this.competitionCategory)?.label ?? '锦标赛'
    ui.outlinedLabel(heading, contentX, this.screen.safeTopY(42), Math.min(34, Math.max(27, safeHeight * 0.06)), {
      width: contentWidth, color: new Color(255, 242, 182), outlineColor: new Color(37, 42, 74), outlineWidth: 4,
    })
    ui.outlinedLabel(statusText, contentX, this.screen.safeTopY(77), Math.min(17, Math.max(14, safeHeight * 0.03)), {
      width: contentWidth, color: new Color(231, 239, 255), outlineColor: new Color(37, 42, 74), outlineWidth: 2,
    })

    if (this.competitionCategory === 'championship') {
      const items = this.tournaments.slice(0, 6)
      if (!items.length) ui.outlinedLabel(this.tournamentDataState === 'empty' ? '当前没有可报名赛事' : '赛事目录暂时不可用', contentX, 0, 24, { width: contentWidth })
      const cadence = ['日赛', '周赛', '月赛', '日赛', '周赛', '月赛'] as const
      items.forEach((tournament, index) => {
        const schedule = cadence[index]
        const time = schedule === '日赛' ? '每日 12:30 / 20:30' : schedule === '周赛' ? '每周六 20:00' : '每月末周日 19:30'
        const capacity = tournament.capacity ?? 16
        const advance = tournament.advanceCount ?? Math.max(4, Math.floor(capacity / 2))
        const state = tournament.enrolled ? '已报名' : tournament.status === 'open' ? `${tournament.entryPoints}积分` : tournament.status === 'running' ? '进行中' : tournament.status === 'finished' ? '已结束' : '待开放'
        this.competitionCard(ui, contentLeft, contentRight, panelHeight, index, {
          badge: schedule.slice(0, 1),
          title: `${schedule} · ${tournament.name}`,
          detail: `${time}\n${capacity}人 · 前${advance}名晋级 · ${state}`,
          accent: index % 3 === 0 ? new Color(52, 148, 210) : index % 3 === 1 ? new Color(113, 91, 201) : new Color(51, 160, 128),
          action: () => { void this.selectTournament(tournament) },
        })
      })
    } else if (this.competitionCategory === 'mine') {
      const enrolled = this.tournaments.filter(item => item.enrolled)
      if (!enrolled.length) ui.outlinedLabel('暂无已报名或进行中的比赛', contentX, 10, 24, { width: contentWidth })
      enrolled.slice(0, 6).forEach((tournament, index) => this.competitionCard(ui, contentLeft, contentRight, panelHeight, index, {
        badge: '我', title: tournament.name, detail: `${tournament.description}\n已报名 · 查看赛程与排名`, accent: new Color(67, 139, 205), action: () => { void this.selectTournament(tournament) },
      }))
    } else {
      const templates = this.competitionTemplates(this.competitionCategory)
      templates.forEach((item, index) => this.competitionCard(ui, contentLeft, contentRight, panelHeight, index, {
        ...item,
        action: () => this.host.showNotice(item.title, item.notice),
      }))
    }
    this.compactButton(ui, '返回', this.screen.safeLeftX(58), this.screen.safeTopY(42), 76, 38, 18, () => this.showMenu())
  }

  private async refreshCompetition (token: number): Promise<void> {
    const [tournamentResult, walletResult] = await Promise.all([settle(this.gateways.tournaments.listTournaments()), settle(this.gateways.wallet.getWallet())])
    if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'competition') return
    if (tournamentResult.status === 'fulfilled') {
      this.tournaments = tournamentResult.value
      this.tournamentDataState = this.tournaments.length ? 'fresh' : 'empty'
    } else this.tournamentDataState = this.tournaments.length ? 'stale' : 'unavailable'
    if (walletResult.status === 'fulfilled') {
      this.wallet = walletResult.value
      this.walletFresh = true
    } else this.walletFresh = false
    const catalogText = tournamentResult.status === 'fulfilled'
      ? (this.tournaments.length ? '赛事已同步' : '暂无可报名赛事')
      : (this.tournaments.length ? '赛事同步失败，缓存仅供浏览' : '赛事服务暂时不可用')
    const walletText = this.walletFresh ? `当前 ${this.wallet.points} 积分` : '积分暂时无法确认'
    this.renderCompetition(`${catalogText} · ${walletText}`)
  }

  private async selectTournament (tournament: TournamentSummary): Promise<void> {
    if (this.disposed || this.pendingTournamentId) return
    if (tournament.status === 'scheduled') { this.host.showNotice('赛事尚未开放', '该赛事当前不在报名时间内'); return }
    if (tournament.status === 'finished' && tournament.format !== 'fixed16-latin-3') { this.host.showNotice('赛事已结束', '请查看赛事排名'); return }
    if (!this.gateways.configured) {
      if (tournament.format === 'fixed16-latin-3') void this.showTournamentFlow(tournament)
      else this.beginMatch(tournament.queueId, tournament.name, 'competition')
      return
    }
    if (this.tournamentDataState !== 'fresh' || !this.walletFresh) { this.host.showNotice('暂时无法报名', '请先刷新赛事与积分信息'); return }
    if (tournament.status === 'finished' && tournament.format === 'fixed16-latin-3') { void this.showTournamentFlow(tournament); return }
    if (tournament.status === 'running' && !tournament.enrolled) { this.host.showNotice('赛事已开赛', '未报名玩家不能中途加入'); return }
    const pageToken = this.pageRequestToken
    this.pendingTournamentId = tournament.id
    try {
      const enrolled = tournament.enrolled ? tournament : await this.gateways.tournaments.enroll(tournament.id, tournament.entryPoints)
      if (this.disposed || pageToken !== this.pageRequestToken || this.router.current !== 'competition') return
      this.tournaments = this.tournaments.map(item => item.id === enrolled.id ? enrolled : item)
      if (enrolled.format === 'fixed16-latin-3') void this.showTournamentFlow(enrolled)
      else this.beginMatch(enrolled.queueId, enrolled.name, 'competition')
    } catch (error) {
      if (!this.disposed && pageToken === this.pageRequestToken && this.router.current === 'competition') {
        this.host.showNotice('赛事报名失败', this.errorDetail(error, '请稍后重试'))
      }
    } finally {
      if (this.pendingTournamentId === tournament.id) this.pendingTournamentId = null
    }
  }

  private async showTournamentFlow (tournament: TournamentSummary): Promise<void> {
    if (this.disposed) return
    const token = ++this.pageRequestToken
    this.renderTournamentFlow(tournament, null, '正在同步检录与分桌状态…')
    try {
      const state = await this.gateways.tournaments.getState(tournament.id)
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'tournament-flow') return
      this.tournaments = this.tournaments.map(item => item.id === state.tournament.id ? state.tournament : item)
      this.renderTournamentFlow(state.tournament, state, this.gateways.configured ? '赛事状态已同步' : '固定16人演示状态')
    } catch (error) {
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'tournament-flow') return
      this.renderTournamentFlow(tournament, null, this.errorDetail(error, '赛事状态暂时无法获取'))
    }
  }

  private async checkInTournamentFlow (tournament: TournamentSummary): Promise<void> {
    if (this.disposed || this.pendingTournamentId) return
    const token = this.pageRequestToken
    this.pendingTournamentId = tournament.id
    this.renderTournamentFlow(tournament, null, '正在提交检录…')
    try {
      const state = await this.gateways.tournaments.checkIn(tournament.id)
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'tournament-flow') return
      this.tournaments = this.tournaments.map(item => item.id === state.tournament.id ? state.tournament : item)
      this.renderTournamentFlow(state.tournament, state, state.phase === 'round-active' ? '名单已锁定，牌桌已分配' : '检录成功，等待满员')
    } catch (error) {
      if (!this.disposed && token === this.pageRequestToken && this.router.current === 'tournament-flow') {
        this.renderTournamentFlow(tournament, null, this.errorDetail(error, '检录暂时失败'))
      }
    } finally {
      if (this.pendingTournamentId === tournament.id) this.pendingTournamentId = null
    }
  }

  private renderTournamentFlow (tournament: TournamentSummary, state: TournamentState | null, status: string): void {
    const ui = this.router.open('tournament-flow')
    ui.menuLabel(tournament.name, 0, 225, 40)
    ui.menuLabel(status, 0, 180, 18)
    if (!state) {
      ui.menuLabel('尚未取得检录、轮次和牌桌数据', 0, 75, 24)
      this.pageButton(ui, '重试', -75, () => { void this.showTournamentFlow(tournament) })
      this.pageButton(ui, '返回比赛场', -205, () => this.showCompetition())
      return
    }

    const phaseText = state.phase === 'check-in' ? '检录中' : state.phase === 'round-active' ? '本轮进行中' : state.phase === 'blocked' ? '赛事已暂停' : '赛事已结束'
    ui.menuLabel(`${phaseText} · 已检录 ${state.checkedInCount}/${state.capacity}`, 0, 128, 24)
    ui.menuLabel(`第 ${state.roundNumber}/${state.roundsTotal} 轮 · 本轮 ${state.tablesSettled}/${state.tablesTotal} 桌完成 · 前 ${state.cutoffRank} 名晋级`, 0, 88, 20)

    if (state.phase === 'check-in') {
      const detail = state.viewerEntry.checkedIn ? '你已完成检录，满16人后统一锁定三轮分桌。' : '报名成功后还需检录，检录不会重复扣除积分。'
      ui.menuLabel(detail, 0, 35, 20)
      if (!state.viewerEntry.checkedIn) this.sizedButton(ui, '完成检录', 0, -30, 280, 54, 22, () => { void this.checkInTournamentFlow(tournament) })
      else this.sizedButton(ui, '刷新满员进度', 0, -30, 280, 54, 22, () => { void this.showTournamentFlow(tournament) })
    } else if (state.phase === 'round-active') {
      if (state.assignment) {
        const assignmentText = state.assignment.status === 'completed' ? '本桌已完成' : state.assignment.status === 'matched' ? '牌桌已就绪' : state.assignment.status === 'blocked' ? '本桌异常' : '等待四名同桌玩家进入'
        ui.menuLabel(`你的分桌：第 ${state.assignment.tableNumber} 桌 · ${assignmentText}`, 0, 38, 22)
        if (['pending', 'matching', 'matched'].includes(state.assignment.status)) {
          this.sizedButton(ui, `进入第 ${state.assignment.roundNumber} 轮第 ${state.assignment.tableNumber} 桌`, 0, -35, 360, 56, 22, () => {
            this.beginMatch(tournament.queueId, tournament.name, 'competition', { tournamentId: tournament.id, assignmentId: state.assignment!.assignmentId })
          })
        } else this.sizedButton(ui, '刷新下一轮', 0, -35, 280, 54, 22, () => { void this.showTournamentFlow(tournament) })
      } else ui.menuLabel('当前没有分配给你的牌桌', 0, 30, 22)
    } else if (state.phase === 'blocked') {
      ui.menuLabel('本轮存在异常牌桌，所有桌停止推进；不会自动补赛或重复计分。', 0, 30, 20)
      this.sizedButton(ui, '刷新处理状态', 0, -35, 280, 54, 22, () => { void this.showTournamentFlow(tournament) })
    } else {
      const resultText = state.viewerStanding?.qualificationStatus === 'qualified' ? '你已晋级下一阶段' : state.viewerStanding?.qualificationStatus === 'eliminated' ? '本次未晋级' : '最终资格待确认'
      ui.menuLabel(`${resultText}${state.viewerStanding ? ` · 第 ${state.viewerStanding.rank} 名 · ${state.viewerStanding.points} 分` : ''}`, 0, 30, 24)
    }

    this.sizedButton(ui, '查看完整排名', -155, -120, 270, 50, 20, () => { void this.showTournamentStandings(tournament) })
    this.sizedButton(ui, '返回比赛场', 155, -120, 270, 50, 20, () => this.showCompetition())
  }

  private async showTournamentStandings (tournament: TournamentSummary): Promise<void> {
    if (this.disposed) return
    const token = ++this.pageRequestToken
    this.renderTournamentStandings(tournament, null, '正在同步赛事排名…')
    try {
      const standings = await this.gateways.tournaments.getStandings(tournament.id)
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'tournament-standings') return
      this.renderTournamentStandings(standings.tournament, standings, standings.standings.length ? '实时积分排名' : '暂无已完成对局')
    } catch (error) {
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'tournament-standings') return
      this.renderTournamentStandings(tournament, null, this.errorDetail(error, '排名暂时无法获取'))
    }
  }

  private renderTournamentStandings (tournament: TournamentSummary, result: TournamentStandings | null, status: string): void {
    const ui = this.router.open('tournament-standings')
    ui.menuLabel(tournament.name, 0, 220, 40)
    const roundText = tournament.roundsTotal ? `第 ${tournament.currentRound ?? 0}/${tournament.roundsTotal} 轮 · 前 ${result?.cutoffRank ?? tournament.advanceCount ?? 0} 名晋级` : '积分赛'
    ui.menuLabel(`${roundText} · ${status}`, 0, 172, 18)
    const visibleStandings = result?.standings.slice(0, 6) ?? []
    visibleStandings.forEach((standing, index) => {
      const mine = standing.userId === result?.viewerStanding?.userId
      const mark = mine ? (standing.qualificationStatus === 'qualified' ? '我 · 晋级' : standing.qualificationStatus === 'eliminated' ? '我 · 未晋级' : '我') : standing.qualificationStatus === 'qualified' ? '晋级' : ''
      ui.menuLabel(`${standing.rank}. ${standing.displayName}    ${standing.points}分    ${standing.played}场/${standing.wins}胜    ${mark}`, 0, 116 - index * 43, 20)
    })
    if (result?.viewerStanding && !visibleStandings.some(item => item.userId === result.viewerStanding?.userId)) {
      const mine = result.viewerStanding
      const mark = mine.qualificationStatus === 'qualified' ? '我 · 晋级' : mine.qualificationStatus === 'eliminated' ? '我 · 未晋级' : '我'
      ui.menuLabel(`我的排名：${mine.rank}. ${mine.displayName}    ${mine.points}分    ${mine.played}场/${mine.wins}胜    ${mark}`, 0, -145, 19)
    }
    this.pageButton(ui, '返回比赛场', -205, () => this.showCompetition())
  }

  private async showPlayerCenter (): Promise<void> {
    if (this.disposed) return
    const token = ++this.pageRequestToken
    this.renderPlayerCenter(null, '正在同步个人数据…')
    const [dashboardResult, walletResult] = await Promise.all([
      settle(this.gateways.playerCenter.getDashboard()),
      settle(this.gateways.wallet.getWallet()),
    ])
    if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'player-center') return
    if (walletResult.status === 'fulfilled') {
      this.wallet = walletResult.value
      this.walletFresh = true
    } else this.walletFresh = false
    if (dashboardResult.status === 'rejected') {
      this.renderPlayerCenter(null, this.errorDetail(dashboardResult.reason, '个人数据暂时无法获取'))
      return
    }
    this.playerDashboard = dashboardResult.value
    const walletStatus = walletResult.status === 'fulfilled' ? '' : ' · 积分暂时无法同步'
    this.renderPlayerCenter(dashboardResult.value, `${this.gateways.configured ? '已同步平台数据' : '开发演示数据'}${walletStatus}`)
  }

  private renderPlayerCenter (dashboard: PlayerDashboard | null, status: string): void {
    const ui = this.router.open('player-center')
    ui.menuLabel('个人中心', 0, 220, 42)
    ui.menuLabel(status, 0, 174, 18)
    if (dashboard) {
      const games = Math.max(0, dashboard.rating.games)
      const wins = Math.max(0, dashboard.rating.wins)
      const winRate = games ? Math.round(wins * 100 / games) : 0
      const season = dashboard.season ? `${dashboard.season.name}  ${dashboard.season.progress.score}分 · ${dashboard.season.progress.gamesPlayed}场` : '暂无赛季'
      const points = this.walletFresh ? String(Math.max(0, Math.round(this.wallet.points))) : '--'
      ui.menuLabel(`${dashboard.user.displayName}    账号 ${dashboard.user.accountId}\n积分  ${points}    综合分  ${Math.round(dashboard.rating.comprehensiveScore)}\n总场数  ${games}    胜率  ${winRate}%    头游  ${dashboard.stats.firstPlaceFinishes}\n${season}`, 0, 86, 23)
    }
    this.sizedButton(ui, '赛季任务', -150, -70, 250, 48, 19, () => { void this.showSeasonTasks() })
    this.sizedButton(ui, '我的牌谱', 150, -70, 250, 48, 19, () => { void this.showReplayList() })
    this.pageButton(ui, '返回大厅', -145, () => this.showMenu())
  }

  private async showSeasonTasks (): Promise<void> {
    if (this.disposed) return
    const token = ++this.pageRequestToken
    this.renderSeasonTasks(null, '正在同步赛季任务…')
    try {
      const taskList = await this.gateways.seasons.listTasks()
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'season-tasks') return
      this.renderSeasonTasks(taskList, this.gateways.configured ? '任务进度已同步' : '开发演示 · 仅展示任务样式与进度')
    } catch (error) {
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'season-tasks') return
      this.renderSeasonTasks(null, this.errorDetail(error, '赛季任务暂时无法获取'))
    }
  }

  private renderSeasonTasks (taskList: SeasonTaskList | null, status: string): void {
    const ui = this.router.open('season-tasks')
    ui.menuLabel(taskList?.season?.name ?? '赛季任务', 0, 220, 42)
    ui.menuLabel(status, 0, 174, 18)
    taskList?.tasks.slice(0, 5).forEach((task, index) => {
      const claimable = this.gateways.configured && task.completed && !task.claimed
      const state = task.claimed ? '已领取' : claimable ? '可领取' : task.completed ? '演示完成' : `${Math.min(task.progress, task.target)}/${task.target}`
      const label = `${task.name}    +${task.rewardPoints}积分    ${state}`
      if (claimable) this.sizedButton(ui, label, 0, 115 - index * 55, 560, 45, 19, () => { void this.claimSeasonTask(task.id) })
      else ui.menuLabel(label, 0, 115 - index * 55, 19)
    })
    this.pageButton(ui, '返回个人中心', -205, () => { void this.showPlayerCenter() })
  }

  private async claimSeasonTask (taskId: string): Promise<void> {
    if (this.disposed || !this.gateways.configured || this.pendingSeasonTaskId) return
    const token = this.pageRequestToken
    this.pendingSeasonTaskId = taskId
    try {
      await this.gateways.seasons.claim(taskId)
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'season-tasks') return
      this.host.showNotice('领取成功', '奖励积分已入账。')
      await this.showSeasonTasks()
    } catch (error) {
      if (!this.disposed && token === this.pageRequestToken && this.router.current === 'season-tasks') this.host.showNotice('暂时无法领取', this.errorDetail(error, '请稍后重试'))
    } finally { if (this.pendingSeasonTaskId === taskId) this.pendingSeasonTaskId = null }
  }

  private async showReplayList (): Promise<void> {
    if (this.disposed) return
    const token = ++this.pageRequestToken
    this.renderReplayList([], '正在同步牌谱…')
    try {
      const replays = await this.gateways.replays.list()
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'replay-list') return
      const status = this.gateways.configured
        ? replays.length ? '最近完成的对局' : '暂无牌谱'
        : replays.length ? '开发模拟牌谱 · 不代表真实战绩' : '开发模拟牌谱 · 暂无记录'
      this.renderReplayList(replays, status)
    } catch (error) {
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'replay-list') return
      this.renderReplayList([], this.errorDetail(error, '牌谱暂时无法获取'))
    }
  }

  private async showSpectatorList (): Promise<void> {
    if (this.disposed) return
    const token = ++this.pageRequestToken
    this.renderSpectatorList([], `${this.gateways.configured ? '' : '开发模拟观战 · '}正在同步公开牌桌…`)
    try {
      const matches = await this.gateways.spectator.list(30)
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'spectator-list') return
      const status = matches.length ? '运行中、已结束与已终止牌桌 · 公开进程延迟 30 秒' : '暂无公开牌桌'
      this.renderSpectatorList(matches, `${this.gateways.configured ? '' : '开发模拟观战 · '}${status}`)
    } catch (error) {
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'spectator-list') return
      this.renderSpectatorList([], this.errorDetail(error, '观战列表暂时无法获取'))
    }
  }

  private showSpectatorDemo (): void {
    void this.showSpectatorFeed('demo-live-match', this.spectatorDemoGateway, true)
  }

  private renderSpectatorList (matches: SpectatorMatchSummary[], status: string): void {
    const ui = this.router.open('spectator-list')
    ui.menuLabel('延迟观战（实验）', 0, 220, 42)
    ui.menuLabel(status, 0, 174, 18)
    matches.slice(0, 4).forEach((match, index) => {
      const state = match.status === 'running'
        ? `进行中 · 已公开${match.availableEventCount}条`
        : match.status === 'aborted'
          ? match.timelineComplete ? `已终止 · ${match.totalEventCount}条完整记录` : '已终止 · 最后进程延迟中'
          : match.timelineComplete ? `已结束 · ${match.totalEventCount}条完整记录` : `已结束 · 最后进程延迟中`
      const time = new Date(match.startedAt).toLocaleString()
      this.sizedButton(ui, `${match.tableLabel}    ${state}\n${time} · 延迟${match.delaySeconds}秒`, 0, 105 - index * 67, 600, 56, 18, () => { void this.showSpectatorFeed(match.matchId) })
    })
    this.pageButton(ui, '返回更多功能', -205, () => this.showMoreMenu())
  }

  private renderReplayList (replays: ReplaySummary[], status: string): void {
    const ui = this.router.open('replay-list')
    ui.menuLabel('我的牌谱', 0, 220, 42)
    ui.menuLabel(status, 0, 174, 18)
    replays.slice(0, 4).forEach((replay, index) => {
      const time = new Date(replay.finishedAt).toLocaleString()
      this.sizedButton(ui, `房间 ${replay.roomId || '-'}    ${time}\n${replay.ranking.join(' > ')}    ${replay.eventCount}条事件`, 0, 105 - index * 67, 600, 56, 18, () => {
        void this.showReplayDetail(replay.id)
      })
    })
    this.pageButton(ui, '返回个人中心', -205, () => { void this.showPlayerCenter() })
  }

  private async showReplayDetail (replayId: string, returnPage: 'replay-list' | 'player-center' = 'replay-list'): Promise<void> {
    if (this.disposed) return
    this.replayPlaybackToken += 1
    const token = ++this.pageRequestToken
    this.renderReplayDetail(null, '正在读取牌谱…', returnPage)
    try {
      const replay = await this.gateways.replays.get(replayId)
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'replay-detail') return
      const status = `${this.gateways.configured ? '' : '开发模拟牌谱 · '}仅复原公开动作，不包含任何隐藏手牌`
      this.renderReplayDetail(replay, status, returnPage, new ReplayTimeline(replay.events))
    } catch (error) {
      if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'replay-detail') return
      this.renderReplayDetail(null, this.errorDetail(error, '牌谱读取失败'), returnPage)
    }
  }

  private renderReplayDetail (
    replay: ReplayDetail | null,
    status: string,
    returnPage: 'replay-list' | 'player-center',
    timeline?: ReplayTimeline,
  ): void {
    const ui = this.router.open('replay-detail')
    ui.menuLabel('牌谱回放', 0, 300, 40)
    ui.menuLabel(status, 0, 262, 16)
    if (replay && timeline) {
      ui.menuLabel(`房间 ${replay.roomId || '-'} · 胜方 ${replay.winnerTeam || '-'} · 名次 ${replay.ranking.join(' > ')}`, 0, 225, 18)
      renderReplayBoard(ui, timeline.state, replay.participants)
      this.renderReplayControls(ui, timeline, () => this.renderReplayDetail(replay, status, returnPage, timeline))
    }
    this.sizedButton(ui, returnPage === 'player-center' ? '返回个人中心' : '返回牌谱', 0, -310, 220, 40, 17, () => {
      timeline?.pause()
      this.replayPlaybackToken += 1
      if (returnPage === 'player-center') void this.showPlayerCenter()
      else void this.showReplayList()
    })
  }

  private async showSpectatorFeed (
    matchId: string,
    gateway: SpectatorGateway = this.gateways.spectator,
    isDemo = false,
  ): Promise<void> {
    if (!matchId) { this.host.showNotice('无法观战', '该对局没有联机比赛 ID。'); return }
    this.stopSpectatorPolling(true)
    this.replayPlaybackToken += 1
    this.pageRequestToken += 1
    const session: SpectatorFeedSession = {
      matchId,
      gateway,
      isDemo,
      timeline: new ReplayTimeline(),
      feed: null,
      syncStatus: `${isDemo ? '固定演示数据 · ' : this.gateways.configured ? '' : '开发模拟观战 · '}正在读取延迟 30 秒的公开进程并建立自动追帧…`,
      consecutiveFailures: 0,
    }
    this.spectatorFeedSession = session
    this.renderSpectatorFeed(session)
    this.startSpectatorPolling(session)
  }

  private startSpectatorPolling (session: SpectatorFeedSession): void {
    if (this.disposed || this.spectatorBackgrounded || this.router.current !== 'spectator-feed' || this.spectatorFeedSession !== session) return
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
    this.host.scheduleOnce(() => {
      if (this.isCurrentSpectatorPoll(session, token)) void this.pollSpectatorFeed(session, token)
    }, delaySeconds)
  }

  private isCurrentSpectatorPoll (session: SpectatorFeedSession, token: number): boolean {
    return !this.disposed && !this.spectatorBackgrounded && token === this.spectatorPollingToken && this.spectatorFeedSession === session && this.router.current === 'spectator-feed'
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

  private renderSpectatorFeed (session: SpectatorFeedSession): void {
    const { feed, timeline } = session
    const ui = this.router.open('spectator-feed')
    const source = session.isDemo ? '示例 · ' : this.gateways.configured ? '' : '模拟 · '
    ui.menuLabel(`${source}${feed?.tableLabel ?? '延迟观战'} · 延迟 ${feed?.delaySeconds ?? 30} 秒`, 0, 300, 36)
    const state = !feed
      ? '正在建立公开时间线'
      : feed.status === 'running'
        ? `对局进行中 · 当前公开 ${timeline.eventCount}/${feed.totalEventCount} 条`
        : feed.status === 'aborted'
          ? feed.timelineComplete ? `牌桌已终止 · ${feed.abortReason ?? '安全退出'}` : '牌桌已终止 · 最后进程延迟中'
          : feed.timelineComplete ? '对局已结束 · 时间线完整' : '对局已结束 · 最后进程延迟中'
    ui.menuLabel(`${state} · 不展示任何隐藏手牌`, 0, 258, 16)
    ui.menuLabel(session.syncStatus, 0, 228, 14)
    renderReplayBoard(ui, timeline.state)
    this.renderReplayControls(ui, timeline, () => this.renderSpectatorFeed(session))
    if (timeline.newerEventCount > 0) {
      this.sizedButton(ui, `有新进展 ${timeline.newerEventCount} 条 · 回到最新`, 0, -282, 310, 30, 14, () => {
        timeline.pause()
        this.replayPlaybackToken += 1
        timeline.toEnd()
        session.syncStatus = `已回到最新 · 自动追帧中 · 每 ${SPECTATOR_POLL_INTERVAL_SECONDS} 秒检查`
        this.renderSpectatorFeed(session)
      })
    }
    if (session.isDemo) {
      this.sizedButton(ui, '公开牌桌', -125, -326, 210, 38, 17, () => {
        timeline.pause()
        this.replayPlaybackToken += 1
        void this.showSpectatorList()
      })
      this.sizedButton(ui, '结束示例', 125, -326, 210, 38, 17, () => {
        timeline.pause()
        this.replayPlaybackToken += 1
        this.showMoreMenu()
      })
    } else {
      this.sizedButton(ui, '返回观战列表', 0, -326, 230, 38, 17, () => {
        timeline.pause()
        this.replayPlaybackToken += 1
        void this.showSpectatorList()
      })
    }
  }

  private renderReplayControls (ui: RuntimeUiFactory, timeline: ReplayTimeline, rerender: () => void): void {
    const event = timeline.currentEvent
    const round = timeline.state.roundSequence ? `第 ${timeline.state.roundSequence} 局 · ` : ''
    const progress = timeline.eventCount ? `${timeline.cursor + 1}/${timeline.eventCount}` : '0/0'
    const actor = event?.playerId ? ` · ${event.playerId.toUpperCase()}` : ''
    ui.menuLabel(`${round}公开事件 ${progress} · ${event?.type ?? '暂无'}${actor}`, 0, -172, 15)

    ;([0, 0.25, 0.5, 0.75, 1] as const).forEach((ratio, index) => {
      this.sizedButton(ui, `${Math.round(ratio * 100)}%`, -176 + index * 88, -204, 72, 28, 13, () => {
        timeline.pause()
        this.replayPlaybackToken += 1
        timeline.seekRatio(ratio)
        rerender()
      })
    })
    this.sizedButton(ui, '上一条', -146, -244, 118, 34, 15, () => {
      timeline.pause()
      this.replayPlaybackToken += 1
      timeline.previous()
      rerender()
    })
    this.sizedButton(ui, timeline.isPlaying ? '暂停' : '播放', 0, -244, 118, 34, 15, () => this.toggleReplayPlayback(timeline, rerender))
    this.sizedButton(ui, '下一条', 146, -244, 118, 34, 15, () => {
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
      if (this.disposed || token !== this.replayPlaybackToken || !timeline.isPlaying || !['replay-detail', 'spectator-feed'].includes(this.router.current ?? '')) return
      const moved = timeline.next()
      if (!moved || timeline.cursor >= timeline.eventCount - 1) timeline.pause()
      rerender()
      if (timeline.isPlaying) this.host.scheduleOnce(advance, 0.8)
    }
    this.host.scheduleOnce(advance, 0.8)
  }

  private beginMatch (
    queueId: MatchQueueId,
    queueName: string,
    returnPage: MatchReturnPage,
    assignment?: { tournamentId: string, assignmentId: string },
  ): void {
    this.invalidateMatchAttempt()
    const token = this.matchAttemptToken
    const ui = this.router.open('matching')
    ui.menuLabel('正在匹配', 0, 185, 44)
    this.matchingStartedAt = Date.now()
    this.matchingQueueName = queueName
    this.matchingStage = 'requesting'
    this.matchingStatusLabel = ui.menuLabel('', 0, -5, 22)
    this.refreshMatchingWaitLabel()
    this.scheduleMatchingWaitTick(token)
    this.createMatchingShuffle(ui)
    this.pageButton(ui, '取消匹配', -105, () => {
      this.showMatchReturnPage(returnPage)
    })
    this.host.scheduleOnce(() => { void this.requestMatch(queueId, token, returnPage, assignment) }, 0.65)
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
    assignment?: { tournamentId: string, assignmentId: string },
  ): Promise<void> {
    if (this.disposed || token !== this.matchAttemptToken || this.router.current !== 'matching') return
    try {
      const ticket = await this.gateways.matchmaking.joinQueue(queueId, assignment)
      if (this.disposed || token !== this.matchAttemptToken || this.router.current !== 'matching') {
        void this.reconcileStaleMatch(ticket)
        return
      }
      this.activeMatchTicketId = ticket.ticketId
      this.matchingStage = 'queued'
      this.refreshMatchingWaitLabel()
      this.acceptMatchTicket(ticket, token, returnPage)
    } catch (error) {
      if (this.disposed || token !== this.matchAttemptToken) return
      this.showMatchReturnPage(returnPage)
      this.host.showNotice('比赛匹配失败', this.matchErrorDetail(error))
    }
  }

  private acceptMatchTicket (ticket: MatchTicket, token: number, returnPage: MatchReturnPage): void {
    if (this.disposed || token !== this.matchAttemptToken || this.router.current !== 'matching') return
    if (ticket.status === 'matched') {
      const usable = this.isUsableMatchTicket(ticket)
      this.activeMatchTicketId = null
      if (usable) {
        this.reconciledMatchIds.add(ticket.ticketId)
        this.host.enterMatchedGame(ticket)
        return
      }
      void this.gateways.matchmaking.cancel(ticket.ticketId).catch(() => undefined)
      this.showMatchReturnPage(returnPage)
      this.host.showNotice('比赛匹配失败', '匹配服务返回的房间凭证不完整或已过期')
      return
    }
    if (ticket.status === 'cancelled') {
      this.showMatchReturnPage(returnPage)
      return
    }
    this.host.scheduleOnce(() => { void this.pollMatch(ticket.ticketId, token, returnPage) }, 1)
  }

  private async pollMatch (ticketId: string, token: number, returnPage: MatchReturnPage): Promise<void> {
    if (this.disposed || token !== this.matchAttemptToken || this.router.current !== 'matching' || this.activeMatchTicketId !== ticketId) return
    try {
      const ticket = await this.gateways.matchmaking.getStatus(ticketId)
      if (this.disposed || token !== this.matchAttemptToken || this.router.current !== 'matching' || this.activeMatchTicketId !== ticketId) {
        void this.reconcileStaleMatch(ticket)
        return
      }
      this.acceptMatchTicket(ticket, token, returnPage)
    } catch (error) {
      if (this.disposed || token !== this.matchAttemptToken) return
      this.showMatchReturnPage(returnPage)
      this.host.showNotice('比赛匹配失败', this.matchErrorDetail(error))
    }
  }

  private showMatchReturnPage (returnPage: MatchReturnPage): void {
    if (returnPage === 'menu') this.showMenu()
    else if (returnPage === 'competition') this.showCompetition()
    else if (returnPage === 'classic-rooms') this.showClassicRooms()
    else this.showOnlinePlay()
  }

  private invalidateMatchAttempt (): void {
    this.matchAttemptToken += 1
    const ticketId = this.activeMatchTicketId
    this.activeMatchTicketId = null
    this.matchingStatusLabel = null
    this.matchingStartedAt = 0
    this.matchingQueueName = ''
    this.matchingStage = 'requesting'
    if (ticketId) void this.cancelOrRecoverAssignedMatch(ticketId)
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
    this.host.scheduleOnce(() => {
      if (this.disposed || token !== this.matchAttemptToken || this.router.current !== 'matching') return
      this.refreshMatchingWaitLabel()
      this.scheduleMatchingWaitTick(token)
    }, 1)
  }

  private async reconcileStaleMatch (ticket: MatchTicket): Promise<void> {
    if (!ticket.ticketId || this.reconciledMatchIds.has(ticket.ticketId)) return
    if (ticket.status === 'matched') {
      if (this.isUsableMatchTicket(ticket) && !this.disposed) {
        this.reconciledMatchIds.add(ticket.ticketId)
        this.host.showNotice('匹配已完成', '取消请求到达时牌桌已分配，正在进入对局')
        this.host.enterMatchedGame(ticket)
      } else await this.gateways.matchmaking.cancel(ticket.ticketId).catch(() => undefined)
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
      await this.gateways.matchmaking.cancel(ticketId)
      this.reconciledMatchIds.add(ticketId)
      return
    } catch {
      // The queue may have crossed from matching to assigned while the cancel
      // request was in flight. Always reconcile once instead of silently
      // stranding the other three players.
    }
    try {
      const current = await this.gateways.matchmaking.getStatus(ticketId)
      if (current.status === 'matched' && this.isUsableMatchTicket(current) && !this.disposed) {
        this.reconciledMatchIds.add(ticketId)
        this.host.showNotice('匹配已完成', '取消请求到达时牌桌已分配，正在进入对局')
        this.host.enterMatchedGame(current)
      } else if (current.status === 'cancelled') this.reconciledMatchIds.add(ticketId)
      else await this.gateways.matchmaking.cancel(ticketId).then(() => this.reconciledMatchIds.add(ticketId)).catch(() => undefined)
    } catch {
      // A later explicit queue entry will query the server's active match and
      // reconcile it; never treat an uncertain cancel as confirmed locally.
    }
  }

  private isUsableMatchTicket (ticket: MatchTicket): boolean {
    return Boolean(ticket.ticketId && ticket.status === 'matched' && ticket.roomId && ticket.gameEndpoint && ticket.joinToken && ticket.seat && (!ticket.expiresAt || ticket.expiresAt > Date.now()))
  }

  private showShop (): void {
    if (this.disposed) return
    const token = ++this.pageRequestToken
    this.host.setTableVisible(false)
    if (this.gateways.configured) {
      this.productDataState = 'loading'
      this.walletFresh = false
    }
    this.renderShop(this.gateways.configured ? '正在同步商品和积分…' : '示例商品 · 兑换接口开发中')
    if (this.gateways.configured) void this.refreshShop(token)
  }

  private renderShop (statusText: string): void {
    const ui = this.router.open('shop')
    ui.menuLabel('积分生活商城', 0, 225, 44)
    ui.menuLabel(statusText, 0, 175, 18)
    const safeWidth = this.screen.safeSize().x
    const cardWidth = Math.min(220, Math.max(150, (safeWidth - 120) / 4))
    const gap = Math.min(22, Math.max(10, (safeWidth - cardWidth * 4) / 5))
    this.products.slice(0, 8).forEach((product, index) => {
      const column = index % 4
      const row = Math.floor(index / 4)
      const x = (column - 1.5) * (cardWidth + gap)
      const y = 75 - row * 130
      const stockText = product.stock > 0 ? `库存${product.stock}` : '已售罄'
      this.sizedButton(ui, `${product.category} · ${product.name}\n${product.pointsPrice}积分 · ${stockText}`, x, y, cardWidth, 106, 18, () => this.showProduct(product))
    })
    if (!this.products.length) ui.menuLabel(this.productDataState === 'empty' ? '当前没有可兑换商品' : '商品目录暂时不可用', 0, 45, 24)
    this.pageButton(ui, '返回大厅', -205, () => this.showMenu())
  }

  private async refreshShop (token: number): Promise<void> {
    const [productResult, walletResult] = await Promise.all([settle(this.gateways.shop.listProducts()), settle(this.gateways.wallet.getWallet())])
    if (this.disposed || token !== this.pageRequestToken || this.router.current !== 'shop') return
    if (productResult.status === 'fulfilled') {
      this.products = productResult.value
      this.productDataState = this.products.length ? 'fresh' : 'empty'
    } else this.productDataState = this.products.length ? 'stale' : 'unavailable'
    if (walletResult.status === 'fulfilled') {
      this.wallet = walletResult.value
      this.walletFresh = true
    } else this.walletFresh = false
    const catalogText = productResult.status === 'fulfilled'
      ? (this.products.length ? '商品已同步' : '暂无可兑换商品')
      : (this.products.length ? '商品同步失败，缓存仅供浏览' : '商城服务暂时不可用')
    const walletText = this.walletFresh ? `当前 ${this.wallet.points} 积分` : '积分暂时无法确认'
    this.renderShop(`${catalogText} · ${walletText}`)
  }

  private showProduct (product: ShopProduct): void {
    if (this.disposed) return
    this.pageRequestToken += 1
    const ui = this.router.open('product')
    ui.menuLabel(product.name, 0, 175, 42)
    ui.menuLabel(`${product.category}\n${product.description}\n${product.pointsPrice} 积分 · 库存 ${product.stock}`, 0, 65, 23)
    const canRedeem = this.gateways.configured && this.productDataState === 'fresh' && this.walletFresh && product.stock > 0
    const actionText = !this.gateways.configured ? '立即兑换 · 开发中' : product.stock <= 0 ? '商品已售罄' : canRedeem ? '立即兑换' : '刷新后兑换'
    this.pageButton(ui, actionText, -45, () => {
      if (canRedeem) void this.purchaseProduct(product)
      else this.host.showNotice('暂时无法兑换', this.gateways.configured ? '请返回商城刷新商品、库存与积分信息' : '商城后端接口正在开发中')
    })
    this.pageButton(ui, '返回商城', -120, () => this.showShop())
  }

  private async purchaseProduct (product: ShopProduct): Promise<void> {
    if (this.disposed || this.pendingProductId) return
    const pageToken = this.pageRequestToken
    this.pendingProductId = product.id
    try {
      await this.gateways.shop.createOrder(product.id, 1, product.pointsPrice)
      if (this.disposed || pageToken !== this.pageRequestToken || this.router.current !== 'product') return
      const [wallet, products] = await Promise.all([this.gateways.wallet.getWallet(), this.gateways.shop.listProducts()])
      if (this.disposed || pageToken !== this.pageRequestToken || this.router.current !== 'product') return
      this.wallet = wallet
      this.products = products
      this.showShop()
    } catch (error) {
      if (!this.disposed && pageToken === this.pageRequestToken && this.router.current === 'product') {
        this.host.showNotice('商城兑换失败', this.errorDetail(error, '请稍后重试'))
      }
    } finally {
      if (this.pendingProductId === product.id) this.pendingProductId = null
    }
  }

  private showRulesDialog (): void {
    this.rulesDialogVisible = true
    this.rulesPage = Math.max(0, Math.min(RULE_PAGES.length - 1, this.rulesPage))
    const rule = RULE_PAGES[this.rulesPage]
    const ui = this.router.openModal('rules')
    const safeWidth = this.screen.safeSize().x
    const safeHeight = this.screen.safeSize().y
    const centerX = (this.screen.safeLeftX() + this.screen.safeRightX()) / 2
    const centerY = (this.screen.safeBottomY() + this.screen.safeTopY()) / 2
    const modalWidth = Math.min(790, safeWidth - 42)
    const modalHeight = Math.min(510, safeHeight - 34)
    const compact = modalHeight < 430

    const shade = ui.panel('RulesModalShade', 0, 0, this.screen.viewport.width, this.screen.viewport.height, {
      fill: new Color(0, 4, 7, 168), lineWidth: 0, radius: 0,
    })
    shade.addComponent(BlockInputEvents)
    const modal = ui.panel('RulesModal', centerX, centerY, modalWidth, modalHeight, {
      fill: new Color(12, 34, 31, 246), stroke: new Color(234, 194, 89, 250), lineWidth: 3, radius: 8,
    })
    modal.addComponent(BlockInputEvents)

    const headerY = centerY + modalHeight / 2 - (compact ? 46 : 54)
    const iconSize = compact ? 42 : 48
    ui.panel('RulesPageIcon', centerX - modalWidth / 2 + 54, headerY, iconSize, iconSize, {
      fill: new Color(180, 126, 35, 245), stroke: new Color(255, 231, 142, 255), lineWidth: 2, radius: iconSize / 2,
    })
    ui.outlinedLabel(rule.icon, centerX - modalWidth / 2 + 54, headerY, compact ? 24 : 28, {
      width: iconSize - 6, height: iconSize - 6, color: new Color(255, 247, 210), outlineColor: new Color(67, 40, 17), outlineWidth: 2,
    })
    ui.outlinedLabel(`掼蛋规则 · ${rule.title}`, centerX, headerY, compact ? 27 : 32, {
      width: modalWidth - 190, height: 48, color: new Color(255, 226, 132), outlineColor: new Color(46, 28, 18), outlineWidth: 3,
    })
    ui.outlinedLabel(`第 ${this.rulesPage + 1} / ${RULE_PAGES.length} 页`, centerX + modalWidth / 2 - 88, headerY, compact ? 13 : 15, {
      width: 104, height: 28, color: new Color(216, 232, 222), outlineColor: new Color(24, 42, 37), outlineWidth: 2,
    })

    const bodyHeight = modalHeight - (compact ? 150 : 174)
    const body = ui.outlinedLabel(rule.content, centerX, centerY - 4, compact ? 17 : 20, {
      width: modalWidth - 72, height: bodyHeight, color: new Color(245, 239, 215), outlineColor: new Color(24, 35, 31), outlineWidth: 2,
    })
    body.horizontalAlign = Label.HorizontalAlign.LEFT
    body.verticalAlign = Label.VerticalAlign.TOP

    this.compactButton(ui, '×', centerX + modalWidth / 2 - 28, centerY + modalHeight / 2 - 28, 38, 38, 24, () => this.closeRulesDialog())
    const navigationY = centerY - modalHeight / 2 + (compact ? 31 : 36)
    const previous = ui.button('RulesPrevious', '<  上一页', centerX - 115, 190, compact ? 36 : 42, compact ? 16 : 18, {
      fill: new Color(31, 61, 58, 238), pressedFill: new Color(57, 89, 77, 245), stroke: new Color(225, 183, 74, 235),
      textColor: new Color(255, 239, 180), textOutlineWidth: 2, disabled: this.rulesPage === 0, radius: 7,
    })
    previous.setPosition(new Vec3(centerX - 115, navigationY, 0))
    if (this.rulesPage > 0) previous.on(Node.EventType.TOUCH_END, () => { this.rulesPage -= 1; this.showRulesDialog() })
    const next = ui.button('RulesNext', '下一页  >', centerX + 115, 190, compact ? 36 : 42, compact ? 16 : 18, {
      fill: new Color(31, 61, 58, 238), pressedFill: new Color(57, 89, 77, 245), stroke: new Color(225, 183, 74, 235),
      textColor: new Color(255, 239, 180), textOutlineWidth: 2, disabled: this.rulesPage === RULE_PAGES.length - 1, radius: 7,
    })
    next.setPosition(new Vec3(centerX + 115, navigationY, 0))
    if (this.rulesPage + 1 < RULE_PAGES.length) next.on(Node.EventType.TOUCH_END, () => { this.rulesPage += 1; this.showRulesDialog() })
  }

  private closeRulesDialog (): void {
    this.rulesDialogVisible = false
    this.router.closeModal()
    if (this.router.current === 'menu') this.renderMenuPage()
  }

  private showSettings (): void {
    const snapshot = this.session.snapshot
    const ui = this.router.open('settings')
    ui.menuLabel('游戏设置', 0, 215, 42)
    const qualityName = snapshot.settings.effectQuality === 'full' ? '完整' : snapshot.settings.effectQuality === 'reduced' ? '精简' : '关闭'
    ui.menuLabel(`手牌：${snapshot.settings.sortOrder === 'desc' ? '大牌在左' : '小牌在左'}    规则：${snapshot.settings.rulePreset === 'classic' ? '经典' : '竞技'}\n特效：${qualityName}    震动：${snapshot.settings.hapticEnabled ? '开' : '关'}    报牌：${snapshot.settings.voicePack === 'male' ? '男声' : '女声'}`, 0, 155, 20)
    const order = this.pageButton(ui, '切换手牌排序', 82, () => { this.session.updateSettings({ sortOrder: snapshot.settings.sortOrder === 'desc' ? 'asc' : 'desc' }); this.showSettings() })
    const rule = this.pageButton(ui, '切换规则预设', 82, () => { this.session.updateSettings({ rulePreset: snapshot.settings.rulePreset === 'classic' ? 'tournament' : 'classic' }); this.showSettings() })
    const sound = this.pageButton(ui, snapshot.settings.soundEnabled ? '关闭音效' : '开启音效', 20, () => { this.session.updateSettings({ soundEnabled: !snapshot.settings.soundEnabled }); this.showSettings() })
    const bgm = this.pageButton(ui, snapshot.settings.bgmEnabled ? '关闭音乐' : '开启音乐', 20, () => { this.session.updateSettings({ bgmEnabled: !snapshot.settings.bgmEnabled }); this.showSettings() })
    const soundVolume = this.pageButton(ui, `音效音量 ${Math.round(snapshot.settings.volume * 100)}%`, -42, () => { this.session.updateSettings({ volume: Number(((snapshot.settings.volume + 0.1) % 1.1).toFixed(1)) }); this.showSettings() })
    const musicVolume = this.pageButton(ui, `音乐音量 ${Math.round(snapshot.settings.bgmVolume * 100)}%`, -42, () => { this.session.updateSettings({ bgmVolume: Number(((snapshot.settings.bgmVolume + 0.1) % 1.1).toFixed(1)) }); this.showSettings() })
    const effectQuality = this.pageButton(ui, `特效质量 ${qualityName}`, -104, () => {
      const qualities = ['full', 'reduced', 'off'] as const
      this.session.updateSettings({ effectQuality: qualities[(qualities.indexOf(snapshot.settings.effectQuality) + 1) % qualities.length] })
      this.showSettings()
    })
    const haptic = this.pageButton(ui, snapshot.settings.hapticEnabled ? '关闭震动' : '开启震动', -104, () => { this.session.updateSettings({ hapticEnabled: !snapshot.settings.hapticEnabled }); this.showSettings() })
    const voicePack = this.pageButton(ui, `切换报牌声线 · ${snapshot.settings.voicePack === 'male' ? '男声' : '女声'}`, -166, () => {
      this.session.updateSettings({ voicePack: snapshot.settings.voicePack === 'male' ? 'female' : 'male' })
      this.showSettings()
    })
    this.pageButton(ui, '返回更多功能', -240, () => this.showMoreMenu())
    ;[rule, sound, soundVolume, effectQuality, voicePack].forEach(node => node.setPosition(new Vec3(-145, node.position.y, 0)))
    ;[order, bgm, musicVolume, haptic].forEach(node => node.setPosition(new Vec3(145, node.position.y, 0)))
  }

  private renderLobbyPlayerProfile (ui: RuntimeUiFactory, requestedRight: number): void {
    const hasRemoteDashboard = this.playerDashboard !== null
    const awaitingRemoteDashboard = this.gateways.configured && !hasRemoteDashboard
    const stats = this.playerDashboard?.stats ?? this.session.snapshot.playerStats
    const rating = this.playerDashboard?.rating
    const displayName = awaitingRemoteDashboard ? '账号同步中' : this.playerDashboard?.user.displayName.trim() || '陵水玩家'
    const remoteAccountId = this.playerDashboard?.user.accountId.trim() ?? ''
    const accountId = /^\d{8}$/.test(remoteAccountId) ? remoteAccountId : this.gateways.configured ? '同步中' : this.localAccountId
    const games = Math.max(0, rating?.games ?? stats.gamesPlayed)
    const wins = Math.max(0, rating?.wins ?? stats.wins)
    const rawWinRate = games > 0 ? wins * 100 / games : 0
    const rawWinRateText = awaitingRemoteDashboard ? '--' : games > 0 ? rawWinRate.toFixed(1) : '0'
    const comprehensiveScore = awaitingRemoteDashboard
      ? null
      : Math.round(rating?.comprehensiveScore ?? this.playerDashboard?.user.comprehensiveScore ?? this.fallbackComprehensiveScore(stats.elo, wins, games))
    const pointsText = this.gateways.configured && !this.walletFresh ? '积分 --' : `积分 ${Math.max(0, Math.round(this.wallet.points))}`
    const comprehensiveText = `综合 ${comprehensiveScore ?? '--'}`
    const winRateText = `胜率 ${rawWinRateText}${rawWinRateText === '--' ? '' : '%'}`
    const gamesText = `场次 ${awaitingRemoteDashboard ? '--' : games}`
    const estimatedWidth = (text: string, fontSize: number, padding: number): number => Math.ceil(
      Array.from(text).reduce((width, character) => width + (/^[\u0000-\u00ff]$/.test(character) ? fontSize * 0.58 : fontSize), 0) + padding,
    )
    const identityWidth = Math.max(122, Math.min(176, estimatedWidth(displayName, 20, 30)))
    const left = this.screen.safeLeftX(14)
    const right = Math.max(left + 220, Math.min(requestedRight, this.screen.safeRightX(14)))
    const y = this.screen.safeTopY(52)
    const placements = resolveSafeHorizontalLane(left, right, [
      { id: 'avatar', preferredWidth: 64, minWidth: 60, priority: 100, canHide: false },
      { id: 'identity', preferredWidth: identityWidth, minWidth: 112, priority: 95, canHide: false },
      { id: 'points', preferredWidth: estimatedWidth(pointsText, 16, 38), minWidth: 82, priority: 85 },
      { id: 'win-rate', preferredWidth: estimatedWidth(winRateText, 15, 24), minWidth: 76, priority: 60 },
      { id: 'games', preferredWidth: estimatedWidth(gamesText, 15, 24), minWidth: 64, priority: 50 },
      { id: 'comprehensive', preferredWidth: estimatedWidth(comprehensiveText, 16, 24), minWidth: 88, priority: 90, canHide: false },
    ], 5)
    const place = (id: string) => placements.find(item => item.id === id)
    const avatar = place('avatar')
    if (avatar?.visible) {
      ui.panel('LobbyAvatarBacking', avatar.x, y, 64, 64, { fill: new Color(5, 9, 8, 178), lineWidth: 0, radius: 32 })
      ui.image('LobbyDefaultAvatar', LOBBY_ART.defaultAvatar, avatar.x, y, 58, 58)
    }
    const identity = place('identity')
    if (identity?.visible) {
      ui.panel('LobbyIdentityPill', identity.x, y, identity.width, 60, { fill: new Color(4, 8, 8, 172), lineWidth: 0, radius: 30 })
      ui.outlinedLabel(displayName, identity.x, y + 13, 20, {
        width: identity.width - 18, height: 28, color: new Color(255, 241, 178), outlineColor: new Color(46, 36, 24), outlineWidth: 3,
      })
      ui.outlinedLabel(`ID ${accountId}`, identity.x, y - 15, 14, {
        width: identity.width - 18, height: 22, color: new Color(225, 241, 235), outlineColor: new Color(30, 62, 62), outlineWidth: 2,
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
      ui.outlinedLabel(pointsText, points.x + 10, y, 16, {
        width: Math.max(48, points.width - 30), height: 28, color: new Color(255, 238, 168), outlineColor: new Color(47, 49, 35), outlineWidth: 2,
      })
    }
    renderPill('win-rate', winRateText, 15, new Color(230, 239, 232))
    renderPill('games', gamesText, 15, new Color(230, 239, 232))
    renderPill('comprehensive', comprehensiveText, 16, new Color(137, 241, 204))
    const hitArea = new Node('LobbyPlayerProfileHitArea')
    hitArea.parent = ui.parent
    hitArea.setPosition(new Vec3((left + right) / 2, y, 2))
    hitArea.addComponent(UITransform).setContentSize(right - left, 70)
    hitArea.on(Node.EventType.TOUCH_END, () => {
      void this.showPlayerCenter()
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

  private refreshLobbyDashboard (requestToken: number): void {
    if (!this.gateways.configured || this.playerDashboardLoading || Date.now() - this.playerDashboardLoadedAt < 30_000) return
    this.playerDashboardLoading = true
    void Promise.all([
      settle(this.gateways.playerCenter.getDashboard()),
      settle(this.gateways.wallet.getWallet()),
    ]).then(([dashboardResult, walletResult]) => {
      this.playerDashboardLoading = false
      this.playerDashboardLoadedAt = Date.now()
      if (dashboardResult.status === 'fulfilled') this.playerDashboard = dashboardResult.value
      if (walletResult.status === 'fulfilled') {
        this.wallet = walletResult.value
        this.walletFresh = true
      } else this.walletFresh = false
      if (!this.disposed && requestToken === this.pageRequestToken && this.router.current === 'menu' && !this.rulesDialogVisible) this.renderMenuPage()
    })
  }

  private renderShopShortcut (ui: RuntimeUiFactory, safeWidth: number, safeHeight: number): void {
    const size = Math.min(168, Math.max(92, Math.min(safeWidth * 0.14, safeHeight * 0.31)))
    const x = this.screen.safeLeftX(size / 2 + 18)
    const y = this.screen.safeBottomY(size / 2 + 16)
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
    ui.makeInteractive(shortcut, () => this.showShop(), 0.95)
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
    ui.outlinedLabel(label, labelX, y, Math.max(17, Math.min(22, width * 0.034)), {
      width: labelWidth, color: new Color(235, 242, 217), outlineColor: new Color(31, 65, 40), outlineWidth: 2,
    })
    const controlsCenter = centerX + labelWidth * 0.36
    const valueWidth = Math.min(150, Math.max(92, width * 0.22))
    ui.panel('FriendStepperValuePill', controlsCenter, y, valueWidth, 34, { fill: new Color(224, 234, 213, 245), stroke: new Color(129, 158, 117), lineWidth: 1, radius: 17 })
    ui.outlinedLabel(`${value}${suffix}`, controlsCenter, y, 18, {
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
    ui.outlinedLabel(label, labelX, y, Math.max(17, Math.min(22, width * 0.034)), {
      width: labelWidth,
      color: new Color(235, 242, 217),
      outlineColor: new Color(31, 65, 40),
      outlineWidth: 2,
    })
    const choicesLeft = centerX - width / 2 + labelWidth + 24
    const choicesWidth = width - labelWidth - 42
    const gap = 9
    const buttonWidth = Math.min(158, (choicesWidth - gap * (values.length - 1)) / values.length)
    const usedWidth = buttonWidth * values.length + gap * (values.length - 1)
    const firstX = choicesLeft + (choicesWidth - usedWidth) / 2 + buttonWidth / 2
    values.forEach((value, index) => {
      const active = value === selected
      const node = ui.button('FriendChoice', value, firstX + index * (buttonWidth + gap), buttonWidth, 38, Math.max(15, Math.min(19, buttonWidth * 0.15)), {
        fill: active ? new Color(71, 174, 83, 248) : new Color(223, 232, 212, 245),
        pressedFill: new Color(57, 150, 70, 248),
        stroke: active ? new Color(232, 201, 77, 255) : new Color(124, 150, 113, 220),
        textColor: active ? new Color(255, 252, 225) : new Color(59, 82, 61),
        textOutlineColor: active ? new Color(40, 86, 39) : new Color(255, 255, 255),
        textOutlineWidth: active ? 2 : 1,
        radius: 5,
      })
      node.setPosition(new Vec3(firstX + index * (buttonWidth + gap), y, 0))
      if (!active) node.on(Node.EventType.TOUCH_END, () => onSelect(value))
    })
  }

  private competitionTemplates (category: CompetitionCategory): Array<{ badge: string, title: string, detail: string, notice: string, accent: Color }> {
    if (category === 'hometown') return [
      { badge: '海', title: '海口城市代表赛', detail: '周三 20:00 · 城市积分榜\n16人分组 · 前8晋级', notice: '城市身份与赛区服务接入后开放报名', accent: new Color(42, 151, 184) },
      { badge: '三', title: '三亚城市代表赛', detail: '周五 20:00 · 城市积分榜\n16人分组 · 前8晋级', notice: '城市身份与赛区服务接入后开放报名', accent: new Color(52, 164, 142) },
      { badge: '儋', title: '儋州城市代表赛', detail: '周六 19:30 · 城市积分榜\n32人分组 · 前16晋级', notice: '城市身份与赛区服务接入后开放报名', accent: new Color(204, 134, 55) },
      { badge: '沙', title: '三沙城市代表赛', detail: '周日 20:00 · 城市积分榜\n16人分组 · 前8晋级', notice: '城市身份与赛区服务接入后开放报名', accent: new Color(73, 130, 206) },
    ]
    if (category === 'alumni') return [
      { badge: '海大', title: '海南大学校友赛', detail: '每周四 20:00 · 校友积分\n16人瑞士轮 · 前8晋级', notice: '高校认证服务接入后开放报名', accent: new Color(50, 126, 88) },
      { badge: '海师', title: '海南师范大学校友赛', detail: '每周五 20:00 · 校友积分\n16人瑞士轮 · 前8晋级', notice: '高校认证服务接入后开放报名', accent: new Color(61, 113, 185) },
      { badge: '海医', title: '海南医科大学校友赛', detail: '每周六 19:30 · 校友积分\n16人瑞士轮 · 前8晋级', notice: '高校认证服务接入后开放报名', accent: new Color(184, 74, 74) },
      { badge: '三院', title: '三亚学院校友赛', detail: '每周日 20:00 · 校友积分\n16人瑞士轮 · 前8晋级', notice: '高校认证服务接入后开放报名', accent: new Color(118, 84, 177) },
    ]
    if (category === 'custom') return [
      { badge: '+', title: '创建公开比赛', detail: '设置时间、人数、晋级线\n提交后生成赛事ID', notice: '赛事创建表单将在服务端赛程接口接入后启用', accent: new Color(44, 160, 119) },
      { badge: '友', title: '周末好友邀请赛', detail: '周六 20:00 · 16人\n三轮积分 · 前8晋级', notice: '这是自建赛卡片模板', accent: new Color(64, 133, 208) },
      { badge: '社', title: '社区夏季公开赛', detail: '8月8日 19:30 · 32人\n四轮积分 · 前16晋级', notice: '这是自建赛卡片模板', accent: new Color(219, 138, 49) },
      { badge: '企', title: '企业交流赛', detail: '8月10日 20:00 · 16人\n团队积分 · 前8晋级', notice: '这是自建赛卡片模板', accent: new Color(115, 90, 188) },
    ]
    return []
  }

  private competitionCard (
    ui: RuntimeUiFactory,
    contentLeft: number,
    contentRight: number,
    panelHeight: number,
    index: number,
    item: { badge: string, title: string, detail: string, accent: Color, action: () => void },
  ): void {
    const contentWidth = contentRight - contentLeft
    const columns = contentWidth >= 760 ? 3 : 2
    const gap = 12
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns
    const cardHeight = Math.min(142, Math.max(96, (panelHeight - 102 - gap) / 2))
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = contentLeft + cardWidth / 2 + column * (cardWidth + gap)
    const topY = panelHeight / 2 - 67 - cardHeight / 2
    const y = topY - row * (cardHeight + gap)
    const card = ui.panel('CompetitionCard', x, y, cardWidth, cardHeight, {
      fill: new Color(238, 245, 251, 244), stroke: new Color(item.accent.r, item.accent.g, item.accent.b, 235), lineWidth: 2, radius: 7,
    })
    const badgeSize = Math.min(58, cardHeight * 0.46)
    ui.panel('CompetitionBadge', -cardWidth / 2 + badgeSize / 2 + 12, 8, badgeSize, badgeSize, {
      fill: item.accent, stroke: new Color(255, 242, 187, 250), lineWidth: 2, radius: badgeSize / 2,
    }, card)
    ui.outlinedLabel(item.badge, -cardWidth / 2 + badgeSize / 2 + 12, 8, Math.max(16, badgeSize * 0.38), {
      parent: card, width: badgeSize - 6, height: badgeSize - 6, color: new Color(255, 248, 219), outlineColor: new Color(40, 53, 74), outlineWidth: 2,
    })
    const textWidth = cardWidth - badgeSize - 38
    const textX = badgeSize / 2 + 4
    ui.outlinedLabel(item.title, textX, cardHeight * 0.22, Math.max(16, Math.min(21, cardWidth * 0.065)), {
      parent: card, width: textWidth, height: 34, color: new Color(42, 65, 99), outlineColor: new Color(255, 255, 255), outlineWidth: 1,
    })
    ui.outlinedLabel(item.detail, textX, -cardHeight * 0.16, Math.max(12, Math.min(15, cardWidth * 0.045)), {
      parent: card, width: textWidth, height: cardHeight * 0.46, color: new Color(75, 94, 113), outlineColor: new Color(255, 255, 255), outlineWidth: 1,
    })
    ui.makeInteractive(card, item.action, 0.97)
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
      fill, pressedFill: new Color(Math.max(0, fill.r - 28), Math.max(0, fill.g - 28), Math.max(0, fill.b - 28), fill.a),
      stroke: new Color(255, 235, 151, 255), textColor: new Color(255, 252, 224), textOutlineColor: new Color(43, 58, 37, 255), textOutlineWidth: 3, radius: 7,
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

  private errorDetail (error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim() ? error.message : fallback
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
}
