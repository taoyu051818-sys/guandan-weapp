const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/network/LobbyController.ts')
const cocosSocketClientPath = path.join(projectRoot, 'assets/scripts/network/CocosSocketClient.ts')
const lobbyEntryAttemptPath = path.join(projectRoot, 'assets/scripts/network/LobbyEntryAttempt.ts')
const lobbyCleanupTrackerPath = path.join(projectRoot, 'assets/scripts/network/LobbyCleanupTracker.ts')
const lobbyCommandSenderPath = path.join(projectRoot, 'assets/scripts/network/LobbyCommandSender.ts')
const lobbyConnectionEventCoordinatorPath = path.join(projectRoot, 'assets/scripts/network/LobbyConnectionEventCoordinator.ts')
const lobbyMessageRouterPath = path.join(projectRoot, 'assets/scripts/network/LobbyMessageRouter.ts')
const lobbyMatchedEntryCoordinatorPath = path.join(projectRoot, 'assets/scripts/network/LobbyMatchedEntryCoordinator.ts')
const lobbyModelsPath = path.join(projectRoot, 'assets/scripts/network/LobbyModels.ts')
const lobbyResumeConnectionWatchdogPath = path.join(projectRoot, 'assets/scripts/network/LobbyResumeConnectionWatchdog.ts')
const lobbySocketClientPath = path.join(projectRoot, 'assets/scripts/network/LobbySocketClient.ts')
const lobbySyncTrackerPath = path.join(projectRoot, 'assets/scripts/network/LobbySyncTracker.ts')
const lobbyResumeSessionPath = path.join(projectRoot, 'assets/scripts/network/LobbyResumeSession.ts')
const platformMatchRecoveryPath = path.join(projectRoot, 'assets/scripts/scenes/PlatformMatchRecoveryCoordinator.ts')
const effectSyncPolicyPath = path.join(projectRoot, 'assets/scripts/effects/NetworkEffectSyncPolicy.ts')
const { loadTypeScript, typescriptPath } = require('./support/typescript.cjs')
const ts = loadTypeScript()

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
  setRoomView (myPlayerId, isObserver) { this.view = { myPlayerId, isObserver } }
  enterLobby () { this.lobbyEntries += 1 }
  leaveToMenu () { this.menuLeaves += 1 }
}

class FakeSocketClient {
  constructor (connectBehavior = () => Promise.resolve()) {
    this.listeners = new Map()
    this.sent = []
    this.connectCalls = []
    this.sequence = 0
    this.unsubscribeCalls = 0
    this.closeCalls = 0
    this.lifecycle = []
    this.connectBehavior = connectBehavior
  }
  on (type, listener) {
    const group = this.listeners.get(type) || new Set()
    group.add(listener)
    this.listeners.set(type, group)
    let active = true
    return () => {
      assert.equal(active, true, `listener disposer for ${type} must run exactly once`)
      active = false
      this.unsubscribeCalls += 1
      this.lifecycle.push(`unsubscribe:${type}`)
      group.delete(listener)
      if (group.size === 0) this.listeners.delete(type)
    }
  }
  emit (type, payload) { for (const listener of [...(this.listeners.get(type) || [])]) listener(payload) }
  listenerCount () { return [...this.listeners.values()].reduce((total, group) => total + group.size, 0) }
  connect (endpoint) {
    this.connectCalls.push(endpoint)
    return this.connectBehavior(endpoint, this.connectCalls.length)
  }
  send (type, payload, retryRequestId) {
    const requestId = retryRequestId ?? ++this.sequence
    this.sent.push({ requestId, type, payload })
    return requestId
  }
  close () { this.closeCalls += 1; this.lifecycle.push('close') }
}

class FakeStorage {
  constructor () { this.values = new Map(); this.writes = [] }
  getItem (key) { return this.values.get(key) ?? null }
  setItem (key, value) { this.values.set(key, value); this.writes.push({ key, value }) }
  removeItem (key) { this.values.delete(key) }
}

class FailingWriteStorage extends FakeStorage {
  setItem () { throw new Error('quota unavailable') }
}

const source = fs.readFileSync(sourcePath, 'utf8')
const matchedEntryCoordinatorSource = fs.readFileSync(lobbyMatchedEntryCoordinatorPath, 'utf8')
const loadPureTs = (filePath, dependencies = {}) => {
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText
  const loadedModule = { exports: {} }
  new Function('exports', 'module', 'require', output)(loadedModule.exports, loadedModule, request => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`unexpected dependency ${request} in ${filePath}`)
  })
  return loadedModule.exports
}
const effectSyncPolicy = loadPureTs(effectSyncPolicyPath)
const lobbyEntryAttempt = loadPureTs(lobbyEntryAttemptPath)
const lobbyCleanupTracker = loadPureTs(lobbyCleanupTrackerPath)
const lobbyMatchedEntryCoordinator = loadPureTs(lobbyMatchedEntryCoordinatorPath)
const lobbyModels = loadPureTs(lobbyModelsPath)
const lobbyResumeConnectionWatchdog = loadPureTs(lobbyResumeConnectionWatchdogPath)
const lobbySyncTracker = loadPureTs(lobbySyncTrackerPath, {
  '../effects/NetworkEffectSyncPolicy': effectSyncPolicy,
})
const lobbyCommandSender = loadPureTs(lobbyCommandSenderPath, {
  '../core/generated/protocol': { commandRequiresExpectedVersion: type => ['startGame', 'play', 'pass', 'tribute', 'returnTribute', 'finishTribute'].includes(type) },
})
const lobbyConnectionEventCoordinator = loadPureTs(lobbyConnectionEventCoordinatorPath)
const lobbyMessageRouter = loadPureTs(lobbyMessageRouterPath, {
  './LobbyModels': lobbyModels,
  './LobbySyncTracker': lobbySyncTracker,
  './FriendRoomViewReceiver': loadPureTs(path.join(projectRoot, 'assets/scripts/network/FriendRoomViewReceiver.ts')),
})
const networkEndpoint = loadPureTs(path.join(projectRoot, 'assets/scripts/services/NetworkEndpoint.ts'))
const lobbyResumeSession = loadPureTs(lobbyResumeSessionPath, { '../services/NetworkEndpoint': networkEndpoint })
const platformMatchRecovery = loadPureTs(platformMatchRecoveryPath)
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
      sys: { localStorage: new FakeStorage() },
    }
  }
  if (request === '../session/GameSession') return { GameSession: FakeGameSession }
  if (request === '../core/generated/protocol') return { commandRequiresExpectedVersion: type => ['startGame', 'play', 'pass', 'tribute', 'returnTribute', 'finishTribute'].includes(type) }
  if (request === './CocosSocketClient') return { CocosSocketClient: FakeSocketClient }
  if (request === '../effects/NetworkEffectSyncPolicy') return effectSyncPolicy
  if (request === './LobbyModels') return lobbyModels
  if (request === './LobbyEntryAttempt') return lobbyEntryAttempt
  if (request === './LobbyEntryRequest') return loadPureTs(path.join(projectRoot, 'assets/scripts/network/LobbyEntryRequest.ts'))
  if (request === './LobbyCleanupTracker') return lobbyCleanupTracker
  if (request === './LobbyCommandSender') return lobbyCommandSender
  if (request === './LobbyConnectionEventCoordinator') return lobbyConnectionEventCoordinator
  if (request === './LobbyMessageRouter') return lobbyMessageRouter
  if (request === './LobbyMatchedEntryCoordinator') return lobbyMatchedEntryCoordinator
  if (request === './LobbyResumeConnectionWatchdog') return lobbyResumeConnectionWatchdog
  if (request === './LobbySyncTracker') return lobbySyncTracker
  if (request === './LobbyResumeSession') return lobbyResumeSession
  return require(request)
}
runtimeModule._compile(compiled, sourcePath)

const { LobbyController } = runtimeModule.exports

function createHarness (connected = true, storage = new FakeStorage(), socket = new FakeSocketClient()) {
  const controller = new LobbyController()
  const session = new FakeGameSession()
  controller.session = session
  controller.setResumeStorage(storage)
  controller.setSocketClient(socket)
  controller.onLoad()
  controller.snapshot = { ...controller.snapshot, connected }
  return { controller, session, socket, storage }
}

