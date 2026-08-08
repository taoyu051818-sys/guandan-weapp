import { _decorator, BlockInputEvents, Color, Component, game, Graphics, Label, Node, Sprite, SpriteFrame, sys, Texture2D, Tween, UIOpacity, UITransform, Vec3, tween } from 'cc'
import { GameManager, playValidationHint, type GameSnapshot } from '../game/GameManager'
import { canSelectPlayingHand, resolvePlayingHandTapMode, type PlayingHandTapMode } from '../game/HandInteractionPolicy'
import { HandWorkspace } from '../game/HandWorkspace'
import { HandController } from '../ui/HandController'
import { GameSession } from '../session/GameSession'
import { LobbyController, type FriendRoomSettings, type LobbyNetworkResult, type LobbySnapshot, type NetworkDeadlineAction, type NetworkDissolveVote, type NetworkRoundEndedPacket, type NetworkRoundPacket, type NetworkStatePacket } from '../network/LobbyController'
import { PlayerSeatController } from '../ui/PlayerSeatController'
import { PlayAreaController } from '../ui/PlayAreaController'
import { CocosAudioController } from '../audio/CocosAudioController'
import { ChatController, QUICK_CHAT_PHRASES, type QuickChat } from '../ui/ChatController'
import type { PlayerId } from '../core/generated'
import { ScreenAdapter, type TableViewport } from '../ui/ScreenAdapter'
import { EffectController, type EffectAssetAudit, type EffectRuntimeDiagnostics } from '../effects/EffectController'
import { RuntimeUiFactory } from '../ui/RuntimeUiFactory'
import { TableGameHud, type TableGameHudSeatPlace, type TableGameHudSuit } from '../ui/TableGameHud'
import { tableHintToast } from '../ui/TablePromptPolicy'
import { createDevelopmentGateways, type FrontPageGateways, type MatchTicket } from '../services/DevelopmentApis'
import { ensureGameAssetBundle, loadGameAsset, loadGameAssetAsync, type GameAssetBundleProgress } from '../services/GameAssetLoader'
import { createHttpGateways, type PlatformLoginCredential } from '../services/PlatformApi'
import { StartupLoadingOverlay } from '../ui/StartupLoadingOverlay'
import { preloadAllClassicCardFrames } from '../ui/ClassicCardFrameStore'
import { FrontPageController } from './FrontPageController'
import { createEffectLab, type EffectLabApi, type EffectLabPreview } from '../development/EffectLab'
import type { EffectQuality } from '../effects/EffectTypes'

const { ccclass, property } = _decorator

type BackdropMode = 'lobby' | 'table'

const BACKDROP_ASSETS: Readonly<Record<BackdropMode, Readonly<{ path: string, width: number, height: number }>>> = Object.freeze({
  lobby: Object.freeze({ path: 'backgrounds/lobby-lingshui-coast-v1/texture', width: 1600, height: 719 }),
  table: Object.freeze({ path: 'backgrounds/table-perspective-blue-v2/texture', width: 1280, height: 720 }),
})
const TABLE_TIMER_ART_ASSET = 'ui/table/chicken-timer-frame/texture'
const DEFAULT_AVATAR_ART_ASSET = 'ui/common/default-avatar/texture'

type EffectLabDebugBridge = Readonly<{
  open: () => void
  list: () => ReturnType<EffectLabApi['list']>
  trigger: (id: string, quality?: EffectQuality) => boolean
  skip: () => void
  diagnostics: () => EffectRuntimeDiagnostics | null
  audit: () => Promise<EffectAssetAudit | null>
}>

type EffectLabDebugGlobal = typeof globalThis & {
  __guandanEffectLab?: EffectLabDebugBridge
}

type LocalBrowserDevelopmentConfig = Readonly<{
  lobbyEndpoint: string
  platformEndpoint: string
}>

/** Attach this to the Game scene root and bind editor nodes in the Inspector. */
@ccclass('GameScene')
export class GameScene extends Component {
  @property(Texture2D)
  /** Serialized scene dependency: this image must always stay in the first package. */
  public startupTexture: Texture2D | null = null

  @property(GameSession)
  public session: GameSession | null = null

  @property(GameManager)
  public gameManager: GameManager | null = null

  @property(LobbyController)
  public lobby: LobbyController | null = null

  @property(CocosAudioController)
  public audio: CocosAudioController | null = null

  @property
  /** Production must set a wss:// endpoint in the Inspector or build profile. */
  public lobbyEndpoint = ''

  @property
  /** Optional HTTP platform API; blank keeps the local development catalog. */
  public platformEndpoint = ''

  @property
  /** Local-only switch. Production should keep this false and use wx.login. */
  public platformAllowDevelopmentLogin = false

  @property
  /** Local LAN test only. Production should keep this false so match tickets require wss://. */
  public platformAllowInsecureGameEndpoint = false

  @property
  /** Local LAN HTTP test only. Production must keep this false so access tokens use HTTPS. */
  public platformAllowInsecureEndpoint = false

  @property(HandController)
  public hand: HandController | null = null

  @property(PlayAreaController)
  public playArea: PlayAreaController | null = null

  @property(Label)
  public hintLabel: Label | null = null

  @property(Label)
  public phaseLabel: Label | null = null

  @property(Label)
  public overlayLabel: Label | null = null

  @property(Node)
  public playButton: Node | null = null

  @property(Node)
  public passButton: Node | null = null

  @property(Node)
  public hintButton: Node | null = null

  @property(Node)
  public confirmTributeButton: Node | null = null

  @property(Node)
  public finishTributeButton: Node | null = null

  @property(Node)
  public nextRoundButton: Node | null = null

  private playerSeats = new Map<string, PlayerSeatController>()
  private backdrop: Node | null = null
  private backdropSprite: Sprite | null = null
  private backdropOpacity: UIOpacity | null = null
  private backdropMode: BackdropMode = 'lobby'
  private displayedBackdropMode: BackdropMode | null = null
  private readonly backdropFrames = new Map<BackdropMode, SpriteFrame>()
  private readonly backdropSourceSizes = new Map<BackdropMode, Readonly<{ width: number, height: number }>>()
  private backdropSourceSize = { width: BACKDROP_ASSETS.lobby.width, height: BACKDROP_ASSETS.lobby.height }
  private chat: ChatController | null = null
  private trusteeButton: Node | null = null
  private ownChatLabel: Label | null = null
  private chatNodes: Node[] = []
  private latestSnapshot: GameSnapshot | null = null
  private screen: ScreenAdapter | null = null
  private ui: RuntimeUiFactory | null = null
  private tableHud: TableGameHud | null = null
  private tableTimerArtworkRequested = false
  private tableAvatarArtworkRequested = false
  private frontPages: FrontPageController | null = null
  private lastPhase: GameSnapshot['phase'] | null = null
  private lastTurn: PlayerId | null = null
  private levelLabel: Label | null = null
  private countdownLabel: Label | null = null
  private finishToastLabel: Label | null = null
  private exitDialog: Node | null = null
  private dissolveDialog: Node | null = null
  private dissolveCountdownLabel: Label | null = null
  private previousFinishedPlayers: PlayerId[] = []
  private previousHandCounts = new Map<PlayerId, number>()
  private actionCountdown = 20
  private actionCountdownKey = ''
  private lastPresentedTableHint = ''
  private tableShakeRoot: Node | null = null
  private flightRoot: Node | null = null
  private topEffectRoot: Node | null = null
  private effects: EffectController | null = null
  private skipEffectButton: Node | null = null
  private suppressNextSettlementEffect = false
  private readonly handWorkspace = new HandWorkspace()
  private handStackRise = 0
  private quickChatMuted = false
  private effectLab: EffectLabApi | null = null
  private effectLabDebugBridge: EffectLabDebugBridge | null = null
  private friendRoomWaitingVisible = false
  private previousTributeEffects = new Set<string>()
  private startupOverlay: StartupLoadingOverlay | null = null
  private startupAttempt = 0
  private gameInitialized = false
  private gameInitializationStarted = false
  private sceneStarted = false
  private initialPageShown = false

  protected onLoad (): void {
    const screen = (this.getComponent(ScreenAdapter) ?? this.addComponent(ScreenAdapter)) as ScreenAdapter
    this.screen = screen
    this.startupOverlay = new StartupLoadingOverlay(this.node, this.startupTexture, 1280, 590)
    this.startupOverlay.resize(screen.viewport)
    this.startupOverlay.setProgress(0, '正在检查游戏资源...')
    screen.events.on('guandan:viewport', this.handleViewport, this)
    void this.prepareStartupResources()
  }

  protected start (): void {
    this.sceneStarted = true
    this.showInitialPageWhenReady()
  }

  private async prepareStartupResources (): Promise<void> {
    const attempt = ++this.startupAttempt
    const overlay = this.startupOverlay
    if (!overlay) return
    overlay.setProgress(0.03, '正在连接资源服务...')
    try {
      await ensureGameAssetBundle(progress => {
        if (attempt !== this.startupAttempt || !this.node.isValid) return
        const normalized = Math.max(0, Math.min(1, progress.progress))
        overlay.setProgress(0.03 + normalized * 0.82, this.startupDownloadStatus(progress))
      })
      if (attempt !== this.startupAttempt || !this.node.isValid) return
      overlay.setProgress(0.88, '正在准备牌面与大厅画面...')
      const [lobbyTexture, classicFramesReady] = await Promise.all([
        loadGameAssetAsync(BACKDROP_ASSETS.lobby.path, Texture2D),
        preloadAllClassicCardFrames(),
      ])
      if (!classicFramesReady) throw new Error('Classic card artwork is incomplete.')
      if (attempt !== this.startupAttempt || !this.node.isValid) return
      this.cacheBackdropTexture('lobby', lobbyTexture)
    } catch (error) {
      if (attempt !== this.startupAttempt || !this.node.isValid) return
      console.error('Unable to prepare the game asset bundle.', error)
      overlay.showError('资源下载失败，请检查网络后重试', () => { void this.prepareStartupResources() })
      return
    }

    overlay.setProgress(0.96, '正在创建游戏界面...')
    this.gameInitializationStarted = true
    try {
      this.initializeGame()
      this.showInitialPageWhenReady()
    } catch (error) {
      if (attempt !== this.startupAttempt || !this.node.isValid) return
      console.error('Unable to initialize the game scene.', error)
      overlay.showError('游戏初始化失败，请重新进入小游戏', () => {
        void game.restart().catch(restartError => {
          console.error('Unable to restart the game scene.', restartError)
          overlay.showError('重新进入失败，请关闭后再次打开小游戏', () => { void game.restart() })
        })
      })
      return
    }
    overlay.bringToFront()
    overlay.setProgress(1, '资源准备完成')
    await overlay.fadeOut()
    if (attempt === this.startupAttempt) this.startupOverlay = null
  }

  private startupDownloadStatus (progress: GameAssetBundleProgress): string {
    const total = progress.totalBytesExpectedToWrite
    if (total <= 0) return '正在下载游戏资源...'
    const writtenMb = (progress.totalBytesWritten / 1_048_576).toFixed(1)
    const totalMb = (total / 1_048_576).toFixed(1)
    return `正在下载游戏资源 ${writtenMb} / ${totalMb} MB`
  }

  private handleViewport (viewport: TableViewport): void {
    this.startupOverlay?.resize(viewport)
    if (this.gameInitialized) this.applyResponsiveLayout(viewport)
  }

  private showInitialPageWhenReady (): void {
    if (!this.sceneStarted || !this.gameInitialized || this.initialPageShown) return
    this.initialPageShown = true
    this.frontPages?.showMenu()
  }

