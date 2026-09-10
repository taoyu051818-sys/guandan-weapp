const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const base = path.resolve(__dirname, '../assets/scripts')
const cache = new Map()
const load = file => {
  if (cache.has(file)) return cache.get(file)
  const source = fs.readFileSync(file, 'utf8')
  const result = { exports: {} }; cache.set(file, result.exports)
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('module', 'exports', 'require', code)(result, result.exports, request => {
    if (!request.startsWith('.')) throw Error('unexpected runtime dependency: ' + request)
    return load(path.resolve(path.dirname(file), request + '.ts'))
  })
  return result.exports
}
const { LobbyMessageRouter } = load(path.join(base, 'network/LobbyMessageRouter.ts'))
const { createLobbySnapshot } = load(path.join(base, 'network/LobbyModels.ts'))
const { LobbyCommandSender } = load(path.join(base, 'network/LobbyCommandSender.ts'))
const settings = load(path.join(base, 'scenes/front-pages/FriendRoomSettingsPolicy.ts'))
let snapshot = { ...createLobbySnapshot(), roomId: '123456', roomStatus: 'ready', myPlayerId: 'p1', roomRole: 'player' }
const listeners = new Map(), emitted = []
const router = new LobbyMessageRouter({ snapshot: () => snapshot, patch: patch => { snapshot = { ...snapshot, ...patch } },
  listen: (type, fn) => listeners.set(type, fn), emit: (...args) => emitted.push(args), isRoomCleaning: () => false,
  handleRequestResult () {}, applyRoomEntry () {}, closeRoom () {}, reportError () {},
})
router.bind()
listeners.get('turnDeadline')({ roomId: '123456', version: 20, gameVersion: 10, turnDeadlineAt: 5000 })
const view = { roomId: '123456', myPlayerId: 'p3', roomRole: 'observer', seatedPlayerId: null, observerWaiting: true, state: null, version: 0, gameVersion: 0, isRoomHost: true }
listeners.get('roomView')({ ...view, roomId: '999999' })
assert.equal(snapshot.roomRole, 'player')
listeners.get('roomView')({ ...view, roomRole: 'admin' })
assert.equal(snapshot.roomRole, 'player')
listeners.get('roomView')(view)
assert.equal(snapshot.roomRole, 'observer'); assert.equal(snapshot.isRoomHost, true)
const state = { phase: 'playing', playArea: [] }
const clock = Date.now() - 30000
listeners.get('roomView')({ ...view, observerWaiting: false, observerClockAt: clock, turnDeadlineAt: clock + 12000, state, version: 5, gameVersion: 2 })
assert.ok(snapshot.turnDeadlineAt >= Date.now() + 11000, 'delayed deadline follows the observed clock')
assert.equal(emitted.at(-1)[0], 'guandan:network-state')
assert.deepEqual(emitted.at(-1)[1].effectSync, { mode: 'recovery', reason: 'reconnect' }, 'history must not replay old effects')
listeners.get('roomView')({ ...view, myPlayerId: 'p2', observerWaiting: false, state, version: 5, gameVersion: 2 })
assert.equal(snapshot.myPlayerId, 'p2', 'same revision must allow a different authorized hand projection')
const sent = [], errors = []
const sender = new LobbyCommandSender({ snapshot: () => snapshot, client: () => ({ send: (...args) => { sent.push(args); return 1 } }), emitResult () {}, reportError: text => errors.push(text) })
for (const type of ['play', 'pass', 'setLobbyReady', 'readyNextRound', 'setTrustee']) assert.equal(sender.roomIntent(type), null)
assert.equal(sent.length, 0)
assert.equal(sender.roomIntent('watchPlayer', { playerId: 'p4' }), 1)
assert.equal(sender.roomIntent('sitDown', { playerId: 'p4' }), 1)
assert.equal(errors.length, 5)
for (const type of ['startGame', 'kickMember', 'addBot', 'removeBot']) assert.equal(sender.roomIntent(type), 1, 'standing host retains room management authority')
snapshot = { ...snapshot, isRoomHost: false }
for (const type of ['startGame', 'kickMember', 'addBot', 'removeBot']) assert.equal(sender.roomIntent(type), null, 'ordinary observers cannot manage the room')
assert.match(fs.readFileSync(path.join(base, 'ui/TableGameHud.ts'), 'utf8'), /trusteeButton\.node\.active = this\.state\.trusteeVisible === true/)
let config = settings.createDefaultFriendRoomSettings()
config = settings.updateFriendRoomChoice(config, 'spectator', '延迟观战')
for (const [text, mode] of [['15秒', 'delay-15'], ['30秒', 'delay-30'], ['60秒', 'delay-60'], ['1局', 'delayed-round']]) {
  config = settings.updateFriendRoomChoice(config, 'spectator-delay', text)
  assert.equal(config.spectator, mode)
}
assert.equal(fs.existsSync(path.join(base, 'scenes/front-pages/ReplaySpectatorPageDomain.ts')), false)
assert.doesNotMatch(fs.readFileSync(path.join(base, 'scenes/FrontPageController.ts'), 'utf8'), /showSpectatorDemo|spectator-feed/)
console.log('Friend-room observer client passed: role transitions, delayed clock, recovery-only snapshots, read-only commands, delay choices and retired page')
