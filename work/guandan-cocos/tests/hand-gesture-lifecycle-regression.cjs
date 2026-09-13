const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
// Reuse the native coordinate harness; no Cocos engine, sockets or files are mutated.
const harnessFile = path.join(__dirname, 'hand-touch-coordinates-regression.cjs')
const harnessModule = new Module(harnessFile, module)
harnessModule.filename = harnessFile; harnessModule.paths = Module._nodeModulePaths(__dirname)
harnessModule._compile(fs.readFileSync(harnessFile, 'utf8') + '\nmodule.exports = { harness, cc, load, cache };', harnessFile)
const { harness, cc, load, cache } = harnessModule.exports
const src = p => path.resolve(__dirname, '../assets/scripts', p + '.ts')
for (const [file, exports] of Object.entries({
  'session/GameSession': { GameSession: class {} }, 'network/LobbyController': { LobbyController: class {} },
  'scenes/TablePhasePresenter': { TablePhasePresenter: class { clear () {} layoutActionControls () {} renderPhaseOverlay () {} animateEntrance () {} } },
  'scenes/TableProgressPresentation': { TableProgressPresentation: class { reset () {} seedRecovery () {} renderProgressNotifications () {} } },
  'scenes/TableSnapshotPresenter': { projectTableViewer: () => ({ levelLabel: '', settlementWon: false, settlementTitle: '' }) },
})) cache.set(src(file), { exports })
cc.Tween = { stopAllByTarget () {} }; cc.Node.EventType = { TOUCH_END: 'touch-end' }
class Events {
  constructor () { this.listeners = [] }
  on (type, fn, owner) { this.listeners.push({ type, fn, owner }) }
  off (type, fn, owner) { this.listeners = this.listeners.filter(x => x.type !== type || x.fn !== fn || x.owner !== owner) }
  emit (type, ...args) { for (const x of this.listeners.slice()) if (x.type === type) x.fn.apply(x.owner, args) }
}
const { GameManager } = load(src('game/GameManager'))
const { TableHandInteractionController } = load(src('scenes/TableHandInteractionController'))
const { TableMatchCoordinator } = load(src('scenes/TableMatchCoordinator'))
const core = load(src('core/generated/index')), profile = core.getRuleProfile('classic')
const card = (id, rank) => ({ id, rank, suit: 'spade', value: rank, isLevelCard: false })
const players = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((id, i) => [id, { id, name: id, team: i % 2 ? 'teamB' : 'teamA',
  hand: i ? [card(`${i}a`, 4 + i), card(`${i}b`, 8 + i)] : [card('a', 8), card('c', 9), card('b', 3)] }]))
