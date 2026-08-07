const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/network/LobbyController.ts')
const effectSyncPolicyPath = path.join(projectRoot, 'assets/scripts/effects/NetworkEffectSyncPolicy.ts')
const typescriptPath = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript'
const ts = require(typescriptPath)

class FakeEventTarget {
  constructor () { this.listeners = new Map() }
  on (type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }
  off () {}
  emit (type, ...args) { for (const listener of this.listeners.get(type) || []) listener(...args) }
}

class FakeComponent {
  constructor () { this.scheduled = [] }
  getComponent () { return null }
  scheduleOnce (callback, delay) { this.scheduled.push({ callback, delay }) }
}

class FakeGameSession {
  constructor () { this.joined = []; this.lobbyEntries = 0; this.menuLeaves = 0 }
  joinRoom (roomId, playerId) { this.joined.push({ roomId, playerId }) }
  enterLobby () { this.lobbyEntries += 1 }
  leaveToMenu () { this.menuLeaves += 1 }
}

class FakeSocketClient {
  constructor () {
    this.listeners = new Map()
    this.sent = []
    this.connectCalls = []
    this.sequence = 0
  }
  on (type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); return () => {} }
  emit (type, payload) { for (const listener of this.listeners.get(type) || []) listener(payload) }
  connect (endpoint) { this.connectCalls.push(endpoint); return Promise.resolve() }
  send (type, payload) {
    const requestId = ++this.sequence
    this.sent.push({ requestId, type, payload })
    return requestId
  }
  close () {}
}

const source = fs.readFileSync(sourcePath, 'utf8')
const loadPureTs = filePath => {
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText
  const loadedModule = { exports: {} }
  new Function('exports', 'module', 'require', output)(loadedModule.exports, loadedModule, request => {
    throw new Error(`unexpected dependency ${request} in ${filePath}`)
  })
  return loadedModule.exports
}
const effectSyncPolicy = loadPureTs(effectSyncPolicyPath)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    experimentalDecorators: true,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText

const runtimeModule = new Module(sourcePath, module)
runtimeModule.filename = sourcePath
runtimeModule.paths = Module._nodeModulePaths(path.dirname(sourcePath))
runtimeModule.require = request => {
  if (request === 'cc') {
    return {
      _decorator: {
        ccclass: () => target => target,
        property: () => () => undefined,
      },
      Component: FakeComponent,
      EventTarget: FakeEventTarget,
    }
  }
  if (request === '../session/GameSession') return { GameSession: FakeGameSession }
  if (request === './CocosSocketClient') return { CocosSocketClient: FakeSocketClient }
  if (request === '../effects/NetworkEffectSyncPolicy') return effectSyncPolicy
  return require(request)
}
runtimeModule._compile(compiled, sourcePath)

const { LobbyController } = runtimeModule.exports

function createHarness (connected = true) {
  const controller = new LobbyController()
  const session = new FakeGameSession()
  controller.session = session
  controller.onLoad()
  controller.snapshot = { ...controller.snapshot, connected }
  return { controller, session, socket: controller.client }
}

function roomMessage (type, requestId, roomId, playerId = 'p2', resumeToken = `resume-${requestId}`) {
  return { type, requestId, roomId, myPlayerId: playerId, resumeToken, version: 1 }
}

function failRequest (socket, requestId, requestType, message) {
  socket.emit('requestResult', { requestId, requestType, responseType: 'error', ok: false, message })
}

function runScheduled (controller, delay) {
  const index = controller.scheduled.findIndex(item => item.delay === delay)
  assert.notEqual(index, -1, `missing scheduled callback at ${delay}s`)
  const [{ callback }] = controller.scheduled.splice(index, 1)
  callback.call({ deliberatelyWrongThis: true })
}

async function flushPromises () { await Promise.resolve(); await Promise.resolve() }

