import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { GameTicketService, GameTicketVerifier } from './platform/crypto.js'
import { DuplicateRoomRuntime } from './duplicate-room-runtime.js'
import { DUPLICATE_SEATS, TABLE_SEATS, tableOf, localSeat, occupant } from './duplicate-room-model.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { duplicateSnapshot, captureDuplicateObservers } from './duplicate-room-projection.js'
import { duplicateEntry } from './duplicate-room-admission.js'
const { representativeLegalMoves } = createRequire(import.meta.url)('../../../shared-core/dist')
const temp = mkdtempSync(join(tmpdir(), 'guandan-duplicate-'))
const secret = 'duplicate-test-secret-at-least-thirty-two-characters'
const tickets = new GameTicketService({ secret, gameEndpoint: 'ws://127.0.0.1:3003/weapp' })
const connections = new Map(DUPLICATE_SEATS.map((s, i) => [s, { id: s, packets: [], acceptingCommands: true }]))
const events = []; let seed = 32451; let id = 0
const opts = { connections, send: (c, type, p) => c.packets.push({ type, ...p }), verifier: new GameTicketVerifier({ secret, required: true }),
  reporter: { configured: true, claimStart: async e => { events.push(e) }, enqueue: async e => { events.push(e) } },
  filePath: join(temp, 'rooms.json'), random: () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) }
