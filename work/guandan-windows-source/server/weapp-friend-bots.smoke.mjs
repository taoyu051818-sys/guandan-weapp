import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FriendRoomService } from './platform/friend-room-service.js'
import { SpectatorEventService } from './platform/spectator-event-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './platform/storage.js'
import { GameTicketService, spectatorEventSignature } from './platform/crypto.js'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'

const secret = 'friend-bot-integration-test-secret-32-characters'
const port = 39143, temp = mkdtempSync(join(tmpdir(), 'friend-bots-')), file = join(temp, 'rooms.json')
const initial = createEmptyPlatformState()
initial.users.host = { id: 'host' }; initial.users.guest = { id: 'guest' }
const store = new MemoryPlatformStore(initial)
let nextRoom = 819200, nextMatch = 0, sequence = 0, child, logs = ''
const sockets = [], delay = ms => new Promise(r => setTimeout(r, ms))
const tickets = new GameTicketService({ secret, gameEndpoint: `ws://127.0.0.1:${port}/weapp` })
const service = new FriendRoomService({ store, gameTickets: tickets, createId: () => `friend-bots-${++nextMatch}`,
  createInviteCode: () => `friend-bots-invite-${nextMatch}`.padEnd(24, 'x'), createRoomId: () => String(++nextRoom) })