async function verifyManualEntryGeneration () {
  const { controller, session, socket } = createHarness()
  const firstRequestId = controller.joinRoom('123456')
  assert.equal(controller.createRoom(), null, 'create/join must reject duplicate entry while joining')
  assert.equal(socket.sent.filter(item => item.type === 'joinRoom' || item.type === 'createRoom').length, 1)

  controller.leaveRoom()
  const currentRequestId = controller.joinRoom('654321')
  socket.emit('roomJoined', roomMessage('roomJoined', firstRequestId, '123456'))
  assert.deepEqual(session.joined, [], 'a late success from an invalidated generation must not enter its room')
  assert.equal(controller.snapshot.roomStatus, 'joining', 'a stale response for another room must not cancel the current entry')
  assert.equal(socket.sent.some(item => item.type === 'leaveRoom' && item.payload.roomId === '123456'), true, 'a stale success must release its server-side seat')

  socket.emit('roomJoined', roomMessage('roomJoined', currentRequestId, '654321'))
  assert.deepEqual(session.joined, [{ roomId: '654321', playerId: 'p2' }])
  assert.equal(controller.snapshot.roomStatus, 'ready')
  const leavesBeforeDuplicate = socket.sent.filter(item => item.type === 'leaveRoom').length
  socket.emit('roomJoined', roomMessage('roomJoined', currentRequestId, '654321'))
  assert.equal(socket.sent.filter(item => item.type === 'leaveRoom').length, leavesBeforeDuplicate, 'a duplicate of the accepted response must not leave the live room')

  const lateCreate = createHarness()
  const createId = lateCreate.controller.createRoom('测试房主')
  const createdRoomId = lateCreate.socket.sent.find(item => item.requestId === createId).payload.roomId
  lateCreate.controller.leaveRoom()
  lateCreate.socket.emit('roomCreated', roomMessage('roomCreated', createId, createdRoomId, 'p1'))
  assert.deepEqual(lateCreate.session.joined, [], 'a late roomCreated must not recreate a room after cancellation')
  assert.equal(lateCreate.socket.sent.some(item => item.type === 'leaveRoom' && item.payload.roomId === createdRoomId), true)
}

async function verifyExpectedRoomAndRejoin () {
  const mismatch = createHarness()
  const mismatchId = mismatch.controller.joinRoom('222222')
  mismatch.socket.emit('roomJoined', roomMessage('roomJoined', mismatchId, '333333'))
  assert.equal(mismatch.controller.snapshot.roomStatus, 'idle')
  assert.deepEqual(mismatch.session.joined, [], 'a response for the wrong room must be rejected')
  assert.equal(mismatch.socket.sent.some(item => item.type === 'leaveRoom' && item.payload.roomId === '333333'), true)

  const harness = createHarness()
  const joinId = harness.controller.joinRoom('444444')
  harness.socket.emit('roomJoined', roomMessage('roomJoined', joinId, '444444', 'p3', 'resume-live'))
  harness.socket.emit('disconnected')
  assert.equal(harness.controller.snapshot.roomStatus, 'rejoining')
  harness.socket.emit('connected')
  const rejoin = harness.socket.sent.findLast(item => item.type === 'rejoinRoom')
  assert.ok(rejoin, 'reconnect must create a request-bound rejoin attempt')
  harness.socket.emit('roomRejoined', roomMessage('roomRejoined', rejoin.requestId, '444444', 'p2', 'resume-live'))
  assert.equal(harness.controller.snapshot.roomStatus, 'idle', 'a rejoin response for the wrong seat must close local room identity')
  assert.equal(harness.session.joined.length, 1, 'wrong-seat rejoin must not call session.joinRoom')

  const late = createHarness()
  const firstJoinId = late.controller.joinRoom('888888')
  late.socket.emit('roomJoined', roomMessage('roomJoined', firstJoinId, '888888', 'p4', 'resume-late'))
  late.socket.emit('disconnected')
  late.socket.emit('connected')
  const oldRejoin = late.socket.sent.findLast(item => item.type === 'rejoinRoom')
  late.socket.emit('disconnected')
  late.socket.emit('connected')
  const currentRejoin = late.socket.sent.findLast(item => item.type === 'rejoinRoom')
  assert.notEqual(currentRejoin.requestId, oldRejoin.requestId)
  late.socket.emit('roomRejoined', roomMessage('roomRejoined', oldRejoin.requestId, '888888', 'p4', 'resume-late'))
  assert.equal(late.controller.snapshot.roomStatus, 'idle', 'a late roomRejoined must invalidate same-seat cleanup races')
  assert.equal(late.session.joined.length, 1, 'a late roomRejoined must not enter the session again')
}