  private initializeGame (): void {
    if (this.gameInitialized) return
    if (!this.gameInitializationStarted) throw new Error('Game initialization must be started by the resource bootstrap.')
    if (!this.session) this.session = this.getComponent(GameSession) ?? this.addComponent(GameSession)
    if (!this.gameManager) this.gameManager = this.getComponent(GameManager) ?? this.addComponent(GameManager)
    if (!this.lobby) this.lobby = this.getComponent(LobbyController) ?? this.addComponent(LobbyController)
    if (!this.audio) this.audio = this.getComponent(CocosAudioController) ?? this.addComponent(CocosAudioController)
    this.chat = this.getComponent(ChatController) ?? this.addComponent(ChatController)
    const screen = this.screen ?? (this.getComponent(ScreenAdapter) ?? this.addComponent(ScreenAdapter)) as ScreenAdapter
    this.screen = screen
    this.ui = new RuntimeUiFactory(this.node)
    const manager = this.gameManager!
    const lobby = this.lobby!
    const audio = this.audio!
    manager.session = this.session
    manager.audio = audio
    manager.lobby = lobby
    lobby.session = this.session
    audio.session = this.session
    this.ensureFallbackUi()
    this.ensureEffectHierarchy()
    this.ensureTableHud()
    this.effectLab = createEffectLab({
      playAction: preview => this.previewLabAction(preview),
      playAudio: event => this.audio?.playEvent(event),
      playCountdown: remaining => this.audio?.playCountdown(remaining),
      playTribute: (fixture, quality) => this.previewLabTribute(fixture, quality),
      playSettlement: (fixture, quality) => this.previewLabSettlement(fixture.won, fixture.levelUp, quality),
      playFlow: (fixture, quality) => this.previewLabFlow(fixture, quality),
      playSequence: fixture => this.previewLabSequence(fixture),
      runDiagnostic: fixture => { void this.previewLabDiagnostic(fixture) },
      startFixedMatch: (state, fixture) => {
        this.frontPages?.hideAll()
        this.setTableVisible(true)
        this.effects?.resetForRecovery(state.playArea.length)
        manager.applyDevelopmentFixtureState(state, fixture.label)
        this.audio?.playRoundStart()
      },
      playQuickChat: phrase => this.audio?.playVoice(phrase.voice),
    })
    const frontPageGateways = this.createFrontPageGateways()
    this.frontPages = new FrontPageController(this.node, this.session!, lobby, screen, {
      setTableVisible: visible => this.setTableVisible(visible),
      setFriendRoomWaitingVisible: visible => this.setFriendRoomWaitingVisible(visible),
      closeModal: () => this.clearExitDialog(),
      showNotice: (title, detail) => this.showNotice(title, detail),
      scheduleOnce: (callback, delaySeconds) => this.scheduleOnce(callback, delaySeconds),
      getLobbyEndpoint: () => this.resolvedLobbyEndpoint(),
      enterMatchedGame: ticket => this.enterMatchedGame(ticket),
      startMasterBotTest: () => this.startMasterBotTest(),
      listEffectLabFixtures: () => this.effectLab?.list() ?? [],
      previewEffectLabFixture: (id, quality) => { this.effectLab?.trigger(id, quality) },
    }, frontPageGateways)
    this.installEffectLabDebugBridge()
    this.applyResponsiveLayout(screen.viewport)
    manager.node.on('guandan:state', this.render, this)
    this.hand?.node.on('guandan:card-toggle', this.handleCardToggle, this)
    this.playButton?.on(Node.EventType.TOUCH_END, this.playSelectedWithEffect, this)
    this.passButton?.on(Node.EventType.TOUCH_END, manager.pass, manager)
    this.hintButton?.on(Node.EventType.TOUCH_END, manager.hint, manager)
    this.confirmTributeButton?.on(Node.EventType.TOUCH_END, manager.confirmTribute, manager)
    this.finishTributeButton?.on(Node.EventType.TOUCH_END, manager.finishTribute, manager)
    this.nextRoundButton?.on(Node.EventType.TOUCH_END, this.handleNextRound, this)
    lobby.events.on('guandan:lobby', this.renderLobby, this)
    lobby.events.on('guandan:network-state', this.applyNetworkState, this)
    lobby.events.on('guandan:round-prepared', this.applyNetworkRoundPrepared, this)
    lobby.events.on('guandan:round-ended', this.applyNetworkRoundEnded, this)
    lobby.events.on('guandan:network-result', this.applyNetworkResult, this)
    lobby.events.on('guandan:network-error', this.applyNetworkError, this)
    lobby.events.on('guandan:room-closed', this.applyNetworkRoomClosed, this)
    lobby.events.on('guandan:chat', this.applyNetworkChat, this)
    lobby.events.on('guandan:trustee', this.refreshNetworkPresentation, this)
    lobby.events.on('guandan:round-ready', this.refreshNetworkPresentation, this)
    lobby.events.on('guandan:turn-deadline', this.refreshNetworkPresentation, this)
    lobby.events.on('guandan:turn-timeout', this.applyNetworkTurnTimeout, this)
    lobby.events.on('guandan:dissolve-vote', this.applyNetworkDissolveVote, this)
    this.chat?.events.on('guandan:chat', this.renderChat, this)
    this.session?.events.on('guandan:session', this.refreshBackdropTheme, this)
    this.schedule(this.tickActionCountdown, 1)
    this.gameInitialized = true
  }

  private createFrontPageGateways (): FrontPageGateways {
    const localBrowserConfig = this.localBrowserDevelopmentConfig()
    const configuredEndpoint = this.platformEndpoint.trim()
    const endpoint = configuredEndpoint || localBrowserConfig?.platformEndpoint || ''
    if (!endpoint) return createDevelopmentGateways()
    const usingLocalBrowserDefaults = !configuredEndpoint && localBrowserConfig !== null
    const accessTokenKey = `guandan-platform-token:${endpoint}`
    return createHttpGateways({
      baseUrl: endpoint,
      deviceId: this.platformDeviceId(),
      displayName: '陵水玩家',
      allowDevelopmentLogin: usingLocalBrowserDefaults || this.platformAllowDevelopmentLogin,
      httpEndpointPolicy: usingLocalBrowserDefaults || this.platformAllowInsecureEndpoint ? 'allow-insecure' : 'secure-only',
      gameEndpointPolicy: usingLocalBrowserDefaults || this.platformAllowInsecureGameEndpoint ? 'allow-insecure' : 'allow-localhost-insecure',
      loginProvider: usingLocalBrowserDefaults || this.platformAllowDevelopmentLogin ? undefined : () => this.platformLoginCredential(),
      credentialStore: {
        getAccessToken: () => sys.localStorage.getItem(accessTokenKey),
        setAccessToken: token => sys.localStorage.setItem(accessTokenKey, token),
        clearAccessToken: () => sys.localStorage.removeItem(accessTokenKey),
      },
    })
  }

  private resolvedLobbyEndpoint (): string {
    return this.lobbyEndpoint.trim() || this.localBrowserDevelopmentConfig()?.lobbyEndpoint || ''
  }

  /** Keeps localhost preview zero-config without serializing unsafe endpoints into the release scene. */
  private localBrowserDevelopmentConfig (): LocalBrowserDevelopmentConfig | null {
    const browserLocation = (globalThis as typeof globalThis & { location?: { hostname?: string } }).location
    const hostname = browserLocation?.hostname?.trim().toLowerCase()
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1' && hostname !== '[::1]') return null
    return {
      lobbyEndpoint: 'ws://127.0.0.1:3002/weapp',
      platformEndpoint: 'http://127.0.0.1:3003',
    }
  }

  private platformLoginCredential (): Promise<PlatformLoginCredential> {
    type WxApi = { login: (options: { success: (result: { code?: string }) => void, fail: () => void }) => void }
    const wxApi = (globalThis as unknown as { wx?: WxApi }).wx
    if (!wxApi?.login) return Promise.reject(new Error('请在微信环境登录，或仅在本地联调时开启开发登录'))
    return new Promise((resolve, reject) => {
      wxApi.login({
        success: result => result.code ? resolve({ kind: 'wechat', code: result.code }) : reject(new Error('微信登录没有返回有效凭证')),
        fail: () => reject(new Error('微信登录失败，请稍后重试')),
      })
    })
  }

  private platformDeviceId (): string {
    const key = 'guandan-platform-device-id-v1'
    const existing = sys.localStorage.getItem(key)
    if (existing) return existing
    const created = `cocos-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000_000).toString(36)}`
    sys.localStorage.setItem(key, created)
    return created
  }

  private enterMatchedGame (ticket: MatchTicket): void {
    if (!ticket.roomId || !ticket.gameEndpoint || !ticket.joinToken || !ticket.seat) {
      this.showNotice('比赛匹配失败', '匹配服务返回了不完整的房间凭证')
      return
    }
    if (this.topEffectRoot) this.topEffectRoot.active = true
    this.effects?.playMatchSuccess()
    this.session?.enterLobby()
    this.lobby?.enterMatchedRoom({
      roomId: ticket.roomId,
      gameEndpoint: ticket.gameEndpoint,
      gameTicket: ticket.joinToken,
      seat: ticket.seat,
      expiresAt: ticket.expiresAt,
      displayName: '陵水玩家',
    })
  }

  protected onDestroy (): void {
    this.startupAttempt += 1
    this.startupOverlay?.dispose()
    this.startupOverlay = null
    this.gameManager?.node.off('guandan:state', this.render, this)
    this.hand?.node.off('guandan:card-toggle', this.handleCardToggle, this)
    this.lobby?.events.off('guandan:lobby', this.renderLobby, this)
    this.lobby?.events.off('guandan:network-state', this.applyNetworkState, this)
    this.lobby?.events.off('guandan:round-prepared', this.applyNetworkRoundPrepared, this)
    this.lobby?.events.off('guandan:round-ended', this.applyNetworkRoundEnded, this)
    this.lobby?.events.off('guandan:network-result', this.applyNetworkResult, this)
    this.lobby?.events.off('guandan:network-error', this.applyNetworkError, this)
    this.lobby?.events.off('guandan:room-closed', this.applyNetworkRoomClosed, this)
    this.lobby?.events.off('guandan:chat', this.applyNetworkChat, this)
    this.lobby?.events.off('guandan:trustee', this.refreshNetworkPresentation, this)
    this.lobby?.events.off('guandan:round-ready', this.refreshNetworkPresentation, this)
    this.lobby?.events.off('guandan:turn-deadline', this.refreshNetworkPresentation, this)
    this.lobby?.events.off('guandan:turn-timeout', this.applyNetworkTurnTimeout, this)
    this.lobby?.events.off('guandan:dissolve-vote', this.applyNetworkDissolveVote, this)
    this.chat?.events.off('guandan:chat', this.renderChat, this)
    this.screen?.events.off('guandan:viewport', this.handleViewport, this)
    this.session?.events.off('guandan:session', this.refreshBackdropTheme, this)
    this.unschedule(this.tickActionCountdown)
    this.removeEffectLabDebugBridge()
    this.frontPages?.destroy()
    this.frontPages = null
    this.tableHud?.dispose()
    this.tableHud = null
    this.effectLab = null
    this.clearDissolveDialog()
  }

  /** Compile-time-gated automation bridge; the visible lab lives in the existing More page. */
  private installEffectLabDebugBridge (): void {
    if (!this.effectLab || !this.frontPages) return
    const bridge: EffectLabDebugBridge = Object.freeze({
      open: () => this.frontPages?.openEffectLabTable(),
      list: () => this.effectLab?.list() ?? [],
      trigger: (id, quality = 'full') => Boolean(this.effectLab?.trigger(id, quality)),
      skip: () => this.effects?.skipAll(),
      diagnostics: () => this.effects?.diagnostics() ?? null,
      audit: async () => await this.effects?.auditRuntimeAssets() ?? null,
    })
    this.effectLabDebugBridge = bridge
    ;(globalThis as EffectLabDebugGlobal).__guandanEffectLab = bridge
  }

  private removeEffectLabDebugBridge (): void {
    const host = globalThis as EffectLabDebugGlobal
    if (host.__guandanEffectLab === this.effectLabDebugBridge) delete host.__guandanEffectLab
    this.effectLabDebugBridge = null
  }

  private previewLabAction (preview: EffectLabPreview): void {
    if (!preview.action || !this.effects) return
    if (this.flightRoot) this.flightRoot.active = true
    if (this.topEffectRoot) this.topEffectRoot.active = true
    this.effects.resetForRecovery(0)
    this.effects.previewAction(preview.action, preview.quality, this.effectLabWorldPoint(new Vec3(-160, -120, 0)), this.effectLabWorldPoint(Vec3.ZERO))
    this.scheduleOnce(this.hideLabEffectRoots, 2.4)
  }

  private previewLabSettlement (won: boolean, levelUp: number, quality: EffectQuality): void {
    if (this.topEffectRoot) this.topEffectRoot.active = true
    this.effects?.playSettlement(won, levelUp, quality)
    this.scheduleOnce(this.hideLabEffectRoots, 2.4)
  }

