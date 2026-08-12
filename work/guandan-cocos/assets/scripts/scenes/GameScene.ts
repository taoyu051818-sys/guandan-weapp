import { _decorator, Component, Graphics, Label, Node, sys, Texture2D, UITransform, Vec3 } from 'cc'
import { GameManager, playValidationHint } from '../game/GameManager'
import { HandController } from '../ui/HandController'
import { GameSession } from '../session/GameSession'
import { LobbyController, type FriendRoomSettings } from '../network/LobbyController'
import { PlayerSeatController } from '../ui/PlayerSeatController'
import { PlayAreaController } from '../ui/PlayAreaController'
import { CocosAudioController } from '../audio/CocosAudioController'
import { ChatController } from '../ui/ChatController'
import { getRuleProfile, type PlayerId } from '../core/generated'
import { ScreenAdapter, type TableViewport } from '../ui/ScreenAdapter'
import { EffectController } from '../effects/EffectController'
import { RuntimeUiFactory } from '../ui/RuntimeUiFactory'
import { hitTestVisibleNodes } from '../ui/TableGameHudFoundation'
import { createDevelopmentGateways } from '../services/DevelopmentApis'
import type { FrontPageGateways, MatchTicket } from '../services/FrontPageGatewayContracts'
import { createHttpGateways, type PlatformLoginCredential } from '../services/PlatformApi'
import { requestWechatLoginCredential, type WechatLoginApi } from '../services/WechatLoginProvider'
import { resolveClientNetworkConfig } from '../services/RuntimeClientConfig'
import { FrontPageController } from './FrontPageController'
import { EffectLabSceneHost } from '../development/EffectLabSceneHost'
import { SceneBackdropController } from './SceneBackdropController'
import { StartupCoordinator } from './StartupCoordinator'
import { TableOverlayController } from './TableOverlayController'
import { TableTurnClockController } from './TableTurnClockController'
import { TableHandInteractionController } from './TableHandInteractionController'
import { TableHudPresenter } from './TableHudPresenter'
import { PlatformMatchRecoveryCoordinator } from './PlatformMatchRecoveryCoordinator'
import { TableMatchCoordinator } from './TableMatchCoordinator'

const { ccclass, property } = _decorator

