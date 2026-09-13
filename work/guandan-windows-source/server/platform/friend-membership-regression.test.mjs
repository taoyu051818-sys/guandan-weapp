import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { buildGameResultEvent } from '../game-stats.js'
import { SpectatorEventReporter } from './spectator-event-reporter.js'
import { JsonSpectatorOutboxStore } from './spectator-outbox-store.js'
import { normalizeSpectatorEvent, validateSpectatorEventMatchTime } from './spectator-domain.js'
import { lifecycleFixture, createLifecycleFriendRoom, lifecycleSeats as seats,
  activeParticipant, lifecycleTestSecret } from './platform-lifecycle-test-fixture.mjs'
const core = createRequire(import.meta.url)('../../../../shared-core/dist')

for (const format of ['classic', 'duplicate']) for (const byNumber of [false, true]) for (const playing of [false, true]) {
  test(`PF-06-001: ${format}/${byNumber ? 'number' : 'invite'}/${playing ? 'playing' : 'lobby'} returning member capacity`, async () => {
    const f = lifecycleFixture(), room = await createLifecycleFriendRoom(f, format === 'duplicate' ? { format, rounds: 2 } : {})
    await room.join(1, 1, byNumber); await room.leave(1)
    await assert.rejects(room.join(1, 1, byNumber), e => e.code === 'FRIEND_ENTRY_ATTEMPT_REVOKED')
    for (let i = 2; i <= 12; i++) await room.join(i, 1, byNumber)
    if (playing) await room.start()
    const before = await f.snapshot(), issued = f.issued
    await assert.rejects(room.join(1, 2, byNumber), e => e.code === 'FRIEND_ROOM_FULL')
    await assert.rejects(room.join(13, 1, byNumber), e => e.code === 'FRIEND_ROOM_FULL')
    assert.deepEqual(await f.snapshot(), before, 'no ticket, entry receipt, historical mutation or active index may commit')
    assert.equal(f.issued, issued, 'capacity must be checked before ticket issuance')
    assert.equal((await room.join(12, 1, byNumber)).matchId, room.host.matchId, 'active retry remains allowed at capacity')
    assert.equal((await f.service.recoverActiveFriendRoom('u12', { recoveryAttemptId: 'lifecycle-recovery-000001' })).matchId, room.host.matchId)
    await room.leave(12)
    assert.equal((await room.join(1, 2, byNumber)).seat, 'observer', 'a released slot admits the old member once')
    assert.equal((await f.snapshot()).matches[room.host.matchId].participants.filter(activeParticipant).length, 12)
  })
}

const terminalGame = () => {
  const players = Object.fromEntries(seats.map((id, i) => [id, { id, name: id, team: i % 2 ? 'teamB' : 'teamA',
    hand: [{ id: `card-${id}`, rank: [8, 9, 10, 'J'][i], suit: 'spade', value: 8 + i, isLevelCard: false }] }]))
  let game = core.createMatchState({ players, ruleProfile: core.getRuleProfile('classic'), currentLevel: 6,
    levelTeam: 'teamA', dealerId: 'p1', teamLevels: { teamA: 6, teamB: 6 },
    matchFormat: { kind: 'upgrade', upgradeTarget: 6, levelMode: 'fixed', levelRank: 2, tributeEnabled: true, doubleDown: 3 } })
  for (const id of ['p1', 'p2', 'p3']) {
    const next = core.transition(game, { type: 'PLAY_CARDS', playerId: id, cardIds: [`card-${id}`], roundId: game.roundId, expectedRevision: game.revision })
    assert.equal(next.ok, true); game = next.state
  }
  assert.equal(game.settlement.isGameWon, true)
  return game.settlement
}
for (const reverse of [false, true]) for (const bot of [false, true]) {
  test(`PR-08-001: historical seat reuse ${reverse ? 'reversed' : 'original'} order, bot=${bot}`, async () => {
    const f = lifecycleFixture(), room = await createLifecycleFriendRoom(f, { format: 'upgrade', upgradeTarget: 6 })
    await room.join(1); await room.leave(1); await room.join(4); await room.leave(4)
    await room.join(1, 2); await room.join(2); await room.join(3)
    const roster = { p1: 'u0', p2: 'u1', p3: 'u2', p4: 'u3' }
    if (bot) { await room.leave(3); roster.p4 = 'friendbot_333333333333333333333333' }
    await room.accept({ type: 'game-start', friendRoster: roster })
    if (reverse) await f.store.transaction(s => { s.matches[room.host.matchId].participants.reverse() })
    const settlement = terminalGame()
    await room.accept({ type: 'round-end', ranking: settlement.fullRank, winnerTeam: settlement.winnerTeam, isGameWon: true })
    const snapshot = await f.snapshot()
    const report = buildGameResultEvent({ roomId: room.host.roomId, matchId: room.host.matchId,
      roundSequence: 1, spectatorSequence: snapshot.spectatorFeeds[room.host.matchId].events.at(-1).sequence,
      userIdsBySeat: roster }, settlement, f.now())
    f.store.failNext = true
    await assert.rejects(f.service.acceptGameResult(report.eventId, report), /synthetic persist failure/)
    assert.deepEqual(await f.snapshot(), snapshot, 'failed persistence cannot partially credit or alter history')
    const results = await Promise.all(Array.from({ length: 6 }, () => f.service.acceptGameResult(report.eventId, report)))
    assert.equal(results.filter(r => !r.duplicate).length, 1)
    await f.restart()
    assert.equal((await f.service.acceptGameResult(report.eventId, report)).duplicate, true)
    const after = await f.snapshot()
    for (const id of Object.values(roster).filter(id => !id.startsWith('friendbot_'))) assert.equal(after.userStats[id].gamesPlayed, 1)
    assert.equal(after.userStats.u4, undefined)
    assert.equal(after.matches[room.host.matchId].participants.find(p => p.userId === 'u4').status, 'cancelled')
    assert.equal(after.matches[room.host.matchId].participants.length, snapshot.matches[room.host.matchId].participants.length)
    if (bot) assert.equal(after.userStats[roster.p4], undefined)
    const second = { ...report, eventId: `${report.eventId}-second` }
    await assert.rejects(f.service.acceptGameResult(second.eventId, second), e => e.code === 'MATCH_ALREADY_SETTLED')
    assert.deepEqual(await f.snapshot(), after)
  })
}