  private previewLabTribute (fixture: NonNullable<EffectLabPreview['tribute']>, quality: EffectQuality): void {
    if (!this.effects) return
    if (this.flightRoot) this.flightRoot.active = true
    if (this.topEffectRoot) this.topEffectRoot.active = true
    const source = this.effectLabWorldPoint(fixture.phase === 'return' ? new Vec3(260, 20, 0) : new Vec3(-260, 20, 0))
    const target = this.effectLabWorldPoint(fixture.phase === 'return' ? new Vec3(-260, 20, 0) : new Vec3(260, 20, 0))
    const card = fixture.phase === 'return' ? fixture.returnCard : fixture.card
    this.effects.playTribute({ phase: fixture.phase, from: fixture.from, to: fixture.to, card }, source, target, quality)
    this.scheduleOnce(this.hideLabEffectRoots, 1.4)
  }

  private previewLabFlow (fixture: NonNullable<EffectLabPreview['flow']>, quality: EffectQuality): void {
    if (!this.effects) return
    if (this.flightRoot) this.flightRoot.active = true
    if (this.topEffectRoot) this.topEffectRoot.active = true
    this.effects.skipAll()
    if (fixture.kind === 'tribute' || fixture.kind === 'return-tribute' || fixture.kind === 'anti-tribute') {
      const returning = fixture.kind === 'return-tribute'
      this.effects.playTribute(
        {
          phase: fixture.kind === 'anti-tribute' ? 'anti-tribute' : returning ? 'return' : 'tribute',
          from: returning ? 'p1' : 'p2',
          to: returning ? 'p2' : 'p1',
          card: null,
        },
        this.effectLabWorldPoint(new Vec3(returning ? 260 : -260, 20, 0)),
        this.effectLabWorldPoint(new Vec3(returning ? -260 : 260, 20, 0)),
        quality,
      )
      this.scheduleOnce(this.hideLabEffectRoots, 1.4)
      return
    }
    const target = fixture.kind.startsWith('chat-') || fixture.kind.startsWith('trustee-') ? this.topEffectRoot ?? undefined : undefined
    this.effects.previewFlow(fixture.kind, fixture.text, target, quality)
    this.scheduleOnce(this.hideLabEffectRoots, fixture.kind === 'grade' ? 3.2 : 2.4)
  }

  private previewLabSequence (fixture: NonNullable<EffectLabPreview['sequence']>): void {
    if (!this.effects || !this.effectLab) return
    if (this.flightRoot) this.flightRoot.active = true
    if (this.topEffectRoot) this.topEffectRoot.active = true
    this.effects.resetForRecovery(0)
    const seatOrigins = [
      new Vec3(0, -220, 0),
      new Vec3(350, 0, 0),
      new Vec3(0, 205, 0),
      new Vec3(-350, 0, 0),
    ] as const
    fixture.steps.forEach((step, index) => {
      this.scheduleOnce(() => {
        const preview = this.effectLab?.inspect(step.fixtureId, step.quality ?? this.session?.snapshot.settings.effectQuality ?? 'full')
        const source = fixture.mode === 'seat-matrix' ? seatOrigins[index % seatOrigins.length] : new Vec3(-220 + index * 70, -130, 0)
        if (preview?.action) this.effects?.previewAction(preview.action, preview.quality, this.effectLabWorldPoint(source), this.effectLabWorldPoint(Vec3.ZERO))
        else if (preview?.flow) this.effects?.previewFlow(preview.flow.kind, preview.flow.text, this.topEffectRoot ?? undefined)
      }, step.delayMs / 1000)
    })
    const finalDelay = Math.max(0, ...fixture.steps.map(step => step.delayMs)) / 1000 + 2.5
    this.scheduleOnce(this.hideLabEffectRoots, finalDelay)
  }

  private async previewLabDiagnostic (_fixture: NonNullable<EffectLabPreview['diagnostic']>): Promise<void> {
    if (!this.effects) return
    const audit = await this.effects.auditRuntimeAssets()
    const runtime = this.effects.diagnostics()
    const fallback = this.effectLab?.inspect('play-bomb-small', 'full')
    if (fallback?.action) {
      if (this.topEffectRoot) this.topEffectRoot.active = true
      this.effects.previewAction(fallback.action, 'full', this.effectLabWorldPoint(new Vec3(-160, -120, 0)), this.effectLabWorldPoint(Vec3.ZERO))
      this.scheduleOnce(this.hideLabEffectRoots, 1.5)
    }
    this.showNotice(
      audit.missing.length ? '资源检查发现缺失' : '资源检查通过',
      `运行时纹理 ${audit.loaded}/${audit.bundled} · 迁移候选 ${audit.migrationCandidates} · 拒绝 ${audit.rejected}\nRenderer ${runtime.registeredRendererKeys.length} 项 · 缺失 ${audit.missing.join('、') || '无'}\n炸弹纹理失败时静默跳过，不使用代码绘制降级。`,
    )
  }

  private readonly hideLabEffectRoots = (): void => {
    if (this.latestSnapshot) return
    this.effects?.resetForRecovery(0)
    if (this.flightRoot) this.flightRoot.active = false
    if (this.topEffectRoot) this.topEffectRoot.active = false
  }

  private effectLabWorldPoint (localPosition: Vec3): Vec3 {
    return this.topEffectRoot?.getComponent(UITransform)?.convertToWorldSpaceAR(localPosition) ?? localPosition.clone()
  }

  private render (snapshot: GameSnapshot): void {
    this.latestSnapshot = snapshot
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    if (snapshot.phase !== 'playing' && this.handWorkspace.isManualSelectionActive) this.cancelManualGrouping(false)
    this.chat?.setViewer(humanId)
    const humanHand = snapshot.state.players[humanId].hand
    const friendRoomSettings = this.activeFriendRoomSettings()
    const handSortOrder = this.effectiveHandSortOrder()
    this.handWorkspace.syncAuthoritativeHand(humanHand, {
      levelRank: snapshot.state.currentLevel,
      direction: handSortOrder,
      autoSort: !friendRoomSettings || friendRoomSettings.autoSort,
    })
    const grouping = this.handWorkspace.snapshot
    const playingTapMode = this.playingHandTapMode(snapshot, humanId)
    const selectedCardIds = this.handWorkspace.isManualSelectionActive
      ? this.handWorkspace.selectedCardIds
      : snapshot.selectedCardIds
    this.handStackRise = this.hand?.render(
      humanHand,
      selectedCardIds,
      handSortOrder,
      playingTapMode !== 'blocked' || this.canInteractWithHand(snapshot, humanId),
      grouping.displayCardIds,
      grouping.groups,
    ) ?? 0
    const entranceCompletion = this.hand?.consumeEntranceCompletion()
    if (entranceCompletion) this.effects?.waitForPresentation(entranceCompletion, () => this.hand?.finishEntrances())
    this.syncStackAwareControls()
    this.effects?.syncActions(
      snapshot.state.playArea,
      humanId,
      id => this.playerSeats.get(id)?.getPlayOriginWorldPosition() ?? this.hand?.node.worldPosition.clone() ?? Vec3.ZERO,
      id => this.playArea?.getActionWorldPosition(id, humanId) ?? Vec3.ZERO,
      this.playArea
        ? {
            deferAction: (action, actionIndex) => this.playArea!.deferAction(action, actionIndex),
            beginAction: (action, actionIndex, ticket) => this.playArea?.beginAction(action, actionIndex, ticket),
            revealCard: (action, actionIndex, cardId, ticket) => this.playArea?.revealCard(action, actionIndex, cardId, ticket),
            revealAction: (action, actionIndex, ticket) => this.playArea?.revealAction(action, actionIndex, ticket),
            resetPresentation: actionCount => this.playArea?.resetPresentation(actionCount),
          }
        : undefined,
    )
    this.playArea?.render(snapshot.state.playArea, humanId, snapshot.state.lastValidPlay)
    this.layoutSeats(humanId)
    this.renderTributeEffects(snapshot, humanId)
    ;(['p1', 'p2', 'p3', 'p4'] as const).forEach(id => {
      const seat = this.playerSeats.get(id)
      if (!seat) return
      seat.node.active = id !== humanId
      const ranking = snapshot.settlement?.fullRank ?? snapshot.state.finishedPlayers
      const finishPlace = ranking.indexOf(id) + 1
      if (id !== humanId) seat.render(snapshot.state.players[id], snapshot.state.currentTurn === id, this.session?.snapshot.gameMode === 'double_open' && this.oppositeOf(humanId) === id, this.chat?.get(id)?.message, finishPlace)
    })
    this.syncSeatConnections(this.lobby?.snapshot)
    this.renderProgressNotifications(snapshot, humanId)
    const humanFinished = snapshot.state.finishedPlayers.includes(humanId)
    if (this.hintLabel) this.hintLabel.node.active = false
    if (this.phaseLabel) this.phaseLabel.node.active = false
    this.presentTableHint(snapshot)
    const teamLevels = this.lobby?.snapshot.scoreboard?.teamLevels ?? snapshot.teamLevels
    if (this.levelLabel) this.levelLabel.string = `我方 ${teamLevels.teamA} 级    对方 ${teamLevels.teamB} 级`
    if (this.trusteeButton) {
      const trustee = this.lobby?.snapshot.trustees?.[humanId]
      const label = this.trusteeButton.getComponentInChildren(Label)
      if (label) label.string = trustee ? '取消托管' : '托管'
      this.trusteeButton.active = Boolean(this.session?.snapshot.isMultiplayer && snapshot.phase !== 'settlement')
      this.effects?.playTrusteeState(Boolean(trustee), this.trusteeButton)
    }
    const isPlaying = snapshot.phase === 'playing'
    const isTribute = snapshot.phase === 'tribute'
    const isSettlement = snapshot.phase === 'settlement'
    this.layoutActionControls(snapshot, humanId, humanFinished)
    this.renderTableHud(snapshot, humanId)

    if (this.overlayLabel) {
      this.overlayLabel.node.active = !isPlaying
      if (isTribute && snapshot.tribute) {
        const title = snapshot.tribute.isAntiTribute ? '抗贡成立' : snapshot.tribute.phase === 'tributing' ? '进贡阶段' : snapshot.tribute.phase === 'returning' ? '还贡阶段' : '贡还完成'
        const actions = snapshot.tribute.actions.map(action => `${snapshot.state.players[action.from].name} → ${snapshot.state.players[action.to].name}`).join('\n')
        this.overlayLabel.string = `${title}\n${actions}`
      } else if (isSettlement && snapshot.settlement) {
        const campaign = this.session?.snapshot.campaignProgress
        const campaignText = campaign ? `\n战役：${campaign.wins}/${campaign.targetWins} 胜 · ${campaign.losses}/2 负${campaign.completed ? ' · 闯关成功' : campaign.failed ? ' · 闯关失败' : ''}` : ''
        const readyText = this.session?.snapshot.isMultiplayer && !snapshot.settlement.isGameWon
          ? `\n下一局准备 ${this.lobby?.snapshot.roundReadyPlayerIds?.length ?? 0}/4`
          : ''
        const rankNames = snapshot.settlement.fullRank.map(id => snapshot.state.players[id].name).join(' · ')
        this.overlayLabel.string = `${snapshot.settlement.winnerTeam === 'teamA' ? '本局胜利' : '本局失利'}\n${snapshot.settlement.message}\n${rankNames}${campaignText}${readyText}`
      }
    }
    if (snapshot.phase !== this.lastPhase) {
      const previousPhase = this.lastPhase
      this.lastPhase = snapshot.phase
      if (!isPlaying && this.overlayLabel) {
        this.overlayLabel.node.setScale(new Vec3(0.82, 0.82, 1))
        tween(this.overlayLabel.node).to(0.24, { scale: Vec3.ONE }, { easing: 'backOut' }).start()
      }
      if (snapshot.phase === 'settlement' && previousPhase !== 'settlement' && snapshot.settlement) {
        if (this.suppressNextSettlementEffect) this.suppressNextSettlementEffect = false
        else {
          const myTeam = humanId === 'p1' || humanId === 'p3' ? 'teamA' : 'teamB'
          this.effects?.playSettlement(snapshot.settlement.winnerTeam === myTeam, snapshot.settlement.levelUp)
        }
      }
    }
    if (snapshot.state.currentTurn !== this.lastTurn) this.lastTurn = snapshot.state.currentTurn
    if (this.ownChatLabel) {
      this.ownChatLabel.string = this.chat?.get(humanId)?.message ?? ''
      this.ownChatLabel.node.active = Boolean(this.ownChatLabel.string)
    }
  }

  /** Projects only actionable engine feedback onto the short-lived toast lane. */
  private presentTableHint (snapshot: GameSnapshot): void {
    if (snapshot.hint === this.lastPresentedTableHint) return
    this.lastPresentedTableHint = snapshot.hint
    const toast = tableHintToast(snapshot.hint, snapshot.phase)
    if (toast) this.showFinishToast(toast)
  }