const events = new SpectatorEventService({ store, now: Date.now, markMatchPlaying: (_s, m, at) => {
  assert.equal(m.status, 'matched'); m.status = 'playing'; m.startedAt = at
  m.participants.forEach(p => { p.status = 'playing' })
}, cancelExpiredFriendRoom: () => false, cancelExpiredUnstartedMatch: () => false, activeFriendTickets: () => [] })
const collector = createServer((req, res) => {
  const chunks = []; req.on('data', b => chunks.push(b)); req.on('end', async () => {
    try {
      const raw = Buffer.concat(chunks).toString(), e = JSON.parse(raw)
      assert.equal(req.headers['x-spectator-signature'], spectatorEventSignature(raw, secret, String(req.headers['x-spectator-timestamp'])))
      const result = await events.accept(e.eventId, e)
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, data: { event: result }, error: null }))
    } catch (e) { logs += `\ncollector: ${e.stack}`; res.writeHead(400); res.end(JSON.stringify({ ok: false, error: { message: e.message } })) }
  })
})
await new Promise(r => collector.listen(0, '127.0.0.1', r))
const launch = () => {
  child = spawn(process.execPath, ['server/weapp-ws.js'], { env: { ...process.env, NODE_ENV: 'test', WEAPP_WS_PORT: String(port),
    WEAPP_ROOM_STATE_FILE: file, GAME_TICKET_REQUIRED: 'true', GAME_TICKET_SECRET: secret, GAME_RESULT_SECRET: secret,
    GAME_SPECTATOR_EVENT_SECRET: secret, WEAPP_BOT_ACTION_DELAY_MS: '10', WEAPP_FRIEND_SECOND_MS: '1',
    WEAPP_TEST_RANDOM_SEED: '0x88776655',
    GAME_SPECTATOR_EVENT_ENDPOINT: `http://127.0.0.1:${collector.address().port}/api/v1/game/spectator-events` }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b })
}
const stop = async () => { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done } }
const until = async (predicate, ms = 10000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(20) }
  throw new Error(`Timeout: ${predicate}\n${logs.slice(-5000)}`)
}
const connect = async () => {
  let socket
  await until(async () => {
    socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
    return new Promise(r => { socket.addEventListener('open', () => r(true), { once: true }); socket.addEventListener('error', () => r(false), { once: true }) })
  })
  socket.packets = []; socket.addEventListener('message', e => socket.packets.push(JSON.parse(e.data))); sockets.push(socket); return socket
}
const command = async (s, roomId, type, payload = {}, allowError = false) => {
  const id = ++sequence; sendProtocolCommand(s, type, { roomId, ...payload }, id)
  const response = await until(() => s.packets.find(p => p.requestId === id))
  if (!allowError) assert.notEqual(response.type, 'error', `${type}: ${response.message}`)
  return response
}
const roomSaved = id => { try { return JSON.parse(readFileSync(file, 'utf8')).rooms.find(r => r.roomId === id) } catch { return null } }
try {
  launch()
  for (const [format, spectator] of [['rounds', 'off'], ['rotating', 'live']]) {
    const entry = await service.create('host', { entryAttemptId: `friend-bots-${format}-create-0001`,
      roomSettings: { format, rounds: 1, spectator, ...(format === 'rotating' ? { teamRotation: 'clockwise', rotatingScoring: 6 } : {}), turnSeconds: 15, trusteeSeconds: 15 } })
    const roomId = entry.roomId
    let host = await connect()
    const created = await command(host, roomId, 'createRoom', { gameTicket: entry.gameTicket, entryAttemptId: entry.entryAttemptId })
    assert.equal(created.capabilities.canUseBots, true)
    const guestEntry = await service.joinByNumber('guest', { roomId, entryAttemptId: `friend-bots-${format}-guest-0001` })
    let guest = await connect()
    const joined = await command(guest, roomId, 'joinRoom', { gameTicket: guestEntry.gameTicket, entryAttemptId: guestEntry.entryAttemptId })
    assert.equal((await command(guest, roomId, 'addBot', { playerId: 'p3' }, true)).type, 'error')
    guest.close(); await delay(100)
    assert.match((await command(host, roomId, 'addBot', { playerId: 'p2' }, true)).message, /已有玩家/)
    guest = await connect()
    await command(guest, roomId, 'rejoinRoom', { resumeToken: joined.resumeToken, myPlayerId: 'p2' })
    await command(guest, roomId, 'safeExit')
    await until(async () => (await store.read(s => s.matches[entry.matchId].participants.find(p => p.userId === 'guest'))).status === 'cancelled')
    for (const id of ['p2', 'p3', 'p4']) await command(host, roomId, 'addBot', { playerId: id })
    assert.equal((await command(host, roomId, 'addBot', { playerId: 'p4' }, true)).type, 'error')
    await command(host, roomId, 'removeBot', { playerId: 'p4' })
    await command(host, roomId, 'addBot', { playerId: 'p4' })
    const saved = await until(() => { const r = roomSaved(roomId); return r?.botPlayerIds.length === 3 && r })
    const botIds = { ...saved.botUserIdsBySeat }
    assert.ok(Object.values(botIds).every(id => /^friendbot_[a-f0-9]{24}$/.test(id)))
    assert.equal(new Set(Object.values(botIds)).size, 3)
    await stop(); launch(); host = await connect()
    const restored = await command(host, roomId, 'rejoinRoom', { resumeToken: created.resumeToken, myPlayerId: 'p1' })
    assert.deepEqual(restored.botPlayerIds, ['p2', 'p3', 'p4'])
    assert.deepEqual(roomSaved(roomId).botUserIdsBySeat, botIds)
    await command(host, roomId, 'setLobbyReady')
    await command(host, roomId, 'startGame')
    await until(() => host.packets.some(p => p.state?.phase === 'playing'))
    const committed = await store.read(s => s.matches[entry.matchId])
    assert.equal(committed.status, 'playing'); assert.equal(committed.participants.filter(p => p.isBot).length, 3)
    assert.equal((await command(host, roomId, 'removeBot', { playerId: 'p4' }, true)).type, 'error')
    await command(host, roomId, 'setTrustee')
    await until(async () => (await store.read(s => s.matches[entry.matchId])).status === 'completed', 120000)
    const completed = await store.read(s => s)
    assert.deepEqual(Object.keys(completed.users), ['host', 'guest'])
    assert.deepEqual(Object.keys(completed.wallets).sort(), ['guest', 'host'], 'only human accounts acquire wallets')
    assert.equal(completed.activeMatchByUser.host, undefined)
    assert.equal(completed.matches[entry.matchId].friendMatchEnd.roundsPlayed, 1)
    host.close()
  }
  console.log('Signed friend bots passed: per-seat add/remove, host-only, offline reservation, durable identity, restart, classic/rotating start and complete settlement without bot accounts')
} finally {
  sockets.forEach(s => s.close()); await stop(); collector.closeAllConnections(); await new Promise(r => collector.close(r)); rmSync(temp, { recursive: true, force: true })
}
