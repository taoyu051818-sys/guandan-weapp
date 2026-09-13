import assert from 'node:assert/strict'
import { PlatformService } from '../../../../work/guandan-windows-source/server/platform/service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from '../../../../work/guandan-windows-source/server/platform/storage.js'
import { AccessTokenService, GameTicketService, GameTicketVerifier } from '../../../../work/guandan-windows-source/server/platform/crypto.js'
import { createFixed16LatinPairings } from '../../../../work/guandan-windows-source/server/platform/tournament-pairing.js'
import { createFixedTournamentRun, checkInFixedTournamentRun, markTournamentAssignmentMatched,
  completeTournamentAssignment, getCurrentTournamentAssignment } from '../../../../work/guandan-windows-source/server/platform/tournament-orchestrator.js'
import { formatForNewRoom } from '../../../../work/guandan-windows-source/server/match-format-policy.js'

// Synthetic users, clocks, memory snapshots and tickets. No network or product writes.
// Result ranks are terminal fixtures, not simulated 27-card games.
const base = 1_800_000_000_000, cup = 'audit11-cup', mode = 'lingshui_16_cup'
const userIds = Array.from({ length: 16 }, (_, i) => `audit11-user-${String(i).padStart(2, '0')}`)
const seats = ['p1', 'p2', 'p3', 'p4']
const tournament = { id: cup, name: '合成赛事', queueId: mode, status: 'open',
  format: 'fixed16-latin-3', capacity: 16, roundsTotal: 3, advanceCount: 8, entryPoints: 0 }