  private renderTableHud (snapshot: GameSnapshot, humanId: PlayerId): void {
    if (!this.tableHud) return
    const order: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
    const places: TableGameHudSeatPlace[] = ['bottom', 'right', 'top', 'left']
    const humanIndex = order.indexOf(humanId)
    const viewerTeam = snapshot.state.players[humanId].team
    const opponentTeam = viewerTeam === 'teamA' ? 'teamB' : 'teamA'
    const teamLevels = this.lobby?.snapshot.scoreboard?.teamLevels ?? snapshot.teamLevels
    const ranking = snapshot.settlement?.fullRank ?? snapshot.state.finishedPlayers
    const rankNames = ['头游', '二游', '三游', '末游']
    const multiplayer = Boolean(this.session?.snapshot.isMultiplayer && this.lobby?.snapshot.roomId)
    const members = new Set(this.lobby?.snapshot.members ?? order)
    const seats = order.map((id, index) => {
      const player = snapshot.state.players[id]
      const finishPlace = ranking.indexOf(id) + 1
      return {
        place: places[(index - humanIndex + 4) % 4],
        name: id === humanId ? `${player.name}（我）` : player.name,
        status: finishPlace > 0 ? rankNames[finishPlace - 1] : `剩${player.hand.length}张`,
        avatarText: player.name,
        active: snapshot.phase === 'playing' && snapshot.state.currentTurn === id,
        offline: multiplayer && !members.has(id),
      }
    })
    this.tableHud.render({
      matchLabel: `本局打 ${String(snapshot.state.currentLevel)}`,
      levelLabel: `我方 ${String(teamLevels[viewerTeam])}级 · 对方 ${String(teamLevels[opponentTeam])}级`,
      turnVisible: this.tableHudTurnVisible(snapshot),
      turnSeconds: this.tableHudTurnSeconds(),
      turnDurationSeconds: this.tableTurnDurationSeconds(),
      turnPlace: this.tableHudTurnPlace(snapshot, humanId),
      seats,
      availableSuits: this.handWorkspace.straightFlushAvailability({
        allowAceLowStraight: this.session?.snapshot.settings.rulePreset !== 'tournament',
      }).filter(item => item.available).map(item => item.suit),
      selectedSuit: this.handWorkspace.selectedSuit,
      handLocked: this.handWorkspace.isManualSelectionActive,
      handLockSelectionValid: this.handWorkspace.canLockSelection(),
      arrangeRestoreAvailable: this.handWorkspace.canRestoreArrangement,
    })
  }

  private activeFriendRoomSettings (): FriendRoomSettings | null {
    const lobby = this.lobby?.snapshot
    if (!this.session?.snapshot.isMultiplayer || !lobby?.roomId || lobby.lobbyReadyRequired !== true) return null
    return lobby.roomSettings ?? null
  }

  private effectiveHandSortOrder (): 'asc' | 'desc' {
    return this.activeFriendRoomSettings()?.sortOrder ?? this.session?.snapshot.settings.sortOrder ?? 'desc'
  }

  private tableHudTurnPlace (snapshot: GameSnapshot, humanId: PlayerId): TableGameHudSeatPlace {
    const order: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
    const places: TableGameHudSeatPlace[] = ['bottom', 'right', 'top', 'left']
    const activePlayerId = this.session?.snapshot.isMultiplayer && this.lobby?.snapshot.deadlinePlayerId
      ? this.lobby.snapshot.deadlinePlayerId
      : snapshot.state.currentTurn
    return places[(order.indexOf(activePlayerId) - order.indexOf(humanId) + 4) % 4]
  }

  private tableHudTurnVisible (snapshot: GameSnapshot): boolean {
    return Boolean(this.countdownLabel?.node.active) || (snapshot.phase === 'playing' && !snapshot.actionPending)
  }

  private tableHudTurnSeconds (): number {
    return this.countdownLabel?.node.active ? this.actionCountdown : this.tableTurnDurationSeconds()
  }

  private canInteractWithHand (snapshot: GameSnapshot, humanId: PlayerId): boolean {
    if (snapshot.actionPending) return false
    if (this.session?.snapshot.isMultiplayer && this.lobby?.snapshot.trustees?.[humanId]) return false
    if (snapshot.phase === 'playing') {
      return canSelectPlayingHand(snapshot.state, humanId, snapshot.actionPending)
    }
    if (snapshot.phase !== 'tribute' || !snapshot.tribute || snapshot.tribute.isAntiTribute || snapshot.tribute.phase === 'done') return false
    if (this.session?.snapshot.isMultiplayer && this.lobby?.snapshot.deadlinePlayerId !== humanId) return false
    return snapshot.tribute.phase === 'tributing'
      ? snapshot.tribute.actions.some(action => action.from === humanId && !action.card)
      : snapshot.tribute.actions.some(action => action.to === humanId && !action.returnCard)
  }

  private playingHandTapMode (snapshot: GameSnapshot, humanId: PlayerId): PlayingHandTapMode {
    if (snapshot.phase !== 'playing') return 'blocked'
    if (this.session?.snapshot.isMultiplayer && this.lobby?.snapshot.trustees?.[humanId]) return 'blocked'
    return resolvePlayingHandTapMode(snapshot.state, humanId, snapshot.actionPending, this.handWorkspace.isManualSelectionActive)
  }

  private canEnterHandGrouping (snapshot: GameSnapshot, humanId: PlayerId): boolean {
    if (snapshot.phase !== 'playing') return false
    if (this.session?.snapshot.isMultiplayer && this.lobby?.snapshot.trustees?.[humanId]) return false
    return resolvePlayingHandTapMode(snapshot.state, humanId, snapshot.actionPending, true) === 'grouping'
  }

  /** Only a live rule selection needs clearing when the player explicitly changes modes. */
  private clearCurrentTurnRuleSelection (snapshot: GameSnapshot, humanId: PlayerId): void {
    if (canSelectPlayingHand(snapshot.state, humanId, snapshot.actionPending)) this.gameManager?.clearRuleSelection()
  }

  /** Keeps presentation-only grouping selection out of the rule/action state. */
  private readonly handleCardToggle = (cardId: string): void => {
    const snapshot = this.latestSnapshot
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    if (!snapshot) return
    const tapMode = this.playingHandTapMode(snapshot, humanId)
    if (snapshot.phase === 'playing' && tapMode === 'blocked') return
    if (snapshot.phase === 'playing' && tapMode === 'grouping' && !this.handWorkspace.isManualSelectionActive) {
      this.handWorkspace.beginManualSelection()
    }
    if (!this.handWorkspace.isManualSelectionActive) {
      if (!this.canInteractWithHand(snapshot, humanId)) return
      const stackCardIds = this.handWorkspace.stackSelectionForBottomCard(cardId)
      const manager = this.gameManager
      if (manager && stackCardIds.length > 0) {
        const stackIsExactSelection = manager.selectedCardIds.size === stackCardIds.length &&
          stackCardIds.every(stackCardId => manager.selectedCardIds.has(stackCardId))
        manager.replaceSelectedCards(stackIsExactSelection ? [] : stackCardIds)
      } else {
        manager?.toggleCard(cardId)
      }
      return
    }
    if (tapMode !== 'grouping') return
    const result = this.handWorkspace.toggleManualCard(cardId)
    if (result === 'locked') {
      this.showFinishToast('该牌已锁定，请先拆分牌组')
    }
    this.refreshHandGroupingView()
  }

  private playSelectedWithEffect (): void {
    const manager = this.gameManager
    if (!manager) return
    const validation = this.latestSnapshot?.playValidation
    if (validation && !validation.canPlay) this.showFinishToast(playValidationHint(validation))
    this.effects?.captureLocalOrigins(this.hand?.captureCardOrigins(manager.selectedCardIds) ?? [])
    manager.playSelected()
  }

  private applyNetworkState (packet: NetworkStatePacket): void {
    if (packet.roomId !== this.lobby?.snapshot.roomId) return
    this.frontPages?.hideAll()
    this.setTableVisible(true)
    if (packet.effectSync.mode === 'recovery') this.prepareRecoveryVisualBaseline(packet.state, 'playing')
    if (packet.effectSync.mode === 'recovery') this.handWorkspace.invalidateAuthoritativeHand()
    this.gameManager?.applyServerState(packet.state, packet.state.currentTurn === (this.session?.snapshot.myPlayerId ?? 'p1') ? '轮到你出牌' : '等待其他玩家')
  }

  private applyNetworkRoundPrepared (packet: NetworkRoundPacket): void {
    if (packet.roomId !== this.lobby?.snapshot.roomId) return
    const isLiveNextRound = this.latestSnapshot?.phase === 'settlement' && packet.state.playArea.length === 0
    this.frontPages?.hideAll()
    this.setTableVisible(true)
    const shouldPlayOpening = packet.effectSync.mode !== 'recovery'
    if (!shouldPlayOpening) {
      this.prepareRecoveryVisualBaseline(packet.state, packet.tribute ? 'tribute' : 'playing')
      this.previousTributeEffects = this.collectTributeEffectTokens(packet.tribute)
    } else {
      this.previousTributeEffects.clear()
    }
    if (isLiveNextRound) this.audio?.playRoundStart()
    this.cancelManualGrouping(false)
    this.handWorkspace.invalidateAuthoritativeHand()
    this.gameManager?.applyNetworkRoundPrepared(packet.state, packet.tribute)
    if (shouldPlayOpening) this.effects?.playRoundOpening(`本局打 ${String(packet.state.currentLevel)}`)
  }

  private applyNetworkRoundEnded (packet: NetworkRoundEndedPacket): void {
    this.setTableVisible(true)
    this.suppressNextSettlementEffect = packet.effectSync.mode === 'recovery'
    if (this.suppressNextSettlementEffect) this.lastPhase = 'settlement'
    this.gameManager?.applyNetworkRoundEnded(packet.result)
    this.suppressNextSettlementEffect = false
  }

  /** Opens an isolated local table; this path never reuses matchmaking or room state. */
  private startMasterBotTest (): void {
    const session = this.session
    const manager = this.gameManager
    if (!session || !manager) return
    if (this.lobby?.snapshot.roomId) this.lobby.safeExit()
    manager.abortRound()
    this.previousFinishedPlayers = []
    this.previousHandCounts.clear()
    this.previousTributeEffects.clear()
    this.latestSnapshot = null
    this.suppressNextSettlementEffect = false
    this.effects?.resetForRecovery(0)
    this.frontPages?.hideAll()
    this.setFriendRoomWaitingVisible(false)
    this.setTableVisible(true)
    session.beginLocalGame('standard')
    manager.startRound()
  }

  private prepareRecoveryVisualBaseline (state: NetworkStatePacket['state'], phase: GameSnapshot['phase']): void {
    this.effects?.resetForRecovery(state.playArea.length)
    this.previousFinishedPlayers = [...state.finishedPlayers]
    this.previousHandCounts.clear()
    ;(['p1', 'p2', 'p3', 'p4'] as const).forEach(id => this.previousHandCounts.set(id, state.players[id].hand.length))
    this.lastTurn = state.currentTurn
    this.lastPhase = phase
  }

  private applyNetworkError (message: string): void {
    const status = this.session?.snapshot.status
    if (!this.latestSnapshot || status === 'menu' || status === 'lobby' || status === 'grouping' || status === 'dealing') return
    this.gameManager?.applyNetworkError(message)
  }

  private applyNetworkResult (result: LobbyNetworkResult): void {
    this.gameManager?.applyNetworkResult(result)
  }

  private applyNetworkRoomClosed (): void {
    this.clearExitDialog()
    this.clearDissolveDialog()
    this.gameManager?.abortRound()
    this.previousFinishedPlayers = []
    this.previousHandCounts.clear()
    this.previousTributeEffects.clear()
    this.latestSnapshot = null
    this.suppressNextSettlementEffect = false
    this.effects?.resetForRecovery(0)
    this.frontPages?.showLobby()
  }

