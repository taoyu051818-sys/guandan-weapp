const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomSettingsPresenter.ts')
const policyPath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomSettingsPolicy.ts')
const lobbyPagePath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/LobbyPageDomain.ts')
const ts = loadTypeScript()

assert.equal(fs.existsSync(sourcePath), true)
assert.equal(fs.existsSync(`${sourcePath}.meta`), true)
const engineConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'settings/v2/packages/engine.json'), 'utf8')).modules.configs.defaultConfig
assert.equal(engineConfig.cache.mask._value, true, 'runtime scrolling needs the non-cropped Cocos Mask feature')
assert.ok(engineConfig.includeModules.includes('mask'))

class MockColor {
  constructor (r = 0, g = 0, b = 0, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a }
}
class MockVec3 {
  constructor (x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
}
class MockUITransform {
  setAnchorPoint (x, y) { this.anchorPoint = { x, y } }
  setContentSize (width, height) { this.contentSize = typeof width === 'object' ? width : { width, height } }
}
class MockNode {
  static EventType = { TOUCH_END: 'touch-end' }
  constructor (name) {
    this.name = name
    this.children = []
    this.handlers = new Map()
    this.components = new Map()
    this.active = true
    this.isValid = true
    this.position = new MockVec3()
  }
  set parent (parent) {
    if (this._parent) this._parent.children = this._parent.children.filter(child => child !== this)
    this._parent = parent
    if (parent) parent.children.push(this)
  }
  get parent () { return this._parent }
  getChildByName (name) { return this.children.find(child => child.name === name) ?? null }
  setScale (scale) { this.scale = scale }
  addComponent (ComponentType) {
    const component = new ComponentType()
    component.node = this
    this.components.set(ComponentType, component)
    return component
  }
  setPosition (position) { this.position = position }
  on (event, callback) {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(callback)
    this.handlers.set(event, handlers)
  }
  emit (event) { ;[...(this.handlers.get(event) ?? [])].forEach(callback => callback()) }
  destroy () {
    if (!this.isValid) return
    this.active = false
    this.isValid = false
    this.children.slice().forEach(child => child.destroy())
    this.parent = null
  }
}

const stoppedTweens = []
const cc = {
  BlockInputEvents: class {},
  EditBox: { InputMode: { NUMERIC: 'numeric' } },
  Mask: class {},
  ScrollView: class { isValid = true; offset = { y: 0 }; scrollToOffset (v) { this.offset = v }; scrollToTop () { this.offset = { y: 0 } }; getScrollOffset () { return this.offset } },
  Vec2: MockVec3,
  Color: MockColor,
  Node: MockNode,
  Tween: { stopAllByTarget: target => stoppedTweens.push(target) },
  UITransform: MockUITransform,
  Vec3: MockVec3,
}

const defaultSettings = Object.freeze({
  mode: 'classic',
  rounds: 4,
  scoring: 'double-3',
  scoreVisibility: 'live',
  turnSeconds: 40,
  trusteeSeconds: 15,
  totalTimeMinutes: 0,
  spectator: 'off',
  autoSort: true,
  disableInteraction: true,
  sortOrder: 'desc',
  authoritativeValidation: true,
})

const compile = (filePath, runtimeDependencies) => {
  const result = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `${path.basename(filePath)} must transpile`)
  const moduleRecord = { exports: {} }
  const localRequire = request => {
    if (Object.prototype.hasOwnProperty.call(runtimeDependencies, request)) return runtimeDependencies[request]
    throw new Error(`unexpected runtime dependency ${request} from ${filePath}`)
  }
  new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(moduleRecord.exports, moduleRecord, localRequire, filePath, path.dirname(filePath))
  return moduleRecord.exports
}

const policy = compile(policyPath, {
  '../../network/LobbyModels': { DEFAULT_FRIEND_ROOM_SETTINGS: defaultSettings },
  '../../core/generated/lib/matchFormat': compile(path.join(projectRoot, 'assets/scripts/core/generated/lib/matchFormat.ts'), {}),
})

