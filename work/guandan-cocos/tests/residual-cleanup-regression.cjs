const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const root = path.resolve(__dirname, '..')
const core = require(path.resolve(root, '../../shared-core/dist'))
const saved = new Map()
class Component {
  constructor () { this.node = { emit () {} }; this.jobs = [] }
  scheduleOnce (fn) { this.jobs.push(fn) }
  unscheduleAllCallbacks () { this.jobs = [] }
}
const cc = {
  Component, EventTarget: class { emit () {} },
  _decorator: { ccclass: () => value => value, property: () => () => undefined },
  sys: { localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } },
}
const cache = new Map()
function load (relative) {
  const file = path.resolve(root, relative)
  if (cache.has(file)) return cache.get(file)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
  }).outputText
  const mod = { exports: {} }
  cache.set(file, mod.exports)
  Function('module', 'exports', 'require', compiled)(mod, mod.exports, id => {
    if (id === 'cc') return cc
    if (id === '../core/generated') return core
    if (id === '../network/LobbyController') return { LobbyController: class {} }
    return load(path.relative(root, path.resolve(path.dirname(file), id + '.ts')))
  })
  return mod.exports
}
const { GameSession } = load('assets/scripts/session/GameSession.ts')
const { restoreSessionSnapshot, SESSION_SCHEMA_VERSION } = load('assets/scripts/session/GameSessionModel.ts')
const { projectSettlementContent } = load('assets/scripts/scenes/SettlementPresentation.ts')
for (const gameMode of ['campaign', 'double_open', 'standard']) {
  const session = new GameSession()
  session.snapshot = restoreSessionSnapshot({
    schemaVersion: 2, gameMode, difficulty: 'easy',
    campaignProgress: { wins: 1, losses: 0, targetWins: 3 },
    settings: { volume: 0.7, sortOrder: 'asc', voicePack: 'male' },
    playerStats: { gamesPlayed: 12, wins: 7 },
  })
  assert.equal(session.snapshot.schemaVersion, SESSION_SCHEMA_VERSION)
  assert.equal(session.snapshot.settings.volume, 0.7)
  assert.equal(session.snapshot.settings.sortOrder, 'asc')
  assert.equal(session.snapshot.settings.voicePack, 'female')
  session.enterLobby()
  session.joinRoom('memory-only-room', 'p1')
  session.recordRound('teamA', true, 2)
  assert.equal(session.snapshot.playerStats.gamesPlayed, 13)
  assert.equal(session.snapshot.playerStats.wins, 8)
  for (const key of ['gameMode', 'difficulty', 'campaignProgress']) {
    assert.equal(key in session.snapshot, false, 'legacy field survived: ' + key)
    assert.equal(key in JSON.parse(saved.get('guandan-cocos-session-v1')), false)
  }
  const state = core.createGame(9)
  const result = projectSettlementContent({
    state, settlement: { fullRank: ['p1','p3','p2','p4'], winnerTeam: 'teamA', format: 'independent', levelUp: 0, isGameWon: false },
  }, 'p1', null, true, [])
  assert.doesNotMatch(JSON.stringify(result), /战役|闯关|双明/)
  session.setRoomView('p3', true)
  session.recordRound('teamA', true, 3)
  assert.equal(session.snapshot.playerStats.gamesPlayed, 13, 'observer must not claim played rounds')
}
const { GameManager } = load('assets/scripts/game/GameManager.ts')
const manager = new GameManager()
manager.session = new GameSession()
manager.session.joinRoom('memory-only-room', 'p1')
let requestId = 0
const commands = []
manager.lobby = {
  snapshot: { connected: true, roomId: 'memory-only-room', roomStatus: 'ready' },
  play: ids => { commands.push(['play', ids]); return ++requestId },
  pass: () => { commands.push(['pass']); return ++requestId },
}
const state = core.createGame(2)
state.currentTurn = 'p1'
manager.applyServerState(state)
const card = state.players.p1.hand[0]
assert.ok(card)
manager.replaceSelectedCards([card.id])
const before = JSON.stringify(manager.state)
manager.playSelected()
assert.deepEqual(commands[0], ['play', [card.id]])
assert.equal(JSON.stringify(manager.state), before, 'client cannot locally apply its requested move')
assert.equal(manager.actionPending, true)
manager.applyNetworkError('test rejection')
assert.equal(manager.actionPending, false)
const following = { ...state, lastValidPlay: { playerId: 'p2', type: 'Single', cards: [state.players.p2.hand[0]] } }
manager.applyServerState(following)
manager.pass()
assert.deepEqual(commands[1], ['pass'])
manager.abortRound()
assert.equal(manager.actionPending, false)
for (const name of ['startRound', 'nextRound', 'actOnTimeout']) assert.equal(manager[name], undefined, name + ' must not launch local gameplay')
for (const name of ['beginLocalGame', 'completeGrouping', 'resetMatchProgress']) assert.equal(manager.session[name], undefined)
;(async () => {
  const { pathToFileURL } = require('node:url')
  const { isClientSharedCoreSource: keep } = await import(pathToFileURL(path.join(root, 'scripts/core-sync-policy.mjs')).href)
  assert.equal(keep('lib/ai.ts'), false)
  assert.equal(keep(['lib', 'ai.ts'].join(String.fromCharCode(92))), false)
  for (const file of ['ai', 'ai/engine.ts', 'index.ts', 'lib/rules.ts']) assert.equal(keep(file), true)
  console.log('Residual cleanup passed: historical cache migration, preserved preferences/stats, observer isolation, server-only action routing, sync boundary')
})().catch(error => { console.error(error); process.exitCode = 1 })
