import assert from 'node:assert/strict'
import test from 'node:test'
import { lifecycleFixture } from './platform-lifecycle-test-fixture.mjs'
import { blockTournamentAssignment, getCurrentTournamentAssignment } from './tournament-orchestrator.js'

const cup = 'lifecycle-cup', mode = 'lingshui_16_cup'
const setup = async () => {
  const f = lifecycleFixture()
  await f.store.transaction(s => { s.tournaments[cup] = { id: cup, name: '合成赛事', queueId: mode,
    status: 'open', format: 'fixed16-latin-3', capacity: 16, roundsTotal: 3, advanceCount: 8, entryPoints: 0 } })
  for (let i = 0; i < 16; i++) {
    await f.service.enrollTournament(`u${i}`, cup, `enroll-u${i}`, { expectedEntryPoints: 0 })
    await f.service.checkInTournament(`u${i}`, cup)
  }
  const tables = []
  const run = await f.store.read(s => s.tournamentRuns[cup])
  for (const assignment of run.rounds[0].assignments) {
    for (const user of assignment.userIds) await f.service.joinMatch(user, { mode, tournamentId: cup, assignmentId: assignment.assignmentId })
    const entry = await f.service.getMatchStatus(assignment.userIds[0], (await f.snapshot()).activeMatchByUser[assignment.userIds[0]])
    const start = { eventId: `spectate:${entry.matchId}:1`, matchId: entry.matchId,
      roomId: entry.roomId, sequence: 1, roundSequence: 1, at: f.now(), type: 'game-start' }
    await f.service.claimGameStart(start.eventId, start)
    tables.push({ ...entry, assignment })
  }
  return { f, tables }
}
const closeEvent = (f, table, index = 0) => ({ eventId: `spectate:${table.matchId}:2`, matchId: table.matchId,
  roomId: table.roomId, sequence: 2, roundSequence: 1, at: f.now() + index,
  type: 'room-closed', reason: index % 2 ? 'server-shutdown' : 'empty-timeout' })
const accept = (f, event) => f.service.acceptSpectatorEvent(event.eventId, event)
const assertNoScores = s => {
  for (const key of ['gameResults', 'tournamentRoundResults', 'tournamentPlayerRoundResults', 'userStats']) assert.deepEqual(s[key], {})
  for (const standing of Object.values(s.tournamentStandings)) {
    assert.equal(standing.played, 0); assert.equal(standing.points, 0); assert.deepEqual(standing.opponents, [])
  }
  for (const wallet of Object.values(s.wallets)) assert.equal(wallet.balance, 1000)
}
for (let first = 0; first < 4; first++) for (const concurrent of [false, true]) {
  test(`TO-11-001: first table ${first + 1}, ${concurrent ? 'interleaved' : 'sequential'} closures survive restart`, async () => {
    const { f, tables } = await setup()
    const order = [first, ...[0, 1, 2, 3].filter(i => i !== first)]
    const events = order.map((i, index) => closeEvent(f, tables[i], index))
    assert.equal((await accept(f, events[0])).duplicate, false)
    const firstRun = (await f.snapshot()).tournamentRuns[cup]
    await f.restart()
    if (concurrent) {
      const results = await Promise.all(events.slice(1).flatMap(e => [accept(f, e), accept(f, e)]))
      assert.equal(results.filter(r => !r.duplicate).length, 3)
    } else {
      for (const event of events.slice(1)) {
        assert.equal((await accept(f, event)).duplicate, false)
        assert.equal((await accept(f, event)).duplicate, true)
      }
    }
    const after = await f.snapshot(), run = after.tournamentRuns[cup]
    assert.equal(run.phase, 'blocked'); assert.equal(run.currentRound, 1)
    for (const key of ['blockedAt', 'blockedReason', 'blockedAssignmentId']) assert.equal(run[key], firstRun[key], 'preserve the original pause cause')
    assert.deepEqual(after.activeMatchByUser, {})
    assert.equal(run.rounds[0].assignments.filter(a => a.status === 'blocked').length, 4)
    assert.ok(run.rounds.slice(1).every(r => r.assignments.every(a => a.status === 'pending')))
    for (const table of tables) {
      assert.equal(after.matches[table.matchId].status, 'aborted')
      assert.ok(after.matches[table.matchId].participants.every(p => p.status === 'aborted'))
      assert.equal(getCurrentTournamentAssignment(run, table.assignment.userIds[0]).status, 'blocked')
    }
    assertNoScores(after)
    await f.restart()
    for (const event of events) assert.equal((await accept(f, event)).duplicate, true)
    assert.deepEqual(await f.snapshot(), after)
    for (const table of tables) assert.ok((await f.service.joinMatch(table.assignment.userIds[0], { mode: 'quick' })).status)
  })
}

test('TO-11-001: later-table persistence failure rolls back, retries release; binding and future-round fences remain', async () => {
  const { f, tables } = await setup()
  await accept(f, closeEvent(f, tables[0]))
  const before = await f.snapshot(), run = before.tournamentRuns[cup]
  assert.throws(() => blockTournamentAssignment(run, tables[1].assignment.assignmentId, 'wrong-match', 'failure', f.now()), e => e.code === 'MATCH_MISMATCH')
  assert.throws(() => blockTournamentAssignment(run, run.rounds[1].assignments[0].assignmentId, 'future-match', 'failure', f.now()), e => e.code === 'WRONG_ROUND')
  assert.throws(() => blockTournamentAssignment(run, tables[0].assignment.assignmentId, tables[0].matchId, 'changed-reason', f.now()), e => e.code === 'BLOCK_REASON_MISMATCH')
  assert.deepEqual(await f.snapshot(), before)
  const event = closeEvent(f, tables[1], 1)
  f.store.failNext = true
  await assert.rejects(accept(f, event), /synthetic persist failure/)
  assert.deepEqual(await f.snapshot(), before)
  await f.restart()
  assert.equal((await accept(f, event)).accepted, true)
  const after = await f.snapshot()
  assert.equal(Object.keys(after.activeMatchByUser).length, 8)
  assertNoScores(after)
  const wrongRoom = { ...closeEvent(f, tables[2], 2), roomId: tables[3].roomId }
  await assert.rejects(accept(f, wrongRoom), /已分配匹配不一致/)
  assert.deepEqual(await f.snapshot(), after)
})