function roomMessage (type, requestId, roomId, playerId = 'p2', resumeToken = `resume-${requestId}`) {
  return { type, requestId, roomId, myPlayerId: playerId, resumeToken, version: 1, gameVersion: 0 }
}

function failRequest (socket, requestId, requestType, message, code = null) {
  socket.emit('requestResult', { requestId, requestType, responseType: 'error', ok: false, code, message })
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
  const firstEntryAttemptId = socket.sent.at(-1).payload.entryAttemptId
  assert.match(firstEntryAttemptId, /^[A-Za-z0-9_-]{22,128}$/, 'joinRoom must carry a URL-safe 128-bit attempt id')
  assert.equal(controller.createRoom(), null, 'create/join must reject duplicate entry while joining')
  assert.equal(socket.sent.filter(item => item.type === 'joinRoom' || item.type === 'createRoom').length, 1)

  controller.leaveRoom()
  const currentRequestId = controller.joinRoom('654321')
  assert.notEqual(socket.sent.at(-1).payload.entryAttemptId, firstEntryAttemptId, 'a new manual join must use a new attempt id')
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
  assert.match(lateCreate.socket.sent.find(item => item.requestId === createId).payload.entryAttemptId, /^[A-Za-z0-9_-]{22,128}$/, 'createRoom must carry an attempt id')
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
  const recoveryRequests = []
  const roomClosePolicies = []
  harness.controller.events.on('guandan:platform-recovery-required', value => recoveryRequests.push(value))
  harness.controller.events.on('guandan:room-closed', (_message, options) => roomClosePolicies.push(options))
  harness.socket.emit('roomRejoined', roomMessage('roomRejoined', rejoin.requestId, '444444', 'p2', 'resume-live'))
  assert.equal(harness.controller.snapshot.roomStatus, 'idle', 'a rejoin response for the wrong seat must close local room identity')
  assert.equal(harness.session.joined.length, 1, 'wrong-seat rejoin must not call session.joinRoom')
  assert.deepEqual(recoveryRequests, [{}], 'an identity-mismatched local resume must fall back to authenticated recovery')
  assert.deepEqual(roomClosePolicies, [{ compensateReservation: false }], 'local resume failure must reset presentation without cancelling the platform reservation')
  assert.equal(harness.socket.closeCalls, 1, 'local resume failure must discard any connection that may already be seat-bound')

  const late = createHarness()
  const firstJoinId = late.controller.joinRoom('888888')
  late.socket.emit('roomJoined', roomMessage('roomJoined', firstJoinId, '888888', 'p4', 'resume-late'))
  late.socket.emit('disconnected')
  late.socket.emit('connected')
  const oldRejoin = late.socket.sent.findLast(item => item.type === 'rejoinRoom')
  late.socket.emit('disconnected')
  late.socket.emit('connected')
  const currentRejoin = late.socket.sent.findLast(item => item.type === 'rejoinRoom')
  assert.equal(currentRejoin.requestId, oldRejoin.requestId, 'lost local-resume reply must keep the original token request identity')
  late.socket.emit('roomRejoined', roomMessage('roomRejoined', oldRejoin.requestId, '888888', 'p4', 'resume-late'))
  assert.equal(late.controller.snapshot.roomStatus, 'ready', 'a late response for the same logical resume remains valid')
  assert.equal(late.session.joined.length, 2, 'the resumed session must be restored exactly once')
  late.socket.emit('roomRejoined', roomMessage('roomRejoined', currentRejoin.requestId, '888888', 'p4', 'resume-late'))
  assert.equal(late.session.joined.length, 2, 'duplicate success cannot restore a session twice')
  assert.equal(late.socket.sent.some(item => item.type === 'leaveRoom'), false, 'same-session duplicates cannot trigger destructive cleanup')
}

async function verifyAuthoritativeRoomMembers () {
  const { controller, socket } = createHarness()
  const joinId = controller.joinRoom('121212')
  socket.emit('roomJoined', roomMessage('roomJoined', joinId, '121212', 'p2', 'resume-members'))

  socket.emit('roomMembers', { roomId: '121212', version: 2, memberPlayerIds: ['p1', 'p2', 'p3', 'p4'] })
  assert.deepEqual(controller.snapshot.members, ['p1', 'p2', 'p3', 'p4'], 'the live room member list must be authoritative')

  socket.emit('roomMembers', { roomId: '121212', version: 3, memberPlayerIds: ['p1', 'p2', 'p4'] })
  assert.deepEqual(controller.snapshot.members, ['p1', 'p2', 'p4'], 'a disconnected seat must disappear from the authoritative member list')

  socket.emit('roomMembers', { roomId: '999999', version: 4, memberPlayerIds: ['p1'] })
  assert.deepEqual(controller.snapshot.members, ['p1', 'p2', 'p4'], 'another room must not change live seat connectivity')

  socket.emit('roomMembers', { roomId: '121212', version: 4, memberPlayerIds: ['p1', 'p2', 'p3', 'p4'] })
  assert.deepEqual(controller.snapshot.members, ['p1', 'p2', 'p3', 'p4'], 'a reconnected seat must return to the authoritative member list')

  controller.leaveRoom()
  socket.emit('roomMembers', { roomId: '121212', version: 5, memberPlayerIds: ['p1', 'p2', 'p4'] })
  assert.deepEqual(controller.snapshot.members, [], 'late membership from a room already left must be ignored')
}

async function verifyResumePersistenceFailureIsObservable () {
  const { controller, session, socket } = createHarness(true, new FailingWriteStorage())
  const errors = []
  controller.events.on('guandan:network-error', message => errors.push(message))
  const requestId = controller.joinRoom('343434')
  socket.emit('roomJoined', roomMessage('roomJoined', requestId, '343434', 'p2', 'resume-not-persisted'))
  assert.equal(controller.snapshot.roomStatus, 'ready', 'storage failure must not block the accepted live room')
  assert.equal(session.joined.length, 1, 'storage failure must not prevent the current game session from joining')
  assert.match(controller.snapshot.error, /无法保存断线恢复凭证/, 'the lobby snapshot must expose degraded cold-resume durability')
  assert.ok(errors.some(message => /无法保存断线恢复凭证/.test(message)), 'the UI event channel must expose resume persistence failure')
}

