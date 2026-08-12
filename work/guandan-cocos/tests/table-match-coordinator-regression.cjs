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
new Function('exports', 'module', 'require', result.outputText)(loaded.exports, loaded, request => {
  if (request === 'cc') return {
    Label: class Label {},
    Node: { EventType: { TOUCH_END: 'touch-end' } },
    Vec3: FakeVec3,
    tween: () => ({ stop () { return this }, to () { return this }, start () {} }),
  }
  if (request === '../ui/TablePromptPolicy') return { tableHintToast: () => null }
  if (request === './MatchEndedPresentation') return { projectMatchEndedPresentation: () => ({ title: '', detail: '' }) }
  if (request === './TableNetworkEventBridge') return { TableNetworkEventBridge: FakeTableNetworkEventBridge }
  if (request === './TableSnapshotPresenter') return {
    projectTableViewer: () => ({ levelLabel: '', settlementTitle: null, settlementWon: null }),
    projectTributeEffectTokens: () => new Set(),
  }
  throw new Error(`unexpected runtime dependency ${request}`)
})
const { TableMatchCoordinator } = loaded.exports

const managerNode = new ListenerOwner()
const nextRound = new ListenerOwner()
const trustee = new ListenerOwner()
const calls = { handoff: 0, hide: 0, visible: [], reset: [], invalidate: 0, apply: [] }
const dependencies = {
  session: { snapshot: { myPlayerId: 'p1', isMultiplayer: true, status: 'playing' } },
  manager: {
    node: managerNode,
    applyServerState: (state, hint) => calls.apply.push({ state, hint }),
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
  },
  overlays: {},
  turnClock: {},
  handInteraction: { invalidateAuthoritativeHand: () => { calls.invalidate += 1 } },
  hud: {},
  controls: {
    hint: null, pass: null, play: null, confirmTribute: null, finishTribute: null,
    nextRound, trustee, hintLabel: null, phaseLabel: null, levelLabel: null, overlayLabel: null,
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
assert.equal(trustee.count('touch-end'), 1, 'mount must own the trustee control listener')

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

coordinator.dispose()
coordinator.dispose()
assert.equal(networkBridge.disposeCount, 1, 'dispose must be idempotent')
assert.equal(managerNode.count('guandan:state'), 0, 'dispose must release the snapshot listener')
assert.equal(nextRound.count('touch-end'), 0, 'dispose must release the next-round listener')
assert.equal(trustee.count('touch-end'), 0, 'dispose must release the trustee listener')

process.stdout.write('table match coordinator regression checks passed\n')