const initial = core.createMatchState({ players, ruleProfile: profile, currentLevel: 2, levelTeam: 'teamA', teamLevels: { teamA: 2, teamB: 2 }, dealerId: 'p1' })
const play = (state, playerId, cardIds) => {
  const out = core.transition(state, { type: 'PLAY_CARDS', playerId, cardIds, roundId: state.roundId, expectedRevision: state.revision })
  assert.equal(out.ok, true, out.reason); return out.state
}
function setup (first = initial) {
  const h = harness(1, { x: 0, y: 0 }, ['a', 'b', 'c'].map((id, i) => ({ id, x: 100 + i * 50, y: 30, width: 48, height: 100 })))
  h.controller.getComponent = () => ({ contentSize: { width: 1040 } })
  for (const node of h.controller.cards.values()) {
    node.position = { equals: () => true }; node.setSiblingIndex = () => {}; node.destroy = () => { node.isValid = false }
  }
  for (const view of h.views.values()) {
    view.bind = model => { view.card = model }; view.configureFanHitArea = () => {}; view.configureStackHitArea = () => {}
  }
  const session = { snapshot: { myPlayerId: 'p1', roomId: 'synthetic-room', isMultiplayer: true, isObserver: false, status: 'playing' }, beginPlay () {}, beginTribute () {}, beginSettlement () {} }
  const lobby = { events: new Events(), snapshot: { roomId: 'synthetic-room', roomStatus: 'ready', connected: true, trustees: {}, members: ['p1', 'p2', 'p3', 'p4'] }, sent: [], play (ids) { this.sent.push(ids); return 1 } }
  const manager = new GameManager(); manager.node = new Events(); manager.session = session; manager.lobby = lobby
  let table
  const handInteraction = new TableHandInteractionController({ ruleAuthority: manager, getHumanId: () => 'p1',
    getRuntimeSettings: () => ({ sortOrder: 'desc', autoSort: true, ruleProfile: profile, multiplayer: true, trustee: false, deadlinePlayerId: null }),
    refresh: () => table.refresh(), showToast () {}, showNotice () {}, validationHint: () => '', captureSelectedOrigins () {} })
  const emit = h.controller.node.emit.bind(h.controller.node)
  h.controller.node.emit = (name, ...args) => name === 'guandan:card-toggle' ? handInteraction.handleCardToggle(...args) : emit(name, ...args)
  table = new TableMatchCoordinator({ session, manager, lobby, audio: { playEvent () {} }, effects: { waitForPresentation () {}, syncActions () {}, resetForRecovery () {} },
    hand: h.controller, playArea: { setSeatOrder () {}, render () {} }, playerSeats: new Map(),
    frontPages: { handoffFriendRoomReservation () {}, hideAll () {}, renderLobby () {} }, overlays: { showToast () {} }, turnClock: { reset () {} },
    handInteraction, hud: { render () {} }, controls: {}, controlsY: () => 0, layoutSeats () {}, setTableVisible () {}, setFriendRoomWaitingVisible () {} })
  table.mount()
  const publish = (state, mode = 'incremental') => lobby.events.emit('guandan:network-state', { roomId: 'synthetic-room', effectSync: { mode }, state })
  publish(first)
  return { h, manager, table, publish, lobby }
}
for (const mode of ['incremental', 'recovery']) for (const finish of ['touchend', 'longpress']) {
  const x = setup(); x.manager.toggleCard('c')
  x.h.views.get('a').handleTouchStart(x.h.event({ x: 122, y: 60 }))
  const oldTimer = [...x.h.controller.scheduled][0]
  x.publish(play(initial, 'p1', ['b']), mode)
  assert.deepEqual([...x.manager.selectedCardIds], []); assert.equal(x.h.controller.interactive, true)
  if (finish === 'longpress') oldTimer()
  x.h.views.get('a').handleTouchEnd(x.h.event({ x: 122, y: 60 }))
  assert.deepEqual([...x.manager.selectedCardIds], [], 'old gesture must not revive selection after authoritative hand change')
  x.h.views.get('c').handleTouchStart(x.h.event({ x: 222, y: 60 }, 9))
  oldTimer()
  assert.deepEqual([...x.manager.selectedCardIds], [], 'old timer must not activate a newer gesture')
  x.h.views.get('c').handleTouchEnd(x.h.event({ x: 222, y: 60 }, 9))
  assert.deepEqual([...x.manager.selectedCardIds], ['c'], 'new input still works after invalidation')
  x.table.dispose()
}
// Own pass ends the input transaction even with no old selection or hand changes.
const passState = play({ ...initial, currentTurn: 'p4' }, 'p4', ['3a'])
for (const mode of ['incremental', 'recovery']) {
  const x = setup(passState)
  x.h.views.get('a').handleTouchStart(x.h.event({ x: 122, y: 60 }))
  const next = core.transition(passState, { type: 'PASS', playerId: 'p1', roundId: passState.roundId, expectedRevision: passState.revision })
  assert.equal(next.ok, true, next.reason); x.publish(next.state, mode)
  x.h.views.get('a').handleTouchEnd(x.h.event({ x: 122, y: 60 }))
  assert.deepEqual([...x.manager.selectedCardIds], []); x.table.dispose()
}
const others = { ...initial, currentTurn: 'p2' }, x = setup(others)
x.manager.toggleCard('c'); x.h.views.get('a').handleTouchStart(x.h.event({ x: 122, y: 60 }))
x.table.refresh(); x.publish(play(others, 'p2', ['1a'])); x.table.refresh()
x.h.views.get('a').handleTouchEnd(x.h.event({ x: 122, y: 60 }))
assert.deepEqual(new Set(x.manager.selectedCardIds), new Set(['a', 'c']), 'other player updates and render/tick refresh preserve active preselection')
x.table.dispose()
console.log('CI-05-001 input lifetime passed: actual coordinator/manager/card touch, own play/pass, recovery, late timers and other-seat controls')