  private handleNextRound (): void {
    if (this.latestSnapshot?.settlement?.isGameWon && this.session?.snapshot.isMultiplayer) {
      this.leaveTableToMenu()
      return
    }
    if (this.session?.snapshot.isMultiplayer) {
      const humanId = this.session.snapshot.myPlayerId ?? 'p1'
      const ready = this.lobby?.snapshot.roundReadyPlayerIds?.includes(humanId) ?? false
      if (ready) this.lobby?.cancelRoundReady()
      else this.lobby?.readyNextRound()
      return
    }
    const before = this.latestSnapshot?.phase
    this.gameManager?.nextRound()
    if (before === 'settlement' && this.latestSnapshot?.phase !== 'settlement') {
      this.previousTributeEffects.clear()
      this.effects?.playRoundOpening(`本局打 ${String(this.latestSnapshot?.state.currentLevel ?? '')}`.trim())
    }
  }

  private readonly refreshNetworkPresentation = (): void => {
    if (this.latestSnapshot) this.render(this.latestSnapshot)
  }

  private readonly applyNetworkTurnTimeout = (packet: { playerId: PlayerId | null, enteredTrustee: boolean }): void => {
    if (!packet.playerId) return
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    const name = packet.playerId === humanId
      ? '你'
      : this.latestSnapshot?.state.players[packet.playerId].name ?? packet.playerId
    this.showFinishToast(packet.enteredTrustee ? `${name}连续超时，已进入托管` : `${name}操作超时，服务器已自动处理`)
    this.refreshNetworkPresentation()
  }

  private readonly applyNetworkDissolveVote = (packet: { vote: NetworkDissolveVote | null, outcome: 'rejected' | 'expired' | null }): void => {
    if (packet.outcome) {
      this.clearDissolveDialog()
      this.showFinishToast(packet.outcome === 'rejected' ? '解散申请未通过，牌局继续' : '解散投票已超时，牌局继续')
      return
    }
    const vote = packet.vote
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    if (!vote || vote.votes[humanId] !== 'pending') {
      this.clearDissolveDialog()
      return
    }
    this.showDissolveVoteDialog(vote)
  }

  private toggleTrustee (): void {
    if (!this.session?.snapshot.isMultiplayer || !this.lobby) return
    const humanId = this.session.snapshot.myPlayerId ?? 'p1'
    if (this.lobby.snapshot.trustees?.[humanId]) this.lobby.cancelTrustee()
    else this.lobby.setTrustee()
  }

  private applyNetworkChat (packet: { playerId: PlayerId, text: string }): void {
    const phrase = QUICK_CHAT_PHRASES.find(item => item.text === packet.text)
    const viewerId = this.session?.snapshot.myPlayerId ?? 'p1'
    const blocked = this.chat?.isBlocked(viewerId, packet.playerId) ?? false
    const decision = this.chat?.show(packet.playerId, packet.text, phrase?.voice ?? '')
    if (phrase && decision?.accepted && !blocked) {
      this.audio?.playVoice(phrase.voice)
      this.playChatPulseFor(packet.playerId)
    }
  }

  private playChatPulseFor (playerId: PlayerId): void {
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    const target = playerId === humanId ? this.ownChatLabel?.node : this.playerSeats.get(playerId)?.node
    if (!target) return
    this.effects?.playChatPulse(target, target.worldPosition.x < 0 ? 'left' : 'right')
  }

  /** Lets the first playable scene run before the art prefabs are bound in Creator. */
  private ensureFallbackUi (): void {
    this.ensureBackdrop()
    if (!this.hand) {
      const handNode = new Node('HumanHand')
      handNode.parent = this.node
      handNode.setPosition(new Vec3(0, -265, 0))
      handNode.addComponent(UITransform).setContentSize(1040, 150)
      this.hand = handNode.addComponent(HandController)
    }
    if (!this.playArea) {
      const playNode = new Node('PlayArea')
      playNode.parent = this.node
      playNode.addComponent(UITransform).setContentSize(900, 420)
      this.playArea = playNode.addComponent(PlayAreaController)
    }
    ;(['p1', 'p2', 'p3', 'p4'] as const).forEach(id => {
      if (this.playerSeats.has(id)) return
      const seat = new Node(`Seat-${id}`)
      seat.parent = this.node
      seat.setPosition(new Vec3(0, 0, 0))
      this.playerSeats.set(id, seat.addComponent(PlayerSeatController))
    })
    this.hintLabel ??= this.makeLabel('Hint', 410, -123, 24)
    this.hintLabel.node.getComponent(UITransform)?.setContentSize(420, 38)
    this.hintLabel.overflow = Label.Overflow.SHRINK
    this.hintLabel.verticalAlign = Label.VerticalAlign.CENTER
    this.phaseLabel ??= this.makeLabel('Phase', 0, 282, 30)
    this.levelLabel ??= this.makeLabel('Level', -475, 268, 18)
    this.levelLabel.node.getComponent(UITransform)?.setContentSize(300, 38)
    this.levelLabel.horizontalAlign = Label.HorizontalAlign.LEFT
    this.countdownLabel ??= this.makeLabel('ActionCountdown', 0, -126, 22)
    this.countdownLabel.node.getComponent(UITransform)?.setContentSize(100, 38)
    this.countdownLabel.node.active = false
    this.overlayLabel ??= this.makeLabel('Overlay', 0, 42, 30)
    this.passButton ??= this.makeButton('PassButton', '不要', -185, 112, 54, 28)
    this.hintButton ??= this.makeButton('HintButton', '提示', -62, 112, 54, 28)
    this.playButton ??= this.makeButton('PlayButton', '出牌', 70, 128, 58, 28)
    this.confirmTributeButton ??= this.makeButton('ConfirmTributeButton', '确认贡牌', 0)
    this.finishTributeButton ??= this.makeButton('FinishTributeButton', '开始本局', 0)
    this.nextRoundButton ??= this.makeButton('NextRoundButton', '下一局', 0)
    this.trusteeButton ??= this.makeButton('TrusteeButton', '托管', 535, 112, 44, 18)
    this.trusteeButton.active = false
    this.trusteeButton.on(Node.EventType.TOUCH_END, this.toggleTrustee, this)
    this.ownChatLabel ??= this.makeLabel('OwnChatBubble', -430, -123, 18)
    this.ownChatLabel.node.getComponent(UITransform)?.setContentSize(420, 34)
    this.ownChatLabel.overflow = Label.Overflow.SHRINK
    this.ownChatLabel.verticalAlign = Label.VerticalAlign.CENTER
    this.ownChatLabel.color = new Color(245, 239, 215)
    this.ownChatLabel.node.active = false
    this.finishToastLabel ??= this.makeLabel('FinishToast', 0, 98, 26)
    this.finishToastLabel.node.getComponent(UITransform)?.setContentSize(560, 56)
    this.finishToastLabel.overflow = Label.Overflow.SHRINK
    this.finishToastLabel.verticalAlign = Label.VerticalAlign.CENTER
    this.finishToastLabel.color = new Color(255, 226, 126)
    this.finishToastLabel.node.active = false
    this.skipEffectButton ??= this.makeButton('SkipEffectButton', '跳过动画', 0, 132, 42, 18)
    this.skipEffectButton.active = false
    this.skipEffectButton.on(Node.EventType.TOUCH_END, () => this.effects?.skipAll(), this)
  }

  /** Mounts the table chrome above flights and below major effects. */
  private ensureTableHud (): void {
    if (this.tableHud) return
    const hud = new TableGameHud({
      onBack: () => this.requestLeaveTable(),
      onSuitSelect: suit => this.handleTableHudSuit(suit),
      onHandLockChange: locked => this.handleTableHudHandLock(locked),
      onArrange: () => this.arrangeTableHudHand(),
      onChat: () => this.toggleChatPanel(),
    })
    this.tableHud = hud
    const hudNode = hud.mount(this.node)
    hud.setTurnActionNodes([this.hintButton, this.passButton, this.playButton])
    ;[this.hintButton, this.passButton, this.playButton].forEach(node => { if (node) node.active = false })
    hud.setVisible(false)
    this.requestTableTimerArtwork()
    this.requestTableAvatarArtwork()

    // These fallback nodes still own timing/navigation behavior; their visual
    // presentation is replaced by the table HUD.
    ;[this.levelLabel, this.countdownLabel].forEach(label => { if (label) label.enabled = false })
    this.playerSeats.forEach(seat => {
      const panel = seat.node.getComponent(Graphics)
      if (panel) panel.enabled = false
      const text = seat.node.getChildByName('SeatText')
      if (text) text.active = false
    })

    this.flightRoot?.setSiblingIndex(this.node.children.length - 1)
    hudNode.setSiblingIndex(this.node.children.length - 1)
    this.topEffectRoot?.setSiblingIndex(this.node.children.length - 1)
    this.skipEffectButton?.setSiblingIndex(this.node.children.length - 1)
  }

  private requestTableTimerArtwork (): void {
    if (this.tableTimerArtworkRequested) return
    this.tableTimerArtworkRequested = true
    loadGameAsset(TABLE_TIMER_ART_ASSET, Texture2D, (error, texture) => {
      if (error || !texture || !this.node.isValid || !this.tableHud) {
        if (error) console.warn('Unable to load the chicken timer artwork; using the circular fallback.', error)
        return
      }
      const artwork = new Node('ChickenTimerArtwork')
      artwork.addComponent(UITransform).setContentSize(112, 112)
      const sprite = artwork.addComponent(Sprite)
      sprite.sizeMode = Sprite.SizeMode.CUSTOM
      const frame = new SpriteFrame()
      frame.texture = texture
      sprite.spriteFrame = frame
      this.tableHud.setTimerArtwork(artwork)
    })
  }

  private requestTableAvatarArtwork (): void {
    if (this.tableAvatarArtworkRequested) return
    this.tableAvatarArtworkRequested = true
    loadGameAsset(DEFAULT_AVATAR_ART_ASSET, Texture2D, (error, texture) => {
      if (error || !texture || !this.node.isValid || !this.tableHud) {
        if (error) console.warn('Unable to load the default avatar artwork.', error)
        return
      }
      const frame = new SpriteFrame()
      frame.texture = texture
      this.tableHud.setDefaultAvatarFrame(frame)
    })
  }

  /** Separates shakeable table content, card flights, HUD and top-level effects. */
  private ensureEffectHierarchy (): void {
    if (this.effects) return
    this.tableShakeRoot = new Node('GameTableShakeRoot')
    this.tableShakeRoot.parent = this.node
    this.tableShakeRoot.addComponent(UITransform).setContentSize(1280, 720)
    this.playArea?.node.setParent(this.tableShakeRoot, true)
    this.playerSeats.forEach(seat => seat.node.setParent(this.tableShakeRoot!, true))

    this.flightRoot = new Node('CardFlightRoot')
    this.flightRoot.parent = this.node
    this.flightRoot.addComponent(UITransform).setContentSize(1280, 720)
    this.topEffectRoot = new Node('TopEffectRoot')
    this.topEffectRoot.parent = this.node
    this.topEffectRoot.addComponent(UITransform).setContentSize(1280, 720)
    const effects = (this.getComponent(EffectController) ?? this.addComponent(EffectController)) as EffectController
    this.effects = effects
    effects.setup(
      this.tableShakeRoot,
      this.flightRoot,
      this.topEffectRoot,
      key => this.audio?.playEffect(key),
      action => this.audio?.playActionVoice(action),
      busy => { if (this.skipEffectButton) this.skipEffectButton.active = busy && Boolean(this.latestSnapshot) },
      () => (this.hand?.collectCardBlastTargets() ?? []).concat(this.playArea?.collectCardBlastTargets() ?? []),
    )
    const settings = this.session?.snapshot.settings
    if (settings) effects.configure(settings.effectQuality, settings.hapticEnabled)
    this.flightRoot.setSiblingIndex(this.node.children.length - 1)
    this.topEffectRoot.setSiblingIndex(this.node.children.length - 1)
    this.skipEffectButton?.setSiblingIndex(this.node.children.length - 1)
  }

  private renderLobby (snapshot: LobbySnapshot): void {
    this.frontPages?.renderLobby(snapshot)
    this.syncSeatConnections(snapshot)
    if (this.latestSnapshot) this.render(this.latestSnapshot)
  }

  /** Keeps room connectivity as seat-only presentation state, separate from GameManager and hand selection. */
  private syncSeatConnections (snapshot?: LobbySnapshot): void {
    const multiplayerTable = Boolean(this.latestSnapshot && this.session?.snapshot.isMultiplayer && snapshot?.roomId)
    ;(['p1', 'p2', 'p3', 'p4'] as const).forEach(id => {
      const seat = this.playerSeats.get(id)
      if (!seat) return
      if (!multiplayerTable || !snapshot) {
        seat.clearConnectionStatus()
        return
      }
      seat.setOffline(!snapshot.members.includes(id))
    })
  }

