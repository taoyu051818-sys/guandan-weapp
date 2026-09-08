import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { GameTicketService } from './platform/crypto.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'
import { checkObserverBrowser } from './weapp-friend-observer.browser-smoke.mjs'

const temp = mkdtempSync(join(tmpdir(), 'guandan-room-observer-'))
const roomId = '626415'
const sockets = []
const events = []
const secret = 'observer-smoke-test-secret-longer-than-thirty-two-characters'
const collector = createServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    const event = JSON.parse(body); events.push(event)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, data: { event: { eventId: event.eventId, matchId: event.matchId, sequence: event.sequence, accepted: true,
      ...(event.type === 'game-start' ? { lifecycleClaim: { accepted: true, status: 'playing', startedAt: Date.now() } } : {}) } }, error: null }))
  })
})
await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve))
const allocator = createServer(); await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
const port = allocator.address().port; await new Promise(resolve => allocator.close(resolve))
const endpoint = `ws://127.0.0.1:${port}/weapp`
const spectator = process.argv.includes('--delayed') ? 'delay-15' : 'live'
const settings = normalizeFriendRoomSettings({ format: 'rounds', rounds: 4, spectator, turnSeconds: 60 })
const roomExpiresAt = Date.now() + 180000
const tickets = new GameTicketService({ secret, ttlMs: 120000, gameEndpoint: endpoint })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let child, requestId = 1, serverLog = ''
const start = async () => {
  child = spawn(process.execPath, ['server/weapp-ws.js'], { env: { ...process.env, NODE_ENV: 'test', WEAPP_WS_PORT: String(port), WEAPP_TURN_TIMEOUT_MS: '60000',
    WEAPP_ROOM_STATE_FILE: join(temp, 'rooms.json'), GAME_TICKET_REQUIRED: 'true', GAME_TICKET_SECRET: secret, GAME_RESULT_SECRET: secret,
    GAME_SPECTATOR_EVENT_SECRET: secret, GAME_SPECTATOR_OUTBOX_FILE: join(temp, 'events.json'),
    GAME_SPECTATOR_EVENT_ENDPOINT: `http://127.0.0.1:${collector.address().port}/api/v1/game/spectator-events` }, stdio: ['ignore', 'pipe', 'pipe'] })
  serverLog = ''; child.stdout.on('data', x => { serverLog += x }); child.stderr.on('data', x => { serverLog += x })
  for (let n = 0; n < 100; n++) { if (serverLog.includes('WebSocket server running')) return; if (child.exitCode !== null) throw Error(serverLog); await delay(30) }
  throw Error('server start timeout: ' + serverLog)
}
const stop = async () => { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done } }
const connect = async () => {
  const socket = new WebSocket(endpoint); sockets.push(socket); socket.packets = []
  socket.addEventListener('message', ({ data }) => socket.packets.push(JSON.parse(data)))
  await once(socket, 'open'); return socket
}
const wait = async (socket, predicate, after = 0) => {
  for (let n = 0; n < 1100; n++) { const found = socket.packets.slice(after).find(predicate); if (found) return found; await delay(20) }
  throw Error('packet timeout ' + JSON.stringify(socket.packets.slice(-8)) + '\n' + serverLog)
}
const command = (socket, type, payload = {}, responseType = 'actionAccepted') => {
  const id = requestId++
  sendProtocolCommand(socket, type, { roomId, ...payload }, id)
  return wait(socket, packet => packet.requestId === id && packet.type === responseType)
}
const issue = (user, seat) => tickets.issue({ userId: user, matchId: 'match-observer-smoke', roomId, seat, roomKind: 'friend', hostUserId: 'user-0', roomSettings: settings, roomExpiresAt })
const joinRoom = async (socket, user, seat, type = 'joinRoom') => {
  const ticket = issue(user, seat)
  return command(socket, type, { gameTicket: ticket.gameTicket, entryAttemptId: ticket.claims.entryAttemptId, hostName: user }, type === 'createRoom' ? 'roomCreated' : 'roomJoined')
}
try {
  await start()
  const players = []
  for (let i = 0; i < 4; i++) { const socket = await connect(); players.push(socket); await joinRoom(socket, `user-${i}`, `p${i + 1}`, i ? 'joinRoom' : 'createRoom') }
  const observer = await connect()
  const joined = await joinRoom(observer, 'user-4', 'observer')
  assert.equal(joined.roomRole, 'observer')
  assert.equal(joined.seatedPlayerId, null)
  await command(players[0], 'standUp')
  assert.equal((await wait(players[0], p => p.type === 'roomView' && p.roomRole === 'observer')).isRoomHost, true)
  await command(players[1], 'sitDown', { playerId: 'p1' })
  assert.equal((await wait(players[1], p => p.type === 'roomView' && p.myPlayerId === 'p1')).isRoomHost, false)
  await command(observer, 'sitDown', { playerId: 'p2' })
  for (const socket of [players[1], observer, players[2], players[3]]) await command(socket, 'setLobbyReady')
  assert.match((await command(players[0], 'setLobbyReady', {}, 'error')).message, /不在房间/)
  const startedAt = Date.now()
  await command(players[0], 'startGame')
  if (spectator !== 'live') {
    await delay(1200)
    assert.equal(players[0].packets.some(p => p.type === 'roomView' && p.state), false, 'delayed observers cannot receive a live hand while buffering')
    assert.ok(players[0].packets.some(p => p.observerWaiting))
  }
  const watched = await wait(players[0], p => p.type === 'roomView' && p.state)
  if (spectator !== 'live') assert.ok(Date.now() - startedAt >= 15000, 'server must withhold the snapshot for the full configured delay')
  assert.equal(watched.roomRole, 'observer')
  assert.equal(watched.state.players.p1.hand.length, 27)
  assert.ok(watched.state.players.p1.hand[0].rank)
  for (const seat of ['p2', 'p3', 'p4']) assert.ok(watched.state.players[seat].hand.every(card => card.id.startsWith('hidden-')))
  assert.deepEqual(events.find(e => e.type === 'game-start').friendRoster, { p1: 'user-1', p2: 'user-4', p3: 'user-2', p4: 'user-3' })
  const marker = players[0].packets.length
  await command(players[0], 'watchPlayer', { playerId: 'p3' })
  const switched = await wait(players[0], p => p.type === 'roomView' && p.myPlayerId === 'p3' && p.state, marker)
  assert.ok(switched.state.players.p3.hand[0].rank)
  assert.ok(switched.state.players.p1.hand[0].id.startsWith('hidden-'))
  assert.match((await command(players[0], 'sitDown', { playerId: 'p1' }, 'error')).message, /开局后/)
  assert.match((await command(players[0], 'play', { cardIds: [switched.state.players.p3.hand[0].id] }, 'error')).message, /不在房间|观战/)
  const token = switched.resumeToken
  await checkObserverBrowser({ ticket: issue('user-browser', 'observer'), roomId, endpoint, delayed: spectator !== 'live' })
  await stop()
  await start()
  const resumed = await connect()
  const recovered = await command(resumed, 'rejoinRoom', { resumeToken: token }, 'roomRejoined')
  assert.equal(recovered.roomRole, 'observer'); assert.equal(recovered.isRoomHost, true); assert.equal(recovered.myPlayerId, 'p3')
  assert.notEqual(recovered.resumeToken, token)
  const nextId = requestId++
  const retryPayload = { roomId, resumeToken: recovered.resumeToken }
  sendProtocolCommand(resumed, 'rejoinRoom', retryPayload, nextId)
  const first = await wait(resumed, p => p.type === 'roomRejoined' && p.requestId === nextId)
  const beforeRetry = resumed.packets.length
  sendProtocolCommand(resumed, 'rejoinRoom', retryPayload, nextId)
  const retry = await wait(resumed, p => p.type === 'roomRejoined' && p.requestId === nextId, beforeRetry)
  assert.equal(retry.resumeToken, first.resumeToken, 'entry retry cannot rotate identity twice')
  await command(resumed, 'safeExit', {}, 'roomLeft')
  assert.match((await command(resumed, 'rejoinRoom', { resumeToken: first.resumeToken }, 'error')).message, /无效/)
  console.log(`Friend-room observer WebSocket smoke passed (${spectator}): five members, host stands, seat swap, private view, action denial, durable restart, retry and exit`)
} finally {
  sockets.forEach(socket => socket.close()); await stop(); await new Promise(resolve => collector.close(resolve)); rmSync(temp, { recursive: true, force: true })
}
