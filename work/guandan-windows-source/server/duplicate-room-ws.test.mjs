import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FriendRoomService } from './platform/friend-room-service.js'
import { SpectatorEventService } from './platform/spectator-event-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './platform/storage.js'
import { GameTicketService, spectatorEventSignature, gameResultSignature } from './platform/crypto.js'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'

const secret = 'duplicate-ws-test-signing-secret-thirty-two-characters'
const port = 39139, roomId = '804262', temp = mkdtempSync(join(tmpdir(), 'duplicate-ws-'))
const initial = createEmptyPlatformState()
for (let i = 0; i < 10; i++) initial.users[`user${i}`] = { id: `user${i}` }
const store = new MemoryPlatformStore(initial)
const tickets = new GameTicketService({ secret, gameEndpoint: `ws://127.0.0.1:${port}/weapp` })
const service = new FriendRoomService({ store, gameTickets: tickets, now: Date.now, createId: () => 'duplicate-ws',
  createInviteCode: () => 'D'.repeat(24), createRoomId: () => roomId, friendRoomTtlMs: 600000 })
const events = new SpectatorEventService({ store, now: Date.now, markMatchPlaying: (_state, m, at) => { m.status = 'playing'; m.startedAt ||= at },
  cancelExpiredFriendRoom: () => false, cancelExpiredUnstartedMatch: () => false, activeFriendTickets: () => [] })
const collector = createServer((req, res) => {
  const chunks = []; req.on('data', b => chunks.push(b)); req.on('end', async () => {
    try {
      const raw = Buffer.concat(chunks).toString(), e = JSON.parse(raw)
      assert.equal(req.headers['x-spectator-signature'], spectatorEventSignature(raw, secret, String(req.headers['x-spectator-timestamp'])))
      assert.equal(req.headers['x-game-signature'], gameResultSignature(raw, secret, String(req.headers['x-game-timestamp'])))
      const result = await events.accept(e.eventId, e)
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, data: { event: result }, error: null }))
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: { message: e.message } })) }
  })
})
await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve))
const child = spawn(process.execPath, ['server/weapp-ws.js'], { env: { ...process.env, NODE_ENV: 'test', WEAPP_WS_PORT: String(port),
  WEAPP_ROOM_STATE_FILE: join(temp, 'rooms.json'), GAME_TICKET_REQUIRED: 'true', GAME_TICKET_SECRET: secret,
  GAME_RESULT_SECRET: secret, GAME_SPECTATOR_EVENT_SECRET: secret,
  GAME_SPECTATOR_EVENT_ENDPOINT: `http://127.0.0.1:${collector.address().port}/api/v1/game/spectator-events` }, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''; child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b })
const sockets = []; let sequence = 0
const delay = ms => new Promise(r => setTimeout(r, ms))
const connect = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
      socket.packets = []; socket.addEventListener('message', e => socket.packets.push(JSON.parse(e.data)))
      sockets.push(socket); return socket
    } catch { await delay(50) }
  }
  throw new Error(`WS did not launch: ${logs}`)
}
const until = async predicate => { for (let i = 0; i < 160; i++) { const v = predicate(); if (v) return v; await delay(25) } throw new Error(`WS assertion timed out: ${logs}`) }
const command = async (s, type, payload = {}, allowError = false) => {
  const id = ++sequence; sendProtocolCommand(s, type, { roomId, ...payload }, id)
  const reply = await until(() => s.packets.find(p => p.requestId === id))
  if (!allowError) assert.notEqual(reply.type, 'error', `${type}: ${reply.message}`)
  return reply
}
try {
  const entry = await service.create('user0', { entryAttemptId: 'duplicate-host-create-0001', roomSettings: { format: 'duplicate', rounds: 2, levelMode: 'random' } })
  const entries = [entry]
  for (let i = 1; i < 8; i++) entries.push(await service.joinByNumber(`user${i}`, { roomId, entryAttemptId: `duplicate-guest-join-0000${i}` }))
  assert.deepEqual(entries.map(e => e.seat), ['p1', 'p2', 'p3', 'p4', 'p1', 'p2', 'p3', 'p4'])
  assert.ok(entries.slice(1).every(e => !e.isRoomHost))
  await assert.rejects(service.joinByNumber('user8', { roomId, entryAttemptId: 'duplicate-ninth-join-0001' }), /已满/)
  const responses = []
  for (const [i, e] of entries.entries()) {
    const socket = await connect()
    responses.push(await command(socket, i ? 'joinRoom' : 'createRoom', { gameTicket: e.gameTicket, entryAttemptId: e.entryAttemptId, hostName: `联机玩家${i}` }))
  }
  assert.equal(responses[7].duplicate.slots.filter(s => s.occupied).length, 8)
  assert.equal(responses[7].duplicate.mySeat, 'p8')
  await Promise.all(sockets.map(s => command(s, 'setLobbyReady')))
  await command(sockets[0], 'startGame')
  await until(() => sockets.every(s => s.packets.some(p => p.state?.phase === 'playing')))
  const states = sockets.map(s => s.packets.find(p => p.state?.phase === 'playing'))
  for (let i = 0; i < 4; i++) {
    const seat = `p${i + 1}`
    assert.deepEqual(states[i].state.players[seat].hand, states[i + 4].state.players[seat].hand)
    assert.ok(Object.entries(states[i].state.players).filter(([id]) => id !== seat).every(([, p]) => p.hand.every(c => c.id.startsWith('hidden-'))))
  }
  assert.equal((await command(sockets[0], 'watchTable', { table: 'B' }, true)).type, 'error')
  const committed = await store.read(s => s.matches[entry.matchId])
  assert.equal(committed.status, 'playing'); assert.equal(committed.participants.length, 8)
  sockets[7].close(); await delay(200)
  const recovered = await connect()
  const resumed = await command(recovered, 'rejoinRoom', { resumeToken: responses[7].resumeToken })
  assert.equal(resumed.duplicate.mySeat, 'p8'); assert.equal(resumed.myPlayerId, 'p4')
  const terminal = { eventId: `spectate:${entry.matchId}:2`, matchId: entry.matchId, roomId, sequence: 2, roundSequence: 2, at: Date.now(),
    type: 'match-ended', roundsPlayed: 2, reason: 'round-limit', endedAt: Date.now(), scores: { teamA: 7, teamB: 3 }, winnerTeam: 'teamA' }
  await events.accept(terminal.eventId, terminal)
  assert.equal((await events.accept(terminal.eventId, terminal)).duplicate, true)
  assert.equal(await store.read(s => s.matches[entry.matchId].status), 'completed')
  console.log('Duplicate WS + platform passed: eight signed admissions, native/numeric join contract, signed roster, same hands, privacy, reconnect and aggregate result idempotency')
} finally {
  sockets.forEach(s => s.close()); child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), delay(2000).then(() => child.kill('SIGKILL'))])
  await new Promise(resolve => collector.close(resolve)); rmSync(temp, { recursive: true, force: true })
}