  private setTableVisible (visible: boolean): void {
    this.friendRoomWaitingVisible = false
    this.audio?.setBgmMode(visible ? 'battle' : 'lobby')
    this.setBackdropMode(visible ? 'table' : 'lobby')
    if (!visible) {
      this.actionCountdownKey = ''
      this.actionCountdown = 20
      this.lastPresentedTableHint = ''
      this.handWorkspace.resetForTableExit()
      this.playArea?.clearPresentation()
    }
    if (!visible) this.clearNodes(this.chatNodes)
    if (!visible && this.finishToastLabel) this.finishToastLabel.node.active = false
    if (!visible && this.skipEffectButton) this.skipEffectButton.active = false
    this.tableHud?.setVisible(visible)
    const tableNodes = [this.hand?.node, this.tableShakeRoot, this.flightRoot, this.topEffectRoot, this.hintLabel?.node, this.phaseLabel?.node, this.levelLabel?.node, this.countdownLabel?.node, this.overlayLabel?.node, this.ownChatLabel?.node, this.trusteeButton, this.confirmTributeButton, this.finishTributeButton, this.nextRoundButton]
    tableNodes.push(...Array.from(this.playerSeats.values(), seat => seat.node))
    tableNodes.forEach(node => { if (node) node.active = visible })
    if (!visible) {
      ;[this.playButton, this.passButton, this.hintButton].forEach(node => { if (node) node.active = false })
    }
    if (!visible) this.cancelManualGrouping(false)
  }

  private setFriendRoomWaitingVisible (visible: boolean): void {
    if (visible && this.friendRoomWaitingVisible) {
      this.setBackdropMode('table')
      return
    }
    if (visible) {
      this.setTableVisible(false)
      this.friendRoomWaitingVisible = true
      this.audio?.setBgmMode('lobby')
      this.setBackdropMode('table')
      return
    }
    this.friendRoomWaitingVisible = false
    if (!this.tableHud?.node?.active) this.setBackdropMode('lobby')
  }

  private layoutSeats (humanId: 'p1' | 'p2' | 'p3' | 'p4'): void {
    const order: Array<'p1' | 'p2' | 'p3' | 'p4'> = ['p1', 'p2', 'p3', 'p4']
    const humanIndex = order.indexOf(humanId)
    const screen = this.screen
    const positions = screen
      ? [new Vec3(0, screen.safeBottomY(90), 0), new Vec3(screen.safeRightX(105), 22, 0), new Vec3(-220, 218, 0), new Vec3(screen.safeLeftX(105), 22, 0)]
      : [new Vec3(0, -260, 0), new Vec3(510, 35, 0), new Vec3(-220, 218, 0), new Vec3(-510, 35, 0)]
    order.forEach((id, index) => {
      const slot = (index - humanIndex + 4) % 4
      const seat = this.playerSeats.get(id)
      seat?.node.setPosition(positions[slot])
      seat?.setChatBubbleAbove(slot !== 2)
    })
  }

  private oppositeOf (id: 'p1' | 'p2' | 'p3' | 'p4'): 'p1' | 'p2' | 'p3' | 'p4' {
    const opposites: Record<'p1' | 'p2' | 'p3' | 'p4', 'p1' | 'p2' | 'p3' | 'p4'> = { p1: 'p3', p2: 'p4', p3: 'p1', p4: 'p2' }
    return opposites[id]
  }

  private clearNodes (nodes: Node[]): void { while (nodes.length) nodes.pop()?.destroy() }

  private tableControlsY (): number {
    const base = this.screen?.safeBottomY(200) ?? -160
    return base + Math.max(0, this.handStackRise - 32)
  }

  /**
   * A raised operation row would put its normal upper countdown lane on top
   * of the centre-table pass/action text. In that case use the clear strip
   * between the buttons and the hand instead.
   */
  private tableCountdownY (controlsY: number): number {
    return controlsY + (this.handStackRise > 32 ? -47 : 47)
  }

  /** Raises the operation lane when a downward cascade starts above the hand. */
  private syncStackAwareControls (): void {
    const controlsY = this.tableControlsY()
    this.trusteeButton?.setPosition(new Vec3(this.screen?.safeRightX(70) ?? 570, controlsY + 54, 0))
  }

  /** Repositions every table control when the device rotates, resizes or exposes a notch inset. */
  private applyResponsiveLayout (viewport: TableViewport): void {
    this.frontPages?.resize(viewport.width, viewport.height)
    const safeWidth = viewport.width - viewport.safeLeft - viewport.safeRight
    const controlsY = this.tableControlsY()
    this.hand?.node.setPosition(new Vec3(0, this.screen?.safeBottomY(112) ?? -248, 0))
    this.hand?.node.getComponent(UITransform)?.setContentSize(Math.max(300, safeWidth - 380), 150)
    this.playArea?.node.getComponent(UITransform)?.setContentSize(Math.max(300, safeWidth - 360), Math.max(300, viewport.height - 270))
    ;[this.tableShakeRoot, this.flightRoot, this.topEffectRoot].forEach(root => root?.getComponent(UITransform)?.setContentSize(viewport.width, viewport.height))
    const safeTop = this.screen?.safeTopY(158) ?? 202
    const safeBottom = this.screen?.safeBottomY(260) ?? -100
    const toastY = safeBottom <= safeTop ? Math.max(safeBottom, Math.min(safeTop, 98)) : (safeBottom + safeTop) / 2
    this.finishToastLabel?.node.setPosition(new Vec3(0, toastY, 90))
    this.finishToastLabel?.node.getComponent(UITransform)?.setContentSize(Math.max(220, Math.min(560, safeWidth - 32)), 56)
    this.overlayLabel?.node.setPosition(Vec3.ZERO)
    this.overlayLabel?.node.getComponent(UITransform)?.setContentSize(
      Math.max(280, Math.min(860, safeWidth - 64)),
      Math.max(140, Math.min(300, viewport.height - viewport.safeTop - viewport.safeBottom - 180)),
    )
    if (this.overlayLabel) {
      this.overlayLabel.overflow = Label.Overflow.SHRINK
      this.overlayLabel.enableWrapText = true
      this.overlayLabel.verticalAlign = Label.VerticalAlign.CENTER
    }
    if (!this.tableHud) {
      this.hintButton?.setPosition(new Vec3(-126, controlsY, 0))
      this.passButton?.setPosition(new Vec3(0, controlsY, 0))
      this.playButton?.setPosition(new Vec3(126, controlsY, 0))
    }
    this.confirmTributeButton?.setPosition(new Vec3(0, controlsY, 0))
    this.finishTributeButton?.setPosition(new Vec3(0, controlsY, 0))
    this.nextRoundButton?.setPosition(new Vec3(0, controlsY, 0))
    this.levelLabel?.node.setPosition(new Vec3(this.screen?.safeLeftX(165) ?? -475, this.screen?.safeTopY(92) ?? 268, 0))
    this.levelLabel?.node.getComponent(UITransform)?.setContentSize(300, 38)
    if (this.levelLabel) this.levelLabel.horizontalAlign = Label.HorizontalAlign.LEFT
    this.ownChatLabel?.node.setPosition(new Vec3(this.screen?.safeLeftX(220) ?? -420, this.screen?.safeTopY(235) ?? 125, 0))
    this.trusteeButton?.setPosition(new Vec3(this.screen?.safeRightX(70) ?? 570, controlsY + 54, 0))
    this.skipEffectButton?.setPosition(new Vec3(this.screen?.safeRightX(90) ?? 550, this.screen?.safeTopY(40) ?? 320, 0))
    this.clearNodes(this.chatNodes)
    this.redrawBackdrop(viewport)
    this.tableHud?.layout(viewport)
    if (this.latestSnapshot) this.render(this.latestSnapshot)
  }

  private layoutActionControls (snapshot: GameSnapshot, humanId: PlayerId, humanFinished: boolean): void {
    const controls = [this.hintButton, this.passButton, this.playButton, this.confirmTributeButton, this.finishTributeButton, this.nextRoundButton]
    controls.forEach(node => { if (node) node.active = false })
    const controlsY = this.tableControlsY()
    this.updateActionCountdown(snapshot, humanId, humanFinished, controlsY)
    if (snapshot.actionPending) return
    if (snapshot.phase === 'tribute') {
      if (this.session?.snapshot.isMultiplayer) {
        if (this.lobby?.snapshot.deadlinePlayerId !== humanId || this.lobby.snapshot.trustees?.[humanId]) return
      }
      const ready = Boolean(snapshot.tribute?.isAntiTribute || snapshot.tribute?.phase === 'done')
      const expectedAction = this.lobby?.snapshot.deadlineAction
      const node = ready
        ? (!this.session?.snapshot.isMultiplayer || expectedAction === 'finishTribute' ? this.finishTributeButton : null)
        : this.canInteractWithHand(snapshot, humanId) ? this.confirmTributeButton : null
      if (node) { node.active = true; node.setPosition(new Vec3(0, controlsY, 0)) }
      return
    }
    if (snapshot.phase === 'settlement') {
      const gameWon = Boolean(snapshot.settlement?.isGameWon)
      if (this.nextRoundButton) {
        const label = this.nextRoundButton.getComponentInChildren(Label)
        const ready = this.lobby?.snapshot.roundReadyPlayerIds?.includes(humanId) ?? false
        if (label) label.string = gameWon
          ? (this.session?.snapshot.isMultiplayer ? '本场结束 · 返回大厅' : '重新开局')
          : this.session?.snapshot.isMultiplayer
            ? (ready ? '取消准备' : '准备下一局')
            : '下一局'
        this.nextRoundButton.active = true
        this.nextRoundButton.setPosition(new Vec3(0, controlsY, 0))
      }
      return
    }
    if (this.session?.snapshot.isMultiplayer && this.lobby?.snapshot.trustees?.[humanId]) return
    if (humanFinished || snapshot.state.currentTurn !== humanId) return
    const visible = [this.hintButton, this.passButton, this.playButton].filter((node): node is Node => Boolean(node))
    const spacing = 126
    const startX = -spacing * (visible.length - 1) / 2
    visible.forEach((node, index) => {
      node.active = true
      if (this.tableHud) return
      const target = new Vec3(startX + index * spacing, controlsY, 0)
      tween(node).stop().to(0.12, { position: target }, { easing: 'quadOut' }).start()
    })
  }

  private updateActionCountdown (snapshot: GameSnapshot, humanId: PlayerId, humanFinished: boolean, controlsY: number): void {
    const networkReady = !this.session?.snapshot.isMultiplayer || this.lobby?.snapshot.roomStatus === 'ready'
    const multiplayer = Boolean(this.session?.snapshot.isMultiplayer)
    const networkDeadlineAvailable = Boolean(
      multiplayer &&
      networkReady &&
      !snapshot.actionPending &&
      (snapshot.phase === 'playing' || snapshot.phase === 'tribute') &&
      this.lobby?.snapshot.turnDeadlineAt &&
      this.lobby.snapshot.deadlinePlayerId &&
      this.lobby.snapshot.deadlineAction,
    )
    const available = multiplayer
      ? networkDeadlineAvailable
      : networkReady && !snapshot.actionPending && snapshot.phase === 'playing' && !humanFinished && snapshot.state.currentTurn === humanId
    if (!this.countdownLabel) return
    this.countdownLabel.node.active = available
    if (!available) {
      this.actionCountdownKey = ''
      this.syncTableHudCountdown()
      return
    }
    if (multiplayer) {
      const deadline = this.lobby?.snapshot.turnDeadlineAt
      if (!deadline) {
        this.countdownLabel.node.active = false
        this.actionCountdownKey = ''
        this.syncTableHudCountdown()
        return
      }
      this.actionCountdownKey = `server:${deadline}`
      this.actionCountdown = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      this.countdownLabel.node.setPosition(new Vec3(0, this.tableCountdownY(controlsY), 0))
      this.refreshCountdownLabel()
      return
    }
    const key = `${snapshot.phase}:${snapshot.state.currentTurn}:${snapshot.state.playArea.length}:${snapshot.state.finishedPlayers.length}`
    if (key !== this.actionCountdownKey) {
      this.actionCountdownKey = key
      this.actionCountdown = 20
    }
    this.countdownLabel.node.setPosition(new Vec3(0, this.tableCountdownY(controlsY), 0))
    this.refreshCountdownLabel()
  }