async function verifyInitialReadyAndHostKick () {
  const { controller, session, socket } = createHarness()
  const createId = controller.createRoom('准备测试')
  const roomId = socket.sent.find(item => item.requestId === createId).payload.roomId
  socket.emit('roomCreated', {
    ...roomMessage('roomCreated', createId, roomId, 'p1', 'resume-host'),
    lobbyReadyRequired: true,
    lobbyReadyPlayerIds: [],
    entryKind: 'friend',
    capabilities: { canUseBots: false, canKickMembers: true, requiresLobbyReady: true },
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
  assert.equal(controller.snapshot.entryKind, 'friend')
  assert.deepEqual(controller.snapshot.capabilities, { canUseBots: false, canKickMembers: true, requiresLobbyReady: true }, 'ticket-bound room capabilities must remain authoritative')

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
  assert.equal(controller.snapshot.entryKind, null)
  assert.equal(controller.snapshot.capabilities, null)
  assert.match(controller.snapshot.error, /房主移出/)
  assert.equal(session.lobbyEntries, lobbyEntriesBeforeKick + 1)
}

async function verifyGameStartPendingLifecycle () {
  const { controller, socket } = createHarness()
  const createId = controller.createRoom('开局确认测试')
  const roomId = socket.sent.find(item => item.requestId === createId).payload.roomId
  socket.emit('roomCreated', {
    ...roomMessage('roomCreated', createId, roomId, 'p1', 'resume-pending'),
    memberPlayerIds: ['p1', 'p2', 'p3', 'p4'],
    lobbyReadyRequired: true,
    lobbyReadyPlayerIds: ['p1', 'p2', 'p3', 'p4'],
    gameStartPending: false,
  })
  const startRequestId = controller.startGame()
  socket.emit('gameStartPending', {
    type: 'gameStartPending', requestId: startRequestId, roomId, version: 1, gameVersion: 0,
    gameStartPending: true, message: '平台尚未确认好友房开局',
  })
  assert.equal(controller.snapshot.gameStartPending, true)
  assert.equal(controller.snapshot.error, null, 'routine start confirmation is state, not an error banner')

  const sentBeforeGuards = socket.sent.length
  assert.equal(controller.startGame(), null)
  assert.equal(controller.setLobbyReady(), null)
  assert.equal(controller.kickMember('p2'), null)
  controller.leaveRoom()
  assert.equal(socket.sent.length, sentBeforeGuards, 'pending start must reject duplicate start, membership, ready, and leave actions locally')
  assert.equal(controller.snapshot.roomId, roomId, 'pending start cannot be abandoned before the authoritative lifecycle resolves')

  socket.emit('roomMembers', { roomId, version: 1, gameStartPending: true, memberPlayerIds: ['p1', 'p2', 'p3', 'p4'] })
  assert.equal(controller.snapshot.gameStartPending, true, 'same-version/reconnect metadata must retain the pending projection')
  socket.emit('gameState', { roomId, version: 2, gameVersion: 1, state: { playArea: [] } })
  assert.equal(controller.snapshot.gameStartPending, false, 'authoritative game state must clear pending start even when an older server omits the explicit false flag')
  assert.notEqual(controller.setLobbyReady(), null, 'room commands resume after the server clears pending start')

  const dissolved = createHarness()
  const dissolvedJoinId = dissolved.controller.joinRoom('252526')
  dissolved.socket.emit('roomJoined', {
    ...roomMessage('roomJoined', dissolvedJoinId, '252526', 'p3', 'resume-pending-dissolved'),
    gameStartPending: true,
  })
  dissolved.socket.emit('roomDissolved', { roomId: '252526', version: 2, reason: 'start-claim-rejected' })
  assert.equal(dissolved.controller.snapshot.roomId, null, 'a terminal roomDissolved must exit a pending-start room')
  assert.equal(dissolved.controller.snapshot.gameStartPending, false, 'terminal room cleanup must clear pending-start presentation')
}

async function verifyMatchEndedLifecycle () {
  const { controller, socket } = createHarness()
  const joinId = controller.joinRoom('232323')
  socket.emit('roomJoined', {
    ...roomMessage('roomJoined', joinId, '232323', 'p2', 'resume-ended'),
    turnDeadlineAt: Date.now() + 20_000, deadlinePlayerId: 'p2', deadlineAction: 'play',
  })
  const events = []
  controller.events.on('guandan:match-ended', value => events.push(value))
  const timeLimit = {
    reason: 'time-limit', endedAt: 123456789, roundsPlayed: 3, configuredRounds: 8,
    scores: { teamA: 6, teamB: 8 }, winnerTeam: 'teamB',
  }
  socket.emit('gameState', { roomId: '232323', version: 5, gameVersion: 7, state: { phase: 'playing', playArea: [] }, matchEnded: timeLimit })
  assert.deepEqual(controller.snapshot.matchEnded, timeLimit, 'time-limit must terminate a match even while the engine state remains playing')
  assert.equal(controller.snapshot.turnDeadlineAt, null)
  assert.equal(controller.snapshot.deadlinePlayerId, null)
  assert.equal(controller.play(['card-1']), null, 'terminal metadata must freeze gameplay commands')
  assert.equal(controller.readyNextRound(), null, 'terminal metadata must freeze next-round readiness')
  assert.deepEqual(events, [timeLimit])

  socket.emit('matchEnded', { roomId: '232323', version: 5, ...timeLimit })
  socket.emit('matchEnded', {
    roomId: '232323', version: 4, reason: 'round-limit', endedAt: 1, roundsPlayed: 1,
    configuredRounds: 1, scores: { teamA: 99, teamB: 0 }, winnerTeam: 'teamA',
  })
  assert.equal(events.length, 1, 'duplicate and stale terminal broadcasts must be idempotent')
  assert.deepEqual(controller.snapshot.matchEnded, timeLimit, 'stale terminal metadata cannot replace the accepted result')

  const reconnect = createHarness()
  const reconnectJoin = reconnect.controller.joinRoom('242424')
  const roundLimit = {
    reason: 'round-limit', endedAt: 223456789, roundsPlayed: 4, configuredRounds: 4,
    scores: { teamA: 12, teamB: 12 }, winnerTeam: null,
  }
  reconnect.socket.emit('roomJoined', {
    ...roomMessage('roomJoined', reconnectJoin, '242424', 'p4', 'resume-round-ended'),
    version: 8, phase: 'settlement', state: { phase: 'settled', playArea: [] }, matchEnded: roundLimit,
  })
  assert.deepEqual(reconnect.controller.snapshot.matchEnded, roundLimit, 'a terminal reconnect snapshot must restore round-limit state')
  reconnect.controller.leaveRoom()
  assert.equal(reconnect.controller.snapshot.matchEnded, null, 'leaving a terminal table must clear its presentation')

  const passedA = {
    reason: 'passed-a', endedAt: 323456789, roundsPlayed: 7, configuredRounds: 8,
    scores: { teamA: 18, teamB: 12 }, winnerTeam: 'teamA',
  }
  const roundEnded = createHarness()
  const roundEndedJoin = roundEnded.controller.joinRoom('262626')
  roundEnded.socket.emit('roomJoined', roomMessage('roomJoined', roundEndedJoin, '262626', 'p1', 'resume-passed-a'))
  roundEnded.socket.emit('roundEnded', {
    roomId: '262626', version: 9, gameVersion: 11, matchEnded: passedA,
    result: { winnerTeam: 'teamA' }, state: { phase: 'settled', playArea: [] },
  })
  assert.deepEqual(roundEnded.controller.snapshot.matchEnded, passedA, 'roundEnded must retain the passed-a terminal lifecycle')
  roundEnded.controller.safeExit()
  assert.equal(roundEnded.controller.snapshot.recoveryAvailable, false, 'returning after a terminal roundEnded must not expose continue-match recovery')

  const rejoinedTerminal = createHarness()
  const terminalJoin = rejoinedTerminal.controller.joinRoom('272727')
  rejoinedTerminal.socket.emit('roomJoined', roomMessage('roomJoined', terminalJoin, '272727', 'p2', 'resume-before-terminal'))
  const rejoinedMatchEndedEvents = []
  rejoinedTerminal.controller.events.on('guandan:match-ended', value => rejoinedMatchEndedEvents.push(value))
  rejoinedTerminal.socket.emit('disconnected')
  rejoinedTerminal.socket.emit('connected')
  const terminalRejoin = rejoinedTerminal.socket.sent.findLast(item => item.type === 'rejoinRoom')
  rejoinedTerminal.socket.emit('roomRejoined', {
    ...roomMessage('roomRejoined', terminalRejoin.requestId, '272727', 'p2', 'resume-terminal'),
    version: 12, gameVersion: 14, phase: 'settlement', state: { phase: 'settled', playArea: [] }, matchEnded: passedA,
  })
  assert.deepEqual(rejoinedTerminal.controller.snapshot.matchEnded, passedA, 'the losing p2 roomRejoined snapshot must retain the authoritative passed-a winner')
  assert.deepEqual(rejoinedMatchEndedEvents, [passedA], 'roomRejoined must emit the same non-null winnerTeam used by viewer-relative presentation')
  rejoinedTerminal.controller.safeExit()
  assert.equal(rejoinedTerminal.controller.snapshot.recoveryAvailable, false, 'returning after a terminal roomRejoined snapshot must not show continue-match recovery')

  const safeExit = createHarness()
  const safeJoin = safeExit.controller.joinRoom('252525')
  safeExit.socket.emit('roomJoined', roomMessage('roomJoined', safeJoin, '252525', 'p2', 'resume-safe-exit'))
  const safeRecoveryRequests = []
  safeExit.controller.events.on('guandan:platform-recovery-required', value => safeRecoveryRequests.push(value))
  safeExit.controller.safeExit()
  assert.equal(safeExit.controller.snapshot.recoveryAvailable, true, 'safe exit from a live room must leave an explicit continue path')
  assert.deepEqual(safeRecoveryRequests, [], 'safe exit must not immediately undo the user navigation')
  safeExit.controller.recoverActiveMatch()
  assert.deepEqual(safeRecoveryRequests, [{ manual: true }])
  assert.equal(safeExit.controller.snapshot.recoveryAvailable, false)
}

async function verifyMatchedExpiryAndRetryPolicy () {
  const expired = createHarness(false)
  const expiredRecoveryRequests = []
  expired.controller.events.on('guandan:platform-recovery-required', value => expiredRecoveryRequests.push(value))
  expired.controller.enterMatchedRoom({
    entryAttemptId: 'expiredMatchEntry_Q7mN4vX9kLp2',
    roomId: '555555', gameEndpoint: 'ws://game/weapp', gameTicket: 'expired', seat: 'p2', expiresAt: Date.now() - 1,
  })
  assert.equal(expired.socket.connectCalls.length, 0, 'an expired ticket must be rejected before connecting')
  assert.match(expired.controller.snapshot.error, /已过期/)
  assert.deepEqual(expiredRecoveryRequests, [{}], 'an expired initial platform ticket must request a fresh authenticated recovery ticket')

  const transient = createHarness(false)
  const transientRecoveryRequests = []
  transient.controller.events.on('guandan:platform-recovery-required', value => transientRecoveryRequests.push(value))
  const platformEntryAttemptId = 'platformFriendEntry_Q7mN4vX9kLp2'
  transient.controller.enterMatchedRoom({
    roomId: '555555', gameEndpoint: 'ws://game/weapp', gameTicket: 'retry-ticket', seat: 'p2', expiresAt: Date.now() + 60_000,
    entryAttemptId: platformEntryAttemptId,
  })
  transient.socket.emit('connected')
  await flushPromises()
  const firstJoin = transient.socket.sent.find(item => item.type === 'joinRoom')
  assert.ok(firstJoin)
  failRequest(transient.socket, firstJoin.requestId, 'joinRoom', '房间不存在，请稍后重试')
  runScheduled(transient.controller, 0.5)
  const joins = transient.socket.sent.filter(item => item.type === 'joinRoom')
  assert.equal(joins.length, 2)
  assert.equal(joins[0].payload.entryAttemptId, platformEntryAttemptId, 'the HTTP friend-room attempt id must continue into its first WebSocket entry')
  assert.equal(joins[1].payload.gameTicket, joins[0].payload.gameTicket, 'transient retry must reuse the assigned ticket')
  assert.equal(joins[1].payload.entryAttemptId, platformEntryAttemptId, 'transient retry must reuse the HTTP logical entry attempt id')
  const retryCallbacksBeforePermanentFailure = transient.controller.scheduled.filter(item => item.delay === 0.5).length
  failRequest(transient.socket, joins[1].requestId, 'joinRoom', '入桌票据已使用')
  assert.equal(transient.controller.scheduled.filter(item => item.delay === 0.5).length, retryCallbacksBeforePermanentFailure, 'a permanent server error must not schedule another retry')
  assert.equal(transient.controller.snapshot.roomStatus, 'idle')
  assert.equal(transient.socket.sent.some(item => item.type === 'leaveRoom' && item.payload.roomId === '555555'), false, 'a possibly accepted platform seat must not be released after a lost response')
  assert.equal(transient.socket.closeCalls, 1, 'a fresh recovery ticket must use a new transport connection')
  assert.deepEqual(transientRecoveryRequests, [{}])

  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    for (const [seat, roomId] of [['p1', '565656'], ['p2', '575757']]) {
      const dropped = createHarness(false)
      const recoveryRequests = []
      dropped.controller.events.on('guandan:platform-recovery-required', value => recoveryRequests.push(value))
      dropped.controller.enterMatchedRoom({
        entryAttemptId: `droppedResponse${seat}_Q7mN4vX9kLp`, roomId, gameEndpoint: 'ws://game/weapp',
        gameTicket: `dropped-${seat}`, seat, expiresAt: now + 1_000,
      })
      dropped.socket.emit('connected')
      await flushPromises()
      now += 1_001
      runScheduled(dropped.controller, 6)
      assert.equal(dropped.socket.sent.some(item => item.type === 'leaveRoom'), false, `${seat} expiry after a dropped success must not mutate server membership`)
      assert.equal(dropped.socket.closeCalls, 1, `${seat} recovery must discard the potentially bound connection`)
      assert.deepEqual(recoveryRequests, [{}], `${seat} must request a fresh platform recovery ticket`)
      now += 1_000
    }
  } finally {
    Date.now = originalNow
  }
}

async function verifyMatchedWatchdogAndReconnect () {
  const watchdog = createHarness(false)
  watchdog.controller.enterMatchedRoom({
    entryAttemptId: 'watchdogMatchEntry_Q7mN4vX9kLp2',
    roomId: '666666', gameEndpoint: 'ws://game/weapp', gameTicket: 'watchdog-ticket', seat: 'p4', expiresAt: Date.now() + 60_000,
  })
  watchdog.socket.emit('connected')
  await flushPromises()
  assert.equal(watchdog.socket.sent.filter(item => item.type === 'joinRoom').length, 1)
  runScheduled(watchdog.controller, 6)
  assert.equal(watchdog.socket.sent.some(item => item.type === 'leaveRoom'), false, 'a recoverable timeout must not abandon the idempotent ticket')
  runScheduled(watchdog.controller, 0.5)
  const watchdogJoins = watchdog.socket.sent.filter(item => item.type === 'joinRoom')
  assert.equal(watchdogJoins.length, 2)
  assert.equal(watchdogJoins[1].payload.gameTicket, 'watchdog-ticket')
  assert.equal(watchdogJoins[1].payload.entryAttemptId, watchdogJoins[0].payload.entryAttemptId, 'watchdog retry must remain the same logical entry attempt')
  assert.equal(watchdogJoins[1].requestId, watchdogJoins[0].requestId, 'a dropped success must reuse the server receipt key')

  const delayed = createHarness(false)
  delayed.controller.enterMatchedRoom({ roomId: '666665', seat: 'p2', gameEndpoint: 'ws://game/weapp', gameTicket: 'delayed', entryAttemptId: 'delayedEntry_12345678901234', expiresAt: Date.now() + 60_000 })
  delayed.socket.emit('connected')
  await flushPromises()
  const original = delayed.socket.sent.find(item => item.type === 'joinRoom')
  runScheduled(delayed.controller, 6)
  delayed.socket.emit('roomJoined', roomMessage('roomJoined', original.requestId, '666665', 'p2', 'resume-delayed'))
  runScheduled(delayed.controller, 0.5)
  assert.equal(delayed.controller.snapshot.roomStatus, 'ready', 'success during retry backoff must still enter the room')
  assert.equal(delayed.socket.sent.filter(item => item.type === 'joinRoom').length, 1, 'backoff callback must be cancelled after success')
  assert.equal(delayed.socket.sent.some(item => item.type === 'leaveRoom'), false)

  const exhausted = createHarness(false)
  exhausted.controller.enterMatchedRoom({
    entryAttemptId: 'exhaustedMatchEntry_Q7mN4vX9kL',
    roomId: '999999', gameEndpoint: 'ws://game/weapp', gameTicket: 'exhausted-ticket', seat: 'p2', expiresAt: Date.now() + 60_000,
  })
  exhausted.socket.emit('connected')
  await flushPromises()
  for (let retry = 1; retry < 10; retry += 1) {
    runScheduled(exhausted.controller, 6)
    runScheduled(exhausted.controller, 0.5)
  }
  runScheduled(exhausted.controller, 6)
  assert.equal(exhausted.controller.snapshot.roomStatus, 'idle', 'watchdog must stop after the attempt budget is exhausted')
  assert.equal(exhausted.socket.sent.filter(item => item.type === 'joinRoom').length, 10, 'watchdog must honor the bounded retry budget')
  assert.equal(exhausted.socket.sent.some(item => item.type === 'leaveRoom' && item.payload.roomId === '999999'), false, 'exhausted watchdog must preserve a possibly accepted platform seat for recovery')
  assert.equal(exhausted.socket.closeCalls, 1, 'exhausted watchdog must reset the old transport before recovery')

  const reconnect = createHarness(false)
  const reconnectEntryAttemptId = 'platformReconnect_Q7mN4vX9kLp2s'
  reconnect.controller.enterMatchedRoom({
    roomId: '777777', gameEndpoint: 'ws://game/weapp', gameTicket: 'reconnect-ticket', seat: 'p3', expiresAt: Date.now() + 60_000,
    entryAttemptId: reconnectEntryAttemptId,
  })
  reconnect.socket.emit('connected')
  await flushPromises()
  const oldRequest = reconnect.socket.sent.find(item => item.type === 'joinRoom')
  reconnect.socket.emit('disconnected')
  assert.equal(reconnect.controller.snapshot.roomStatus, 'joining')
  reconnect.socket.emit('connected')
  const retryRequest = reconnect.socket.sent.filter(item => item.type === 'joinRoom').at(-1)
  assert.equal(retryRequest.requestId, oldRequest.requestId, 'reconnect must retain the accepted ticket request id')
  assert.equal(oldRequest.payload.entryAttemptId, reconnectEntryAttemptId)
  assert.equal(retryRequest.payload.entryAttemptId, reconnectEntryAttemptId, 'disconnect retry must reuse the HTTP attempt id across connections')
  reconnect.socket.emit('roomJoined', roomMessage('roomJoined', retryRequest.requestId, '777777', 'p3', 'resume-match'))
  assert.equal(reconnect.controller.snapshot.roomStatus, 'ready')
  assert.deepEqual(reconnect.session.joined.at(-1), { roomId: '777777', playerId: 'p3' })
}

async function verifyMatchedConnectionBudget () {
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    const unreachableSocket = new FakeSocketClient(() => Promise.reject(new Error('endpoint unreachable')))
    const unreachable = createHarness(false, new FakeStorage(), unreachableSocket)
    const expiryRecoveryRequests = []
    unreachable.controller.events.on('guandan:platform-recovery-required', value => expiryRecoveryRequests.push(value))
    const expiringAttemptId = 'expiringConnectAttempt_Q7mN4vX9kLp'
    unreachable.controller.enterMatchedRoom({
      entryAttemptId: expiringAttemptId, recoveryAttemptId: expiringAttemptId, ticketPurpose: 'rejoin',
      roomId: '787878', gameEndpoint: 'wss://unreachable.example/weapp', gameTicket: 'short-ticket', seat: 'p4', expiresAt: now + 1_000,
    })
    await flushPromises()
    assert.match(unreachable.controller.snapshot.error, /endpoint unreachable/)
    assert.equal(unreachable.controller.snapshot.roomStatus, 'joining', 'connect rejection must remain recoverable until its absolute ticket deadline')
    now += 1_001
    runScheduled(unreachable.controller, 1)
    assert.equal(unreachableSocket.closeCalls, 1, 'absolute expiry must stop the transport reconnect loop')
    assert.equal(unreachable.controller.snapshot.roomStatus, 'idle')
    assert.equal(unreachableSocket.sent.some(item => item.type === 'leaveRoom'), false, 'unreachable entry recovery must never mutate a possibly bound seat')
    assert.deepEqual(expiryRecoveryRequests, [{ abandonAttemptId: expiringAttemptId }])

    const repeated = createHarness(false)
    const repeatedRecoveryRequests = []
    repeated.controller.events.on('guandan:platform-recovery-required', value => repeatedRecoveryRequests.push(value))
    repeated.controller.enterMatchedRoom({
      entryAttemptId: 'connectionBudgetAttempt_Q7mN4vX9kLp', roomId: '797979',
      gameEndpoint: 'wss://flaky.example/weapp', gameTicket: 'flaky-ticket', seat: 'p2', expiresAt: now + 60_000,
    })
    await flushPromises()
    for (let failure = 0; failure < 6; failure += 1) {
      repeated.socket.emit('connected')
      repeated.socket.emit('disconnected')
    }
    assert.equal(repeated.socket.closeCalls, 1, 'the total connection failure budget must stop autonomous reconnects')
    assert.equal(repeated.controller.snapshot.roomStatus, 'idle')
    assert.equal(repeated.socket.sent.some(item => item.type === 'leaveRoom'), false)
    assert.deepEqual(repeatedRecoveryRequests, [{}])

    let rejectCancelledConnect
    const cancelledSocket = new FakeSocketClient(() => new Promise((_resolve, reject) => { rejectCancelledConnect = reject }))
    const cancelled = createHarness(false, new FakeStorage(), cancelledSocket)
    const cancelledRecoveryRequests = []
    cancelled.controller.events.on('guandan:platform-recovery-required', value => cancelledRecoveryRequests.push(value))
    cancelled.controller.enterMatchedRoom({
      entryAttemptId: 'cancelledConnectAttempt_Q7mN4vX9kLp', roomId: '808080',
      gameEndpoint: 'wss://slow.example/weapp', gameTicket: 'cancel-ticket', seat: 'p3', expiresAt: now + 1_000,
    })
    cancelled.controller.leaveRoom()
    rejectCancelledConnect(new Error('late connect failure'))
    await flushPromises()
    now += 1_001
    runScheduled(cancelled.controller, 1)
    assert.deepEqual(cancelledRecoveryRequests, [], 'a generation cancelled by the user must not revive platform recovery')
    assert.equal(cancelled.controller.snapshot.roomStatus, 'idle')
  } finally {
    Date.now = originalNow
  }
}