const PLATFORM_LOGIN_TIMEOUT_MS = 8_000

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
  private backdropController: SceneBackdropController | null = null
  private trusteeButton: Node | null = null
  private screen: ScreenAdapter | null = null
  private ui: RuntimeUiFactory | null = null
  private tableHudPresenter: TableHudPresenter | null = null
  private frontPages: FrontPageController | null = null
  private levelLabel: Label | null = null
  private countdownLabel: Label | null = null
  private tableOverlays: TableOverlayController | null = null
  private tableTurnClock: TableTurnClockController | null = null
  private tableShakeRoot: Node | null = null
  private flightRoot: Node | null = null
  private topEffectRoot: Node | null = null
  private effects: EffectController | null = null
  private skipEffectButton: Node | null = null
  private tableHandInteraction: TableHandInteractionController | null = null
  private effectLabHost: EffectLabSceneHost | null = null
  private friendRoomWaitingVisible = false
  private startupCoordinator: StartupCoordinator | null = null
  private matchRecovery: PlatformMatchRecoveryCoordinator | null = null
  private tableMatch: TableMatchCoordinator | null = null

  protected onLoad (): void {
    const screen = (this.getComponent(ScreenAdapter) ?? this.addComponent(ScreenAdapter)) as ScreenAdapter
    this.screen = screen
    const backdropController = new SceneBackdropController(this.node, () => this.screen?.viewport ?? null)
    this.backdropController = backdropController
    this.startupCoordinator = new StartupCoordinator({
      sceneRoot: this.node,
      startupTexture: this.startupTexture,
      initialViewport: screen.viewport,
      backdrop: backdropController,
      initializeApplication: () => this.initializeGame(),
      resizeApplication: viewport => this.applyResponsiveLayout(viewport),
      onReady: () => this.frontPages?.showMenu(),
    })
    screen.events.on('guandan:viewport', this.handleViewport, this)
    this.startupCoordinator.begin()
  }

  protected start (): void {
    this.startupCoordinator?.markSceneStarted()
  }

  private handleViewport (viewport: TableViewport): void {
    this.startupCoordinator?.resize(viewport)
  }

  private initializeGame (): void {
    if (!this.session) this.session = this.getComponent(GameSession) ?? this.addComponent(GameSession)
    if (!this.gameManager) this.gameManager = this.getComponent(GameManager) ?? this.addComponent(GameManager)
    if (!this.lobby) this.lobby = this.getComponent(LobbyController) ?? this.addComponent(LobbyController)
    if (!this.audio) this.audio = this.getComponent(CocosAudioController) ?? this.addComponent(CocosAudioController)
    const chat = (this.getComponent(ChatController) ?? this.addComponent(ChatController)) as ChatController
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
    this.tableOverlays = new TableOverlayController({
      root: this.node,
      ui: this.ui,
      lobby,
      chat,
      initialViewport: screen.viewport,
      getHumanId: () => this.session?.snapshot.myPlayerId ?? 'p1',
      isMultiplayer: () => Boolean(this.session?.snapshot.isMultiplayer),
      isInteractionDisabled: () => Boolean(this.activeFriendRoomSettings()?.disableInteraction),
      shouldLeaveImmediately: () => {
        const multiplayer = Boolean(this.session?.snapshot.isMultiplayer)
        const latest = this.tableMatch?.snapshot
        return Boolean(this.lobby?.snapshot.matchEnded || (latest?.phase === 'settlement' && (!multiplayer || latest.settlement?.isGameWon)))
      },
      playerName: playerId => this.tableMatch?.snapshot?.state.players[playerId].name ?? playerId,
      leaveTable: () => this.tableMatch?.leaveTableToMenu(),
      playVoice: voice => this.audio?.playVoice(voice),
      playChatPulse: (playerId, ownBubbleNode) => this.playChatPulseFor(playerId, ownBubbleNode),
      refreshPresentation: () => this.tableMatch?.refresh(),
      schedule: (callback, intervalSeconds) => this.schedule(callback, intervalSeconds),
      scheduleOnce: (callback, delaySeconds) => this.scheduleOnce(callback, delaySeconds),
      unschedule: callback => this.unschedule(callback),
    })
    this.ensureEffectHierarchy()
    this.tableHandInteraction = new TableHandInteractionController({
      ruleAuthority: manager,
      getHumanId: () => this.session?.snapshot.myPlayerId ?? 'p1',
      getRuntimeSettings: humanId => {
        const friendRoomSettings = this.activeFriendRoomSettings()
        const multiplayer = Boolean(this.session?.snapshot.isMultiplayer)
        return {
          sortOrder: friendRoomSettings?.sortOrder ?? this.session?.snapshot.settings.sortOrder ?? 'desc',
          autoSort: !friendRoomSettings || friendRoomSettings.autoSort,
          ruleProfile: this.tableMatch?.snapshot?.state.ruleProfile ?? this.session?.ruleProfile ?? getRuleProfile('classic'),
          multiplayer,
          trustee: multiplayer && Boolean(this.lobby?.snapshot.trustees?.[humanId] || this.lobby?.snapshot.matchEnded),
          deadlinePlayerId: this.lobby?.snapshot.deadlinePlayerId ?? null,
        }
      },
      refresh: () => {
        if (this.tableMatch?.hasSnapshot) this.tableMatch.refresh()
        else this.tableHudPresenter?.update({ lockAction: 'start' })
      },
      showToast: message => this.tableOverlays?.showToast(message),
      showNotice: (title, detail) => this.tableOverlays?.showNotice(title, detail),
      validationHint: playValidationHint,
      captureSelectedOrigins: cardIds => {
        this.effects?.captureLocalOrigins(this.hand?.captureCardOrigins(cardIds) ?? [])
      },
    })
    this.mountTableHud()
    if (!this.countdownLabel) throw new Error('Table countdown label is not initialized')
    this.tableTurnClock = new TableTurnClockController({
      label: this.countdownLabel,
      tableHud: () => this.tableHudPresenter?.hud ?? null,
      isMultiplayer: () => Boolean(this.session?.snapshot.isMultiplayer),
      lobbySnapshot: () => this.lobby?.snapshot ?? null,
      playCountdown: seconds => this.audio?.playCountdown(seconds),
      actOnLocalTimeout: () => this.gameManager?.actOnTimeout(),
      schedule: (callback, intervalSeconds) => this.schedule(callback, intervalSeconds),
      unschedule: callback => this.unschedule(callback),
    })
    this.effectLabHost = new EffectLabSceneHost({
      effects: this.effects,
      audio: this.audio,
      flightRoot: this.flightRoot,
      topEffectRoot: this.topEffectRoot,
      getEffectQuality: () => this.session?.snapshot.settings.effectQuality ?? 'full',
      hasLiveTableSnapshot: () => Boolean(this.tableMatch?.hasSnapshot),
      openEffectLabTable: () => this.frontPages?.openEffectLabTable(),
      scheduleOnce: (callback, delaySeconds) => this.scheduleOnce(callback, delaySeconds),
      showNotice: (title, detail) => this.tableOverlays?.showNotice(title, detail),
      startFixedMatch: (state, fixture) => {
        this.frontPages?.hideAll()
        this.setTableVisible(true)
        this.effects?.resetForRecovery(state.playArea.length)
        manager.applyDevelopmentFixtureState(state, fixture.label)
        this.audio?.playRoundStart()
      },
    })
    const frontPageGateways = this.createFrontPageGateways()
    this.matchRecovery = new PlatformMatchRecoveryCoordinator({
      configured: frontPageGateways.configured, gateway: frontPageGateways.matchRecovery, lobby,
      enterLobby: () => this.session?.enterLobby(),
      restoreFriendRoom: entry => this.frontPages?.restoreFriendRoomReservation(entry),
      showRecoveryAvailable: message => {
        lobby.offerActiveMatchRecovery(message)
        this.frontPages?.showRecoveryMenu()
      },
      showNotice: (title, detail) => this.tableOverlays?.showNotice(title, detail),
      isDisposed: () => !this.node.isValid,
    })
    this.frontPages = new FrontPageController(this.node, this.session!, lobby, screen, {
      setTableVisible: visible => this.setTableVisible(visible),
      setFriendRoomWaitingVisible: visible => this.setFriendRoomWaitingVisible(visible),
      closeModal: () => this.tableOverlays?.clearModal(),
      showNotice: (title, detail) => this.tableOverlays?.showNotice(title, detail),
      scheduleOnce: (callback, delaySeconds) => this.scheduleOnce(callback, delaySeconds),
      getLobbyEndpoint: () => this.resolvedLobbyEndpoint(),
      enterMatchedGame: ticket => this.enterMatchedGame(ticket),
      startMasterBotTest: () => this.tableMatch?.startMasterBotTest(),
      listEffectLabFixtures: () => this.effectLabHost?.list() ?? [],
      previewEffectLabFixture: (id, quality) => { this.effectLabHost?.trigger(id, quality) },
    }, frontPageGateways)
    this.effectLabHost.installDebugBridge()
    this.applyResponsiveLayout(screen.viewport)
    this.hand?.node.on('guandan:card-toggle', this.tableHandInteraction.handleCardToggle, this.tableHandInteraction)
    this.playButton?.on(Node.EventType.TOUCH_END, this.tableHandInteraction.playSelected, this.tableHandInteraction)
    this.passButton?.on(Node.EventType.TOUCH_END, manager.pass, manager)
    this.hintButton?.on(Node.EventType.TOUCH_END, this.tableHandInteraction.handleHint, this.tableHandInteraction)
    this.confirmTributeButton?.on(Node.EventType.TOUCH_END, manager.confirmTribute, manager)
    this.finishTributeButton?.on(Node.EventType.TOUCH_END, manager.finishTribute, manager)
    this.tableMatch = new TableMatchCoordinator({
      session: this.session!, manager, lobby, audio, effects: this.effects!, hand: this.hand!, playArea: this.playArea!,
      playerSeats: this.playerSeats, frontPages: this.frontPages!, overlays: this.tableOverlays!,
      turnClock: this.tableTurnClock!, handInteraction: this.tableHandInteraction!, hud: this.tableHudPresenter!,
      controls: {
        hint: this.hintButton, pass: this.passButton, play: this.playButton,
        confirmTribute: this.confirmTributeButton, finishTribute: this.finishTributeButton,
        nextRound: this.nextRoundButton, trustee: this.trusteeButton,
        hintLabel: this.hintLabel, phaseLabel: this.phaseLabel, levelLabel: this.levelLabel, overlayLabel: this.overlayLabel,
      },
      controlsY: () => this.tableControlsY(),
      layoutSeats: humanId => this.layoutSeats(humanId),
      setTableVisible: visible => this.setTableVisible(visible),
      setFriendRoomWaitingVisible: visible => this.setFriendRoomWaitingVisible(visible),
    })
    this.tableMatch.mount()
    this.session?.events.on('guandan:session', this.refreshBackdropTheme, this)
    this.matchRecovery.start()
  }

  private createFrontPageGateways (): FrontPageGateways {
    const config = this.resolvedNetworkConfig()
    const endpoint = config.platformEndpoint
    if (!endpoint) return createDevelopmentGateways()
    const accessTokenKey = `guandan-platform-token:${endpoint}`
    return createHttpGateways({
      baseUrl: endpoint,
      deviceId: this.platformDeviceId(),
      displayName: '陵水玩家',
      allowDevelopmentLogin: config.platformAllowDevelopmentLogin,
      httpEndpointPolicy: config.platformAllowInsecureEndpoint ? 'allow-insecure' : 'secure-only',
      gameEndpointPolicy: config.platformAllowInsecureGameEndpoint ? 'allow-insecure' : 'secure-only',
      loginTimeoutMs: PLATFORM_LOGIN_TIMEOUT_MS,
      loginProvider: config.platformAllowDevelopmentLogin ? undefined : () => this.platformLoginCredential(),
      credentialStore: {
        getAccessToken: () => sys.localStorage.getItem(accessTokenKey),
        setAccessToken: token => sys.localStorage.setItem(accessTokenKey, token),
        clearAccessToken: () => sys.localStorage.removeItem(accessTokenKey),
      },
    })
  }

  private resolvedLobbyEndpoint (): string {
    return this.resolvedNetworkConfig().lobbyEndpoint
  }

  private resolvedNetworkConfig () {
    return resolveClientNetworkConfig({
      lobbyEndpoint: this.lobbyEndpoint, platformEndpoint: this.platformEndpoint,
      platformAllowDevelopmentLogin: this.platformAllowDevelopmentLogin,
      platformAllowInsecureEndpoint: this.platformAllowInsecureEndpoint,
      platformAllowInsecureGameEndpoint: this.platformAllowInsecureGameEndpoint,
    })
  }

  private platformLoginCredential (): Promise<PlatformLoginCredential> {
    const wxApi = (globalThis as unknown as { wx?: WechatLoginApi }).wx
    return requestWechatLoginCredential(wxApi, PLATFORM_LOGIN_TIMEOUT_MS)
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
    if (!ticket.entryAttemptId || !ticket.roomId || !ticket.gameEndpoint || !ticket.joinToken || !ticket.seat) {
      this.tableOverlays?.showNotice('比赛匹配失败', '匹配服务返回了不完整的房间凭证')
      return
    }
    if (this.topEffectRoot) this.topEffectRoot.active = true
    this.effects?.playMatchSuccess()
    this.session?.enterLobby()
    this.lobby?.enterMatchedRoom({
      entryAttemptId: ticket.entryAttemptId,
      roomId: ticket.roomId,
      gameEndpoint: ticket.gameEndpoint,
      gameTicket: ticket.joinToken,
      seat: ticket.seat,
      expiresAt: ticket.expiresAt,
      displayName: '陵水玩家',
      ticketPurpose: 'entry',
    })
  }

  protected onDestroy (): void {
    this.matchRecovery?.dispose()
    this.matchRecovery = null
    this.startupCoordinator?.dispose()
    this.startupCoordinator = null
    this.tableMatch?.dispose()
    this.tableMatch = null
    if (this.tableHandInteraction) {
      this.hand?.node.off('guandan:card-toggle', this.tableHandInteraction.handleCardToggle, this.tableHandInteraction)
      this.playButton?.off(Node.EventType.TOUCH_END, this.tableHandInteraction.playSelected, this.tableHandInteraction)
      this.hintButton?.off(Node.EventType.TOUCH_END, this.tableHandInteraction.handleHint, this.tableHandInteraction)
      this.tableHandInteraction.resetForTableExit()
      this.tableHandInteraction = null
    }
    this.tableOverlays?.dispose()
    this.tableOverlays = null
    this.tableTurnClock?.dispose()
    this.tableTurnClock = null
    this.screen?.events.off('guandan:viewport', this.handleViewport, this)
    this.session?.events.off('guandan:session', this.refreshBackdropTheme, this)
    this.backdropController?.dispose()
    this.backdropController = null
    this.effectLabHost?.dispose()
    this.effectLabHost = null
    this.frontPages?.destroy()
    this.frontPages = null
    this.hand?.setTouchExclusionPredicate(null)
    this.tableHudPresenter?.dispose()
    this.tableHudPresenter = null
  }

  private activeFriendRoomSettings (): FriendRoomSettings | null {
    const lobby = this.lobby?.snapshot
    if (!this.session?.snapshot.isMultiplayer || !lobby?.roomId || lobby.lobbyReadyRequired !== true) return null
    return lobby.roomSettings ?? null
  }

  private playChatPulseFor (playerId: PlayerId, ownBubbleNode: Node): void {
    const humanId = this.session?.snapshot.myPlayerId ?? 'p1'
    const target = playerId === humanId ? ownBubbleNode : this.playerSeats.get(playerId)?.node
    if (!target) return
    this.effects?.playChatPulse(target, target.worldPosition.x < 0 ? 'left' : 'right')
  }

  /** Lets the first playable scene run before the art prefabs are bound in Creator. */
  private ensureFallbackUi (): void {
    this.backdropController?.mount()
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
    this.skipEffectButton ??= this.makeButton('SkipEffectButton', '跳过动画', 0, 132, 42, 18)
    this.skipEffectButton.active = false
    this.skipEffectButton.on(Node.EventType.TOUCH_END, () => this.effects?.skipAll(), this)
  }

  /** Mounts the table chrome above flights and below major effects. */
  private mountTableHud (): void {
    if (this.tableHudPresenter) return
    const presenter = new TableHudPresenter({
      root: this.node,
      actions: {
        onBack: () => this.tableOverlays?.requestLeave(),
        onSuitSelect: suit => this.tableHandInteraction?.handleSuitIntent(suit),
        onHandLockAction: () => this.tableHandInteraction?.handleLockAction(),
        onArrange: () => this.tableHandInteraction?.handleArrangeIntent(),
        onChat: () => this.tableOverlays?.toggleQuickChatPanel(),
      },
      lobbySnapshot: () => this.lobby?.snapshot ?? null,
      isMultiplayer: () => Boolean(this.session?.snapshot.isMultiplayer),
      turnClock: (snapshot, humanId) => this.tableTurnClock?.project(snapshot, humanId) ?? null,
    })
    this.tableHudPresenter = presenter
    const hudNode = presenter.mount({
      turnActionNodes: [this.hintButton, this.passButton, this.playButton],
      legacyLabels: [this.levelLabel, this.countdownLabel],
      legacySeatNodes: Array.from(this.playerSeats.values(), seat => seat.node),
    })
    this.hand?.setTouchExclusionPredicate(screenPoint => {
      return presenter.hitTestInteractiveScreenPoint(screenPoint) || hitTestVisibleNodes(
        [this.confirmTributeButton, this.finishTributeButton, this.nextRoundButton, this.trusteeButton], screenPoint,
      )
    })
    this.flightRoot?.setSiblingIndex(this.node.children.length - 1)
    hudNode.setSiblingIndex(this.node.children.length - 1)
    this.topEffectRoot?.setSiblingIndex(this.node.children.length - 1)
    this.skipEffectButton?.setSiblingIndex(this.node.children.length - 1)
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
      busy => { if (this.skipEffectButton) this.skipEffectButton.active = busy && Boolean(this.tableMatch?.hasSnapshot) },
      () => (this.hand?.collectCardBlastTargets() ?? []).concat(this.playArea?.collectCardBlastTargets() ?? []),
    )
    const settings = this.session?.snapshot.settings
    if (settings) effects.configure(settings.effectQuality, settings.hapticEnabled)
    this.flightRoot.setSiblingIndex(this.node.children.length - 1)
    this.topEffectRoot.setSiblingIndex(this.node.children.length - 1)
    this.skipEffectButton?.setSiblingIndex(this.node.children.length - 1)
  }

  private setTableVisible (visible: boolean): void {
    this.friendRoomWaitingVisible = false
    if (!visible) this.audio?.cancelTransientPlayback()
    this.audio?.setBgmMode(visible ? 'battle' : 'lobby')
    this.backdropController?.setMode(visible ? 'table' : 'lobby')
    if (!visible) {
      this.tableTurnClock?.reset()
      this.tableMatch?.handleTableHidden()
      this.tableHandInteraction?.resetForTableExit()
      this.playArea?.clearPresentation()
    }
    this.tableOverlays?.setTableVisible(visible)
    if (!visible && this.skipEffectButton) this.skipEffectButton.active = false
    this.tableHudPresenter?.setVisible(visible)
    const tableNodes = [this.hand?.node, this.tableShakeRoot, this.flightRoot, this.topEffectRoot, this.hintLabel?.node, this.phaseLabel?.node, this.levelLabel?.node, this.countdownLabel?.node, this.overlayLabel?.node, this.trusteeButton, this.confirmTributeButton, this.finishTributeButton, this.nextRoundButton]
    tableNodes.push(...Array.from(this.playerSeats.values(), seat => seat.node))
    tableNodes.forEach(node => { if (node) node.active = visible })
    if (!visible) {
      ;[this.playButton, this.passButton, this.hintButton].forEach(node => { if (node) node.active = false })
    }
  }

  private setFriendRoomWaitingVisible (visible: boolean): void {
    if (visible && this.friendRoomWaitingVisible) {
      this.backdropController?.setMode('table')
      return
    }
    if (visible) {
      this.setTableVisible(false)
      this.friendRoomWaitingVisible = true
      this.audio?.setBgmMode('lobby')
      this.backdropController?.setMode('table')
      return
    }
    this.friendRoomWaitingVisible = false
    if (!this.tableHudPresenter?.visible) this.backdropController?.setMode('lobby')
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

  private tableControlsY (): number {
    return this.screen?.safeBottomY(200) ?? -160
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
    if (!this.tableHudPresenter?.mounted) {
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
    this.trusteeButton?.setPosition(new Vec3(this.screen?.safeRightX(70) ?? 570, controlsY + 54, 0))
    this.skipEffectButton?.setPosition(new Vec3(this.screen?.safeRightX(90) ?? 550, this.screen?.safeTopY(40) ?? 320, 0))
    this.tableOverlays?.resize(viewport)
    this.backdropController?.resize(viewport)
    this.tableHudPresenter?.layout(viewport)
    this.tableMatch?.refresh()
  }

  private makeLabel (name: string, x: number, y: number, fontSize: number): Label {
    if (!this.ui) throw new Error('Runtime UI factory is not initialized')
    return this.ui.label(name, x, y, fontSize)
  }

  private refreshBackdropTheme (): void {
    if (this.screen) this.backdropController?.resize(this.screen.viewport)
    const settings = this.session?.snapshot.settings
    if (settings) this.effects?.configure(settings.effectQuality, settings.hapticEnabled)
  }

  private makeButton (name: string, text: string, x: number, width = 244, height = 56, fontSize = 25): Node {
    if (!this.ui) throw new Error('Runtime UI factory is not initialized')
    return this.ui.button(name, text, x, width, height, fontSize)
  }

}