  private readonly tickActionCountdown = (): void => {
    this.refreshDissolveCountdown()
    if (!this.countdownLabel?.node.active || this.actionCountdown <= 0) return
    if (this.session?.snapshot.isMultiplayer) {
      const deadline = this.lobby?.snapshot.turnDeadlineAt
      if (!deadline) {
        this.countdownLabel.node.active = false
        this.syncTableHudCountdown()
        return
      }
      const previous = this.actionCountdown
      this.actionCountdown = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (this.actionCountdown !== previous && this.actionCountdown > 0 && this.actionCountdown <= 5) this.audio?.playCountdown(this.actionCountdown)
      this.refreshCountdownLabel()
      return
    }
    this.actionCountdown -= 1
    if (this.actionCountdown > 0 && this.actionCountdown <= 5) this.audio?.playCountdown(this.actionCountdown)
    this.refreshCountdownLabel()
    if (this.actionCountdown === 0) this.gameManager?.actOnTimeout()
  }

  private refreshCountdownLabel (): void {
    if (!this.countdownLabel) return
    const deadlinePlayerId = this.lobby?.snapshot.deadlinePlayerId
    const deadlineAction = this.lobby?.snapshot.deadlineAction
    if (this.session?.snapshot.isMultiplayer && deadlinePlayerId && deadlineAction && deadlineAction !== 'play') {
      const playerName = this.latestSnapshot?.state.players[deadlinePlayerId].name ?? deadlinePlayerId
      const actionLabel: Record<Exclude<NetworkDeadlineAction, 'play'>, string> = {
        tribute: '进贡',
        returnTribute: '还贡',
        finishTribute: '开始本局',
      }
      this.countdownLabel.string = `${playerName} · ${actionLabel[deadlineAction]} ${this.actionCountdown}s`
    } else this.countdownLabel.string = `${this.actionCountdown}s`
    this.countdownLabel.color = this.actionCountdown <= 5 ? new Color(255, 126, 96) : new Color(245, 224, 156)
    this.syncTableHudCountdown()
  }

  private syncTableHudCountdown (): void {
    const snapshot = this.latestSnapshot
    if (!snapshot || !this.tableHud) return
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    this.tableHud.update({
      turnVisible: this.tableHudTurnVisible(snapshot),
      turnSeconds: this.tableHudTurnSeconds(),
      turnDurationSeconds: this.tableTurnDurationSeconds(),
      turnPlace: this.tableHudTurnPlace(snapshot, humanId),
    })
  }

  private tableTurnDurationSeconds (): number {
    return this.session?.snapshot.isMultiplayer ? (this.lobby?.snapshot.roomSettings?.turnSeconds ?? 20) : 20
  }

  private renderProgressNotifications (snapshot: GameSnapshot, humanId: PlayerId): void {
    if (snapshot.state.finishedPlayers.length < this.previousFinishedPlayers.length) {
      this.previousFinishedPlayers = []
      this.previousHandCounts.clear()
    }
    const newFinishers = snapshot.state.finishedPlayers.filter(id => !this.previousFinishedPlayers.includes(id))
    newFinishers.forEach(id => {
      const place = snapshot.state.finishedPlayers.indexOf(id)
      const rank = ['头游', '二游', '三游', '末游'][place] ?? '完成'
      const text = id === humanId ? `你已出完 · ${rank}` : `${snapshot.state.players[id].name} 已出完 · ${rank}`
      this.showFinishToast(text)
      this.effects?.playPlayerFinished(text)
    })
    ;(['p1', 'p2', 'p3', 'p4'] as const).forEach(id => {
      const count = snapshot.state.players[id].hand.length
      const previous = this.previousHandCounts.get(id)
      if (id !== humanId && count > 0 && count <= 10 && previous !== undefined && previous > 10) {
        this.showFinishToast(`${snapshot.state.players[id].name} 仅剩 ${count} 张牌`)
      }
      this.previousHandCounts.set(id, count)
    })
    this.previousFinishedPlayers = [...snapshot.state.finishedPlayers]
  }

  private collectTributeEffectTokens (tribute: GameSnapshot['tribute']): Set<string> {
    const tokens = new Set<string>()
    if (!tribute) return tokens
    if (tribute.isAntiTribute) tokens.add('anti-tribute')
    tribute.actions.forEach(action => {
      if (action.card) tokens.add(`give:${action.from}:${action.to}:${action.card.id}`)
      if (action.returnCard) tokens.add(`return:${action.to}:${action.from}:${action.returnCard.id}`)
    })
    return tokens
  }

  private renderTributeEffects (snapshot: GameSnapshot, humanId: PlayerId): void {
    if (snapshot.phase !== 'tribute' || !snapshot.tribute) {
      this.previousTributeEffects.clear()
      return
    }
    const tribute = snapshot.tribute
    const current = this.collectTributeEffectTokens(tribute)
    if (tribute.isAntiTribute && !this.previousTributeEffects.has('anti-tribute')) {
      this.effects?.playTribute({ phase: 'anti-tribute', from: humanId, to: humanId, card: null }, Vec3.ZERO, Vec3.ZERO)
    }
    tribute.actions.forEach(action => {
      if (action.card) {
        const token = `give:${action.from}:${action.to}:${action.card.id}`
        if (!this.previousTributeEffects.has(token)) {
          this.effects?.playTribute(
            { phase: 'tribute', from: action.from, to: action.to, card: action.card },
            this.playerEffectOrigin(action.from, humanId),
            this.playerEffectOrigin(action.to, humanId),
          )
        }
      }
      if (action.returnCard) {
        const token = `return:${action.to}:${action.from}:${action.returnCard.id}`
        if (!this.previousTributeEffects.has(token)) {
          this.effects?.playTribute(
            { phase: 'return', from: action.to, to: action.from, card: action.returnCard },
            this.playerEffectOrigin(action.to, humanId),
            this.playerEffectOrigin(action.from, humanId),
          )
        }
      }
    })
    this.previousTributeEffects = current
  }

  private playerEffectOrigin (playerId: PlayerId, humanId: PlayerId): Vec3 {
    if (playerId === humanId) return this.hand?.node.worldPosition.clone() ?? Vec3.ZERO
    return this.playerSeats.get(playerId)?.getPlayOriginWorldPosition() ?? Vec3.ZERO
  }

  private showFinishToast (text: string): void {
    const label = this.finishToastLabel
    if (!label) return
    this.unschedule(this.hideFinishToast)
    label.string = text
    label.node.active = true
    label.node.setSiblingIndex(this.node.children.length - 1)
    const opacity = label.node.getComponent(UIOpacity) ?? label.node.addComponent(UIOpacity)
    opacity.opacity = 0
    label.node.setScale(new Vec3(0.82, 0.82, 1))
    tween(opacity).to(0.14, { opacity: 255 }).start()
    tween(label.node).to(0.2, { scale: Vec3.ONE }, { easing: 'backOut' }).start()
    this.scheduleOnce(this.hideFinishToast, 1.6)
  }

  private readonly hideFinishToast = (): void => {
    if (!this.finishToastLabel) return
    const label = this.finishToastLabel
    const opacity = label.node.getComponent(UIOpacity)
    if (!opacity) { label.node.active = false; return }
    tween(opacity).to(0.18, { opacity: 0 }).call(() => { label.node.active = false }).start()
  }

  private requestLeaveTable (): void {
    const multiplayer = Boolean(this.session?.snapshot.isMultiplayer)
    if (this.latestSnapshot?.phase === 'settlement' && (!multiplayer || this.latestSnapshot.settlement?.isGameWon)) { this.leaveTableToMenu(); return }
    if (this.exitDialog) return
    const viewport = this.screen?.viewport ?? { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 }
    const overlay = new Node('ExitTableDialog')
    overlay.parent = this.node
    overlay.addComponent(UITransform).setContentSize(viewport.width, viewport.height)
    overlay.addComponent(BlockInputEvents)
    const graphics = overlay.addComponent(Graphics)
    graphics.fillColor = new Color(2, 12, 14, 185)
    graphics.rect(-viewport.halfWidth, -viewport.halfHeight, viewport.width, viewport.height)
    graphics.fill()
    graphics.fillColor = new Color(26, 43, 43, 250)
    graphics.strokeColor = new Color(218, 179, 79, 255)
    graphics.lineWidth = 3
    const panelWidth = multiplayer ? 680 : 520
    graphics.roundRect(-panelWidth / 2, -130, panelWidth, 260, 22)
    graphics.fill()
    graphics.stroke()
    const title = this.makeLabel('ExitTitle', 0, 58, 32)
    title.string = this.session?.snapshot.isMultiplayer ? '退出联机牌局？' : '返回大厅？'
    title.node.parent = overlay
    const detail = this.makeLabel('ExitDetail', 0, 15, 18)
    detail.string = multiplayer ? '安全退出后由托管继续；申请解散需全员同意。' : '当前未完成牌局不会计入战绩。'
    detail.node.parent = overlay
    const stay = this.makeButton('StayButton', '继续游戏', 0, multiplayer ? 176 : 210)
    stay.parent = overlay
    stay.setPosition(new Vec3(multiplayer ? -210 : -125, -70, 0))
    stay.on(Node.EventType.TOUCH_END, this.clearExitDialog, this)
    const leave = this.makeButton('LeaveButton', multiplayer ? '安全退出' : '返回大厅', 0, multiplayer ? 176 : 210)
    leave.parent = overlay
    leave.setPosition(new Vec3(multiplayer ? 0 : 125, -70, 0))
    leave.on(Node.EventType.TOUCH_END, multiplayer ? this.safeExitTableToMenu : this.leaveTableToMenu, this)
    if (multiplayer) {
      const dissolve = this.makeButton('DissolveButton', '申请解散', 0, 176)
      dissolve.parent = overlay
      dissolve.setPosition(new Vec3(210, -70, 0))
      dissolve.on(Node.EventType.TOUCH_END, this.proposeDissolve, this)
    }
    overlay.setSiblingIndex(this.node.children.length - 1)
    this.exitDialog = overlay
  }

  private clearExitDialog (): void {
    this.exitDialog?.destroy()
    this.exitDialog = null
  }

  private proposeDissolve (): void {
    this.clearExitDialog()
    if (this.lobby?.proposeDissolve() === null) this.showFinishToast('解散申请发送失败，请检查网络')
    else this.showFinishToast('已发起解散，等待其他玩家表决')
  }

  private showDissolveVoteDialog (vote: NetworkDissolveVote): void {
    this.clearExitDialog()
    this.clearDissolveDialog()
    const viewport = this.screen?.viewport ?? { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 }
    const overlay = new Node('DissolveVoteDialog')
    overlay.parent = this.node
    overlay.addComponent(UITransform).setContentSize(viewport.width, viewport.height)
    overlay.addComponent(BlockInputEvents)
    const graphics = overlay.addComponent(Graphics)
    graphics.fillColor = new Color(2, 12, 14, 185)
    graphics.rect(-viewport.halfWidth, -viewport.halfHeight, viewport.width, viewport.height)
    graphics.fill()
    graphics.fillColor = new Color(26, 43, 43, 250)
    graphics.strokeColor = new Color(218, 179, 79, 255)
    graphics.lineWidth = 3
    graphics.roundRect(-285, -130, 570, 260, 22)
    graphics.fill()
    graphics.stroke()
    const initiator = this.latestSnapshot?.state.players[vote.initiator].name ?? vote.initiator
    const title = this.makeLabel('DissolveVoteTitle', 0, 68, 30)
    title.string = `${initiator} 申请解散牌局`
    title.node.parent = overlay
    const agreed = Object.values(vote.votes).filter(choice => choice === 'agree').length
    const detail = this.makeLabel('DissolveVoteDetail', 0, 24, 19)
    detail.string = `当前同意 ${agreed}/4；一人拒绝即继续牌局`
    detail.node.parent = overlay
    const countdown = this.makeLabel('DissolveVoteCountdown', 0, -12, 18)
    countdown.node.parent = overlay
    this.dissolveCountdownLabel = countdown
    const refuse = this.makeButton('DissolveRefuse', '拒绝', 0, 210)
    refuse.parent = overlay
    refuse.setPosition(new Vec3(-125, -72, 0))
    refuse.on(Node.EventType.TOUCH_END, () => { this.lobby?.voteDissolve(false); this.clearDissolveDialog() }, this)
    const agree = this.makeButton('DissolveAgree', '同意解散', 0, 210)
    agree.parent = overlay
    agree.setPosition(new Vec3(125, -72, 0))
    agree.on(Node.EventType.TOUCH_END, () => { this.lobby?.voteDissolve(true); this.clearDissolveDialog() }, this)
    overlay.setSiblingIndex(this.node.children.length - 1)
    this.dissolveDialog = overlay
    this.refreshDissolveCountdown()
  }