async function verifyPlatformRecoveryTicketLifecycle () {
  const recovered = createHarness(false)
  const confirmations = []
  recovered.controller.events.on('guandan:room-entry-confirmed', value => confirmations.push(value))
  const recoveryAttemptId = 'platformRecoveryAttempt_Q7mN4vX9k'
  recovered.controller.enterMatchedRoom({
    entryAttemptId: recoveryAttemptId, recoveryAttemptId, matchId: 'match-recovery-1', ticketPurpose: 'rejoin',
    roomId: '676767', gameEndpoint: 'wss://game.example/weapp', gameTicket: 'rejoin-ticket', seat: 'p1', expiresAt: Date.now() + 60_000,
  })
  recovered.socket.emit('connected')
  await flushPromises()
  const request = recovered.socket.sent.find(item => item.type === 'joinRoom')
  assert.ok(request, 'purpose=rejoin must use joinRoom even for p1')
  assert.equal(recovered.socket.sent.some(item => item.type === 'createRoom'), false)
  assert.equal(request.payload.entryAttemptId, recoveryAttemptId)
  recovered.socket.emit('roomRejoined', roomMessage('roomRejoined', request.requestId, '676767', 'p1', 'resume-recovered'))
  assert.deepEqual(confirmations, [{ entryAttemptId: recoveryAttemptId, recoveryAttemptId, ticketPurpose: 'rejoin' }])

  const pending = createHarness(false)
  const pendingConfirmations = []
  const pendingRecoveryRequests = []
  pending.controller.events.on('guandan:room-entry-confirmed', value => pendingConfirmations.push(value))
  pending.controller.events.on('guandan:platform-recovery-required', value => pendingRecoveryRequests.push(value))
  pending.controller.enterMatchedRoom({
    entryAttemptId: recoveryAttemptId, recoveryAttemptId, matchId: 'match-pending-start', ticketPurpose: 'rejoin',
    roomId: '676768', gameEndpoint: 'wss://game.example/weapp', gameTicket: 'pending-start-ticket', seat: 'p2', expiresAt: Date.now() + 60_000,
  })
  pending.socket.emit('connected')
  await flushPromises()
  const pendingRequest = pending.socket.sent.find(item => item.type === 'joinRoom')
  const pendingResponse = {
    ...roomMessage('roomRejoined', pendingRequest.requestId, '676768', 'p2', 'resume-pending-start'),
    state: null, tribute: null, roundResult: null, phase: 'lobby', gameStartPending: true,
    lobbyReadyRequired: true, lobbyReadyPlayerIds: ['p1', 'p2', 'p3', 'p4'],
  }
  pending.socket.emit('roomRejoined', pendingResponse)
  pending.socket.emit('roomRejoined', pendingResponse)
  assert.equal(pending.controller.snapshot.roomStatus, 'ready')
  assert.equal(pending.controller.snapshot.gameStartPending, true, 'a claimed start still awaiting platform confirmation is a successful recovery state')
  assert.deepEqual(pendingConfirmations, [{ entryAttemptId: recoveryAttemptId, recoveryAttemptId, ticketPurpose: 'rejoin' }])
  assert.deepEqual(pendingRecoveryRequests, [], 'an exact pending-start replay must neither rotate nor abandon the confirmed recovery attempt')
  assert.equal(pending.socket.sent.filter(item => item.type === 'joinRoom').length, 1)
  assert.equal(pending.socket.sent.some(item => item.type === 'leaveRoom'), false)

  const failed = createHarness(false)
  const requests = []
  failed.controller.events.on('guandan:platform-recovery-required', value => requests.push(value))
  failed.controller.enterMatchedRoom({
    entryAttemptId: recoveryAttemptId, recoveryAttemptId, matchId: 'match-recovery-1', ticketPurpose: 'rejoin',
    roomId: '676767', gameEndpoint: 'wss://game.example/weapp', gameTicket: 'spent-ticket', seat: 'p1', expiresAt: Date.now() + 60_000,
  })
  failed.socket.emit('connected')
  await flushPromises()
  const failedRequest = failed.socket.sent.find(item => item.type === 'joinRoom')
  failRequest(failed.socket, failedRequest.requestId, 'joinRoom', '恢复票据对应的进行中牌局不存在', 'RECOVERY_NOT_AVAILABLE')
  assert.deepEqual(requests, [{ abandonAttemptId: recoveryAttemptId }], 'a recovery ticket without state or pending start must rotate before platform synchronization')
  assert.equal(failed.controller.scheduled.some(item => item.delay === 0.5), false, 'RECOVERY_NOT_AVAILABLE must not spend the single-ticket retry budget')
}

