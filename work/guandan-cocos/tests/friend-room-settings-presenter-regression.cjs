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

class MockColor {
  constructor (r = 0, g = 0, b = 0, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a }
}
class MockVec3 {
  constructor (x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
}
class MockUITransform {
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
}

const { FriendRoomSettingsPresenter } = compile(sourcePath, {
  cc,
  '../../ui/RuntimeUiFactory': { RuntimeUiFactory: MockRuntimeUiFactory },
  './FriendRoomSettingsPolicy': policy,
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
let joinCount = 0
let backCount = 0
const presenter = new FriendRoomSettingsPresenter({
  router,
  screen,
  backgroundArt: 'ui/lobby/friend-room-green/texture',
  updateSessionSettings: settings => sessionUpdates.push(settings),
  joinRoom: () => { joinCount += 1 },
  createRoom: settings => createdSettings.push(settings),
  goBack: () => { backCount += 1 },
})

const currentUi = () => uiInstances.at(-1)
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
assert.equal(presenter.settings.rounds, 8, 'round changes must continue through the pure normalization policy')
assert.equal(firstView.isValid, false, 'rerendering must release the previous owned view tree')

button('体验设置').emit(MockNode.EventType.TOUCH_END)
assert.equal(presenter.tab, 'experience')
assert.equal(currentUi().buttons.some(node => node.text === '小牌在左'), true)
button('小牌在左').emit(MockNode.EventType.TOUCH_END)
assert.equal(presenter.settings.sortOrder, 'asc')
assert.deepEqual(sessionUpdates, [{ sortOrder: 'asc' }], 'only the sort-order projection must synchronize to GameSession')

button('创建房间').emit(MockNode.EventType.TOUCH_END)
assert.equal(createdSettings.length, 1)
assert.equal(createdSettings[0].rounds, 8)
assert.equal(createdSettings[0].sortOrder, 'asc')
button('加入房间').emit(MockNode.EventType.TOUCH_END)
button('返回').emit(MockNode.EventType.TOUCH_END)
assert.equal(joinCount, 1)
assert.equal(backCount, 1)

const staleCreate = button('创建房间')
const staleJoin = button('加入房间')
const staleBack = button('返回')
const visibleView = router.currentRoot.children[0]
presenter.hide()
assert.equal(visibleView.isValid, false)
staleCreate.emit(MockNode.EventType.TOUCH_END)
staleJoin.emit(MockNode.EventType.TOUCH_END)
staleBack.emit(MockNode.EventType.TOUCH_END)
assert.equal(createdSettings.length, 1, 'hidden-page callbacks must be invalidated')
assert.equal(joinCount, 1, 'hidden-page join callbacks must be invalidated')
assert.equal(backCount, 1, 'hidden-page navigation callbacks must be invalidated')

presenter.show()
assert.equal(presenter.settings.rounds, 8, 'navigation must retain the settings draft')
const routeStaleCreate = button('创建房间')
router.current = 'menu'
routeStaleCreate.emit(MockNode.EventType.TOUCH_END)
assert.equal(createdSettings.length, 1, 'callbacks retained by another route must remain inert')
presenter.show()
const finalCreate = button('创建房间')
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
  show () {}
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
  './FriendRoomPlatformFlow': { FriendRoomPlatformFlow: class {} },
  './FriendRoomPlatformPresenter': { FriendRoomPlatformPresenter: class { resetInput () {}; renderEntry () {}; renderInviteShare () {} } },
  './FriendRoomWaitingPresenter': { FriendRoomWaitingPresenter: class { render () {} } },
  '../../services/ClipboardService': { writeClipboardText: async () => {} },
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
  roomCodeInput: () => ({ getComponentInChildren: () => ({ string: '' }) }),
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
  snapshot: { status: 'menu', playerStats: { elo: 1000, gamesPlayed: 0, wins: 0 } },
  updateSettings () {},
  enterLobby () { this.snapshot.status = 'lobby' },
  leaveToMenu () { this.snapshot.status = 'menu' },
}
let domainDisposed = false
let pageRequest = 0
const domain = new LobbyPageDomain({
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
  invalidateMatchAttempt () {}, closeModal () {}, setTableVisible () {}, setFriendRoomWaitingVisible () {},
  scheduleOnce: callback => scheduled.push(callback),
  getLobbyEndpoint: () => 'ws://127.0.0.1:3002/weapp',
  showNotice () {}, dismissRulesState () {}, rulesVisible: () => false, showRules () {}, showMoreMenu () {}, showCompetition () {}, showPlayerCenter () {}, showShop () {}, beginMatch () {},
})
const domainPresenter = lobbyPresenterInstances.at(-1)
const forwardedSettings = { ...defaultSettings, rounds: 20, scoring: 'double-4', sortOrder: 'asc' }
domainPresenter.dependencies.createRoom(forwardedSettings)
assert.deepEqual(lobbyController.connectCalls, ['ws://127.0.0.1:3002/weapp'])
lobbyController.snapshot = { ...lobbyController.snapshot, connected: true }
domain.renderLobby(lobbyController.snapshot)
assert.equal(scheduled.length, 1, 'connected idle state must schedule one room creation')
scheduled.shift()()
assert.deepEqual(roomCreations, [{ hostName: '玩家', settings: forwardedSettings }], 'the complete presenter draft must reach LobbyController unchanged')

domainPresenter.dependencies.joinRoom()
assert.equal(scheduled.length, 0, 'join flow must not create a room implicitly')
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

process.stdout.write('friend-room settings presenter lifecycle regression checks passed\n')