  private refreshDissolveCountdown (): void {
    const label = this.dissolveCountdownLabel
    const vote = this.lobby?.snapshot.dissolveVote
    if (!label || !vote) return
    label.string = `剩余 ${Math.max(0, Math.ceil((vote.expiresAt - Date.now()) / 1000))} 秒`
  }

  private clearDissolveDialog (): void {
    this.dissolveDialog?.destroy()
    this.dissolveDialog = null
    this.dissolveCountdownLabel = null
  }

  private leaveTableToMenu (): void {
    const multiplayer = Boolean(this.session?.snapshot.isMultiplayer)
    this.clearExitDialog()
    this.gameManager?.abortRound()
    this.previousFinishedPlayers = []
    this.previousHandCounts.clear()
    this.latestSnapshot = null
    this.suppressNextSettlementEffect = false
    this.effects?.resetForRecovery(0)
    this.cancelManualGrouping(false)
    if (multiplayer) this.lobby?.safeExit()
    else this.session?.leaveToMenu()
    this.frontPages?.showMenu()
  }

  private readonly safeExitTableToMenu = (): void => { this.leaveTableToMenu() }

  private showNotice (title: string, message = ''): void {
    if (this.exitDialog) return
    const viewport = this.screen?.viewport ?? { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 }
    const overlay = new Node('DevelopmentDialog')
    overlay.parent = this.node
    overlay.addComponent(UITransform).setContentSize(viewport.width, viewport.height)
    overlay.addComponent(BlockInputEvents)
    const graphics = overlay.addComponent(Graphics)
    graphics.fillColor = new Color(2, 12, 14, 175)
    graphics.rect(-viewport.halfWidth, -viewport.halfHeight, viewport.width, viewport.height)
    graphics.fill()
    graphics.fillColor = new Color(26, 43, 43, 250)
    graphics.strokeColor = new Color(218, 179, 79, 255)
    graphics.lineWidth = 3
    graphics.roundRect(-235, -105, 470, 210, 22)
    graphics.fill()
    graphics.stroke()
    const heading = this.makeLabel('DevelopmentTitle', 0, 48, 32)
    heading.string = title
    heading.node.parent = overlay
    const detail = this.makeLabel('DevelopmentDetail', 0, 4, 19)
    detail.string = message
    detail.node.parent = overlay
    detail.node.active = Boolean(message)
    const close = this.makeButton('DevelopmentClose', '知道了', 0, 190)
    close.parent = overlay
    close.setPosition(new Vec3(0, -58, 0))
    close.on(Node.EventType.TOUCH_END, this.clearExitDialog, this)
    overlay.setSiblingIndex(this.node.children.length - 1)
    this.exitDialog = overlay
  }

  private toggleChatPanel (): void {
    if (this.chatNodes.length) { this.clearNodes(this.chatNodes); return }
    if (this.activeFriendRoomSettings()?.disableInteraction) {
      this.showFinishToast('本好友房已禁止互动')
      return
    }
    const chatPanelTop = this.screen?.safeBottomY(535) ?? 175
    QUICK_CHAT_PHRASES.forEach((phrase, index) => {
      const node = this.makeChatButton(phrase.text, this.screen?.safeLeftX(220) ?? -415, chatPanelTop - index * 48)
      node.on(Node.EventType.TOUCH_END, () => {
        this.sendQuickChat(phrase)
        this.clearNodes(this.chatNodes)
      }, this)
      this.chatNodes.push(node)
    })
    const mute = this.makeChatButton(this.quickChatMuted ? '取消屏蔽快捷语' : '屏蔽其他玩家快捷语', this.screen?.safeLeftX(220) ?? -415, chatPanelTop - QUICK_CHAT_PHRASES.length * 48)
    mute.on(Node.EventType.TOUCH_END, () => {
      const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
      this.quickChatMuted = !this.quickChatMuted
      ;(['p1', 'p2', 'p3', 'p4'] as const).filter(id => id !== humanId).forEach(id => {
        if (this.quickChatMuted) this.chat?.block(humanId, id)
        else this.chat?.unblock(humanId, id)
      })
      this.clearNodes(this.chatNodes)
      if (this.latestSnapshot) this.render(this.latestSnapshot)
    }, this)
    this.chatNodes.push(mute)
  }

  private sendQuickChat (phrase: (typeof QUICK_CHAT_PHRASES)[number]): void {
    if (this.activeFriendRoomSettings()?.disableInteraction) {
      this.showFinishToast('本好友房已禁止互动')
      return
    }
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    if (this.session?.snapshot.isMultiplayer) {
      if ((this.lobby?.chat(phrase.text) ?? null) === null) this.showFinishToast('快捷语发送失败，请检查网络连接')
      return
    }
    const decision = this.chat?.send(humanId, phrase)
    if (!decision?.accepted) {
      const retrySeconds = Math.max(1, Math.ceil((decision?.retryAfterMs ?? 0) / 1000))
      this.showFinishToast(decision?.reason === 'unknown-phrase' ? '快捷语不可用' : `请 ${retrySeconds} 秒后再发送快捷语`)
      return
    }
    this.audio?.playVoice(phrase.voice)
    this.playChatPulseFor(humanId)
  }

  private arrangeTableHudHand (): void {
    if (!this.latestSnapshot) return
    this.handWorkspace.toggleArrangement({
      direction: this.effectiveHandSortOrder(),
      allowAceLowStraight: this.session?.snapshot.settings.rulePreset !== 'tournament',
    })
    this.refreshHandGroupingView()
  }

  /** A lit suit selects its deterministic five-card straight flush candidate. */
  private handleTableHudSuit (suit: TableGameHudSuit | null): void {
    if (!suit) {
      this.cancelManualGrouping(false)
      this.refreshHandGroupingView()
      return
    }
    const snapshot = this.latestSnapshot
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    if (!snapshot || !this.canEnterHandGrouping(snapshot, humanId)) {
      this.handWorkspace.cancelManualSelection()
      this.showFinishToast('当前阶段不能选择同花顺锁牌')
      this.refreshHandGroupingView()
      return
    }
    const selected = this.handWorkspace.selectStraightFlush(suit, {
      allowAceLowStraight: this.session?.snapshot.settings.rulePreset !== 'tournament',
    })
    if (!selected) {
      this.showFinishToast('当前花色没有可组成的同花顺')
      this.refreshHandGroupingView()
      return
    }
    this.clearCurrentTurnRuleSelection(snapshot, humanId)
    this.refreshHandGroupingView()
  }

  /** Maps the lock control to the presentation-only manual-group workflow. */
  private handleTableHudHandLock (locked: boolean): void {
    if (!this.latestSnapshot) { this.tableHud?.update({ handLocked: false }); return }
    if (locked) {
      const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
      if (!this.canEnterHandGrouping(this.latestSnapshot, humanId)) {
        this.tableHud?.update({ handLocked: false })
        this.showFinishToast('当前阶段不能锁牌')
        return
      }
      this.handWorkspace.beginManualSelection()
      this.clearCurrentTurnRuleSelection(this.latestSnapshot, humanId)
      this.refreshHandGroupingView()
      return
    }
    if (!this.handWorkspace.canLockSelection()) {
      this.cancelManualGrouping(false)
      this.refreshHandGroupingView()
      return
    }
    try {
      this.handWorkspace.commitManualSelection({
        allowAceLowStraight: this.session?.snapshot.settings.rulePreset !== 'tournament',
      })
    } catch (error) {
      this.cancelManualGrouping(false)
      this.showNotice('无法锁牌', error instanceof Error ? error.message : '手牌状态已变更')
    }
    this.refreshHandGroupingView()
  }

  private cancelManualGrouping (refresh = true): void {
    this.handWorkspace.cancelManualSelection()
    if (refresh) this.refreshHandGroupingView()
  }

  private refreshHandGroupingView (): void {
    if (this.latestSnapshot) this.render(this.latestSnapshot)
  }

  private renderChat (_chat: QuickChat | null): void {
    if (this.latestSnapshot) this.render(this.latestSnapshot)
  }

  private makeLabel (name: string, x: number, y: number, fontSize: number): Label {
    if (!this.ui) throw new Error('Runtime UI factory is not initialized')
    return this.ui.label(name, x, y, fontSize)
  }

  /** Loads the finished backdrop; the web page's solid color is the boot fallback. */
  private ensureBackdrop (): void {
    if (this.backdrop) return
    const node = new Node('TableBackdrop')
    node.parent = this.node
    node.addComponent(UITransform)
    this.backdropSprite = node.addComponent(Sprite)
    this.backdropSprite.sizeMode = Sprite.SizeMode.CUSTOM
    const opacity = node.addComponent(UIOpacity)
    opacity.opacity = 0
    this.backdropOpacity = opacity
    this.backdrop = node
    this.redrawBackdrop(this.screen?.viewport ?? { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 })
    node.setSiblingIndex(0)
    ;(['lobby', 'table'] as const).forEach(mode => this.loadBackdrop(mode))
  }

  private loadBackdrop (mode: BackdropMode): void {
    if (this.backdropFrames.has(mode)) {
      if (this.backdropMode === mode) this.applyBackdrop(mode)
      return
    }
    const asset = BACKDROP_ASSETS[mode]
    loadGameAsset(asset.path, Texture2D, (error, texture) => {
      if (error || !texture || !this.backdropSprite?.isValid) {
        console.warn(`Unable to load the ${mode} backdrop texture.`, error)
        return
      }
      this.cacheBackdropTexture(mode, texture)
    })
  }

  private cacheBackdropTexture (mode: BackdropMode, texture: Texture2D): void {
    if (!this.backdropFrames.has(mode)) {
      const frame = new SpriteFrame()
      frame.texture = texture
      this.backdropFrames.set(mode, frame)
    }
    this.backdropSourceSizes.set(mode, { width: texture.width, height: texture.height })
    if (this.backdropMode === mode && this.backdropSprite?.isValid) this.applyBackdrop(mode)
  }

  private setBackdropMode (mode: BackdropMode): void {
    this.backdropMode = mode
    this.applyBackdrop(mode)
  }

  private applyBackdrop (mode: BackdropMode): void {
    const frame = this.backdropFrames.get(mode)
    const sprite = this.backdropSprite
    const opacity = this.backdropOpacity
    if (!frame || !sprite?.isValid || !opacity?.isValid) return
    Tween.stopAllByTarget(opacity)
    const commit = (): void => {
      if (this.backdropMode !== mode || !sprite.isValid) return
      sprite.spriteFrame = frame
      sprite.color = Color.WHITE
      this.backdropSourceSize = this.backdropSourceSizes.get(mode) ?? BACKDROP_ASSETS[mode]
      this.displayedBackdropMode = mode
      this.redrawBackdrop(this.screen?.viewport ?? { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 })
    }
    if (this.displayedBackdropMode === null) {
      commit()
      opacity.opacity = 0
      tween(opacity).to(0.2, { opacity: 255 }).start()
      return
    }
    if (this.displayedBackdropMode === mode) {
      commit()
      opacity.opacity = 255
      return
    }
    tween(opacity)
      .to(0.1, { opacity: 0 })
      .call(commit)
      .to(0.18, { opacity: 255 })
      .start()
  }

  private redrawBackdrop (viewport: TableViewport): void {
    const node = this.backdrop
    const transform = node?.getComponent(UITransform)
    if (!node || !transform) return
    const { width, height } = viewport
    const sourceWidth = Math.max(1, this.backdropSourceSize.width)
    const sourceHeight = Math.max(1, this.backdropSourceSize.height)
    const coverScale = Math.max(width / sourceWidth, height / sourceHeight)
    transform.setContentSize(sourceWidth * coverScale, sourceHeight * coverScale)
    node.setPosition(Vec3.ZERO)
  }

  private refreshBackdropTheme (): void {
    if (this.screen) this.redrawBackdrop(this.screen.viewport)
    const settings = this.session?.snapshot.settings
    if (settings) this.effects?.configure(settings.effectQuality, settings.hapticEnabled)
  }

  private makeButton (name: string, text: string, x: number, width = 244, height = 56, fontSize = 25): Node {
    if (!this.ui) throw new Error('Runtime UI factory is not initialized')
    return this.ui.button(name, text, x, width, height, fontSize)
  }

  private makeChatButton (text: string, x: number, y: number): Node {
    if (!this.ui) throw new Error('Runtime UI factory is not initialized')
    return this.ui.quickChatButton(text, x, y)
  }

}
