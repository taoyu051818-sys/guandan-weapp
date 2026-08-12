const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'assets/scripts/replay/ReplayTimeline.ts')
const { loadTypeScript, typescriptPath } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText
const runtime = new Module(sourcePath, module)
runtime.filename = sourcePath
runtime.paths = Module._nodeModulePaths(path.dirname(sourcePath))
runtime._compile(output, sourcePath)

const { ReplayTimeline, normalizeReplayEvents, reduceReplayState } = runtime.exports

const heartA = { rank: 'A', suit: 'heart' }
const spade2 = { rank: '2', suit: 'spade' }
const events = [
  { sequence: 8, at: 800, type: 'room-closed', roundSequence: 2, reason: 'dissolved' },
  { sequence: 4, at: 400, type: 'play-start', roundSequence: 2 },
  { sequence: 2, at: 200, type: 'play', roundSequence: 1, playerId: 'p1', cards: [heartA], playType: 'Single', automatic: false },
  { sequence: 7, at: 700, type: 'round-end', roundSequence: 2, ranking: ['p3', 'p1', 'p4', 'p2'], winnerTeam: 'teamA', isGameWon: false },
  { sequence: 1, at: 100, type: 'game-start', roundSequence: 1 },
  { sequence: 6, at: 600, type: 'pass', roundSequence: 2, playerId: 'p4', automatic: true },
  { sequence: 3, at: 300, type: 'pass', roundSequence: 1, playerId: 'p2', automatic: false },
  { sequence: 5, at: 500, type: 'play', roundSequence: 2, playerId: 'p3', cards: [spade2], playType: 'Single', automatic: false },
  { sequence: 2, at: 200, type: 'play', roundSequence: 1, playerId: 'p1', cards: [heartA], playType: 'Single', automatic: false },
]

const normalized = normalizeReplayEvents(events)
assert.deepEqual(normalized.map(event => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8], 'events must be sorted and duplicate sequences removed')
assert.equal(events[0].sequence, 8, 'normalization must not reorder caller-owned input')

const timeline = new ReplayTimeline(events)
assert.equal(timeline.eventCount, 8)
assert.equal(timeline.cursor, 0)
assert.equal(timeline.currentEvent.sequence, 1)
assert.equal(timeline.state.phase, 'game-start')
assert.equal(timeline.state.roundSequence, 1)

timeline.seek(1)
assert.deepEqual(timeline.state.tableCards, [heartA])
assert.equal(timeline.state.tablePlayerId, 'p1')
assert.equal(timeline.state.seatActions.p1.type, 'play')
assert.equal('hand' in timeline.state, false, 'the public replay state must never synthesize hidden hands')

timeline.next()
assert.equal(timeline.currentEvent.type, 'pass')
assert.deepEqual(timeline.state.tableCards, [heartA], 'pass must leave the last public play on the table')
assert.equal(timeline.state.seatActions.p2.type, 'pass')

timeline.next()
assert.equal(timeline.currentEvent.type, 'play-start')
assert.deepEqual(timeline.state.tableCards, [], 'play-start must clear the public table')
assert.equal(timeline.state.tablePlayerId, null)
assert.equal(timeline.state.roundSequence, 2)

timeline.seek(5)
assert.deepEqual(timeline.state.tableCards, [spade2], 'a pass after a later play must not clear that play')
assert.equal(timeline.state.tablePlayerId, 'p3')
assert.equal(timeline.state.seatActions.p4.automatic, true)

timeline.next()
assert.equal(timeline.state.phase, 'round-ended')
assert.deepEqual(timeline.state.ranking, ['p3', 'p1', 'p4', 'p2'])
assert.equal(timeline.state.winnerTeam, 'teamA')
assert.equal(timeline.state.isGameWon, false)

timeline.next()
assert.equal(timeline.state.phase, 'room-closed')
assert.equal(timeline.state.closedReason, 'dissolved')