async function verifyPlatformRecoveryCoordinator () {
  const events = new FakeEventTarget()
  const entered = []
  const confirmed = []
  const abandoned = []
  const restoredFriendRooms = []
  let recoveries = 0
  const recoveryAttemptId = 'coordinatorRecovery_Q7mN4vX9kLp'
  const lobby = {
    snapshot: { roomStatus: 'idle' }, events,
    enterMatchedRoom: entry => { entered.push(entry) },
  }
  const coordinator = new platformMatchRecovery.PlatformMatchRecoveryCoordinator({
    configured: true,
    gateway: {
      recover: async () => {
        recoveries += 1
        if (recoveries === 2) {
          const nextAttemptId = 'friendHostRecovery_Q7mN4vX9kLp'
          return {
            entryAttemptId: nextAttemptId, recoveryAttemptId: nextAttemptId, matchId: 'match-friend-recovery', roomId: '696969', seat: 'p1',
            roomKind: 'friend', ticketPurpose: 'entry', gameEndpoint: 'wss://game.example/weapp',
            gameTicket: 'friend-recovery-ticket', joinToken: 'friend-recovery-ticket', expiresAt: Date.now() + 60_000,
            roomExpiresAt: Date.now() + 600_000,
            roomSettings: { mode: 'classic', rounds: 8, scoring: 'double-3', scoreVisibility: 'live', turnSeconds: 40, trusteeSeconds: 15, totalTimeMinutes: 0, spectator: 'off', autoSort: true, disableInteraction: true, sortOrder: 'desc', authoritativeValidation: true },
            inviteCode: 'Q7mN4vX9kLp2sTw8aBcD', invitePayload: { version: 1, roomId: '696969', inviteCode: 'Q7mN4vX9kLp2sTw8aBcD' },
            inviteText: '696969.Q7mN4vX9kLp2sTw8aBcD',
          }
        }
        return {
          entryAttemptId: recoveryAttemptId, recoveryAttemptId, matchId: 'match-coordinator', roomId: '686868', seat: 'p4',
          roomKind: 'match', ticketPurpose: 'rejoin', gameEndpoint: 'wss://game.example/weapp',
          gameTicket: 'coordinator-ticket', joinToken: 'coordinator-ticket', expiresAt: Date.now() + 60_000,
        }
      },
      confirm: attemptId => { confirmed.push(attemptId) },
      abandon: attemptId => { abandoned.push(attemptId) },
    },
    lobby, enterLobby: () => undefined, restoreFriendRoom: entry => restoredFriendRooms.push(entry), showRecoveryAvailable: () => undefined,
    showNotice: () => undefined, isDisposed: () => false,
  })
  coordinator.start()
  await flushPromises()
  assert.equal(recoveries, 1)
  assert.equal(entered[0].entryAttemptId, recoveryAttemptId)
  assert.equal(entered[0].ticketPurpose, 'rejoin')
  events.emit('guandan:room-entry-confirmed', { recoveryAttemptId })
  assert.deepEqual(confirmed, [recoveryAttemptId])
  events.emit('guandan:platform-recovery-required', { abandonAttemptId: recoveryAttemptId })
  await flushPromises()
  assert.deepEqual(abandoned, [recoveryAttemptId])
  assert.equal(recoveries, 2)
  assert.equal(restoredFriendRooms[0].inviteText, '696969.Q7mN4vX9kLp2sTw8aBcD', 'waiting host recovery must hydrate the share credential before entering WebSocket')
  assert.equal(entered[1].entryAttemptId, 'friendHostRecovery_Q7mN4vX9kLp', 'failed short tickets must rotate to the fresh recovery attempt')
  coordinator.dispose()
}