let runtime = new DuplicateRoomRuntime(opts); clearInterval(runtime.timer)
const roomId = '904262'; const settings = normalizeFriendRoomSettings({ format: 'duplicate', rounds: 2, levelMode: 'random' })
const cmd = async (c, type, p = {}, requestId = ++id, allowError = false) => {
  const message = { type, requestId, payload: { roomId, ...p } }
  await runtime.handle(c, message)
  const reply = c.packets.filter(p => p.requestId === requestId).at(-1)
  assert.ok(reply, type); if (!allowError) assert.notEqual(reply.type, 'error', `${type}: ${reply.message}`)
  return reply
}
const latest = c => c.packets.filter(p => p.state).at(-1)
const ownMember = c => runtime.rooms.get(roomId).members.find(m => m.connectionId === c.id)
try {
  for (const seat of DUPLICATE_SEATS) {
    const issued = tickets.issue({ userId: `user_${seat}`, matchId: 'mat_duplicate_test', roomId, seat, roomKind: 'friend', roomSettings: settings,
      roomExpiresAt: Date.now() + 600000, hostUserId: 'user_p1' })
    // Shared signed lease is identical for all eight members.
    if (seat === 'p1') opts.expiresAt = issued.claims.roomExpiresAt
    const ticket = tickets.issue({ ...issued.claims, userId: issued.claims.sub, roomExpiresAt: opts.expiresAt })
    await cmd(connections.get(seat), seat === 'p1' ? 'createRoom' : 'joinRoom', { gameTicket: ticket.gameTicket, entryAttemptId: ticket.claims.entryAttemptId, hostName: `牌友${seat}` })
  }
  const host = connections.get('p1')
  assert.equal(runtime.rooms.get(roomId).members.length, 8)
  const withdrawn = structuredClone(runtime.rooms.get(roomId))
  Object.assign(withdrawn.members.find(m => m.userId === 'user_p8'), { left: true, seat: null, connectionId: null })
  const unused = tickets.issue({ userId: 'user_p8', matchId: withdrawn.matchId, roomId, seat: 'p8', roomKind: 'friend', roomSettings: settings,
    roomExpiresAt: opts.expiresAt, hostUserId: 'user_p1' })
  const replay = { type: 'joinRoom', requestId: 1, payload: { roomId, gameTicket: unused.gameTicket, entryAttemptId: unused.claims.entryAttemptId } }
  withdrawn.events.push({ type: 'seat-left', userId: 'user_p8' })
  assert.throws(() => duplicateEntry(withdrawn, { id: 'old-credential' }, replay, opts.verifier, Date.now()), /释放确认中/)
  withdrawn.events = []; withdrawn.usedTickets.push(unused.claims.jti)
  assert.throws(() => duplicateEntry(withdrawn, { id: 'old-credential' }, replay, opts.verifier, Date.now()), /撤销/)
  assert.equal((await cmd(host, 'startGame', {}, ++id, true)).type, 'error')
  await cmd(connections.get('p8'), 'standUp')
  await cmd(connections.get('p2'), 'sitDown', { duplicateSeat: 'p8' })
  await cmd(connections.get('p8'), 'sitDown', { duplicateSeat: 'p2' })
  for (const c of connections.values()) await cmd(c, 'setLobbyReady')
  await cmd(host, 'startGame')
  const delayed = structuredClone(runtime.rooms.get(roomId))
  delayed.settings.spectator = 'delay-15'
  const watcher = { userId: 'watcher', seat: null, watch: 'A' }
  captureDuplicateObservers(delayed, 100000)
  delayed.scores.red = 6; delayed.phase = 'ended'; delayed.completedRounds = 1
  captureDuplicateObservers(delayed, 101000)
  assert.equal(duplicateSnapshot(delayed, watcher, 114999).state, null)
  const behind = duplicateSnapshot(delayed, watcher, 115000)
  assert.equal(behind.duplicate.scores.red, 0); assert.equal(behind.matchEnded, null)
  assert.equal(duplicateSnapshot(delayed, watcher, 116000).matchEnded.scores.teamA, 6)
  const beforeFailure = JSON.stringify(runtime.rooms.get(roomId))
  const save = runtime.store.save.bind(runtime.store)
  runtime.store.save = async () => { throw new Error('injected disk failure') }
  assert.equal((await cmd(host, 'setTrustee', {}, ++id, true)).type, 'error')
  assert.equal(JSON.stringify(runtime.rooms.get(roomId)), beforeFailure, 'failed persistence cannot mutate the live table')
  runtime.store.save = save
  assert.equal(events[0].type, 'game-start'); assert.equal(Object.keys(events[0].friendRoster).length, 8)
  for (let round = 1; round <= 2; round++) {
    const r = runtime.rooms.get(roomId)
    assert.equal(r.tables.A.state.currentLevel, r.tables.B.state.currentLevel)
    assert.equal(r.tables.A.state.currentTurn, TABLE_SEATS[round - 1])
    assert.equal(r.tables.A.state.currentTurn, r.tables.B.state.currentTurn)
    for (const s of TABLE_SEATS) assert.deepEqual(r.tables.A.state.players[s].hand, r.tables.B.state.players[s].hand)
    assert.equal((await cmd(host, 'watchTable', { table: 'B' }, ++id, true)).type, 'error', 'cannot view sibling table before own table is over')
    for (const tableName of ['A', 'B']) {
      for (let turn = 0; runtime.rooms.get(roomId).tables[tableName].state.phase !== 'settled'; turn++) {
        assert.ok(turn < 800)
        const room = runtime.rooms.get(roomId), table = room.tables[tableName], state = table.state
        const global = `p${Number(state.currentTurn.slice(1)) + (tableName === 'B' ? 4 : 0)}`
        const member = occupant(room, global), c = connections.get(member.connectionId)
        const moves = representativeLegalMoves(state.players[state.currentTurn].hand, state.lastValidPlay, state.ruleProfile)
        const move = moves.sort((a, b) => b.length - a.length)[0]
        const p = { cardIds: move?.map(c => c.id), expectedVersion: state.revision }
        const request = ++id; await cmd(c, move ? 'play' : 'pass', p, request)
        if (turn === 0) { const revision = runtime.rooms.get(roomId).tables[tableName].state.revision; await cmd(c, move ? 'play' : 'pass', p, request); assert.equal(runtime.rooms.get(roomId).tables[tableName].state.revision, revision) }
      }
      if (tableName === 'A') {
        assert.equal(runtime.rooms.get(roomId).completedRounds, round - 1, 'fast table cannot cross the barrier or score early')
        await cmd(host, 'watchTable', { table: 'B' }); assert.equal(latest(host).roomRole, 'observer')
        assert.equal((await cmd(host, 'pass', {}, ++id, true)).type, 'error')
        await cmd(host, 'watchTable', { table: null })
      }
    }
    assert.equal(runtime.rooms.get(roomId).completedRounds, round)
    if (round === 1) {
      const tokens = new Map([...connections.values()].map(c => [c.id, ownMember(c).token]))
      await runtime.dispose(); runtime = new DuplicateRoomRuntime(opts); clearInterval(runtime.timer)
      for (const c of connections.values()) { c.duplicateViewKey = null; await cmd(c, 'rejoinRoom', { resumeToken: tokens.get(c.id) }); await cmd(c, 'cancelTrustee') }
      for (const c of connections.values()) await cmd(c, 'readyNextRound')
    }
  }
  const final = runtime.rooms.get(roomId)
  assert.equal(final.phase, 'ended'); assert.equal(final.history.length, 2)
  assert.equal(final.scores.red, final.history.reduce((sum, row) => sum + row.red, 0))
  assert.equal(final.scores.blue, final.history.reduce((sum, row) => sum + row.blue, 0))
  for (const c of connections.values()) {
    const own = localSeat(ownMember(c).seat)
    const first = c.packets.find(p => p.state?.phase === 'playing' && p.roomRole === 'player')
    assert.ok(TABLE_SEATS.filter(s => s !== own).every(s => first.state.players[s].hand.every(card => card.id.startsWith('hidden-'))))
    assert.ok(!JSON.stringify(first.duplicate).includes('hand'))
  }
  await cmd(host, 'safeExit')
  const botRoomId = '904263'
  const fixed = normalizeFriendRoomSettings({ format: 'duplicate', rounds: 2, levelMode: 'fixed', levelRank: 2 })
  const botTicket = tickets.issue({ userId: 'bot-host', matchId: 'mat_duplicate_bots', roomId: botRoomId, seat: 'p1', roomKind: 'friend',
    roomSettings: fixed, roomExpiresAt: opts.expiresAt, hostUserId: 'bot-host' })
  await cmd(host, 'createRoom', { roomId: botRoomId, gameTicket: botTicket.gameTicket, entryAttemptId: botTicket.claims.entryAttemptId })
  await cmd(host, 'fillBots', { roomId: botRoomId }); await cmd(host, 'setLobbyReady', { roomId: botRoomId }); await cmd(host, 'startGame', { roomId: botRoomId })
  const bots = runtime.rooms.get(botRoomId)
  assert.equal(bots.members.filter(m => m.bot).length, 7)
  for (const table of Object.values(bots.tables)) {
    const start = table.deadlineAt - bots.settings.turnSeconds * 1000
    assert.ok(table.botWakeAt - start >= 500 && table.botWakeAt - start <= 1500, 'duplicate table persists the same ordinary bot pacing range')
  }
  assert.equal(bots.tables.A.state.currentLevel, 2); assert.equal(bots.tables.B.state.currentLevel, 2)
  await cmd(host, 'setTrustee', { roomId: botRoomId }); await runtime.tick()
  assert.ok(runtime.rooms.get(botRoomId).tables.A.state.revision > bots.tables.A.state.revision)
  console.log('Duplicate runtime passed: 8 seats, bots, rearrangement, equal decks, shared levels/leader, both-table barrier, scoring, idempotency, restart and private projections')
} finally { await runtime.dispose(); rmSync(temp, { recursive: true, force: true }) }
