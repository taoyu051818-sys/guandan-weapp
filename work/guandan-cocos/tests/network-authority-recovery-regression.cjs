const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
}).outputText, file)
const storage = new Map()
const originalLoad = Module._load
Module._load = function (name, ...args) {
  if (name === 'cc') return { _decorator: { ccclass: () => value => value }, Component: class {}, EventTarget: class { emit () {} },
    sys: { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } } }
  return originalLoad.call(this, name, ...args)
}
const base = path.resolve(__dirname, '../assets/scripts')
const core = require(path.join(base, 'core/generated/index.ts'))
const { NetworkMatchSnapshotController } = require(path.join(base, 'game/NetworkMatchSnapshotController.ts'))
const { createGameManagerProjection } = require(path.join(base, 'game/GameManagerProjection.ts'))
const { GameSession } = require(path.join(base, 'session/GameSession.ts'))
const players = core.createGame(2).players
const playing = core.createMatchState({ players, ruleProfile: core.getRuleProfile('classic'), currentLevel: 2,
  levelTeam: 'teamA', teamLevels: { teamA: 2, teamB: 2 }, dealerId: 'p1', roundId: 1, revision: 10 })
const settlement = { winnerTeam: 'teamA', levelUp: 3, currentLevel: 5, fullRank: ['p1', 'p3', 'p2', 'p4'],
  teamLevels: { teamA: 5, teamB: 2 }, aFailStreaks: { teamA: 0, teamB: 0 }, message: '本局结束', isGameWon: false }
const settled = { ...playing, phase: 'settled', revision: 11, settlement, scores: { teamA: 3, teamB: 0 } }
let authority = 'match-one:A:p1', scope = authority
function lifetime () {
  const session = new GameSession()
  session.onLoad(); session.joinRoom('123456', 'p1')
  let state = playing, projection = createGameManagerProjection(), clearCount = 0
  const controller = new NetworkMatchSnapshotController({
    getState: () => state, getProjection: () => projection, getRoomId: () => '123456', getHumanId: () => 'p1',
    getAuthority: () => authority, getRecordScope: () => scope,
    commit: (s, p) => { state = s; projection = p }, clearSelection: () => clearCount++, cancelPendingAction () {},
    setSessionPhase () {}, publishHint () {}, recordRound: r => session.recordRound(r.settlement.winnerTeam, r.wasFirst, r.bombCount, {
      levelUp: r.settlement.levelUp, currentLevel: r.settlement.currentLevel, teamLevels: r.settlement.teamLevels, scores: r.scores,
    }, 'teamA', r.recordKey),
  })
  return { controller, session, projection: () => projection, clears: () => clearCount }
}
const first = lifetime()
assert.equal(first.controller.applyServerState(settled), true)
first.controller.applyRoundEnded(settlement, settled, { bombsPlayed: 7 })
assert.equal(first.session.snapshot.playerStats.gamesPlayed, 1)
for (const revision of [2, 50]) {
  authority = `match-one:B:p1:${revision}`
  assert.equal(first.controller.applyServerState({ ...playing, revision }), true, 'another table has an independent revision/lifecycle')
  assert.equal(first.projection().phase, 'playing')
  assert.equal(first.controller.applyServerState({ ...playing, revision: revision - 1 }), false, 'same authority still rejects stale packets')
}
authority = scope
first.controller.reset()
first.controller.applyServerState(settled)
first.controller.applyRoundEnded(settlement, settled, { bombsPlayed: 7 })
assert.equal(first.session.snapshot.playerStats.gamesPlayed, 1, 'reset is not a new accounting event')
const restarted = lifetime()
restarted.controller.applyServerState(settled)
restarted.controller.applyRoundEnded(settlement, settled, { bombsPlayed: 7 })
assert.equal(restarted.session.snapshot.playerStats.gamesPlayed, 1, 'app restart must retain once-only settlement')
assert.equal(restarted.session.snapshot.playerStats.bombsPlayed, 7)
authority = scope = 'match-two:A:p1'
restarted.controller.applyServerState(settled)
restarted.controller.applyRoundEnded(settlement, settled, { bombsPlayed: 2 })
assert.equal(restarted.session.snapshot.playerStats.gamesPlayed, 2, 'reused room number is a different platform match')
assert.equal(restarted.session.snapshot.playerStats.bombsPlayed, 9)
restarted.session.setRoomView('p2', true)
restarted.session.recordRound('teamA', true, 3, undefined, 'teamA', 'observer-event')
assert.equal(restarted.session.snapshot.playerStats.gamesPlayed, 2)
for (const getAuthority of [undefined, () => null]) {
  let state = settled, projection = { ...createGameManagerProjection(), phase: 'settlement', roundId: 1, revision: 11 }
  const c = new NetworkMatchSnapshotController({ getAuthority,
    getState: () => state, getProjection: () => projection, getRoomId: () => '123456', getHumanId: () => 'p1',
    commit: (s, p) => { state = s; projection = p }, clearSelection () {}, cancelPendingAction () {},
    setSessionPhase () {}, recordRound () {}, publishHint () {},
  })
  c.reset()
  assert.equal(c.applyServerState({ ...playing, revision: 2 }), true, 'reset invalidates even an unidentified old baseline')
  assert.equal(c.applyServerState({ ...playing, revision: 1 }), false, 'same unidentified lifetime still rejects stale states')
}
console.log('network authority/restart accounting regression passed')