const uiInstances = []
class MockRuntimeUiFactory {
  constructor (root) {
    this.parent = root
    this.buttons = []
    this.images = []
    this.labels = []
    uiInstances.push(this)
  }
  panel (name, x, y, width, height, style) {
    const node = new MockNode(name)
    node.parent = this.parent
    node.setPosition(new MockVec3(x, y, 0))
    node.size = { width, height }
    node.style = style
    return node
  }
  image (name, assetPath, x, y, width, height, parent = this.parent) {
    const node = new MockNode(name)
    node.parent = parent
    node.setPosition(new MockVec3(x, y, 0))
    node.assetPath = assetPath
    node.size = { width, height }
    this.images.push(node)
    return node
  }
  outlinedLabel (text, x, y, fontSize, style = {}) {
    const node = new MockNode('OutlinedLabel')
    node.parent = style.parent ?? this.parent
    node.setPosition(new MockVec3(x, y, 0))
    node.text = text
    node.fontSize = fontSize
    node.style = style
    this.labels.push(node)
    return node
  }
  button (name, text, x, width, height, fontSize, style = {}) {
    const node = new MockNode(name)
    node.parent = this.parent
    node.setPosition(new MockVec3(x, -205, 0))
    node.text = text
    node.size = { width, height }
    node.fontSize = fontSize
    node.style = style
    this.buttons.push(node)
    return node
  }
  makeInteractive (node, action) { node.on(MockNode.EventType.TOUCH_END, action) }
  formInput (name, placeholder, x, y, options) {
    const node = new MockNode(name)
    node.parent = this.parent
    const input = { node, string: '', enabled: true, options, blur () { this.blurred = true } }
    node.input = input
    return input
  }
}