const frozen = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value) }
  return value
}
const permutations = xs => xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => j !== i)).map(rest => [x, ...rest])) : [[]]
const orders = permutations([0, 1, 2, 3])
let randomState = 1234567
const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32 }
for (let seed = 0; seed < 256; seed++) {
  const roster = [...userIds]
  for (let i = 15; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [roster[i], roster[j]] = [roster[j], roster[i]] }
  const schedule = createFixed16LatinPairings(frozen(roster)), pairs = new Set()
  for (const round of schedule.rounds) {
    assert.deepEqual(round.assignments.flatMap(a => a.userIds).sort(), [...userIds].sort())
    for (const a of round.assignments) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const key = [a.userIds[i], a.userIds[j]].sort().join('|')
      assert.equal(pairs.has(key), false)
      pairs.add(key)
    }
  }
  assert.equal(pairs.size, 72)
}
let completionTransitions = 0
for (const order of orders) {
  let run = createFixedTournamentRun(tournament, base)
  for (const user of userIds) run = checkInFixedTournamentRun(frozen(run), user, base)
  const clone = getCurrentTournamentAssignment(run, userIds[0]); clone.userIds[0] = 'unrelated'
  assert.equal(getCurrentTournamentAssignment(run, userIds[0]).userIds[0], userIds[0])
  for (let round = 1; round <= 3; round++) {
    const assignments = run.rounds[round - 1].assignments
    for (const a of assignments) run = markTournamentAssignmentMatched(frozen(run), a.assignmentId, `m-${a.assignmentId}`, base)
    for (let i = 0; i < 4; i++) {
      const a = assignments[order[i]]
      run = completeTournamentAssignment(frozen(run), a.assignmentId, `m-${a.assignmentId}`, base)
      assert.equal(run.currentRound, i === 3 ? Math.min(3, round + 1) : round)
      assert.equal(run.phase, round === 3 && i === 3 ? 'finished' : 'round-active')
      assert.strictEqual(completeTournamentAssignment(frozen(run), a.assignmentId, `m-${a.assignmentId}`, base), run)
      completionTransitions++
    }
  }
}
class FaultStore extends MemoryPlatformStore {
  async persist () { if (this.failNext) { this.failNext = false; throw new Error('audit11 synthetic persistence failure') } }
}
const fixture = () => {
  let now = base, id = 0, roomId = 700_000, entry = 0
  const state = createEmptyPlatformState()
  state.tournaments[cup] = { ...tournament }
  for (const user of [...userIds, 'audit11-outsider']) {
    state.users[user] = { id: user, displayName: user }
    state.wallets[user] = { userId: user, balance: 1000, currency: 'points' }
  }
  let store = new FaultStore(state), service
  const secret = 'audit11-synthetic-only-not-a-production-secret'
  const gameTickets = new GameTicketService({ secret, now: () => now, ttlMs: 1000, gameEndpoint: 'ws://127.0.0.1:1/not-connected' })
  const verifier = new GameTicketVerifier({ secret, required: true, now: () => now })
  const bind = () => { service = new PlatformService({ store, gameTickets, now: () => now,
    accessTokens: new AccessTokenService({ secret, now: () => now }), createId: () => `audit11-${++id}`,
    createRoomId: () => String(++roomId), createEntryAttemptId: () => `audit11-attempt-${String(++entry).padStart(12, '0')}` }) }
  bind()
  return { get service () { return service }, get store () { return store }, verifier,
    now: () => now, advance: ms => { now += ms },
    restart: async () => { const snapshot = await store.read(s => s); store = new FaultStore(snapshot); bind(); return snapshot } }
}
const snapshot = f => f.store.read(s => s)
const enroll = (f, user) => f.service.enrollTournament(user, cup, `enroll-${user}`, { expectedEntryPoints: 0 })
const checked = async f => {
  await Promise.all(userIds.map(user => enroll(f, user)))
  for (const user of userIds) await f.service.checkInTournament(user, cup)
}
const joinRound = async (f, round, inject = false) => {
  const run = await f.store.read(s => s.tournamentRuns[cup]), tables = []
  assert.equal(run.currentRound, round)
  for (const [tableIndex, a] of run.rounds[round - 1].assignments.entries()) {
    for (const [index, user] of [...a.userIds].reverse().entries()) {
      const join = () => f.service.joinMatch(user, { mode, tournamentId: cup, assignmentId: a.assignmentId })
      if (inject && index === 3 && tableIndex === 0) {
        const before = await snapshot(f); f.store.failNext = true
        await assert.rejects(join(), /audit11 synthetic persistence failure/)
        assert.deepEqual(await snapshot(f), before)
      }
      await join()
    }
    const matchId = await f.store.read(s => s.tournamentRuns[cup].rounds[round - 1].assignments[tableIndex].matchId)
    const views = await Promise.all(a.userIds.map(user => f.service.getMatchStatus(user, matchId)))
    for (const [index, view] of views.entries()) {
      const claims = f.verifier.inspect(view.gameTicket), format = formatForNewRoom({ entryKind: claims.roomKind, matchMode: claims.matchMode })
      assert.equal(claims.sub, a.userIds[index]); assert.equal(view.seat, seats[index])
      assert.equal(format.kind, 'independent'); assert.equal(format.levelMode, 'random')
      assert.equal(format.tributeEnabled, false); assert.equal(format.individualRanking, true)
    }
    tables.push({ assignment: a, matchId: views[0].matchId, roomId: views[0].roomId, views,
      userIdsBySeat: Object.fromEntries(a.userIds.map((user, index) => [seats[index], user])) })
  }
  return tables
}
const publicEvent = (f, table, sequence, details) => ({ eventId: `spectate:${table.matchId}:${sequence}`,
  matchId: table.matchId, roomId: table.roomId, sequence, roundSequence: 1, at: f.now(), ...details })
