const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'assets/scripts/network/LobbyController.ts')
const scenePath = path.join(root, 'assets/scripts/scenes/GameScene.ts')
const typescriptPath = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript'
const ts = require(typescriptPath)

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
  joinRoom () {}
  enterLobby () {}
  leaveToMenu () {}
}
class FakeSocket {
  constructor () { this.listeners = new Map(); this.sent = []; this.sequence = 0 }
  on (type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); return () => {} }
  emit (type, payload) { for (const listener of this.listeners.get(type) || []) listener(payload) }
  send (type, payload) { const requestId = ++this.sequence; this.sent.push({ type, payload, requestId }); return requestId }
  connect () { return Promise.resolve() }
  close () {}
}

const policyPath = path.join(root, 'assets/scripts/effects/NetworkEffectSyncPolicy.ts')
const policyOutput = ts.transpileModule(fs.readFileSync(policyPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const policyModule = { exports: {} }
new Function('exports', 'module', 'require', policyOutput)(policyModule.exports, policyModule, request => { throw new Error(`unexpected ${request}`) })

const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
  fileName: sourcePath,
}).outputText
const runtime = new Module(sourcePath, module)
runtime.filename = sourcePath
runtime.paths = Module._nodeModulePaths(path.dirname(sourcePath))
runtime.require = request => {
  if (request === 'cc') return { _decorator: { ccclass: () => value => value, property: () => () => undefined }, Component: FakeComponent, EventTarget: FakeEventTarget }
  if (request === '../session/GameSession') return { GameSession: FakeSession }
  if (request === './CocosSocketClient') return { CocosSocketClient: FakeSocket }
  if (request === '../effects/NetworkEffectSyncPolicy') return policyModule.exports
  return require(request)
}
runtime._compile(output, sourcePath)

const controller = new runtime.exports.LobbyController()
controller.session = new FakeSession()
controller.onLoad()
controller.snapshot = { ...controller.snapshot, connected: true }
const joinRequest = controller.joinRoom('123456')
controller.client.emit('roomJoined', {
  type: 'roomJoined', requestId: joinRequest, roomId: '123456', myPlayerId: 'p2', resumeToken: 'resume', version: 1,
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
controller.events.on('guandan:turn-deadline', value => deadlineEvents.push(value))
controller.events.on('guandan:trustee', value => trusteeEvents.push(value))
controller.events.on('guandan:round-ready', value => readyEvents.push(value))
controller.events.on('guandan:dissolve-vote', value => dissolveEvents.push(value))

controller.client.emit('turnDeadline', {
  roomId: '123456', version: 2, currentTurn: null, turnDeadlineAt: 9000, deadlinePlayerId: 'p3', deadlineAction: 'returnTribute',
})
controller.client.emit('trusteeUpdated', {
  roomId: '123456', version: 2,
  trustees: { p1: null, p2: { reason: 'timeout', since: 100 }, p3: null, p4: null },
  consecutiveTimeouts: { p1: 0, p2: 2, p3: 0, p4: 0 },
})
controller.client.emit('roundReadyUpdated', { roomId: '123456', version: 3, roundReadyPlayerIds: ['p1', 'p2'] })
const vote = { initiator: 'p1', votes: { p1: 'agree', p2: 'pending', p3: 'offline', p4: 'pending' }, expiresAt: 12000 }
controller.client.emit('dissolveVoteUpdated', { roomId: '123456', version: 4, dissolveVote: vote })

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

controller.readyNextRound()
controller.cancelRoundReady()
controller.setTrustee()
controller.cancelTrustee()
controller.proposeDissolve()
controller.voteDissolve(false)
assert.deepEqual(controller.client.sent.slice(-6).map(item => item.type), [
  'readyNextRound', 'cancelRoundReady', 'setTrustee', 'cancelTrustee', 'proposeDissolve', 'dissolveVote',
])
assert.equal(controller.client.sent.at(-1).payload.agree, false)

controller.client.emit('roomDissolved', { roomId: '123456', reason: 'vote-approved' })
assert.equal(controller.snapshot.roomId, null)
assert.equal(controller.snapshot.turnDeadlineAt, null)
assert.equal(controller.snapshot.deadlinePlayerId, null)
assert.equal(controller.snapshot.deadlineAction, null)
assert.deepEqual(controller.snapshot.roundReadyPlayerIds, [])

const sceneSource = fs.readFileSync(scenePath, 'utf8')
assert.match(sceneSource, /deadline - Date\.now\(\)/, 'the table countdown must derive from the server deadline')
assert.match(sceneSource, /deadlinePlayerId !== humanId/, 'only the authoritative tribute actor may use tribute controls')
assert.match(sceneSource, /expectedAction === 'finishTribute'/, 'only the authoritative tribute leader may start play')
assert.match(sceneSource, /playerName} · \$\{actionLabel\[deadlineAction\]}/, 'tribute countdown must identify the authoritative player and action')
const multiplayerTick = sceneSource.slice(sceneSource.indexOf('private readonly tickActionCountdown'), sceneSource.indexOf('private refreshCountdownLabel'))
assert.match(multiplayerTick, /if \(this\.session\?\.snapshot\.isMultiplayer\)/, 'multiplayer countdown must have an explicit server-owned branch')
assert.match(multiplayerTick, /this\.refreshCountdownLabel\(\)[\s\S]*return/, 'the server-owned branch must return without performing a local timeout action')
assert.equal((multiplayerTick.match(/actOnTimeout\(\)/g) ?? []).length, 1, 'only the local-game branch may invoke actOnTimeout')
assert.doesNotMatch(sceneSource, /humanId !== 'p1' && !gameWon/, 'all four seats must have a between-round ready control')
assert.match(sceneSource, /roundReadyPlayerIds\?\.includes\(humanId\)/, 'the ready control must reflect this seat\'s authoritative vote')
assert.match(sceneSource, /this\.lobby\?\.cancelRoundReady\(\)/, 'a ready player must be able to cancel')
assert.match(sceneSource, /this\.lobby\?\.safeExit\(\)/, 'active multiplayer exit must use the safe-exit protocol')
assert.match(sceneSource, /this\.lobby\?\.proposeDissolve\(\)/, 'the table must expose dissolve proposals')
assert.match(sceneSource, /this\.lobby\?\.voteDissolve\(false\)/, 'the table must expose a refuse vote')
assert.match(sceneSource, /this\.lobby\?\.voteDissolve\(true\)/, 'the table must expose an agree vote')

process.stdout.write('network round-state regression checks passed\n')
