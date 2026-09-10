const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/TableMatchCoordinator.ts')
const ts = loadTypeScript()

assert.equal(fs.existsSync(`${sourcePath}.meta`), true, 'TableMatchCoordinator must be imported by Cocos')
const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'TableMatchCoordinator must transpile')

class ListenerOwner {
  constructor () { this.listeners = [] }
  on (type, callback, target) { this.listeners.push({ type, callback, target }) }
  off (type, callback, target) {
    this.listeners = this.listeners.filter(listener => listener.type !== type || listener.callback !== callback || listener.target !== target)
  }
  count (type) { return this.listeners.filter(listener => listener.type === type).length }
}

class FakeTableNetworkEventBridge {
  static latest = null
  constructor (events, handlers) {
    this.events = events
    this.handlers = handlers
    this.mountCount = 0
    this.disposeCount = 0
    FakeTableNetworkEventBridge.latest = this
  }
  mount () { this.mountCount += 1 }
  dispose () { this.disposeCount += 1 }
}

class FakeVec3 {
  static ZERO = new FakeVec3(0, 0, 0)
  static ONE = new FakeVec3(1, 1, 1)
  constructor (x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
  clone () { return new FakeVec3(this.x, this.y, this.z) }
}

const loaded = { exports: {} }
const runtimeRequire = request => {
  if (request === './TablePhasePresenter') {
    const scope = { exports: {} }
    const output = ts.transpileModule(fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TablePhasePresenter.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    new Function('exports', 'require', output)(scope.exports, runtimeRequire)
    return scope.exports
  }
  if (request === 'cc') return {
    Label: class Label {},
    Node: { EventType: { TOUCH_END: 'touch-end' } },
    Vec3: FakeVec3,
    tween: () => ({ stop () { return this }, to () { return this }, start () {} }),
  }
  if (request === '../ui/TablePromptPolicy') return { tableHintToast: () => null }
  if (request === '../game/TeammateHandProjector') return { TeammateHandProjector: class { project () { return null } reset () {} } }
  if (request === '../ui/TablePlayActionPolicy') return { TablePlayActionPolicy: class { resolve () { return ['hint', 'play'] } } }
  if (request === '../ui/TableSettlementView') return { TableSettlementView: class { clear () {} render () {} } }
  if (request === './SettlementPresentation') return { projectSettlementContent: () => ({}) }
  if (request === './MatchEndedPresentation') return { projectMatchEndedPresentation: () => ({ title: '', detail: '' }) }
  if (request === './TableNetworkEventBridge') return { TableNetworkEventBridge: FakeTableNetworkEventBridge }
  if (request === './TableProgressPresentation') {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableProgressPresentation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    const scope = { exports: {} }
    new Function('exports', 'require', compiled.outputText)(scope.exports, name => {
      if (name === 'cc') return { Vec3: FakeVec3 }
      if (name === './TableSnapshotPresenter') return { projectTributeEffectTokens: () => new Set() }
      throw new Error(name)
    })
    return scope.exports
  }
  if (request === './TableSnapshotPresenter') return {
    projectTableViewer: () => ({ levelLabel: '', settlementTitle: null, settlementWon: null }),
    projectTributeEffectTokens: () => new Set(),
  }
  throw new Error(`unexpected runtime dependency ${request}`)
}
new Function('exports', 'module', 'require', result.outputText)(loaded.exports, loaded, runtimeRequire)
const { TableMatchCoordinator } = loaded.exports

const managerNode = new ListenerOwner()
const nextRound = new ListenerOwner()
const calls = { handoff: 0, hide: 0, visible: [], reset: [], invalidate: 0, apply: [] }
const closedCalls = []
const dependencies = {
  session: { snapshot: { myPlayerId: 'p1', isMultiplayer: true, status: 'playing' } },
  manager: {
    node: managerNode,
    applyServerState: (state, hint) => calls.apply.push({ state, hint }),
    abortRound: () => closedCalls.push('abort'),
  },
  lobby: { events: {}, snapshot: { roomId: 'room-1' } },
  audio: {},
  effects: { resetForRecovery: count => calls.reset.push(count) },
  hand: {},
  playArea: {},
  playerSeats: new Map(),
  frontPages: {
    handoffFriendRoomReservation: () => { calls.handoff += 1 },
    hideAll: () => { calls.hide += 1 },
    showMenu: () => closedCalls.push('main-hall'),
    showRecoveryMenu: () => closedCalls.push('preserved-recovery-hall'),
  },
  overlays: { clearDialogs: () => closedCalls.push('clear-dialogs'), showToast: message => closedCalls.push(message) },
  turnClock: { reset: () => closedCalls.push('reset-clock') },
  handInteraction: { invalidateAuthoritativeHand: () => { calls.invalidate += 1 } },
  hud: {},
  controls: {
    hint: null, pass: null, play: null, confirmTribute: null, finishTribute: null,
    nextRound, hintLabel: null, phaseLabel: null, levelLabel: null, overlayLabel: null,
  },
  controlsY: () => -160,
  layoutSeats: () => {},
  setTableVisible: visible => calls.visible.push(visible),
  setFriendRoomWaitingVisible: () => {},
}

const coordinator = new TableMatchCoordinator(dependencies)
const networkBridge = FakeTableNetworkEventBridge.latest
assert.ok(networkBridge, 'the coordinator must compose its network bridge')
coordinator.mount()
coordinator.mount()
assert.equal(networkBridge.mountCount, 1, 'mount must be idempotent')
assert.equal(managerNode.count('guandan:state'), 1, 'mount must subscribe to authoritative snapshots once')
assert.equal(nextRound.count('touch-end'), 1, 'mount must own the next-round control listener')
assert.equal(typeof coordinator.toggleTrustee, 'function', 'HUD owns the trustee button and invokes the coordinator callback')

const state = {
  currentTurn: 'p1', currentLevel: 2, playArea: [{ id: 'action-1' }, { id: 'action-2' }], finishedPlayers: ['p3'],
  players: {
    p1: { hand: [{ id: 'p1-card' }] }, p2: { hand: [] }, p3: { hand: [] }, p4: { hand: [] },
  },
}
networkBridge.handlers.onNetworkState({ roomId: 'other-room', effectSync: { mode: 'recovery' }, state })
assert.equal(calls.apply.length, 0, 'packets for another room must be ignored')

networkBridge.handlers.onNetworkState({ roomId: 'room-1', effectSync: { mode: 'incremental' }, state })
assert.equal(calls.apply.length, 1, 'an incremental packet must reach the snapshot authority')
assert.deepEqual(calls.reset, [], 'incremental packets must preserve the effect cursor')
assert.equal(calls.invalidate, 0, 'incremental packets must preserve the authoritative hand signature')

networkBridge.handlers.onNetworkState({ roomId: 'room-1', effectSync: { mode: 'recovery' }, state })
assert.equal(calls.apply.length, 2, 'a recovery packet must still reach the snapshot authority')
assert.deepEqual(calls.reset, [2], 'recovery must establish the server action count as the visual baseline')
assert.equal(calls.invalidate, 1, 'recovery must invalidate the cached authoritative hand')
assert.deepEqual(calls.visible, [true, true], 'accepted packets must reveal the table')

networkBridge.handlers.onRoomClosed('全员同意，房间已解散', { compensateReservation: true })
assert.deepEqual(closedCalls, ['clear-dialogs', 'abort', 'reset-clock', 'main-hall', '全员同意，房间已解散'], 'a closed match must return to the main hall, never unrelated friend-room entry')
closedCalls.length = 0
networkBridge.handlers.onRoomClosed('恢复本地状态', { compensateReservation: false })
assert.deepEqual(closedCalls, ['clear-dialogs', 'abort', 'reset-clock', 'preserved-recovery-hall', '恢复本地状态'], 'local recovery reset must not cancel a valid remote reservation')
closedCalls.length = 0
networkBridge.handlers.onRoomClosed()
assert.equal(closedCalls.at(-1), '房间已关闭', 'older close messages without a reason still have readable feedback')

dependencies.session = { snapshot: { isMultiplayer: true } }
closedCalls.length = 0
coordinator.applyNetworkTurnTimeout({ playerId: 'p1', enteredTrustee: false })
assert.deepEqual(closedCalls, [], 'routine automatic play must not show a timeout toast')
coordinator.applyNetworkTurnTimeout({ playerId: 'p1', enteredTrustee: true })
assert.deepEqual(closedCalls, ['你连续超时，已进入托管'], 'actual trustee state changes remain visible')
assert.match(fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableSceneNodes.ts'), 'utf8'), /'NextRoundButton'.*tableButtonWidth\('本场结束 · 返回大厅'/, 'frame reserves the longest supported settlement label width')
dependencies.lobby.snapshot.matchEnded = { reason: 'single-round' }
dependencies.frontPages.isTournamentRoom = id => id === 'room-1'
dependencies.frontPages.showTournament = () => closedCalls.push('tournament-center')
coordinator.leaveTableToMenu = () => closedCalls.push('leave-completed-table')
closedCalls.length = 0
coordinator.handleNextRound()
assert.deepEqual(closedCalls, ['leave-completed-table', 'tournament-center'], 'completed tournament round must return to its center, not classic matchmaking')

coordinator.dispose()
coordinator.dispose()
assert.equal(networkBridge.disposeCount, 1, 'dispose must be idempotent')
assert.equal(managerNode.count('guandan:state'), 0, 'dispose must release the snapshot listener')
assert.equal(nextRound.count('touch-end'), 0, 'dispose must release the next-round listener')


process.stdout.write('table match coordinator regression checks passed\n')
