import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { GameTicketService } from './platform/crypto.js'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'
import { BOT_NICKNAMES, roomPlayerNicknames } from './player-nicknames.js'

const secret = 'signed-match-bot-ticket-secret-with-at-least-32-characters'
const resultSecret = 'signed-match-bot-result-secret-with-at-least-32-characters'
const spectatorSecret = 'signed-match-bot-spectator-secret-with-at-least-32-characters'
const roomId = '737373'
const matchId = 'mat-signed-bot-smoke'
const botUserIdsBySeat = { p3: `bot_${matchId}_p3`, p4: `bot_${matchId}_p4` }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const close = server => new Promise(resolve => server.close(resolve))

const collector = createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const event = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      ok: true,
      data: { event: { eventId: event.eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false, lifecycleClaim: { accepted: true, status: 'playing', startedAt: event.at } } },
      error: null,
    }))
  })
})
const collectorPort = await listen(collector)
const reservation = createServer()
const gamePort = await listen(reservation)
await close(reservation)

const child = spawn(process.execPath, ['server/weapp-ws.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WEAPP_WS_PORT: String(gamePort),
    GAME_TICKET_REQUIRED: 'true',
    GAME_TICKET_SECRET: secret,
    GAME_RESULT_SECRET: resultSecret,
    GAME_SPECTATOR_EVENT_SECRET: spectatorSecret,
    GAME_SPECTATOR_EVENT_ENDPOINT: `http://127.0.0.1:${collectorPort}/api/v1/game/spectator-events`,
  },
  stdio: 'ignore',
})
const sockets = []
const connectOnce = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${gamePort}/weapp`)
  socket.addEventListener('open', () => resolve(socket), { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const connect = async () => {
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    try { return await connectOnce() } catch { await delay(40) }
  }
  throw new Error('签名机器人牌局服启动超时')
}
const waitMessage = (socket, type, requestId) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等待 ${type}/${requestId ?? '*'} 超时`)), 5_000)
  const handler = ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type !== type || (requestId !== undefined && packet.requestId !== requestId)) return
    clearTimeout(timer)
    socket.removeEventListener('message', handler)
    resolve(packet)
  }
  socket.addEventListener('message', handler)
})
const payloadFor = issued => ({ gameTicket: issued.gameTicket, entryAttemptId: issued.claims.entryAttemptId })

try {
  sockets.push(await connect(), await connect(), await connect())
  const tickets = new GameTicketService({ secret, gameEndpoint: `ws://127.0.0.1:${gamePort}/weapp` })
  const p1 = tickets.issue({ userId: 'human-1', matchId, roomId, seat: 'p1', botUserIdsBySeat, matchMode: 'classic_50' })
  const p2 = tickets.issue({ userId: 'human-2', matchId, roomId, seat: 'p2', botUserIdsBySeat, matchMode: 'classic_50' })
  const inconsistentP2 = tickets.issue({
    userId: 'human-2',
    matchId,
    roomId,
    seat: 'p2',
    matchMode: 'classic_50',
    botUserIdsBySeat: { ...botUserIdsBySeat, p4: `bot_${matchId}_other_p4` },
  })

  const createdPromise = waitMessage(sockets[0], 'roomCreated', 1)
  sendProtocolCommand(sockets[0], 'createRoom', { roomId, hostName: '玩家一', ...payloadFor(p1) }, 1)
  const created = await createdPromise
  assert.deepEqual(created.botPlayerIds, ['p3', 'p4'])

  const rejectedPromise = waitMessage(sockets[2], 'error', 2)
  sendProtocolCommand(sockets[2], 'joinRoom', { roomId, ...payloadFor(inconsistentP2) }, 2)
  assert.match((await rejectedPromise).message, /匹配票据|不匹配|有效/)

  const states = [waitMessage(sockets[0], 'gameState'), waitMessage(sockets[1], 'gameState')]
  const joinedPromise = waitMessage(sockets[1], 'roomJoined', 3)
  sendProtocolCommand(sockets[1], 'joinRoom', { roomId, ...payloadFor(p2) }, 3)
  const joined = await joinedPromise
  assert.deepEqual(joined.botPlayerIds, ['p3', 'p4'])
  const started = await Promise.all(states)
  assert.ok(started.every(packet => packet.phase === 'playing' && packet.roomId === roomId))
  assert.ok(started.every(packet => packet.botPlayerIds.join(',') === 'p3,p4'))
  assert.equal(started[0].state.players.p3.isAI, true)
  assert.equal(started[0].state.players.p4.isAI, true)
  const expectedNames = roomPlayerNicknames({ matchId, botUserIdsBySeat })
  for (const seat of ['p3', 'p4']) {
    assert.ok(BOT_NICKNAMES.includes(started[0].state.players[seat].name))
    assert.equal(started[0].state.players[seat].name, expectedNames[seat], 'live metadata must not overwrite an allocated nickname')
    assert.equal(started[0].state.players[seat].name, started[1].state.players[seat].name, 'all clients see the same nickname')
  }
  assert.equal(started[0].state.players.p1.hand.length, 27)
  assert.equal(started[0].state.matchFormat.kind, 'independent', 'signed classic mode reaches the authoritative opening state')
  assert.equal(started[0].state.currentLevel, started[1].state.currentLevel, 'all clients receive the same server-chosen level')
  assert.equal(started[0].state.matchFormat.tributeEnabled, false)
} finally {
  sockets.forEach(socket => socket.close())
  child.kill('SIGTERM')
  await close(collector)
}

console.log('weapp signed match bot ticket integration passed')
