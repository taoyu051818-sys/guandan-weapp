const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'assets/scripts/network/LobbyController.ts')
const lobbyEntryAttemptPath = path.join(root, 'assets/scripts/network/LobbyEntryAttempt.ts')
const lobbyCleanupTrackerPath = path.join(root, 'assets/scripts/network/LobbyCleanupTracker.ts')
const lobbyCommandSenderPath = path.join(root, 'assets/scripts/network/LobbyCommandSender.ts')
const lobbyConnectionEventCoordinatorPath = path.join(root, 'assets/scripts/network/LobbyConnectionEventCoordinator.ts')
const lobbyMessageRouterPath = path.join(root, 'assets/scripts/network/LobbyMessageRouter.ts')
const lobbyMatchedEntryCoordinatorPath = path.join(root, 'assets/scripts/network/LobbyMatchedEntryCoordinator.ts')
const lobbyModelsPath = path.join(root, 'assets/scripts/network/LobbyModels.ts')
const lobbyResumeConnectionWatchdogPath = path.join(root, 'assets/scripts/network/LobbyResumeConnectionWatchdog.ts')
const lobbySyncTrackerPath = path.join(root, 'assets/scripts/network/LobbySyncTracker.ts')
const lobbyResumeSessionPath = path.join(root, 'assets/scripts/network/LobbyResumeSession.ts')
const scenePath = path.join(root, 'assets/scripts/scenes/GameScene.ts')
const tableMatchCoordinatorPath = path.join(root, 'assets/scripts/scenes/TableMatchCoordinator.ts')
const tableOverlayPath = path.join(root, 'assets/scripts/scenes/TableOverlayController.ts')
const turnClockPath = path.join(root, 'assets/scripts/scenes/TableTurnClockController.ts')
const { loadTypeScript, typescriptPath } = require('./support/typescript.cjs')
const ts = loadTypeScript()

class FakeEventTarget {
  constructor () { this.listeners = new Map() }
  on (type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]) }
  emit (type, ...args) { for (const listener of this.listeners.get(type) || []) listener(...args) }
}
class FakeComponent {
  getComponent () { return null }
  scheduleOnce () {}
}
class FakeSession {
  setRoomView () {}
  joinRoom () {}
  enterLobby () {}
  leaveToMenu () {}
}
class FakeSocket {
  constructor () { this.listeners = new Map(); this.sent = []; this.sequence = 0 }
  on (type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); return () => {} }
  emit (type, payload) { for (const listener of this.listeners.get(type) || []) listener(payload) }
  send (type, payload, retryRequestId) { const requestId = retryRequestId ?? ++this.sequence; this.sent.push({ type, payload, requestId }); return requestId }
  connect () { return Promise.resolve() }
  close () {}
}
class FakeStorage {
  constructor () { this.values = new Map() }
  getItem (key) { return this.values.get(key) ?? null }
  setItem (key, value) { this.values.set(key, value) }
  removeItem (key) { this.values.delete(key) }
}

const loadPureTs = (filePath, dependencies = {}) => {
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loaded = { exports: {} }
  new Function('exports', 'module', 'require', output)(loaded.exports, loaded, request => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`unexpected ${request}`)
  })
  return loaded.exports
}

