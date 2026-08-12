const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const root = path.resolve(__dirname, '..')
const networkRoot = path.join(root, 'assets/scripts/network')
const ts = loadTypeScript()
const loadPure = (name, dependencies = {}) => {
  const filePath = path.join(networkRoot, `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText
  const loaded = { exports: {} }
  new Function('exports', 'module', 'require', output)(loaded.exports, loaded, request => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`unexpected dependency ${request} in ${name}`)
  })
  return loaded.exports
}

const policy = loadPure('../effects/NetworkEffectSyncPolicy')
const models = loadPure('LobbyModels')
const sync = loadPure('LobbySyncTracker', { '../effects/NetworkEffectSyncPolicy': policy })
const { LobbyMessageRouter } = loadPure('LobbyMessageRouter', {
  './LobbyModels': models,
  './LobbySyncTracker': sync,
})
const { LobbyCommandSender } = loadPure('LobbyCommandSender', {
  '../core/generated/protocol': { commandRequiresExpectedVersion: type => type === 'play' },
})
const { LobbyConnectionEventCoordinator } = loadPure('LobbyConnectionEventCoordinator')

function verifyMessageRouter () {
  let snapshot = { ...models.createLobbySnapshot(), connected: true, roomId: '123456', myPlayerId: 'p2', roomStatus: 'ready' }
  const listeners = new Map()
  const emitted = []
  const router = new LobbyMessageRouter({
    listen: (type, listener) => listeners.set(type, listener),
    snapshot: () => snapshot,
    patch: next => { snapshot = { ...snapshot, ...next } },
    emit: (type, ...args) => emitted.push([type, ...args]),
    isRoomCleaning: roomId => roomId === '654321',
    handleRequestResult: () => {},
    applyRoomEntry: () => {},
    closeRoom: message => emitted.push(['closed', message]),
    reportError: message => emitted.push(['error', message]),
  })
  router.bind()
  const entryState = { playArea: [], phase: 'playing' }
  router.applyEntrySnapshot({ type: 'roomJoined', roomId: '123456', myPlayerId: 'p2', resumeToken: 'resume-entry', state: entryState, phase: 'playing' }, 'initial-snapshot')
  assert.deepEqual(emitted.at(-1).slice(0, 2), ['guandan:network-state', { roomId: '123456', version: 0, gameVersion: 0, state: entryState, effectSync: { mode: 'recovery', reason: 'initial-snapshot' } }], 'only the accepted entry adapter may normalize missing legacy snapshot versions')
  router.reset()
  emitted.length = 0
  listeners.get('turnDeadline')({ roomId: '123456', version: 2, currentTurn: 'p3', turnDeadlineAt: 9000, deadlinePlayerId: 'p3', deadlineAction: 'play' })
  assert.equal(snapshot.turnDeadlineAt, 9000)
  assert.deepEqual(emitted.at(-1), ['guandan:turn-deadline', { currentTurn: 'p3', turnDeadlineAt: 9000, deadlinePlayerId: 'p3', deadlineAction: 'play' }])

  const eventCount = emitted.length
  const deadline = snapshot.turnDeadlineAt
  listeners.get('turnDeadline')({ roomId: '123456', version: 2, turnDeadlineAt: 1 })
  listeners.get('turnDeadline')({ version: 3, turnDeadlineAt: 1 })
  listeners.get('turnDeadline')({ roomId: '123456', turnDeadlineAt: 1 })
  listeners.get('turnDeadline')({ roomId: '123456', version: -1, turnDeadlineAt: 1 })
  listeners.get('turnDeadline')({ roomId: '123456', version: 3.5, turnDeadlineAt: 1 })
  listeners.get('turnDeadline')({ roomId: '123456', version: Number.MAX_SAFE_INTEGER + 1, turnDeadlineAt: 1 })
  listeners.get('turnDeadline')({ roomId: '999999', version: 3, turnDeadlineAt: 1 })
  listeners.get('turnDeadline')({ roomId: 'wrong-room', version: 3, turnDeadlineAt: 1 })
  listeners.get('turnDeadline')({ roomId: '654321', version: 3, turnDeadlineAt: 1 })
  assert.equal(emitted.length, eventCount, 'duplicate, other-room and cleanup metadata must be ignored')
  assert.equal(snapshot.turnDeadlineAt, deadline, 'missing or invalid metadata envelopes must not mutate the snapshot')

  const state = { playArea: [], phase: 'playing' }
  listeners.get('gameState')({ roomId: '123456', version: 3, state })
  listeners.get('gameState')({ roomId: '123456', gameVersion: 5, state })
  listeners.get('gameState')({ roomId: '999999', version: 3, gameVersion: 5, state })
  assert.equal(emitted.filter(item => item[0] === 'guandan:network-state').length, 0, 'state messages require roomId, version and gameVersion')
  listeners.get('gameState')({ roomId: '123456', version: 3, gameVersion: 5, state })
  listeners.get('gameState')({ roomId: '123456', version: 3, gameVersion: 5, state })
  assert.equal(emitted.filter(item => item[0] === 'guandan:network-state').length, 1, 'duplicate state packets must be version-gated')

  const result = { winnerTeam: 'teamA', levelUp: 1, fullRank: ['p1', 'p3', 'p2', 'p4'], teamLevels: { teamA: 3, teamB: 2 }, aFailStreaks: { teamA: 0, teamB: 0 }, message: 'settled' }
  listeners.get('roundEnded')({ roomId: '123456', version: 4, result })
  listeners.get('roundEnded')({ roomId: '123456', version: 4, gameVersion: 6, result })
  listeners.get('roundEnded')({ roomId: '123456', version: 4, gameVersion: 6, result })
  assert.equal(emitted.filter(item => item[0] === 'guandan:round-ended').length, 1, 'round events require gameVersion and dedupe repeated delivery')

  const roomEventCount = emitted.length
  listeners.get('chat')({ playerId: 'p2', text: 'missing room' })
  listeners.get('chat')({ roomId: '999999', playerId: 'p2', text: 'wrong room' })
  listeners.get('hostLeft')({})
  listeners.get('roomDissolved')({ roomId: 'wrong-room' })
  listeners.get('roomKicked')({ roomId: '654321' })
  assert.equal(emitted.length, roomEventCount, 'every live room-domain event must carry the accepted current room id')
  listeners.get('chat')({ roomId: '123456', playerId: 'p2', text: 'hello' })
  assert.deepEqual(emitted.at(-1), ['guandan:chat', { playerId: 'p2', text: 'hello' }])
}

function verifyCommandSender () {
  const sent = []
  const errors = []
  const snapshot = { ...models.createLobbySnapshot(), roomId: '123456', roomStatus: 'ready', gameVersion: 8 }
  const sender = new LobbyCommandSender({
    client: () => ({ send: (type, payload) => { sent.push({ type, payload }); return sent.length } }),
    snapshot: () => snapshot,
    emitResult: result => errors.push(result),
    reportError: message => errors.push(message),
  })
  sender.roomIntent('play', { cardIds: ['card-1'] })
  sender.roomIntent('chat', { text: 'hello' })
  assert.deepEqual(sent, [
    { type: 'play', payload: { roomId: '123456', cardIds: ['card-1'], expectedVersion: 8 } },
    { type: 'chat', payload: { roomId: '123456', text: 'hello' } },
  ])
  snapshot.gameStartPending = true
  assert.equal(sender.roomIntent('play'), null)
  assert.deepEqual(errors, ['平台确认开局期间暂不能操作'])
}

function verifyConnectionCoordinator () {
  let snapshot = { ...models.createLobbySnapshot(), roomId: '123456', myPlayerId: 'p2', roomStatus: 'rejoining' }
  const calls = []
  const dependencies = {
    snapshot: () => snapshot,
    resumeToken: () => 'resume-token',
    matchedConnected: () => false,
    matchedDisconnected: () => 'none',
    resumePending: () => false,
    startResumeWatchdog: () => calls.push('watchdog'),
    recordResumeFailure: () => false,
    beginEntry: (...args) => { calls.push(['begin', ...args]); return 9 },
    invalidateEntry: () => calls.push('invalidate'),
    closeForRecovery: message => calls.push(['close', message]),
    requestPlatformRecovery: () => calls.push('recover'),
    refreshRooms: () => calls.push('refresh'),
    patch: next => { snapshot = { ...snapshot, ...next }; calls.push(['patch', next]) },
    reportDisconnect: message => calls.push(['error', message]),
  }
  const coordinator = new LobbyConnectionEventCoordinator(dependencies)
  coordinator.handleConnected()
  assert.deepEqual(calls.slice(0, 2).map(item => Array.isArray(item) ? item[0] : item), ['patch', 'begin'])
  assert.equal(calls[1][1], 'rejoinRoom', 'resume must start only after connected projection')

  calls.length = 0
  coordinator.handleDisconnected()
  assert.deepEqual(calls.map(item => Array.isArray(item) ? item[0] : item), ['watchdog', 'invalidate', 'patch', 'error'])
}

verifyMessageRouter()
verifyCommandSender()
verifyConnectionCoordinator()

for (const name of ['LobbyMessageRouter', 'LobbyCommandSender', 'LobbyConnectionEventCoordinator']) {
  assert.equal(fs.existsSync(path.join(networkRoot, `${name}.ts.meta`)), true, `${name} must have Cocos metadata`)
}

process.stdout.write('lobby network owner regression checks passed\n')