const start = async (f, table) => {
  const e = publicEvent(f, table, 1, { type: 'game-start' })
  await f.service.claimGameStart(e.eventId, e)
}
const end = async (f, table, ranking) => {
  const winnerTeam = ['p1', 'p3'].includes(ranking[0]) ? 'teamA' : 'teamB'
  const e = publicEvent(f, table, 2, { type: 'round-end', ranking, winnerTeam, isGameWon: true })
  await f.service.acceptSpectatorEvent(e.eventId, e)
  return { eventId: `game:${table.matchId}:1`, matchId: table.matchId, roomId: table.roomId,
    userIdsBySeat: table.userIdsBySeat, ranking, winnerTeam, finishedAt: f.now(), finalSpectatorSequence: 2 }
}
const f = fixture()
await Promise.all(userIds.map(user => enroll(f, user)))
for (const user of userIds.slice(0, 15)) await f.service.checkInTournament(user, cup)
const beforeLock = await snapshot(f); f.store.failNext = true
await assert.rejects(f.service.checkInTournament(userIds[15], cup), /audit11 synthetic persistence failure/)
assert.deepEqual(await snapshot(f), beforeLock)
await Promise.all(Array.from({ length: 8 }, () => f.service.checkInTournament(userIds[15], cup)))
assert.equal((await f.service.getTournamentState(userIds[15], cup)).checkedInCount, 16)
const expectedPoints = Object.fromEntries(userIds.map(u => [u, 0])), allEvents = []
let lastJoinFailures = 0, lastResultFailures = 0, ticketRenewals = 0, rehydrations = 0
for (let round = 1; round <= 3; round++) {
  const tables = await joinRound(f, round, true); lastJoinFailures++
  f.advance(1100)
  const original = tables[0].views[0], a = tables[0].assignment
  const renewed = await f.service.joinMatch(a.userIds[0], { mode, tournamentId: cup, assignmentId: a.assignmentId })
  assert.equal(renewed.matchId, original.matchId); assert.equal(renewed.entryAttemptId, original.entryAttemptId)
  assert.equal(renewed.seat, original.seat); assert.notEqual(renewed.gameTicket, original.gameTicket)
  f.verifier.inspect(renewed.gameTicket); ticketRenewals++
  for (const table of tables) await start(f, table)
  const resultOrder = orders[round * 5]
  for (let index = 0; index < 4; index++) {
    const table = tables[resultOrder[index]], ranking = orders[(round * 4 + index) % 24].map(i => seats[i])
    const result = await end(f, table, ranking)
    const before = await snapshot(f)
    if (index === 3) {
      f.store.failNext = true
      await assert.rejects(f.service.acceptGameResult(result.eventId, result), /audit11 synthetic persistence failure/)
      assert.deepEqual(await snapshot(f), before)
      lastResultFailures++
    }
    const attempts = await Promise.all(Array.from({ length: 12 }, () => f.service.acceptGameResult(result.eventId, result)))
    assert.equal(attempts.filter(x => !x.duplicate).length, 1)
    ranking.forEach((seat, place) => { expectedPoints[table.userIdsBySeat[seat]] += 3 - place })
    allEvents.push(result)
    if (index === 1) { const beforeRestart = await f.restart(); assert.deepEqual(await snapshot(f), beforeRestart); rehydrations++ }
    const view = await f.service.getTournamentState(userIds[0], cup)
    assert.equal(view.roundNumber, index < 3 ? round : Math.min(3, round + 1))
    assert.equal(view.phase, round === 3 && index === 3 ? 'finished' : 'round-active')
  }
}
const final = await snapshot(f)
assert.equal(Object.keys(final.tournamentPlayerRoundResults).length, 48)
assert.equal(Object.keys(final.gameResults).length, 12)
assert.equal(Object.keys(final.activeMatchByUser).length, 0)
assert.equal(final.tournaments[cup].status, 'finished')
for (const user of userIds) {
  const standing = final.tournamentStandings[`${cup}:${user}`]
  assert.equal(standing.played, 3); assert.equal(standing.points, expectedPoints[user])
  assert.equal(standing.opponents.length, 9); assert.equal(new Set(standing.opponents).size, 9)
  assert.equal(standing.opponentPoints, standing.opponents.reduce((sum, u) => sum + expectedPoints[u], 0))
  assert.equal(final.userStats[user].gamesPlayed, 3)
}
assert.equal(Object.values(final.tournamentStandings).filter(s => s.advanced).length, 8)
for (const event of allEvents) assert.equal((await f.service.acceptGameResult(event.eventId, event)).duplicate, true)
assert.deepEqual(await snapshot(f), final)
const withdrawal = fixture()
await enroll(withdrawal, userIds[0]); await withdrawal.service.checkInTournament(userIds[0], cup)
const beforeWithdrawal = await snapshot(withdrawal); withdrawal.store.failNext = true
await assert.rejects(withdrawal.service.withdrawTournament(userIds[0], cup, 'withdraw-one'), /audit11 synthetic persistence failure/)
assert.deepEqual(await snapshot(withdrawal), beforeWithdrawal)
assert.equal((await withdrawal.service.withdrawTournament(userIds[0], cup, 'withdraw-one')).viewerEntry.enrolled, false)
console.log(JSON.stringify({ tournamentProgress11: { rosterPermutations: 256, uniquePairsPerRoster: 72,
  roundCompletionOrderCases: 72, completionTransitions, finalCheckInFailureRecovery: true,
  repeatedLastCheckIns: 8, lastJoinFailures, lastResultFailures, ticketRenewals, rehydrations,
  realServiceTerminalFixtures: 12, resultAttemptsPerFixture: 12, persistedPlayerRoundRows: 48,
  finalQualifiedPlayers: 8, withdrawalFailureRecovery: true } }, null, 2))