const formUiModule = compile(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomFormUi.ts'), { cc, '../../ui/RuntimeUiFactory': { RuntimeUiFactory: MockRuntimeUiFactory } })
const numberModalModule = compile(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomNumberModal.ts'), {
  cc, '../../ui/RuntimeUiFactory': { RuntimeUiFactory: MockRuntimeUiFactory }, './FriendRoomFormUi': formUiModule,
})
const { FriendRoomSettingsPresenter } = compile(sourcePath, {
  cc,
  '../../core/generated/lib/matchFormat': compile(path.join(projectRoot, 'assets/scripts/core/generated/lib/matchFormat.ts'), {}),
  './FriendRoomFormUi': compile(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomFormUi.ts'), { cc, '../../ui/RuntimeUiFactory': { RuntimeUiFactory: MockRuntimeUiFactory } }),
  '../../ui/RuntimeUiFactory': { RuntimeUiFactory: MockRuntimeUiFactory },
  './FriendRoomSettingsPolicy': policy,
  './FriendRoomNumberModal': numberModalModule,
  './FriendRoomRulesModal': { showFriendRoomRulesModal: () => {} },
  './FriendRoomModeTabs': compile(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomModeTabs.ts'), { cc, './FriendRoomSettingsPolicy': policy }),
})

const pages = []
const router = {
  current: null,
  currentRoot: null,
  open (page) {
    assert.equal(page, 'friend-room-settings')
    this.current = page
    this.currentRoot?.destroy()
    const root = new MockNode(`Page-${page}`)
    this.currentRoot = root
    pages.push(root)
    return { parent: root }
  },
}
const viewport = { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 36, safeRight: 24, safeTop: 18, safeBottom: 12 }
const screen = {
  viewport,
  safeSize: () => ({ x: viewport.width - viewport.safeLeft - viewport.safeRight, y: viewport.height - viewport.safeTop - viewport.safeBottom }),
  safeLeftX: margin => -viewport.halfWidth + viewport.safeLeft + margin,
  safeRightX: margin => viewport.halfWidth - viewport.safeRight - margin,
  safeTopY: margin => viewport.halfHeight - viewport.safeTop - margin,
}
const sessionUpdates = []
const createdSettings = []
const joinedNumbers = []
let backCount = 0
const presenter = new FriendRoomSettingsPresenter({
  router,
  screen,
  backgroundArt: 'ui/lobby/friend-room-green/texture',
  updateSessionSettings: settings => sessionUpdates.push(settings),
  createRoom: settings => createdSettings.push(settings),
  joinRoom: roomId => joinedNumbers.push(roomId),
  goBack: () => { backCount += 1 },
})

const currentUi = () => {
  const live = uiInstances.filter(ui => ui.parent.isValid)
  return { buttons: live.flatMap(ui => ui.buttons), images: live.flatMap(ui => ui.images), labels: live.flatMap(ui => ui.labels) }
}
const button = text => {
  const node = currentUi().buttons.find(candidate => candidate.text === text)
  assert.ok(node, `expected button ${text}`)
  return node
}

presenter.show()
assert.equal(presenter.tab, 'rules')
assert.equal(presenter.settings.rounds, 4)
const detachedDraft = presenter.settings
detachedDraft.rounds = 32
assert.equal(presenter.settings.rounds, 4, 'callers must not mutate the presenter-owned draft through its snapshot getter')
assert.equal(router.currentRoot.children[0].name, 'FriendRoomSettingsView')
assert.deepEqual(router.currentRoot.children[0].components.get(MockUITransform).contentSize, { width: 1280, height: 720 })
const backdrop = currentUi().images.find(node => node.name === 'FriendRoomBackdrop')
const coverScale = Math.max(viewport.width / 1672, viewport.height / 941)
assert.deepEqual(backdrop.size, { width: 1672 * coverScale, height: 941 * coverScale }, 'the extracted page must preserve cover scaling')
assert.equal(currentUi().buttons.filter(node => node.name === 'FriendModeTab').length, 4)
assert.equal(button('基础规则').fontSize, 22)
assert.equal(button('重置').size.height, 42)

const firstView = router.currentRoot.children[0]
button('+').emit(MockNode.EventType.TOUCH_END)
assert.equal(presenter.settings.rounds, 5, 'custom rounds advance one at a time')
assert.equal(firstView.isValid, false, 'rerendering must release the previous owned view tree')

button('体验设置').emit(MockNode.EventType.TOUCH_END)
assert.equal(presenter.tab, 'experience')
assert.equal(currentUi().buttons.some(node => node.text === '小牌在左'), true)
button('小牌在左').emit(MockNode.EventType.TOUCH_END)
assert.equal(presenter.settings.sortOrder, 'asc')
assert.deepEqual(sessionUpdates, [{ sortOrder: 'asc' }], 'only the sort-order projection must synchronize to GameSession')

button('创建房间').emit(MockNode.EventType.TOUCH_END)
assert.equal(createdSettings.length, 1)
assert.equal(createdSettings[0].rounds, 5)
assert.equal(createdSettings[0].sortOrder, 'asc')
button('加入房间').emit(MockNode.EventType.TOUCH_END)
const modalRoot = router.currentRoot.children[0].getChildByName('FriendRoomNumberModal')
const modalPanel = modalRoot.getChildByName('RoomNumberPanel')
const numberInput = modalPanel.getChildByName('FriendRoomNumberInput').input
assert.ok(modalRoot.components.has(cc.BlockInputEvents), 'modal must block table/form click-through')
assert.equal(numberInput.options.maxLength, 6)
assert.equal(numberInput.options.inputMode, 'numeric')
button('加入房间').emit(MockNode.EventType.TOUCH_END)
assert.equal(router.currentRoot.children[0].children.filter(node => node.name === 'FriendRoomNumberModal').length, 1)
for (const invalid of ['', '12345', '12x456', '123456.token']) {
  numberInput.string = invalid
  button('加入').emit(MockNode.EventType.TOUCH_END)
}
assert.deepEqual(joinedNumbers, [], 'invalid room numbers must not issue requests')
assert.ok(currentUi().labels.some(label => label.string === '请输入完整的六位数字房间号'))
numberInput.string = '012345'
const staleJoin = button('加入')
numberInput.node.emit('editing-return')
staleJoin.emit(MockNode.EventType.TOUCH_END)
assert.deepEqual(joinedNumbers, ['012345'], 'keyboard submit and touch must issue one request and preserve leading zero')
assert.equal(numberInput.blurred, true)
button('加入房间').emit(MockNode.EventType.TOUCH_END)
const cancelledJoin = button('加入')
button('取消').emit(MockNode.EventType.TOUCH_END)
cancelledJoin.emit(MockNode.EventType.TOUCH_END)
assert.equal(joinedNumbers.length, 1)
button('返回').emit(MockNode.EventType.TOUCH_END)
assert.equal(backCount, 1)

const staleCreate = button('创建房间')
const staleBack = button('返回')
const visibleView = router.currentRoot.children[0]
presenter.hide()
assert.equal(visibleView.isValid, false)
staleCreate.emit(MockNode.EventType.TOUCH_END)
staleBack.emit(MockNode.EventType.TOUCH_END)
assert.equal(createdSettings.length, 1, 'hidden-page callbacks must be invalidated')
assert.equal(backCount, 1, 'hidden-page navigation callbacks must be invalidated')

presenter.show()
assert.equal(presenter.settings.rounds, 5, 'navigation must retain the settings draft')
const routeStaleCreate = button('创建房间')
router.current = 'menu'
routeStaleCreate.emit(MockNode.EventType.TOUCH_END)
assert.equal(createdSettings.length, 1, 'callbacks retained by another route must remain inert')
presenter.show()
const finalCreate = button('创建房间')
button('传统升级').emit(MockNode.EventType.TOUCH_END)
assert.equal(presenter.settings.format, 'upgrade')
assert.equal(currentUi().labels.some(node => node.text === '上下滑动查看更多设置'), false, 'short forms must not suggest nonexistent scrolling')
assert.equal(currentUi().buttons.some(node => node.text === '每局随机'), false)
assert.ok(button('不进贡'))
const pageCountBeforeDispose = pages.length
presenter.dispose()
presenter.dispose()
finalCreate.emit(MockNode.EventType.TOUCH_END)
presenter.show()
assert.equal(createdSettings.length, 1, 'disposed presenter callbacks must remain inert')
assert.equal(pages.length, pageCountBeforeDispose, 'a disposed presenter must not reopen its route')
assert.ok(stoppedTweens.length > 0, 'owned runtime nodes must have their tweens stopped before destruction')

const lobbyPage = fs.readFileSync(lobbyPagePath, 'utf8')
assert.match(lobbyPage, /new FriendRoomSettingsPresenter\(/)
assert.match(lobbyPage, /public showFriendRoomSettings \(\): void \{[\s\S]*this\.friendRoomSettingsPresenter\.show\(\)/)
assert.doesNotMatch(lobbyPage, /private friend(?:Stepper|Choice)Row\b/, 'settings node helpers must stay outside the lobby orchestration domain')
assert.match(lobbyPage, /public destroy \(\): void \{[\s\S]*friendRoomSettingsPresenter\.dispose\(\)/)
assert.match(lobbyPage, /private destroyed = false[\s\S]*public destroy \(\): void \{[\s\S]*if \(this\.destroyed\) return[\s\S]*this\.destroyed = true/)
assert.match(lobbyPage, /private isDisposed \(\): boolean \{ return this\.destroyed \|\| this\.dependencies\.isDisposed\(\) \}/)

const lobbyPresenterInstances = []
class MockLobbyPresenter {
  constructor (dependencies) {
    this.dependencies = dependencies
    this.hidden = 0
    this.disposed = 0
    lobbyPresenterInstances.push(this)
  }
  show () { this.dependencies.router.current = 'friend-room-settings' }
  hide () { this.hidden += 1 }
  dispose () { this.disposed += 1 }
}

const localStorageValues = new Map()
const lobbyCc = {
  ...cc,
  EditBox: class MockEditBox {},
  sys: {
    localStorage: {
      getItem: key => localStorageValues.get(key) ?? null,
      setItem: (key, value) => localStorageValues.set(key, value),
    },
  },
  tween: () => ({
    delay () { return this },
    to () { return this },
    start () { return this },
  }),
}

const { LobbyPageDomain } = compile(lobbyPagePath, {
  cc: lobbyCc,
  '../../ui/LobbyLayoutPolicy': compile(path.join(projectRoot, 'assets/scripts/ui/LobbyLayoutPolicy.ts'), {}),
  '../../ui/LobbyAmbientMotion': { attachLobbyAmbientMotion() {} },
  '../../ui/LobbyMenuView': { // Rendering is covered by lobby-artwork/refinement suites.
    renderLobbyEntries() {}, renderLobbyShop() {},
    lobbyLabel: () => ({ node: { getComponent: () => null } }),
  },
  '../../ui/CoastalUi': { coastalText: () => ({}), coastalIcon: () => ({}), coastalButton: () => new MockNode('CoastalButton') },
  '../../network/LobbyController': {},
  '../../session/GameSession': {},
  '../../ui/ScreenAdapter': {},
  '../../ui/SafeAreaLayout': {
    resolveSafeHorizontalLane: (left, _right, items, gap) => {
      let cursor = left
      return items.map(item => {
        const width = item.preferredWidth
        const result = { id: item.id, x: cursor + width / 2, width, visible: true }
        cursor += width + gap
        return result
      })
    },
  },
  '../../ui/RuntimeUiFactory': { RuntimeUiFactory: class {} },
  '../PageRouter': {},
  './FriendRoomSettingsPresenter': { FriendRoomSettingsPresenter: MockLobbyPresenter },
  './FriendRoomPlatformFlow': compile(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomPlatformFlow.ts'), {
    './FriendRoomReservationCleanup': compile(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomReservationCleanup.ts'), {}),
  }),
  './FriendRoomWaitingPresenter': { FriendRoomWaitingPresenter: class {
    constructor (_screen, _lobby, _avatar, leave) { this.leave = leave; waitingInstances.push(this) }
    render (_ui, snapshot, _signed, invite) { this.snapshot = snapshot; this.invite = invite }
    renderEntering (_ui, status) { this.status = status }
  } },
  '../../services/WechatFriendInvite': { WechatFriendInvite: class {
    constructor (receive) { this.receive = receive; inviteInstances.push(this) }
    activate () {}; dispose () {}; share (credential) { this.shared = credential }
  } },
  './FriendRoomSettingsPolicy': { describeFriendRoomRules: () => '好友房规则' },
  './FrontPagePlayerState': {},
  './FrontPageWalletState': {},
  './LobbyPlayerProfilePresenter': { LobbyPlayerProfilePresenter: class { render () {} } },
  './LobbyPageCatalog': {
    CLASSIC_ROOM_MODES: [], CLASSIC_ROOM_TIERS: [],
    LOBBY_ART: { friendBackground: '', defaultAvatar: '', coin: '', shopChick: '' },
  },
})

const makeUiNode = () => ({
  setPosition () {},
  on () {},
  addComponent () { return { setContentSize () {} } },
})
const lobbyUi = {
  parent: new MockNode('LobbyUiRoot'),
  button: () => makeUiNode(),
  imageCard: () => makeUiNode(),
  panel: () => makeUiNode(),
  image: () => makeUiNode(),
  outlinedLabel: () => makeUiNode(),
  menuLabel: () => makeUiNode(),
  makeInteractive: () => {},
}
const lobbyRouter = {
  current: null,
  open (page) { this.current = page; return lobbyUi },
}
const scheduled = []
const roomCreations = []
const lobbyController = {
  snapshot: { connected: false, rooms: [], roomId: null, members: [], myPlayerId: null, roomStatus: 'idle', error: null },
  connectCalls: [],
  connect (endpoint) { this.connectCalls.push(endpoint) },
  createRoom (hostName, settings) { roomCreations.push({ hostName, settings }) },
  refreshRooms () {}, leaveRoom () {}, joinRoom () {}, addBot () {}, removeBot () {}, kickMember () {}, setLobbyReady () {}, cancelLobbyReady () {}, startGame () {},
}
const lobbySession = {
  snapshot: { status: 'menu', settings: { effectQuality: 'full' }, playerStats: { elo: 1000, gamesPlayed: 0, wins: 0 } },
  updateSettings () {},
  enterLobby () { this.snapshot.status = 'lobby' },
  leaveToMenu () { this.snapshot.status = 'menu' },
}
let domainDisposed = false
let pageRequest = 0
const waitingInstances = []
const inviteInstances = []
const waitingVisibility = []
const domainDependencies = {
  router: lobbyRouter,
  session: lobbySession,
  lobby: lobbyController,
  screen: {
    viewport,
    safeSize: screen.safeSize,
    safeLeftX: screen.safeLeftX,
    safeRightX: screen.safeRightX,
    safeTopY: screen.safeTopY,
    safeBottomY: margin => -viewport.halfHeight + viewport.safeBottom + margin,
  },
  gateways: { configured: false },
  player: { dashboard: null, loading: false, loadedAt: 0, invalidate () {} },
  wallet: { value: { points: 10000 }, fresh: true, invalidate () {}, update () {} },
  isDisposed: () => domainDisposed,
  issuePageRequest: () => ++pageRequest,
  currentPageRequest: () => pageRequest,
  invalidateMatchAttempt () {}, closeModal () {}, setTableVisible () {}, setFriendRoomWaitingVisible (visible) { waitingVisibility.push(visible) },
  scheduleOnce: callback => scheduled.push(callback),
  getLobbyEndpoint: () => 'ws://127.0.0.1:3002/weapp',
  showNotice () {}, showCompetition () {}, showPlayerCenter () {}, showShop () {}, beginMatch () {},
}
const domain = new LobbyPageDomain(domainDependencies)
const domainPresenter = lobbyPresenterInstances.at(-1)
const forwardedSettings = { ...defaultSettings, rounds: 20, scoring: 'double-4', sortOrder: 'asc' }
domainPresenter.dependencies.createRoom(forwardedSettings)
assert.equal(lobbyRouter.current, 'lobby')
assert.equal(waitingVisibility.at(-1), true, 'creation must immediately show the empty table before connecting')
assert.deepEqual(lobbyController.connectCalls, ['ws://127.0.0.1:3002/weapp'])
lobbyController.snapshot = { ...lobbyController.snapshot, connected: true }
domain.renderLobby(lobbyController.snapshot)
assert.equal(scheduled.length, 1, 'connected idle state must schedule one room creation')
scheduled.shift()()
assert.deepEqual(roomCreations, [{ hostName: '玩家', settings: forwardedSettings }], 'the complete presenter draft must reach LobbyController unchanged')

assert.equal(typeof domainPresenter.dependencies.joinRoom, 'function', 'short room-number modal must use the authenticated flow')
domainPresenter.dependencies.createRoom({ ...forwardedSettings, rounds: 24 })
assert.equal(scheduled.length, 1)
domainPresenter.dependencies.goBack()
scheduled.shift()()
assert.equal(roomCreations.length, 1, 'returning to the menu must invalidate a queued room creation')

domainPresenter.dependencies.createRoom({ ...forwardedSettings, rounds: 28 })
assert.equal(scheduled.length, 1)
domain.destroy()
domain.destroy()
scheduled.shift()()
assert.equal(roomCreations.length, 1, 'destroying the domain must invalidate a queued room creation without relying on its parent flag')
assert.equal(domainPresenter.disposed, 1, 'the friend-room presenter must be disposed exactly once')
domainDisposed = true

async function verifyDirectTableEntry () {
  const requests = []
  const entered = []
  const cancelled = []
  const notices = []
  const deferredRequest = (kind, value) => new Promise((resolve, reject) => requests.push({ kind, value, resolve, reject }))
  const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }
  const session = { ...lobbySession, snapshot: { ...lobbySession.snapshot, status: 'menu' } }
  const idle = { connected: false, rooms: [], roomId: null, members: [], myPlayerId: null, roomStatus: 'idle', error: null }
  const controller = { ...lobbyController, snapshot: { ...idle, error: '上次恢复失败' },
    enterMatchedRoom (entry) { entered.push(entry); this.snapshot = { ...idle }; direct.renderLobby(this.snapshot) },
    leaveRoom () { this.snapshot = { ...idle } },
  }
  const direct = new LobbyPageDomain({ ...domainDependencies,
    session, lobby: controller, isDisposed: () => false,
    player: { ...domainDependencies.player, loading: true },
    gateways: { configured: true, friendRooms: {
      create: settings => deferredRequest('create', settings),
      join: credential => deferredRequest('join', credential),
      joinRoomNumber: roomId => deferredRequest('join-number', roomId),
      cancel: async matchId => cancelled.push(matchId),
    } },
    showNotice: (title, detail) => notices.push({ title, detail }),
  })
  const settingsView = lobbyPresenterInstances.at(-1)
  const tableView = waitingInstances.at(-1)
  const nativeInvite = inviteInstances.at(-1)
  settingsView.dependencies.createRoom(forwardedSettings)
  assert.equal(lobbyRouter.current, 'lobby')
  assert.equal(waitingVisibility.at(-1), true, 'HTTP creation must display the table immediately')
  assert.equal(tableView.status, '正在创建房间…', 'a stale recovery error must not replace the current HTTP progress')
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].value, forwardedSettings)
  assert.equal(tableView.invite, undefined, 'cannot share before the server has admitted a room')
  direct.reflow()
  assert.equal(requests.length, 1, 'resizing must not recreate a room')
  requests[0].reject(new Error('暂时无法创建'))
  await flush()
  assert.equal(lobbyRouter.current, 'friend-room-settings', 'failed create must restore settings, not the retired interstitial')
  assert.equal(waitingVisibility.at(-1), false)
  assert.equal(notices.at(-1).title, '创建好友房失败')

  settingsView.dependencies.createRoom(forwardedSettings)
  const entry = { matchId: 'friend-direct', roomId: '123456', seat: 'p1', gameTicket: 'private-seat-ticket',
    entryAttemptId: 'attempt-direct', gameEndpoint: 'wss://example.invalid/weapp',
    ticketPurpose: 'entry', expiresAt: Date.now() + 60000, inviteText: '123456.private-invite-credential' }
  requests[1].resolve(entry)
  await flush()
  assert.equal(entered.length, 1)
  assert.equal(entered[0].gameTicket, entry.gameTicket)
  assert.equal(tableView.status, '正在进入牌桌…', 'HTTP success stays on the table while WebSocket admission is pending')
  assert.equal(tableView.invite, undefined)
  controller.snapshot = { ...idle, roomId: entry.roomId, myPlayerId: 'p1', members: ['p1'], roomStatus: 'waiting' }
  direct.renderLobby(controller.snapshot)
  assert.equal(tableView.snapshot.roomId, entry.roomId)
  tableView.invite()
  assert.equal(nativeInvite.shared, entry.inviteText, 'table invite must retain the secure WeChat card credential')
  tableView.leave()
  await flush()
  assert.equal(lobbyRouter.current, 'menu')
  assert.ok(cancelled.includes(entry.matchId))

  nativeInvite.receive('654321.received-wechat-credential')
  assert.equal(waitingVisibility.at(-1), true)
  assert.equal(tableView.status, '正在加入好友房…')
  assert.equal(requests[2].kind, 'join')
  assert.equal(requests[2].value, '654321.received-wechat-credential')
  requests[2].reject(new Error('邀请已失效'))
  await flush()
  assert.equal(lobbyRouter.current, 'menu', 'failed invitation must return to the hall')
  assert.equal(notices.at(-1).title, '加入好友房失败')

  settingsView.dependencies.createRoom(forwardedSettings)
  tableView.leave()
  requests[3].resolve({ ...entry, matchId: 'late-cancelled-room' })
  await flush()
  assert.equal(lobbyRouter.current, 'menu')
  assert.equal(entered.length, 1, 'late creation must never reopen the table after cancellation')
  assert.ok(cancelled.includes('late-cancelled-room'), 'late room reservation must be released')
  settingsView.dependencies.joinRoom('012345')
  assert.equal(requests[4].kind, 'join-number')
  assert.equal(requests[4].value, '012345')
  assert.equal(tableView.status, '正在加入好友房…')
  requests[4].reject(new Error('房间不存在'))
  await flush()
  assert.equal(lobbyRouter.current, 'friend-room-settings', 'failed number join returns to settings')
  settingsView.dependencies.joinRoom('123456')
  const numberEntry = { ...entry, seat: 'p2', inviteText: undefined }
  requests[5].resolve(numberEntry)
  await flush()
  controller.snapshot = { ...idle, roomId: entry.roomId, myPlayerId: 'p2', members: ['p1', 'p2'], roomStatus: 'waiting' }
  direct.renderLobby(controller.snapshot)
  assert.equal(entered.at(-1).seat, 'p2')
  assert.equal(tableView.invite, undefined, 'number guests must not see a broken share action without invite credentials')
  tableView.leave()
  direct.destroy()
  console.log('Direct friend-room table entry, native invite, failed retry and cancellation regressions passed')
}
verifyDirectTableEntry().catch(error => { console.error(error); process.exitCode = 1 })

const { FriendRoomWaitingPresenter } = compile(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomWaitingPresenter.ts'), {
  cc, './FriendRoomSettingsPolicy': policy,
  './DuplicateRoomWaitingView': compile(path.join(projectRoot, 'assets/scripts/scenes/front-pages/DuplicateRoomWaitingView.ts'), {
    '../../services/DefaultProfileFrames': { defaultProfileAsset: () => undefined },
    cc, '../../ui/RuntimeUiFactory': { RuntimeUiFactory: MockRuntimeUiFactory }, './FriendRoomRulesModal': { showFriendRoomRulesModal: () => {} },
  }),
  '../../ui/RuntimeUiFactory': { RuntimeUiFactory: MockRuntimeUiFactory },
})
const waitingCalls = []
for (const height of [402, 589, 720]) {
  for (const myPlayerId of ['p1', 'p2', 'p3', 'p4']) {
    for (const ready of [false, true]) {
      const waitingScreen = {
        safeSize: () => ({ x: 1280, y: height }), safeLeftX: margin => -640 + margin,
        safeRightX: margin => 640 - margin, safeTopY: margin => height / 2 - margin,
        safeBottomY: margin => -height / 2 + margin,
      }
      const waiting = new FriendRoomWaitingPresenter(waitingScreen, {
        setLobbyReady: () => waitingCalls.push('ready'), cancelLobbyReady: () => waitingCalls.push('cancel'),
      }, 'original-avatar', () => {})
      const ui = new MockRuntimeUiFactory(new MockNode('WaitingTest'))
      waiting.render(ui, {
        roomId: '123456', myPlayerId, members: ['p1', 'p2', 'p3', 'p4'], botPlayerIds: [],
        lobbyReadyPlayerIds: ready ? [myPlayerId] : [], roomSettings: defaultSettings,
        capabilities: { canUseBots: false, canKickMembers: false },
      }, true)
      const button = ui.buttons.find(item => item.text === (ready ? '取消准备' : '准备'))
      const status = ui.labels.find(item => /^等待其他玩家准备|^等待房主开始/.test(item.text))
      assert.ok(button && status)
      assert.equal(button.position.x, 0, 'a lone ready action stays centered')
      assert.ok(status.position.y + status.style.height / 2 <= button.position.y - button.size.height / 2 - 12,
        `waiting copy must stay below, never overpaint ${myPlayerId}'s ready button`)
      button.emit(MockNode.EventType.TOUCH_END)
      assert.equal(waitingCalls.at(-1), ready ? 'cancel' : 'ready')
    }
  }
}

for (const width of [874, 1280]) {
  for (const fullReady of [false, true]) {
    const actions = []
    const screen = { safeSize: () => ({ x: width, y: 589 }), safeLeftX: m => -width / 2 + m,
      safeRightX: m => width / 2 - m, safeTopY: m => 294.5 - m, safeBottomY: m => -294.5 + m }
    const ui = new MockRuntimeUiFactory(new MockNode('NativeInvitationWaiting'))
    new FriendRoomWaitingPresenter(screen, {
      setLobbyReady: () => actions.push('ready'), cancelLobbyReady: () => actions.push('cancel'), startGame: () => actions.push('start'),
    }, 'original-avatar', () => {}).render(ui, {
      roomId: '123456', myPlayerId: 'p1', members: ['p1', 'p2', 'p3', 'p4'], botPlayerIds: [],
      lobbyReadyPlayerIds: fullReady ? ['p1', 'p2', 'p3', 'p4'] : [],
      capabilities: { canUseBots: false, canKickMembers: false },
    }, true, () => actions.push('invite'))
    const row = ui.buttons.filter(b => ['邀请好友', '准备', '取消准备', '开始游戏'].includes(b.text))
    assert.equal(row.length, fullReady ? 3 : 2)
    assert.equal(row.reduce((sum, b) => sum + b.position.x, 0), 0, 'the action row is centered')
    assert.equal(row[0].style.fill.g > row[0].style.fill.r, true, 'invitation uses green')
    for (let i = 1; i < row.length; i++) {
      assert.equal(row[i].position.y, row[0].position.y)
      assert.ok(row[i].position.x - row[i].size.width / 2 - row[i - 1].position.x - row[i - 1].size.width / 2 >= 15.99)
    }
    if (!fullReady) assert.ok(row[1].style.fill.r > row[1].style.fill.g && row[1].style.fill.g > row[1].style.fill.b, 'ready uses yellow')
    row[0].emit(MockNode.EventType.TOUCH_END)
    assert.deepEqual(actions, ['invite'])
    assert.equal(ui.buttons.some(b => /复制.*口令/.test(b.text)), false)
  }
}

for (const isRoomHost of [true, false]) {
  for (const gameStartPending of [true, false]) {
    for (const movable of [true, false]) {
      const calls = [], root = new MockNode('FourSeatBots')
      const screen = { safeSize: () => ({ x: 1280, y: 589 }), safeLeftX: m => -640 + m,
        safeRightX: m => 640 - m, safeTopY: m => 294.5 - m, safeBottomY: m => -294.5 + m }
      new FriendRoomWaitingPresenter(screen, { addBot: id => calls.push(id), sitDown: () => {} }, 'avatar', () => {}).render(new MockRuntimeUiFactory(root), {
        roomId: '123456', myPlayerId: 'p1', members: ['p1'], botPlayerIds: [], isRoomHost, gameStartPending,
        roomRole: 'player', roomSettings: { spectator: movable ? 'live' : 'off' },
        capabilities: { canUseBots: true, canKickMembers: false },
      }, true)
      for (const id of ['p2', 'p3', 'p4']) {
        const seat = root.getChildByName(`FriendSeat-${id}`)
        const add = seat.getChildByName(`FriendAddBot-${id}`)
        assert.ok(add && add.text === '添加机器人')
        assert.equal(add.style.disabled, !isRoomHost || gameStartPending)
        assert.ok(add.position.y < 0 && add.size.height >= 44)
        add.emit(MockNode.EventType.TOUCH_END)
        const sit = seat.children.find(n => n.text === '坐下')
        assert.equal(Boolean(sit), movable && !gameStartPending)
        if (sit) assert.ok(sit.position.x - sit.size.width / 2 - add.position.x - add.size.width / 2 >= 8)
      }
      assert.deepEqual(calls, isRoomHost && !gameStartPending ? ['p2', 'p3', 'p4'] : [])
      assert.equal(root.getChildByName('FriendSeat-p1').children.some(n => n.name.startsWith('FriendAddBot-')), false)
    }
  }
}

for (const width of [874, 1280]) {
  for (const isRoomHost of [true, false]) {
    for (const gameStartPending of [false, true]) {
      const height = 589
      const screen = { viewport: { safeLeft: 0, safeRight: 0 }, safeSize: () => ({ x: width, y: height }),
        safeLeftX: m => -width / 2 + m, safeRightX: m => width / 2 - m,
        safeTopY: m => height / 2 - m, safeBottomY: m => -height / 2 + m }
      const calls = []
      const ui = new MockRuntimeUiFactory(new MockNode('DuplicateWaiting'))
      const slots = Array.from({ length: 8 }, (_, i) => ({ seat: `p${i + 1}`, occupied: i === 0,
        team: i % 2 ? 'blue' : 'red', direction: ['南', '东', '北', '西'][i % 4], name: '牌友', host: i === 0, online: true }))
      new FriendRoomWaitingPresenter(screen, { sendRoomIntent: (...args) => calls.push(args) }, 'avatar', () => {}).render(ui, {
        roomId: '123456', isRoomHost, gameStartPending,
        duplicate: { slots, configuredRounds: 4, mySeat: 'p1', ready: false, canStart: false },
      }, true)
      const buttons = ui.buttons.filter(b => b.name.startsWith('DuplicateAddBot-'))
      assert.equal(buttons.length, 7, 'every empty seat has a named add-bot button, occupied seats do not')
      for (const button of buttons) {
        const id = button.name.slice('DuplicateAddBot-'.length)
        const panel = ui.parent.getChildByName(`DuplicateSeat-${id}`)
        const sit = ui.buttons.find(b => b.name === `DuplicateSit-${id}`)
        assert.equal(button.text, '添加机器人')
        assert.equal(button.position.x, panel.position.x, 'add button sits below its own slot')
        assert.ok(button.size.height >= 44)
        assert.ok(sit.position.y - sit.size.height / 2 - button.position.y - button.size.height / 2 >= 8,
          'sit and add actions have separate, non-overlapping tap targets')
        assert.ok(button.position.y - button.size.height / 2 >= panel.position.y - panel.size.height / 2)
        assert.ok(button.position.x - button.size.width / 2 >= -width / 2)
        assert.ok(button.position.x + button.size.width / 2 <= width / 2)
        assert.equal(button.style.disabled, !isRoomHost || gameStartPending)
        button.emit(MockNode.EventType.TOUCH_END)
        if (isRoomHost && !gameStartPending) assert.deepEqual(calls.at(-1), ['addBot', { duplicateSeat: id }])
      }
      assert.equal(calls.length, isRoomHost && !gameStartPending ? 7 : 0, 'guests and pending starts never send bot mutations')
    }
  }
}

process.stdout.write('friend-room settings presenter lifecycle regression checks passed\n')