async function verifyAuthoritativeRoomMembers () {
  const { controller, socket } = createHarness()
  const joinId = controller.joinRoom('121212')
  socket.emit('roomJoined', roomMessage('roomJoined', joinId, '121212', 'p2', 'resume-members'))

  socket.emit('roomMembers', { roomId: '121212', memberPlayerIds: ['p1', 'p2', 'p3', 'p4'] })
  assert.deepEqual(controller.snapshot.members, ['p1', 'p2', 'p3', 'p4'], 'the live room member list must be authoritative')

  socket.emit('roomMembers', { roomId: '121212', memberPlayerIds: ['p1', 'p2', 'p4'] })
  assert.deepEqual(controller.snapshot.members, ['p1', 'p2', 'p4'], 'a disconnected seat must disappear from the authoritative member list')

  socket.emit('roomMembers', { roomId: '999999', memberPlayerIds: ['p1'] })
  assert.deepEqual(controller.snapshot.members, ['p1', 'p2', 'p4'], 'another room must not change live seat connectivity')

  socket.emit('roomMembers', { roomId: '121212', memberPlayerIds: ['p1', 'p2', 'p3', 'p4'] })
  assert.deepEqual(controller.snapshot.members, ['p1', 'p2', 'p3', 'p4'], 'a reconnected seat must return to the authoritative member list')

  controller.leaveRoom()
  socket.emit('roomMembers', { roomId: '121212', memberPlayerIds: ['p1', 'p2', 'p4'] })
  assert.deepEqual(controller.snapshot.members, [], 'late membership from a room already left must be ignored')
}

async function verifyInitialReadyAndHostKick () {
  const { controller, session, socket } = createHarness()
  const createId = controller.createRoom('准备测试')
  const roomId = socket.sent.find(item => item.requestId === createId).payload.roomId
  socket.emit('roomCreated', {
    ...roomMessage('roomCreated', createId, roomId, 'p1', 'resume-host'),
    lobbyReadyRequired: true,
    lobbyReadyPlayerIds: [],
  })
  socket.emit('roomMembers', {
    roomId,
    version: 2,
    memberPlayerIds: ['p1', 'p2', 'p3', 'p4'],
    lobbyReadyRequired: true,
    lobbyReadyPlayerIds: ['p2'],
  })
  assert.equal(controller.snapshot.lobbyReadyRequired, true)
  assert.deepEqual(controller.snapshot.lobbyReadyPlayerIds, ['p2'])

  controller.setLobbyReady()
  controller.cancelLobbyReady()
  controller.kickMember('p3')
  assert.deepEqual(socket.sent.slice(-3).map(item => [item.type, item.payload]), [
    ['setLobbyReady', { roomId }],
    ['cancelLobbyReady', { roomId }],
    ['kickMember', { roomId, playerId: 'p3' }],
  ])

  socket.emit('lobbyReadyUpdated', { roomId, version: 3, lobbyReadyRequired: true, lobbyReadyPlayerIds: ['p1', 'p2'] })
  assert.deepEqual(controller.snapshot.lobbyReadyPlayerIds, ['p1', 'p2'])
  const lobbyEntriesBeforeKick = session.lobbyEntries
  socket.emit('roomKicked', { roomId, reason: 'host-kicked', version: 4 })
  assert.equal(controller.snapshot.roomId, null)
  assert.equal(controller.snapshot.roomStatus, 'idle')
  assert.deepEqual(controller.snapshot.lobbyReadyPlayerIds, [])
  assert.match(controller.snapshot.error, /房主移出/)
  assert.equal(session.lobbyEntries, lobbyEntriesBeforeKick + 1)
}