// Multi-table teardown: the run is intentionally paused after the first abnormal
// table, but later tables still need independent release of their active seats.
const blockedClosures = []
for (let first = 0; first < 4; first++) {
  const b = fixture(); await checked(b)
  const tables = await joinRound(b, 1)
  for (const table of tables) await start(b, table)
  b.advance(60_000)
  const ordering = [first, ...[0, 1, 2, 3].filter(i => i !== first)]
  for (let position = 0; position < 4; position++) {
    const table = tables[ordering[position]], e = publicEvent(b, table, 2, { type: 'room-closed', reason: 'empty-timeout' })
    const before = await snapshot(b)
    if (position === 0) {
      assert.equal((await b.service.acceptSpectatorEvent(e.eventId, e)).accepted, true)
      assert.equal((await b.service.acceptSpectatorEvent(e.eventId, e)).duplicate, true)
    } else {
      // Confirmed behavior, deliberately asserting the defect for a repeatable audit.
      for (let retry = 0; retry < 2; retry++) {
        await assert.rejects(b.service.acceptSpectatorEvent(e.eventId, e), error => error.code === 'RUN_NOT_ACTIVE')
        assert.deepEqual(await snapshot(b), before, 'later table release rolls back with the blocked orchestrator')
      }
      const user = table.assignment.userIds[0]
      await assert.rejects(b.service.joinMatch(user, { mode: 'quick' }), error => error.code === 'ALREADY_MATCHING')
      await assert.rejects(b.service.cancelMatch(user, table.matchId), error => error.code === 'MATCH_NOT_CANCELLABLE')
    }
  }
  const beforeRestart = await b.restart()
  assert.deepEqual(await snapshot(b), beforeRestart)
  assert.equal(beforeRestart.tournamentRuns[cup].phase, 'blocked')
  assert.equal(beforeRestart.matches[tables[first].matchId].status, 'aborted')
  assert.equal(Object.keys(beforeRestart.activeMatchByUser).length, 12)
  const firstOther = tables[ordering[1]], e = publicEvent(b, firstOther, 2, { type: 'room-closed', reason: 'empty-timeout' })
  await assert.rejects(b.service.acceptSpectatorEvent(e.eventId, e), error => error.code === 'RUN_NOT_ACTIVE')
  assert.deepEqual(await snapshot(b), beforeRestart)
  // The first-closed table's users are free; the other 12 are not.
  assert.equal((await b.service.joinMatch(tables[first].assignment.userIds[0], { mode: 'quick' })).status, 'matching')
  blockedClosures.push({ firstClosedTable: first + 1, acceptedClosures: 1, rejectedClosures: 3,
    staleActiveUsers: 12, retriesAndRehydrationStillRejected: true })
}
console.log(JSON.stringify({ tournamentClosure11: blockedClosures }, null, 2))
