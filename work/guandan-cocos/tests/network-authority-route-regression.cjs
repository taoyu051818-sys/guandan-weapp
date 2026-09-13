const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('./support/typescript.cjs').loadTypeScript()

// All product owners are real source. Only Cocos lifecycle/storage and the
// transport port are synthetic; no audit files, Creator install or network.
const storage = new Map()
class Events {
  constructor () { this.listeners = [] }
  on (type, callback, target) { this.listeners.push({ type, callback, target }) }
  off (type, callback, target) {
    this.listeners = this.listeners.filter(item => item.type !== type || item.callback !== callback || item.target !== target)
  }
  emit (type, ...args) {
    for (const item of this.listeners.slice()) if (item.type === type) item.callback.apply(item.target, args)
  }
}
class Component {
  constructor () { this.node = new Events(); this.scheduled = [] }
  scheduleOnce (callback, delay) { this.scheduled.push({ callback, delay }) }
  unscheduleAllCallbacks () { this.scheduled = [] }
  getComponent () { return null }
}
class SocketPort {
  constructor () { this.events = new Events(); this.sent = []; this.endpoints = []; this.sequence = 0 }
  on (type, callback) { this.events.on(type, callback); return () => this.events.off(type, callback) }
  emit (type, body = {}) { this.events.emit(type, { type, ...body }) }
  connect (endpoint) { this.endpoints.push(endpoint); return Promise.resolve() }
  close () {}
  send (type, payload, retryRequestId) {
    const requestId = retryRequestId ?? ++this.sequence
    this.sent.push({ type, payload, requestId })
    return requestId
  }
  lastRequest (type) {
    const request = this.sent.filter(item => item.type === type).at(-1)
    assert.ok(request, `expected the real LobbyController to send ${type}`)
    return request
  }
}
const cc = {
  Component, EventTarget: Events,
  _decorator: { ccclass: () => value => value, property: () => () => undefined },
  sys: { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  } },
}
const originalLoad = Module._load
const originalTypeScript = require.extensions['.ts']
const originalFetch = globalThis.fetch
const originalWebSocket = globalThis.WebSocket
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
}).outputText, file)
Module._load = function (name, ...args) { return name === 'cc' ? cc : originalLoad.call(this, name, ...args) }
globalThis.fetch = () => { throw Error('network is forbidden in authority route regression') }
globalThis.WebSocket = class { constructor () { throw Error('real sockets are forbidden in authority route regression') } }