async function verifyPlatformRecoveryFailureRetry () {
  const events = new FakeEventTarget()
  const entered = []
  const recoveryNotices = []
  const pendingStates = []
  let visibleNotice = null
  let recoveries = 0
  const retryAttemptId = 'recoveryRetryAttempt_Q7mN4vX9kLp'
  const lobby = { snapshot: { roomStatus: 'idle' }, events, enterMatchedRoom: entry => entered.push(entry) }
  const coordinator = new platformMatchRecovery.PlatformMatchRecoveryCoordinator({
    configured: true,
    gateway: {
      recover: async () => {
        recoveries += 1
        if (recoveries === 1) throw new Error('temporary platform timeout')
        return {
          entryAttemptId: retryAttemptId, recoveryAttemptId: retryAttemptId, matchId: 'match-retry', roomId: '707070', seat: 'p2',
          roomKind: 'match', ticketPurpose: 'rejoin', gameEndpoint: 'wss://game.example/weapp',
          gameTicket: 'retry-ticket', joinToken: 'retry-ticket', expiresAt: Date.now() + 60_000,
        }
      },
      confirm: () => undefined,
      abandon: () => undefined,
    },
    lobby, enterLobby: () => undefined, showNotice: (title, detail) => { visibleNotice = { title, detail } },
    onPendingChanged: pending => pendingStates.push(pending),
    showRecoveryAvailable: message => { visibleNotice = null; recoveryNotices.push(message) }, isDisposed: () => false,
  })
  coordinator.start()
  assert.deepEqual(pendingStates, [true], 'recovery must immediately signal pending to the main entrance')
  await flushPromises()
  assert.deepEqual(recoveryNotices, ['temporary platform timeout'], 'transient HTTP failure must restore the explicit retry affordance')
  assert.deepEqual(visibleNotice, { title: '牌局恢复失败', detail: 'temporary platform timeout' }, 'rebuilding the hall must happen before the error modal, or the user only sees account syncing flash')
  assert.deepEqual(pendingStates, [true, false], 'failure must release the recovery button without a fake timer')
  events.emit('guandan:platform-recovery-required', {})
  await flushPromises()
  assert.equal(recoveries, 2)
  assert.equal(entered[0].entryAttemptId, retryAttemptId)
  assert.deepEqual(pendingStates, [true, false, true, false], 'successful retry must also release pending state')
  coordinator.dispose()
}

async function verifyEmptyPlatformRecovery () {
  const events = new FakeEventTarget()
  const notices = []
  const pending = []
  const coordinator = new platformMatchRecovery.PlatformMatchRecoveryCoordinator({
    configured: true, gateway: { recover: async () => null },
    lobby: { snapshot: { roomStatus: 'idle' }, events, enterMatchedRoom: () => assert.fail('null recovery must not enter a room') },
    enterLobby: () => assert.fail('null recovery must not create a replacement match'),
    showRecoveryAvailable: () => assert.fail('null recovery must not advertise a stale retry'),
    showNotice: (title, detail) => notices.push({ title, detail }),
    onPendingChanged: value => pending.push(value), isDisposed: () => false,
  })
  coordinator.start()
  await flushPromises()
  assert.equal(notices.length, 0, 'normal cold startup without a match stays quiet')
  events.emit('guandan:platform-recovery-required', { manual: true })
  await flushPromises()
  assert.equal(notices[0]?.title, '没有可恢复的牌局', 'an explicit continue action must explain that the room is gone')
  assert.deepEqual(pending, [true, false, true, false])
  coordinator.dispose()
}