timeline.toStart()
assert.equal(timeline.cursor, 0)
assert.equal(timeline.previous(), false)
timeline.toEnd()
assert.equal(timeline.cursor, 7)
assert.equal(timeline.next(), false)
timeline.seekRatio(0)
assert.equal(timeline.cursor, 0)
timeline.seekRatio(0.5)
assert.equal(timeline.cursor, 4, 'ratio seeks use a deterministic nearest-event mapping')
timeline.seekRatio(1)
assert.equal(timeline.cursor, 7)

timeline.seek(5)
const directState = timeline.state
timeline.toStart()
timeline.next()
timeline.toEnd()
timeline.previous()
timeline.seek(5)
assert.deepEqual(timeline.state, directState, 'state at a cursor must not depend on navigation history')
assert.deepEqual(reduceReplayState(events, 5), directState, 'functional reduction and cursor state must agree')

assert.equal(timeline.isPlaying, false)
assert.equal(timeline.play(), true)
assert.equal(timeline.isPlaying, true)
assert.equal(timeline.toggle(), false)
assert.equal(timeline.isPlaying, false)
timeline.toggle()
timeline.pause()
assert.equal(timeline.isPlaying, false)

const empty = new ReplayTimeline([])
assert.equal(empty.eventCount, 0)
assert.equal(empty.cursor, -1)
assert.equal(empty.currentEvent, null)
assert.equal(empty.state.phase, 'idle')
assert.equal(empty.state.roundSequence, null)
assert.deepEqual(empty.state.tableCards, [])
assert.deepEqual(empty.state.ranking, [])
assert.equal(empty.next(), false)
assert.equal(empty.previous(), false)
assert.equal(empty.toStart(), false)
assert.equal(empty.toEnd(), false)
assert.equal(empty.seekRatio(0.5), false)
assert.equal(empty.play(), false)
assert.equal(empty.isPlaying, false)

const live = new ReplayTimeline([])
const firstMerge = live.merge(events.filter(event => event.sequence <= 3))
assert.equal(firstMerge.addedCount, 3)
assert.equal(firstMerge.followedEnd, true, 'an empty live player must open at the newest available public event')
assert.equal(live.cursor, 2)
assert.equal(live.currentEvent.sequence, 3)
assert.equal(live.newerEventCount, 0)

const duplicateAndNew = live.merge([
  { sequence: 2, at: 999, type: 'pass', roundSequence: 1, playerId: 'p4', automatic: true },
  events.find(event => event.sequence === 4),
  events.find(event => event.sequence === 5),
])
assert.equal(duplicateAndNew.addedCount, 2, 'existing sequence identities must be immutable even if a conflicting duplicate arrives')
assert.equal(duplicateAndNew.followedEnd, true)
assert.equal(live.currentEvent.sequence, 5)
assert.equal(live.state.tablePlayerId, 'p3')

live.seek(1)
const reviewedSequence = live.currentEvent.sequence
const reviewMerge = live.merge(events.filter(event => event.sequence >= 5))
assert.equal(reviewMerge.addedCount, 3)
assert.equal(reviewMerge.followedEnd, false, 'new public events must not steal the cursor while the user reviews history')
assert.equal(live.currentEvent.sequence, reviewedSequence)
assert.equal(live.newerEventCount, 6)
assert.equal(live.toEnd(), true)
assert.equal(live.currentEvent.sequence, 8)
assert.equal(live.newerEventCount, 0)

const insertion = new ReplayTimeline([
  events.find(event => event.sequence === 1),
  events.find(event => event.sequence === 3),
])
insertion.toEnd()
const insertMerge = insertion.merge([events.find(event => event.sequence === 2)], false)
assert.equal(insertMerge.addedCount, 1)
assert.equal(insertMerge.followedEnd, false)
assert.equal(insertion.currentEvent.sequence, 3, 'an out-of-order gap fill must preserve the viewed event by sequence')
assert.deepEqual(insertion.state.tableCards, [heartA], 'state caches must be rebuilt when a missing earlier event arrives')

process.stdout.write('replay timeline regression checks passed\n')