test('PR-08-001: ambiguous current seats cannot be resolved by participant array order', async () => {
  const f = lifecycleFixture(), room = await createLifecycleFriendRoom(f, { format: 'upgrade' })
  for (let i = 1; i <= 4; i++) await room.join(i)
  const roster = await room.start()
  await f.store.transaction(s => { s.matches[room.host.matchId].participants.find(p => p.userId === 'u4').seat = 'p2' })
  const before = await f.snapshot()
  const event = { eventId: 'ambiguous-result', matchId: room.host.matchId, roomId: room.host.roomId,
    userIdsBySeat: { ...roster, p2: 'u4' }, ranking: seats, winnerTeam: 'teamA', finishedAt: f.now() }
  await assert.rejects(f.service.acceptGameResult(event.eventId, event), /席位/)
  assert.deepEqual(await f.snapshot(), before)
})

for (const offset of [299999, 300000, 300001, 24 * 60 * 60 * 1000]) {
  test(`PS-08-001: observer exit at lease + ${offset} drains ordered public events`, async () => {
    const f = lifecycleFixture(), room = await createLifecycleFriendRoom(f)
    for (let i = 1; i <= 4; i++) await room.join(i)
    await room.start(); f.setTime(room.host.roomExpiresAt + offset)
    const left = room.event({ type: 'seat-left', playerId: 'observer', userId: 'u4', reason: 'left' })
    const play = room.event({ type: 'play', playerId: 'p1', cards: [{ rank: 8, suit: 'spade' }], playType: 'Single', automatic: false })
    const before = await f.snapshot()
    for (const illegal of [{ ...left, playerId: 'p1', userId: 'u0' }, { ...left, userId: 'u0' }, { ...left, userId: 'u15' }]) {
      await assert.rejects(f.service.acceptSpectatorEvent(illegal.eventId, illegal))
      assert.deepEqual(await f.snapshot(), before)
    }
    await f.restart()
    const outbox = new JsonSpectatorOutboxStore(), sent = []
    const reporter = new SpectatorEventReporter({ endpoint: 'https://synthetic.invalid/unused', secret: lifecycleTestSecret,
      lifecycleSecret: lifecycleTestSecret, outbox, now: f.now, maxAttempts: 1, fetchImpl: async (_url, options) => {
        const event = JSON.parse(options.body); sent.push(event.type)
        const ack = await f.service.acceptSpectatorEvent(event.eventId, event)
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { event: ack } }) }
      } })
    const timer = setTimeout(() => reporter.stop(room.host.matchId, new Error('test delivery timeout')), 1000)
    try {
      const receipts = await Promise.all([reporter.stage(left), reporter.stage(play)])
      assert.ok(receipts.every(receipt => !receipt.duplicate), 'both first deliveries must be accepted after restoring the live match')
      assert.deepEqual(sent, ['seat-left', 'play']); assert.deepEqual(outbox.pending(), [])
    } finally { clearTimeout(timer); reporter.stop(room.host.matchId) }
    assert.equal((await f.service.acceptSpectatorEvent(left.eventId, left)).duplicate, true)
    await f.restart()
    assert.equal((await f.service.acceptSpectatorEvent(left.eventId, left)).duplicate, true)
    const after = await f.snapshot()
    assert.equal(after.matches[room.host.matchId].participants.find(p => p.userId === 'u4').status, 'cancelled')
    assert.equal(after.activeMatchByUser.u4, undefined)
    assert.deepEqual(after.spectatorFeeds[room.host.matchId].events.map(e => e.type), ['game-start', 'seat-left', 'play'])
  })
}

test('PS-08-001: lobby lease and match-start/future clock fences remain enforced', () => {
  const match = { kind: 'friend-room', status: 'matching', createdAt: 1000000, friendRoomExpiresAt: 2000000 }
  const left = { type: 'seat-left', playerId: 'observer', at: 2300000 }
  assert.doesNotThrow(() => validateSpectatorEventMatchTime(left, match))
  assert.throws(() => validateSpectatorEventMatchTime({ ...left, at: left.at + 1 }, match), e => e.code === 'FRIEND_SEAT_EVENT_AFTER_LEASE')
  assert.throws(() => validateSpectatorEventMatchTime({ ...left, at: 2699999 }, { ...match, status: 'playing', startedAt: 3000000 }), e => e.code === 'SPECTATOR_EVENT_BEFORE_MATCH')
  const event = { ...left, eventId: 'spectate:clock-test:1', matchId: 'clock-test', roomId: '123456', sequence: 1,
    roundSequence: 1, userId: 'u1', reason: 'left', at: 3060001 }
  assert.throws(() => normalizeSpectatorEvent(event.eventId, event, 3000000), e => e.code === 'INVALID_SPECTATOR_TIME')
})