const policyPath = path.join(root, 'assets/scripts/effects/NetworkEffectSyncPolicy.ts')
const policyOutput = ts.transpileModule(fs.readFileSync(policyPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const policyModule = { exports: {} }
new Function('exports', 'module', 'require', policyOutput)(policyModule.exports, policyModule, request => { throw new Error(`unexpected ${request}`) })

const lobbyEntryAttemptOutput = ts.transpileModule(fs.readFileSync(lobbyEntryAttemptPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const lobbyEntryAttemptModule = { exports: {} }
new Function('exports', 'module', 'require', lobbyEntryAttemptOutput)(lobbyEntryAttemptModule.exports, lobbyEntryAttemptModule, request => { throw new Error(`unexpected ${request}`) })
const lobbyCleanupTracker = loadPureTs(lobbyCleanupTrackerPath)
const lobbyMatchedEntryCoordinator = loadPureTs(lobbyMatchedEntryCoordinatorPath)
const lobbyResumeConnectionWatchdog = loadPureTs(lobbyResumeConnectionWatchdogPath)
const lobbyResumeSession = loadPureTs(lobbyResumeSessionPath, {
  '../services/NetworkEndpoint': loadPureTs(path.join(root, 'assets/scripts/services/NetworkEndpoint.ts')),
})

const lobbyModelsOutput = ts.transpileModule(fs.readFileSync(lobbyModelsPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const lobbyModelsModule = { exports: {} }
new Function('exports', 'module', 'require', lobbyModelsOutput)(lobbyModelsModule.exports, lobbyModelsModule, request => { throw new Error(`unexpected ${request}`) })

const lobbySyncTrackerOutput = ts.transpileModule(fs.readFileSync(lobbySyncTrackerPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const lobbySyncTrackerModule = { exports: {} }
new Function('exports', 'module', 'require', lobbySyncTrackerOutput)(lobbySyncTrackerModule.exports, lobbySyncTrackerModule, request => {
  if (request === '../effects/NetworkEffectSyncPolicy') return policyModule.exports
  throw new Error(`unexpected ${request}`)
})
const lobbyCommandSender = loadPureTs(lobbyCommandSenderPath, {
  '../core/generated/protocol': { commandRequiresExpectedVersion: type => ['startGame', 'play', 'pass', 'tribute', 'returnTribute', 'finishTribute'].includes(type) },
})
const lobbyConnectionEventCoordinator = loadPureTs(lobbyConnectionEventCoordinatorPath)
const lobbyMessageRouter = loadPureTs(lobbyMessageRouterPath, {
  './LobbyModels': lobbyModelsModule.exports,
  './LobbySyncTracker': lobbySyncTrackerModule.exports,
  './FriendRoomViewReceiver': loadPureTs(path.join(root, 'assets/scripts/network/FriendRoomViewReceiver.ts')),
})

const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
  fileName: sourcePath,
}).outputText
const runtime = new Module(sourcePath, module)
runtime.filename = sourcePath
runtime.paths = Module._nodeModulePaths(path.dirname(sourcePath))
runtime.require = request => {
  if (request === 'cc') return { _decorator: { ccclass: () => value => value, property: () => () => undefined }, Component: FakeComponent, EventTarget: FakeEventTarget, sys: { localStorage: new FakeStorage() } }
  if (request === '../session/GameSession') return { GameSession: FakeSession }
  if (request === '../core/generated/protocol') return { commandRequiresExpectedVersion: type => ['startGame', 'play', 'pass', 'tribute', 'returnTribute', 'finishTribute'].includes(type) }
  if (request === './CocosSocketClient') return { CocosSocketClient: FakeSocket }
  if (request === '../effects/NetworkEffectSyncPolicy') return policyModule.exports
  if (request === './LobbyEntryAttempt') return lobbyEntryAttemptModule.exports
  if (request === './LobbyEntryRequest') return loadPureTs(path.join(root, 'assets/scripts/network/LobbyEntryRequest.ts'))
  if (request === './LobbyCleanupTracker') return lobbyCleanupTracker
  if (request === './LobbyCommandSender') return lobbyCommandSender
  if (request === './LobbyConnectionEventCoordinator') return lobbyConnectionEventCoordinator
  if (request === './LobbyMessageRouter') return lobbyMessageRouter
  if (request === './LobbyMatchedEntryCoordinator') return lobbyMatchedEntryCoordinator
  if (request === './LobbyResumeConnectionWatchdog') return lobbyResumeConnectionWatchdog
  if (request === './LobbyModels') return lobbyModelsModule.exports
  if (request === './LobbySyncTracker') return lobbySyncTrackerModule.exports
  if (request === './LobbyResumeSession') return lobbyResumeSession
  return require(request)
}
runtime._compile(output, sourcePath)

const controller = new runtime.exports.LobbyController()
controller.session = new FakeSession()
const socket = new FakeSocket()
controller.setSocketClient(socket)
controller.onLoad()
controller.snapshot = { ...controller.snapshot, connected: true }
const joinRequest = controller.joinRoom('123456')
socket.emit('roomJoined', {
  type: 'roomJoined', requestId: joinRequest, roomId: '123456', myPlayerId: 'p2', resumeToken: 'resume', version: 1, gameVersion: 0,
  turnDeadlineAt: 5000, deadlinePlayerId: 'p2', deadlineAction: 'play',
  trustees: { p1: null, p2: null, p3: null, p4: null },
  consecutiveTimeouts: { p1: 0, p2: 0, p3: 0, p4: 0 },
  roundReadyPlayerIds: [], dissolveVote: null,
})
assert.equal(controller.snapshot.turnDeadlineAt, 5000)
assert.equal(controller.snapshot.deadlinePlayerId, 'p2')
assert.equal(controller.snapshot.deadlineAction, 'play')

const deadlineEvents = []
const trusteeEvents = []
const readyEvents = []
const dissolveEvents = []
const roundEndedEvents = []
controller.events.on('guandan:turn-deadline', value => deadlineEvents.push(value))
controller.events.on('guandan:trustee', value => trusteeEvents.push(value))
controller.events.on('guandan:round-ready', value => readyEvents.push(value))
controller.events.on('guandan:dissolve-vote', value => dissolveEvents.push(value))
controller.events.on('guandan:round-ended', value => roundEndedEvents.push(value))

socket.emit('turnDeadline', {
  roomId: '123456', version: 2, currentTurn: null, turnDeadlineAt: 9000, deadlinePlayerId: 'p3', deadlineAction: 'returnTribute',
})
socket.emit('trusteeUpdated', {
  roomId: '123456', version: 2,
  trustees: { p1: null, p2: { reason: 'timeout', since: 100 }, p3: null, p4: null },
  consecutiveTimeouts: { p1: 0, p2: 2, p3: 0, p4: 0 },
})
socket.emit('roundReadyUpdated', { roomId: '123456', version: 3, roundReadyPlayerIds: ['p1', 'p2'] })
const vote = { initiator: 'p1', votes: { p1: 'agree', p2: 'pending', p3: 'offline', p4: 'pending' }, expiresAt: 12000 }
socket.emit('dissolveVoteUpdated', { roomId: '123456', version: 4, dissolveVote: vote })

assert.equal(controller.snapshot.turnDeadlineAt, 9000)
assert.equal(controller.snapshot.deadlinePlayerId, 'p3')
assert.equal(controller.snapshot.deadlineAction, 'returnTribute')
assert.equal(controller.snapshot.trustees.p2.reason, 'timeout')
assert.equal(controller.snapshot.consecutiveTimeouts.p2, 2)
assert.deepEqual(controller.snapshot.roundReadyPlayerIds, ['p1', 'p2'])
assert.deepEqual(controller.snapshot.dissolveVote, vote)
assert.equal(deadlineEvents.length, 1)
assert.deepEqual(deadlineEvents[0], { currentTurn: null, turnDeadlineAt: 9000, deadlinePlayerId: 'p3', deadlineAction: 'returnTribute' })
assert.equal(trusteeEvents.length, 1)
assert.equal(readyEvents.length, 1)
assert.equal(dissolveEvents.length, 1)

const settledWireState = { phase: 'settled', roundId: 2, revision: 9 }
const settledWireResult = { winnerTeam: 'teamA', fullRank: ['p1', 'p3', 'p2', 'p4'] }
socket.emit('roundEnded', {
  roomId: '123456', version: 5, gameVersion: 9, state: settledWireState, result: settledWireResult,
  viewerRoundStats: { bombsPlayed: 6 },
})
assert.equal(roundEndedEvents.length, 1)
assert.deepEqual(
  { roomId: roundEndedEvents[0].roomId, version: roundEndedEvents[0].version, gameVersion: roundEndedEvents[0].gameVersion },
  { roomId: '123456', version: 5, gameVersion: 9 },
  'round-ended packets must carry a stable server event identity through the lobby event boundary',
)
assert.equal(roundEndedEvents[0].state, settledWireState, 'the viewer-projected settled state must reach the match snapshot owner')
assert.deepEqual(roundEndedEvents[0].viewerRoundStats, { bombsPlayed: 6 })

controller.readyNextRound()
controller.cancelRoundReady()
controller.setTrustee()
controller.cancelTrustee()
controller.proposeDissolve()
controller.voteDissolve(false)
assert.deepEqual(socket.sent.slice(-6).map(item => item.type), [
  'readyNextRound', 'cancelRoundReady', 'setTrustee', 'cancelTrustee', 'proposeDissolve', 'dissolveVote',
])
assert.deepEqual(socket.sent.slice(-6).map(item => item.payload.expectedVersion), [undefined, undefined, undefined, undefined, undefined, undefined])
assert.equal(socket.sent.at(-1).payload.agree, false)

socket.emit('roomDissolved', { roomId: '123456', version: 6, reason: 'vote-approved' })
assert.equal(controller.snapshot.roomId, null)
assert.equal(controller.snapshot.turnDeadlineAt, null)
assert.equal(controller.snapshot.deadlinePlayerId, null)
assert.equal(controller.snapshot.deadlineAction, null)
assert.deepEqual(controller.snapshot.roundReadyPlayerIds, [])

const sceneSource = fs.readFileSync(scenePath, 'utf8')
const tableMatchCoordinatorSource = fs.readFileSync(tableMatchCoordinatorPath, 'utf8')
const lobbyModelsSource = fs.readFileSync(lobbyModelsPath, 'utf8')
const tableOverlaySource = fs.readFileSync(tableOverlayPath, 'utf8')
const turnClockSource = fs.readFileSync(turnClockPath, 'utf8')
assert.match(turnClockSource, /deadline - this\.now\(\)/, 'the table countdown must derive from the server deadline')
assert.match(lobbyModelsSource, /NetworkViewerRoundStats = Readonly<\{ bombsPlayed: number \}>/)
assert.match(lobbyModelsSource, /NetworkRoundEndedPacket = \{[\s\S]*state\?: EngineState[\s\S]*viewerRoundStats\?: NetworkViewerRoundStats/, 'round-ended packets must support new authoritative state/stats and old result-only servers')
assert.match(tableMatchCoordinatorSource, /applyNetworkRoundEnded\(packet\.result, packet\.state \?\? null, packet\.viewerRoundStats, \{[\s\S]*roomId: packet\.roomId,[\s\S]*version: packet\.version,[\s\S]*gameVersion: packet\.gameVersion/, 'the table bridge must preserve the stable round event identity')
assert.match(tableMatchCoordinatorSource, /deadlinePlayerId !== humanId/, 'only the authoritative tribute actor may use tribute controls')
assert.match(tableMatchCoordinatorSource, /deadlineAction === 'finishTribute'/, 'only the authoritative tribute leader may start play')
assert.match(turnClockSource, /playerName} · \$\{ACTION_LABELS\[deadlineAction\]}/, 'tribute countdown must identify the authoritative player and action')
const multiplayerTick = turnClockSource.slice(turnClockSource.indexOf('private readonly tick'), turnClockSource.indexOf('private playWarningTick'))
assert.doesNotMatch(tableMatchCoordinatorSource, /humanId !== 'p1' && !gameWon/, 'all four seats must have a between-round ready control')
assert.match(tableMatchCoordinatorSource, /roundReadyPlayerIds\?\.includes\(humanId\)/, 'the ready control must reflect this seat\'s authoritative vote')
assert.match(tableMatchCoordinatorSource, /lobby\.cancelRoundReady\(\)/, 'a ready player must be able to cancel')
assert.match(tableMatchCoordinatorSource, /lobby\.safeExit\(\)/, 'active multiplayer exit must use the safe-exit protocol')
assert.match(tableOverlaySource, /this\.dependencies\.lobby\.proposeDissolve\(\)/, 'the table overlay must expose dissolve proposals')
assert.match(tableOverlaySource, /this\.voteDissolve\(false\)/, 'the table overlay must expose a refuse vote')
assert.match(tableOverlaySource, /this\.voteDissolve\(true\)/, 'the table overlay must expose an agree vote')

process.stdout.write('network round-state regression checks passed\n')

assert.doesNotMatch(multiplayerTick, /actOnLocalTimeout|remainingSeconds -=/, 'clock must never simulate moves or elapsed local turns')
assert.match(multiplayerTick, /deadline - this\.now\(\)/, 'deadline remains server-authoritative')