async function main () {
  const base = path.resolve(__dirname, '../assets/scripts')
  const load = name => require(path.join(base, name + '.ts'))
  const core = load('core/generated/index')
  const { GameSession } = load('session/GameSession')
  const { GameManager } = load('game/GameManager')
  const { LobbyController } = load('network/LobbyController')
  const { LOBBY_RESUME_STORAGE_KEY } = load('network/LobbyResumeSession')
  const playing = core.createMatchState({ players: core.createGame(2).players, ruleProfile: core.getRuleProfile('classic'),
    currentLevel: 2, levelTeam: 'teamA', teamLevels: { teamA: 2, teamB: 2 }, dealerId: 'p1', roundId: 1, revision: 10 })
  const settlement = { winnerTeam: 'teamA', levelUp: 3, currentLevel: 5, fullRank: ['p1', 'p3', 'p2', 'p4'],
    teamLevels: { teamA: 5, teamB: 2 }, aFailStreaks: { teamA: 0, teamB: 0 }, message: '路由测试结算', isGameWon: false }
  const settled = { ...playing, phase: 'settled', revision: 11, settlement, scores: { teamA: 3, teamB: 0 } }
  const duplicate = watching => ({
    phase: 'playing', mySeat: 'p1', watching, round: 1, configuredRounds: 8, scores: { red: 0, blue: 0 },
    ready: false, canStart: false, tables: { A: 'settled', B: 'playing' }, history: [],
    slots: Array.from({ length: 8 }, (_, index) => ({
      seat: `p${index + 1}`, table: index < 4 ? 'A' : 'B', direction: '南', team: index % 2 ? 'blue' : 'red',
      name: `合成玩家${index + 1}`, occupied: true, ready: true, bot: false, online: true, host: index === 0,
    })),
  })
  const view = (state, watching, version) => ({
    roomId: '123456', myPlayerId: watching ? 'p2' : 'p1', roomRole: watching ? 'observer' : 'player',
    seatedPlayerId: 'p1', viewPlayerId: watching ? 'p2' : 'p1', entryKind: 'friend',
    state, version, gameVersion: state.revision, phase: state.phase === 'settled' ? 'settlement' : 'playing',
    roundResult: state.settlement, duplicate: duplicate(watching), viewerRoundStats: { bombsPlayed: 7 },
  })
  function lifetime () {
    const session = new GameSession(); session.onLoad()
    const lobby = new LobbyController(), socket = new SocketPort(), manager = new GameManager(), packets = []
    lobby.session = session; lobby.setSocketClient(socket)
    manager.session = session; manager.lobby = lobby
    // Same adapter calls used by TableMatchCoordinator; rendering is outside
    // this test, while both real version gates and accounting owners execute.
    lobby.events.on('guandan:network-state', packet => { packets.push(packet); manager.applyServerState(packet.state) })
    lobby.events.on('guandan:round-ended', packet => manager.applyNetworkRoundEnded(packet.result, packet.state, packet.viewerRoundStats, packet))
    lobby.onLoad()
    return { session, lobby, socket, manager, packets }
  }
  function matchedEntry (instance, matchId, version) {
    instance.lobby.enterMatchedRoom({
      matchId, roomId: '123456', seat: 'p1', entryAttemptId: 'route-regression-entry-01',
      gameEndpoint: 'wss://authority-route.invalid/game', gameTicket: 'synthetic-ticket-not-used-for-authentication',
    })
    instance.socket.emit('connected')
    const request = instance.socket.lastRequest('createRoom')
    instance.socket.emit('roomCreated', { ...view(settled, null, version), requestId: request.requestId, resumeToken: 'synthetic-resume-token' })
    assert.equal(instance.lobby.snapshot.roomStatus, 'ready')
    assert.equal(instance.lobby.matchIdentity, matchId, 'identity must come through accepted matched entry, not test mutation')
  }
  const stats = instance => instance.session.snapshot.playerStats
  for (const revision of [2, 50]) {
    storage.clear()
    const first = lifetime(), matchId = `route-match-${revision}`
    let version = 20
    matchedEntry(first, matchId, version++)
    assert.equal(first.manager.phase, 'settlement')
    assert.equal(stats(first).gamesPlayed, 1)
    assert.equal(stats(first).bombsPlayed, 7)
    const firstLedger = [...first.session.snapshot.recordedRoundKeys]
    assert.equal(firstLedger.length, 1)
    assert.equal(JSON.parse(storage.get(LOBBY_RESUME_STORAGE_KEY)).matchId, matchId)

    first.socket.emit('roomView', view({ ...playing, revision }, 'B', version++))
    assert.equal(first.manager.phase, 'playing', `B revision ${revision} owns an independent lifecycle from settled A`)
    assert.equal(first.manager.state.revision, revision)
    assert.equal(first.lobby.snapshot.duplicate.watching, 'B')
    assert.equal(first.session.snapshot.myPlayerId, 'p2')
    assert.equal(first.session.snapshot.isObserver, true)
    assert.deepEqual(first.packets.at(-1).effectSync, { mode: 'recovery', reason: 'reconnect' })

    const packetCount = first.packets.length
    first.socket.emit('gameState', view({ ...playing, revision: revision - 1 }, 'B', version++))
    first.socket.emit('gameState', view({ ...playing, revision: revision + 1 }, 'B', 19))
    assert.equal(first.packets.length, packetCount, 'router rejects old gameVersion and old room version separately')
    first.socket.emit('roomView', view({ ...playing, revision: revision - 1 }, 'B', version++))
    assert.equal(first.manager.state.revision, revision, 'even force-recovery cannot regress the same table authority')
    first.socket.emit('gameState', view({ ...playing, revision: revision + 1 }, 'B', version++))
    assert.equal(first.manager.state.revision, revision + 1, 'current-table progress is not blanket rejected')
    first.socket.emit('roomView', view({ ...settled, revision: revision + 2 }, 'B', version++))
    assert.equal(first.manager.phase, 'settlement')
    assert.equal(stats(first).gamesPlayed, 1, 'watching sibling table settlement is not another played round')

    first.socket.emit('roomView', view(settled, null, version++))
    assert.equal(first.manager.state.revision, 11)
    assert.equal(first.manager.phase, 'settlement')
    assert.equal(first.session.snapshot.isObserver, false)
    first.socket.emit('roomView', view(playing, null, version++))
    assert.equal(first.manager.phase, 'settlement', 'late own-table playing snapshot cannot reopen settlement')
    first.manager.abortRound()
    first.socket.emit('roomView', view(settled, null, version++))
    assert.equal(first.manager.phase, 'settlement')
    assert.equal(stats(first).gamesPlayed, 1, 'return to A and abort/recovery do not recount')
    assert.deepEqual(first.session.snapshot.recordedRoundKeys, firstLedger)
    first.lobby.onDestroy()

    const restarted = lifetime()
    assert.equal(restarted.lobby.snapshot.roomStatus, 'rejoining')
    assert.equal(restarted.lobby.matchIdentity, matchId, 'fresh Lobby must restore the persisted match scope')
    restarted.socket.emit('connected')
    const rejoin = restarted.socket.lastRequest('rejoinRoom')
    assert.equal(rejoin.payload.resumeToken, 'synthetic-resume-token')
    restarted.socket.emit('roomRejoined', { ...view(settled, null, version++), requestId: rejoin.requestId, resumeToken: rejoin.payload.resumeToken })
    assert.equal(restarted.lobby.snapshot.roomStatus, 'ready')
    assert.equal(restarted.manager.phase, 'settlement')
    assert.equal(stats(restarted).gamesPlayed, 1, 'fresh manager/controller must consult the restored session ledger')
    assert.equal(stats(restarted).bombsPlayed, 7)
    assert.deepEqual(restarted.session.snapshot.recordedRoundKeys, firstLedger)

    matchedEntry(restarted, `${matchId}-new`, version++)
    assert.equal(stats(restarted).gamesPlayed, 2, 'a genuinely new match at the reused room number still counts')
    assert.equal(stats(restarted).bombsPlayed, 14)
    restarted.lobby.onDestroy()
    await Promise.resolve() // Drain only synthetic resolved connect promises.
  }
  console.log('Network authority route passed: real Lobby/Router/GameManager/Session, B low/high revision, stale packets, observer exclusion, return/abort/restart once-only, new-match positive control')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  Module._load = originalLoad
  if (originalTypeScript) require.extensions['.ts'] = originalTypeScript
  else delete require.extensions['.ts']
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWebSocket
})