async function verifyPlatformRecoveryCycleBudget () {
  const events = new FakeEventTarget()
  const entered = []
  const abandoned = []
  const manualRecoveryNotices = []
  let visibleNotice = null
  let recoveries = 0
  const lobby = { snapshot: { roomStatus: 'idle' }, events, enterMatchedRoom: entry => entered.push(entry) }
  const coordinator = new platformMatchRecovery.PlatformMatchRecoveryCoordinator({
    configured: true,
    gateway: {
      recover: async () => {
        recoveries += 1
        const attemptId = `budgetRecoveryAttempt0${recoveries}_Q7mN4vX9kLp`
        return {
          entryAttemptId: attemptId, recoveryAttemptId: attemptId, matchId: 'match-budget', roomId: '717171', seat: 'p2',
          roomKind: 'match', ticketPurpose: 'rejoin', gameEndpoint: 'wss://game.example/weapp',
          gameTicket: `budget-ticket-${recoveries}`, joinToken: `budget-ticket-${recoveries}`, expiresAt: Date.now() + 60_000,
        }
      },
      confirm: () => undefined,
      abandon: attemptId => abandoned.push(attemptId),
    },
    lobby, enterLobby: () => undefined, showNotice: (title, detail) => { visibleNotice = { title, detail } },
    showRecoveryAvailable: message => { visibleNotice = null; manualRecoveryNotices.push(message) }, isDisposed: () => false,
  })
  coordinator.start()
  await flushPromises()
  for (let rejectedTicket = 0; rejectedTicket < 3; rejectedTicket += 1) {
    events.emit('guandan:platform-recovery-required', { abandonAttemptId: entered.at(-1).recoveryAttemptId })
    await flushPromises()
  }
  assert.equal(recoveries, 3, 'one automatic recovery cycle must cap HTTP tickets across repeated WebSocket rejects')
  assert.equal(abandoned.length, 3, 'even the ticket that exhausts the budget must be retired')
  assert.match(manualRecoveryNotices.at(-1), /手动重试/, 'budget exhaustion must restore an explicit manual recovery path')
  assert.equal(visibleNotice?.title, '牌局恢复已暂停', 'the recovery budget notice must survive rebuilding the hall')

  events.emit('guandan:platform-recovery-required', { manual: true })
  await flushPromises()
  assert.equal(recoveries, 4, 'an explicit user action may begin one new bounded recovery cycle')
  coordinator.dispose()
}

async function verifyEntryAttemptGeneratorAndWireProtocol () {
  await require('./support/lobby-entry-ticket-contract.cjs')({ loadPureTs, projectRoot })
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index)
  const entryAttemptId = lobbyEntryAttempt.createEntryAttemptId({
    getRandomValues: target => { target.set(bytes); return target },
  })
  assert.equal(entryAttemptId, 'AAECAwQFBgcICQoLDA0ODw', '16 random bytes must encode as an unpadded 22-character base64url id')
  assert.equal(lobbyEntryAttempt.isEntryAttemptId(entryAttemptId), true)

  const originalWebSocket = globalThis.WebSocket
  class RecordingWebSocket {
    static OPEN = 1
    constructor () { this.readyState = RecordingWebSocket.OPEN; this.sent = []; queueMicrotask(() => this.onopen?.()) }
    send (raw) { this.sent.push(raw) }
    close () { this.readyState = 3 }
  }
  globalThis.WebSocket = RecordingWebSocket
  try {
    const { CocosSocketClient } = loadPureTs(cocosSocketClientPath, {
      '../services/WechatNetworkPolicy': loadPureTs(path.join(projectRoot, 'assets/scripts/services/WechatNetworkPolicy.ts'), { './NetworkEndpoint': networkEndpoint }),
    })
    const client = new CocosSocketClient()
    await client.connect('wss://game.example/weapp')
    const socket = client.socket
    const requestResults = []
    client.on('requestResult', result => requestResults.push(result))
    const requestId = client.send('joinRoom', { roomId: '123456', entryAttemptId })
    const wire = JSON.parse(socket.sent.at(-1))
    assert.deepEqual(wire.payload, { roomId: '123456', entryAttemptId }, 'CocosSocketClient must preserve the idempotency key in the request payload')
    const replayId = client.send('joinRoom', wire.payload, requestId)
    assert.equal(replayId, requestId)
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), wire, 'transport must retransmit the exact original request envelope')
    assert.throws(() => client.send('joinRoom', wire.payload, requestId + 100), /重试请求编号无效/)
    assert.equal(client.send('listRooms'), requestId + 1, 'retry must not consume the next request sequence')
    socket.onmessage({ data: JSON.stringify({
      type: 'error', requestId, code: 'RECOVERY_NOT_AVAILABLE', message: '恢复票据对应的进行中牌局不存在',
    }) })
    assert.deepEqual(requestResults, [{
      requestId, requestType: 'joinRoom', responseType: 'error', ok: false,
      code: 'RECOVERY_NOT_AVAILABLE', message: '恢复票据对应的进行中牌局不存在',
    }], 'the transport must preserve authoritative recovery error codes for retry policy')
    client.close()
  } finally {
    globalThis.WebSocket = originalWebSocket
  }
}