async function verifyMatchedExpiryAndRetryPolicy () {
  const expired = createHarness(false)
  expired.controller.enterMatchedRoom({
    roomId: '555555', gameEndpoint: 'ws://game/weapp', gameTicket: 'expired', seat: 'p2', expiresAt: Date.now() - 1,
  })
  assert.equal(expired.socket.connectCalls.length, 0, 'an expired ticket must be rejected before connecting')
  assert.match(expired.controller.snapshot.error, /已过期/)

  const transient = createHarness(false)
  transient.controller.enterMatchedRoom({
    roomId: '555555', gameEndpoint: 'ws://game/weapp', gameTicket: 'retry-ticket', seat: 'p2', expiresAt: Date.now() + 60_000,
  })
  transient.socket.emit('connected')
  await flushPromises()
  const firstJoin = transient.socket.sent.find(item => item.type === 'joinRoom')
  assert.ok(firstJoin)
  failRequest(transient.socket, firstJoin.requestId, 'joinRoom', '房间不存在，请稍后重试')
  runScheduled(transient.controller, 0.5)
  const joins = transient.socket.sent.filter(item => item.type === 'joinRoom')
  assert.equal(joins.length, 2)
  assert.equal(joins[1].payload.gameTicket, joins[0].payload.gameTicket, 'transient retry must reuse the assigned ticket')
  const retryCallbacksBeforePermanentFailure = transient.controller.scheduled.filter(item => item.delay === 0.5).length
  failRequest(transient.socket, joins[1].requestId, 'joinRoom', '入桌票据已使用')
  assert.equal(transient.controller.scheduled.filter(item => item.delay === 0.5).length, retryCallbacksBeforePermanentFailure, 'a permanent server error must not schedule another retry')
  assert.equal(transient.controller.snapshot.roomStatus, 'idle')
  assert.equal(transient.socket.sent.some(item => item.type === 'leaveRoom' && item.payload.roomId === '555555'), true)
}

async function verifyMatchedWatchdogAndReconnect () {
  const watchdog = createHarness(false)
  watchdog.controller.enterMatchedRoom({
    roomId: '666666', gameEndpoint: 'ws://game/weapp', gameTicket: 'watchdog-ticket', seat: 'p4', expiresAt: Date.now() + 60_000,
  })
  watchdog.socket.emit('connected')
  await flushPromises()
  assert.equal(watchdog.socket.sent.filter(item => item.type === 'joinRoom').length, 1)
  runScheduled(watchdog.controller, 6)
  assert.equal(watchdog.controller.matchedJoinInFlight, false, 'watchdog must release matchedJoinInFlight')
  assert.equal(watchdog.socket.sent.some(item => item.type === 'leaveRoom'), false, 'a recoverable timeout must not abandon the idempotent ticket')
  runScheduled(watchdog.controller, 0.5)
  const watchdogJoins = watchdog.socket.sent.filter(item => item.type === 'joinRoom')
  assert.equal(watchdogJoins.length, 2)
  assert.equal(watchdogJoins[1].payload.gameTicket, 'watchdog-ticket')

  const exhausted = createHarness(false)
  exhausted.controller.enterMatchedRoom({
    roomId: '999999', gameEndpoint: 'ws://game/weapp', gameTicket: 'exhausted-ticket', seat: 'p2', expiresAt: Date.now() + 60_000,
  })
  exhausted.socket.emit('connected')
  await flushPromises()
  exhausted.controller.matchedJoinAttempts = 10
  runScheduled(exhausted.controller, 6)
  assert.equal(exhausted.controller.snapshot.roomStatus, 'idle', 'watchdog must stop after the attempt budget is exhausted')
  assert.equal(exhausted.controller.matchedJoinInFlight, false)
  assert.equal(exhausted.socket.sent.some(item => item.type === 'leaveRoom' && item.payload.roomId === '999999'), true, 'exhausted watchdog must best-effort release the seat')

  const reconnect = createHarness(false)
  reconnect.controller.enterMatchedRoom({
    roomId: '777777', gameEndpoint: 'ws://game/weapp', gameTicket: 'reconnect-ticket', seat: 'p3', expiresAt: Date.now() + 60_000,
  })
  reconnect.socket.emit('connected')
  await flushPromises()
  const oldRequest = reconnect.socket.sent.find(item => item.type === 'joinRoom')
  reconnect.socket.emit('disconnected')
  assert.equal(reconnect.controller.snapshot.roomStatus, 'joining')
  reconnect.socket.emit('connected')
  const retryRequest = reconnect.socket.sent.filter(item => item.type === 'joinRoom').at(-1)
  assert.notEqual(retryRequest.requestId, oldRequest.requestId, 'reconnect must create a fresh expected request id')
  reconnect.socket.emit('roomJoined', roomMessage('roomJoined', retryRequest.requestId, '777777', 'p3', 'resume-match'))
  assert.equal(reconnect.controller.snapshot.roomStatus, 'ready')
  assert.deepEqual(reconnect.session.joined.at(-1), { roomId: '777777', playerId: 'p3' })
}

