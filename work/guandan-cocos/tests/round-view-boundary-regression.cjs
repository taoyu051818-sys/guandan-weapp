'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const root = path.resolve(__dirname, '..')
const { ownRoundState, normalizeRoundViewPhase } = require('../assets/scripts/game/RoundViewState.ts')
const { createGameManagerProjection, projectAuthoritativeState } = require('../assets/scripts/game/GameManagerProjection.ts')
const { projectTurnClock } = require('../assets/scripts/scenes/TableTurnClockProjection.ts')

const wire = {
  turnOrder: ['p1', 'p2', 'p3', 'p4'], currentTurn: 'p2',
  players: { p1: { hand: [{ id: 'a', rank: 3 }] } },
  finishedPlayers: [], playArea: [],
}
const owned = ownRoundState(wire)
wire.players.p1.hand[0].rank = 8
assert.equal(owned.players.p1.hand[0].rank, 3, 'later wire mutations cannot change the accepted state')
assert.throws(() => { owned.currentTurn = 'p4' }, TypeError)
assert.throws(() => owned.players.p1.hand.push({ id: 'b' }), TypeError)
assert.throws(() => { owned.players.p1.hand[0].rank = 9 }, TypeError)
assert.equal(normalizeRoundViewPhase({ phase: 'tribute' }), null)
assert.equal(normalizeRoundViewPhase({ phase: 'settlement', settlement: null }), null)
assert.deepEqual(normalizeRoundViewPhase({ phase: 'playing', tribute: {} }), { phase: 'playing', tribute: null, settlement: null })
const current = createGameManagerProjection()
for (const phase of ['tribute', 'settled']) {
  const rejected = projectAuthoritativeState(current, { ...wire, phase, roundId: 1, revision: 1 })
  assert.equal(rejected.accepted, false, 'an incomplete canonical lifecycle must not reach presenters')
  assert.equal(rejected.projection, current)
}
const snapshot = { state: owned, phase: 'playing', actionPending: false }
const lobby = { roomStatus: 'ready', turnDeadlineAt: 5000, deadlinePlayerId: 'p2', deadlineAction: 'play', roomSettings: { turnSeconds: 40 } }
assert.deepEqual(projectTurnClock(snapshot, 'p1', lobby, true, 1200), {
  turnVisible: true, turnSeconds: 4, turnDurationSeconds: 40, turnPlace: 'right',
})
assert.equal(projectTurnClock(snapshot, 'p1', lobby, true, 5500).turnSeconds, 0)
assert.equal(projectTurnClock({ ...snapshot, phase: 'settlement' }, 'p1', lobby, true, 1200).turnVisible, false)
assert.equal(projectTurnClock(snapshot, 'p1', { ...lobby, matchEnded: {} }, true, 1200).turnVisible, false)
const coordinator = fs.readFileSync(path.join(root, 'assets/scripts/scenes/TableMatchCoordinator.ts'), 'utf8')
assert.doesNotMatch(coordinator, /private layoutActionControls|new TableSettlementView|new TablePlayActionPolicy|private lastTurn/)
const clock = fs.readFileSync(path.join(root, 'assets/scripts/scenes/TableTurnClockController.ts'), 'utf8')
assert.doesNotMatch(clock, /!this\.dependencies\.label\.node\.active|&&\s*this\.dependencies\.label\.node\.active/)
const grouping = fs.readFileSync(path.join(root, 'assets/scripts/game/HandGrouping.ts'), 'utf8')
assert.doesNotMatch(grouping, /HandGroupingHistory|this\.history|public undo|public redo/)
assert.equal(fs.existsSync(path.join(root, 'assets/scripts/game/HandGroupingHistory.ts')), false)
console.log('round view ownership, lifecycle completeness, clock projection and retirement passed')