async function verifyColdRestartResumeSession () {
  const storage = new FakeStorage()
  const first = createHarness(false, storage)
  first.controller.enterMatchedRoom({
    entryAttemptId: 'coldRestartAttempt_Q7mN4vX9kLp2', matchId: 'match-cold-1',
    roomId: '313131', gameEndpoint: 'wss://game.example/weapp', gameTicket: 'cold-ticket', seat: 'p3', expiresAt: Date.now() + 60_000,
  })
  first.socket.emit('connected')
  await flushPromises()
  const firstJoin = first.socket.sent.find(item => item.type === 'joinRoom')
  first.socket.emit('roomJoined', roomMessage('roomJoined', firstJoin.requestId, '313131', 'p3', 'resume-cold-one'))
  const persisted = JSON.parse(storage.getItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY))
  assert.deepEqual(persisted, {
    version: 1, endpoint: 'wss://game.example/weapp', roomId: '313131', seat: 'p3', resumeToken: 'resume-cold-one', matchId: 'match-cold-1',
  })
  assert.equal('gameTicket' in persisted, false, 'cold-resume storage must not retain a signed one-shot ticket')
  first.controller.onDestroy()
  assert.ok(storage.getItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY), 'destroying the process-bound controller must preserve the resume identity')

  const restarted = createHarness(false, storage)
  assert.equal(restarted.controller.snapshot.roomStatus, 'rejoining')
  assert.equal(restarted.controller.snapshot.roomId, '313131')
  assert.deepEqual(restarted.socket.connectCalls, ['wss://game.example/weapp'])
  restarted.socket.emit('connected')
  const rejoin = restarted.socket.sent.findLast(item => item.type === 'rejoinRoom')
  assert.deepEqual(rejoin.payload, { roomId: '313131', myPlayerId: 'p3', resumeToken: 'resume-cold-one' })
  restarted.socket.emit('roomRejoined', roomMessage('roomRejoined', rejoin.requestId, '313131', 'p3', 'resume-cold-two'))
  assert.equal(JSON.parse(storage.getItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY)).resumeToken, 'resume-cold-two', 'rotated resume tokens must atomically replace the prior token')

  restarted.socket.emit('disconnected')
  restarted.socket.emit('connected')
  const staleRejoin = restarted.socket.sent.findLast(item => item.type === 'rejoinRoom')
  failRequest(restarted.socket, staleRejoin.requestId, 'rejoinRoom', '恢复凭证无效')
  assert.equal(storage.getItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY), null, 'a rejected stale token must clear persisted recovery identity')

  storage.setItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY, '{broken json')
  const corrupted = createHarness(false, storage)
  assert.equal(corrupted.controller.snapshot.roomId, null)
  assert.deepEqual(corrupted.socket.connectCalls, [])
  assert.equal(storage.getItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY), null, 'corrupt recovery state must self-clear')

  const clearing = createHarness()
  clearing.controller.connect('wss://lobby.example/weapp')
  const joinId = clearing.controller.joinRoom('414141')
  clearing.socket.emit('roomJoined', roomMessage('roomJoined', joinId, '414141', 'p2', 'resume-clear'))
  assert.ok(clearing.storage.getItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY))
  clearing.controller.leaveRoom()
  assert.equal(clearing.storage.getItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY), null, 'voluntary leave must clear persisted recovery state')

  const unreachableStorage = new FakeStorage()
  unreachableStorage.setItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY, JSON.stringify({
    version: 1, endpoint: 'wss://unreachable.example/weapp', roomId: '424242',
    seat: 'p4', resumeToken: 'resume-unreachable', matchId: 'match-unreachable',
  }))
  const unreachableSocket = new FakeSocketClient(() => Promise.reject(new Error('resume endpoint unreachable')))
  const unreachable = createHarness(false, unreachableStorage, unreachableSocket)
  const recoveryRequests = []
  unreachable.controller.events.on('guandan:platform-recovery-required', value => recoveryRequests.push(value))
  await flushPromises()
  assert.equal(unreachable.controller.snapshot.roomStatus, 'rejoining')
  runScheduled(unreachable.controller, 30)
  assert.equal(unreachableSocket.closeCalls, 1, 'cold resume watchdog must stop an unreachable transport')
  assert.equal(unreachableStorage.getItem(lobbyResumeSession.LOBBY_RESUME_STORAGE_KEY), null, 'failed cold resume must clear the stale local token')
  assert.equal(unreachable.controller.snapshot.roomId, null)
  assert.equal(unreachable.controller.snapshot.roomStatus, 'idle')
  assert.match(unreachable.controller.snapshot.error, /恢复.*超时/)
  assert.equal(unreachableSocket.sent.some(item => item.type === 'leaveRoom'), false)
  assert.deepEqual(recoveryRequests, [{}], 'cold resume exhaustion must fall back to authenticated platform recovery')
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
    type: 'roomJoined', requestId: joinId, roomId: '565656', myPlayerId: 'p2', resumeToken: 'resume-effects', version: 10, gameVersion: 20, state: state(2), phase: 'playing',
  })
  assert.equal(states.length, 1)
  assert.deepEqual(states[0].effectSync, { mode: 'recovery', reason: 'initial-snapshot' }, 'the first authoritative snapshot must establish a silent baseline')

  socket.emit('gameState', { roomId: '565656', version: 11, gameVersion: 21, state: state(3) })
  assert.deepEqual(states.at(-1).effectSync, { mode: 'incremental' }, 'one contiguous action must remain eligible for playback')
  socket.emit('gameState', { roomId: '565656', version: 11, gameVersion: 21, state: state(3) })
  assert.equal(states.length, 2, 'a duplicate version must not reach presentation twice')

  socket.emit('roomMembers', { roomId: '565656', version: 12, gameVersion: 21, memberPlayerIds: ['p1', 'p2', 'p3', 'p4'] })
  socket.emit('gameState', { roomId: '565656', version: 13, gameVersion: 22, state: state(4) })
  assert.deepEqual(states.at(-1).effectSync, { mode: 'incremental' }, 'metadata-only versions must not create a false effect gap')
  socket.emit('gameState', { roomId: '565656', version: 15, gameVersion: 24, state: state(5) })
  assert.deepEqual(states.at(-1).effectSync, { mode: 'recovery', reason: 'version-gap' }, 'a true gameVersion gap must land silently at the final state')

  socket.emit('disconnected')
  socket.emit('connected')
  const rejoin = socket.sent.findLast(item => item.type === 'rejoinRoom')
  socket.emit('roomRejoined', {
    type: 'roomRejoined', requestId: rejoin.requestId, roomId: '565656', myPlayerId: 'p2', resumeToken: 'resume-effects-rotated', version: 15, gameVersion: 24, state: state(5), phase: 'playing',
  })
  assert.equal(controller.resumeToken, 'resume-effects-rotated', 'only the request-bound successful rejoin may replace the local resume token')
  assert.deepEqual(states.at(-1).effectSync, { mode: 'recovery', reason: 'reconnect' }, 'a true rejoin must never replay history even at the same version')

  socket.emit('roundPrepared', { roomId: '565656', version: 16, gameVersion: 25, state: state(0), tribute: null })
  assert.deepEqual(rounds.at(-1).effectSync, { mode: 'recovery', reason: 'round-reset' }, 'a new round must reset the action counter')
  socket.emit('gameState', { roomId: '565656', version: 18, gameVersion: 26, state: state(1) })
  assert.deepEqual(states.at(-1).effectSync, { mode: 'incremental' }, 'the first action after a round reset must play normally')
}

function verifyInjectedTransportLifecycle () {
  const { controller, socket } = createHarness()
  const registeredListeners = socket.listenerCount()
  assert.ok(registeredListeners > 0, 'onLoad must bind the injected transport')
  let networkErrors = 0
  controller.events.on('guandan:network-error', () => { networkErrors += 1 })
  const snapshotBeforeDestroy = controller.snapshot

  controller.onDestroy()
  assert.equal(socket.unsubscribeCalls, registeredListeners, 'destroy must invoke every injected listener disposer')
  assert.equal(socket.listenerCount(), 0, 'the long-lived injected client must not retain controller listeners')
  assert.equal(socket.closeCalls, 1, 'destroy must close the injected transport after unbinding listeners')
  assert.equal(socket.lifecycle.at(-1), 'close', 'transport close must happen after all listener disposers')
  assert.equal(socket.lifecycle.slice(0, -1).every(item => item.startsWith('unsubscribe:')), true)

  socket.emit('disconnected')
  assert.equal(networkErrors, 0, 'transport events after destroy must not reach the controller')
  assert.equal(controller.snapshot, snapshotBeforeDestroy, 'transport events after destroy must not mutate lobby state')

  controller.onDestroy()
  assert.equal(socket.unsubscribeCalls, registeredListeners, 'repeated destroy must not invoke a disposer twice')
}

async function main () {
  assert.equal(fs.existsSync(`${lobbyEntryAttemptPath}.meta`), true, 'entry attempt helper must be imported by Cocos')
  assert.equal(fs.existsSync(`${lobbyMatchedEntryCoordinatorPath}.meta`), true, 'matched entry coordinator must be imported by Cocos')
  assert.equal(fs.existsSync(`${lobbyResumeConnectionWatchdogPath}.meta`), true, 'local resume watchdog must be imported by Cocos')
  assert.equal(fs.existsSync(`${lobbyResumeSessionPath}.meta`), true, 'cold-resume store must be imported by Cocos')
  assert.equal(fs.existsSync(`${platformMatchRecoveryPath}.meta`), true, 'platform recovery coordinator must be imported by Cocos')
  assert.equal(fs.existsSync(lobbySocketClientPath), true, 'lobby transport contract must exist')
  assert.equal(fs.existsSync(`${lobbySocketClientPath}.meta`), true, 'lobby transport contract must be imported by Cocos')
  const injection = new LobbyController()
  injection.setSocketClient(new FakeSocketClient())
  injection.onLoad()
  assert.throws(() => injection.setSocketClient(new FakeSocketClient()), /onLoad 前注入/, 'transport replacement must be frozen after event binding')
  assert.match(source, /private client: LobbySocketClient = new CocosSocketClient\(\)/, 'production must retain the Cocos WebSocket adapter by default')
  assert.match(source, /entryGeneration/, 'entry responses must be guarded by a generation')
  assert.match(source, /message\.requestId === pending\.requestId/, 'entry success must match its request id')
  assert.match(source, /message\.roomId === pending\.roomId/, 'entry success must match its expected room')
  assert.match(matchedEntryCoordinatorSource, /dependencies\.schedule\(\(\) =>/, 'matched-entry callbacks must remain arrow-bound')
  await verifyManualEntryGeneration()
  await verifyExpectedRoomAndRejoin()
  await verifyAuthoritativeRoomMembers()
  await verifyResumePersistenceFailureIsObservable()
  await verifyInitialReadyAndHostKick()
  await verifyGameStartPendingLifecycle()
  await verifyMatchEndedLifecycle()
  await verifyMatchedExpiryAndRetryPolicy()
  await verifyMatchedWatchdogAndReconnect()
  await verifyMatchedConnectionBudget()
  await verifyPlatformRecoveryTicketLifecycle()
  await verifyPlatformRecoveryCoordinator()
  await verifyPlatformRecoveryFailureRetry()
  await verifyEmptyPlatformRecovery()
  await verifyPlatformRecoveryCycleBudget()
  await verifyNetworkEffectSyncSemantics()
  await verifyEntryAttemptGeneratorAndWireProtocol()
  await verifyColdRestartResumeSession()
  verifyInjectedTransportLifecycle()
  process.stdout.write('lobby entry regression checks passed\n')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