async function verifyNetworkEffectSyncSemantics () {
  const { controller, socket } = createHarness()
  const states = []
  const rounds = []
  controller.events.on('guandan:network-state', packet => states.push(packet))
  controller.events.on('guandan:round-prepared', packet => rounds.push(packet))
  const state = count => ({ playArea: Array.from({ length: count }, (_, index) => ({ index })) })

  const joinId = controller.joinRoom('565656')
  socket.emit('roomJoined', {
    type: 'roomJoined', requestId: joinId, roomId: '565656', myPlayerId: 'p2', resumeToken: 'resume-effects', version: 10, state: state(2), phase: 'playing',
  })
  assert.equal(states.length, 1)
  assert.deepEqual(states[0].effectSync, { mode: 'recovery', reason: 'initial-snapshot' }, 'the first authoritative snapshot must establish a silent baseline')

  socket.emit('gameState', { roomId: '565656', version: 11, state: state(3) })
  assert.deepEqual(states.at(-1).effectSync, { mode: 'incremental' }, 'one contiguous action must remain eligible for playback')
  socket.emit('gameState', { roomId: '565656', version: 11, state: state(3) })
  assert.equal(states.length, 2, 'a duplicate version must not reach presentation twice')

  socket.emit('gameState', { roomId: '565656', version: 13, state: state(4) })
  assert.deepEqual(states.at(-1).effectSync, { mode: 'recovery', reason: 'version-gap' }, 'a missed version must land silently at the final state')

  socket.emit('disconnected')
  socket.emit('connected')
  const rejoin = socket.sent.findLast(item => item.type === 'rejoinRoom')
  socket.emit('roomRejoined', {
    type: 'roomRejoined', requestId: rejoin.requestId, roomId: '565656', myPlayerId: 'p2', resumeToken: 'resume-effects', version: 13, state: state(4), phase: 'playing',
  })
  assert.deepEqual(states.at(-1).effectSync, { mode: 'recovery', reason: 'reconnect' }, 'a true rejoin must never replay history even at the same version')

  socket.emit('roundPrepared', { roomId: '565656', version: 14, state: state(0), tribute: null })
  assert.deepEqual(rounds.at(-1).effectSync, { mode: 'recovery', reason: 'round-reset' }, 'a new round must reset the action counter')
  socket.emit('gameState', { roomId: '565656', version: 15, state: state(1) })
  assert.deepEqual(states.at(-1).effectSync, { mode: 'incremental' }, 'the first action after a round reset must play normally')
}

async function main () {
  assert.match(source, /entryGeneration/, 'entry responses must be guarded by a generation')
  assert.match(source, /message\.requestId === pending\.requestId/, 'entry success must match its request id')
  assert.match(source, /message\.roomId === pending\.roomId/, 'entry success must match its expected room')
  assert.match(source, /this\.scheduleOnce\(\(\) =>/, 'scheduleOnce callbacks must be arrow-bound')
  await verifyManualEntryGeneration()
  await verifyExpectedRoomAndRejoin()
  await verifyAuthoritativeRoomMembers()
  await verifyInitialReadyAndHostKick()
  await verifyMatchedExpiryAndRetryPolicy()
  await verifyMatchedWatchdogAndReconnect()
  await verifyNetworkEffectSyncSemantics()
  process.stdout.write('lobby entry regression checks passed\n')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
