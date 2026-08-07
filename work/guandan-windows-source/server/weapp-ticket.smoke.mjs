import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { GameTicketService, spectatorEventSignature } from './platform/crypto.js'

const port = 39103
const roomId = '271828'
const matchId = 'mat-ticket-smoke'
const secret = 'ticket-smoke-secret-with-at-least-thirty-two-characters'
const spectatorSecret = 'spectator-smoke-secret-with-at-least-thirty-two-characters'
const acceptedSpectatorEvents = []
const spectatorAttempts = new Map()
let collectorError = null
const collector = createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8')
    try {
      const timestamp = String(request.headers['x-spectator-timestamp'] || '')
      const eventId = String(request.headers['x-spectator-event-id'] || '')
      assert.equal(request.url, '/api/v1/game/spectator-events')
      assert.equal(request.headers['x-spectator-signature'], spectatorEventSignature(rawBody, spectatorSecret, timestamp))
      const event = JSON.parse(rawBody)
      assert.equal(event.eventId, eventId)
      assert.equal('userIdsBySeat' in event, false)
      assert.equal('hand' in event, false)
      const attempts = (spectatorAttempts.get(eventId) || 0) + 1
      spectatorAttempts.set(eventId, attempts)
      if (event.sequence === 2 && attempts === 1) {
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: false, error: { message: '模拟瞬时失败' } }))
        return
      }
      acceptedSpectatorEvents.push(event)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, data: { event: { accepted: true, duplicate: false } }, error: null }))
    } catch (error) {
      collectorError = error
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: { message: error instanceof Error ? error.message : 'collector error' } }))
    }
  })
})
await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve))
const spectatorPort = collector.address().port
const child = spawn(process.execPath, ['server/weapp-ws.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WEAPP_WS_PORT: String(port),
    WEAPP_TURN_TIMEOUT_MS: '1000',
    WEAPP_EMPTY_ROOM_TIMEOUT_MS: '150',
    GAME_TICKET_REQUIRED: 'true',
    GAME_TICKET_SECRET: secret,
    GAME_SPECTATOR_EVENT_SECRET: spectatorSecret,
    GAME_SPECTATOR_EVENT_ENDPOINT: `http://127.0.0.1:${spectatorPort}/api/v1/game/spectator-events`,
  },
  stdio: 'ignore',
})
const sockets = []
const tickets = new GameTicketService({ secret, gameEndpoint: `ws://127.0.0.1:${port}/weapp` })
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const waitForSpectator = async (predicate, message) => {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const found = acceptedSpectatorEvents.find(predicate)
    if (found) return found
    if (collectorError) throw collectorError
    await delay(25)
  }
  throw new Error(message)
}
const connectOnce = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  socket.addEventListener('open', () => resolve(socket), { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const connect = async () => {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    try { return await connectOnce() } catch { await delay(40) }
  }
  throw new Error('票据联机服务启动超时')
}
const waitMessage = (socket, type, requestId) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), 3000)
  const handler = ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type === type && packet.requestId === requestId) {
      clearTimeout(timer)
      socket.removeEventListener('message', handler)
      resolve(packet)
    }
  }
  socket.addEventListener('message', handler)
})
const send = (socket, type, requestId, payload) => socket.send(JSON.stringify({ type, requestId, payload }))

try {
  await delay(250)
  for (let index = 0; index < 6; index += 1) sockets.push(await connect())
  const issued = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((seat, index) => [seat, tickets.issue({ userId: `usr-${index + 1}`, matchId, roomId, seat }).gameTicket]))

  const missingPromise = waitMessage(sockets[4], 'error', 1)
  send(sockets[4], 'joinRoom', 1, { roomId })
  assert.match((await missingPromise).message, /票据/)

  const wrongSeatPromise = waitMessage(sockets[5], 'error', 2)
  send(sockets[5], 'createRoom', 2, { roomId, hostName: '错误席位', gameTicket: issued.p3 })
  assert.match((await wrongSeatPromise).message, /席位/)

  const p2JoinedPromise = waitMessage(sockets[1], 'roomJoined', 3)
  send(sockets[1], 'joinRoom', 3, { roomId, gameTicket: issued.p2 })
  // 测试工具观察首次响应以比对凭证；模拟客户端随后丢弃该响应并重发/断线恢复。
  const p2Initial = await p2JoinedPromise
  assert.equal(p2Initial.myPlayerId, 'p2', '非房主先到时应按票据预建等待房主的房间')

  const secondP2Ticket = tickets.issue({ userId: 'usr-2', matchId, roomId, seat: 'p2' }).gameTicket
  const differentTicketPromise = waitMessage(sockets[5], 'error', 11)
  send(sockets[5], 'joinRoom', 11, { roomId, gameTicket: secondP2Ticket })
  assert.match((await differentTicketPromise).message, /其他票据/, '相同席位不能用不同 jti 替换原票据绑定')

  const wrongMatchTicket = tickets.issue({ userId: 'usr-4', matchId: 'mat-other', roomId, seat: 'p4' }).gameTicket
  const wrongMatchPromise = waitMessage(sockets[5], 'error', 12)
  send(sockets[5], 'joinRoom', 12, { roomId, gameTicket: wrongMatchTicket })
  assert.match((await wrongMatchPromise).message, /有效匹配票据|不匹配/, '同房间但不同 matchId 的票据必须拒绝')

  const sameConnectionRetryPromise = waitMessage(sockets[1], 'roomJoined', 4)
  send(sockets[1], 'joinRoom', 4, { roomId, gameTicket: issued.p2 })
  const sameConnectionRetry = await sameConnectionRetryPromise
  assert.equal(sameConnectionRetry.resumeToken, p2Initial.resumeToken, '同一连接重发同票必须返回原恢复凭证')

  const activeTakeoverPromise = waitMessage(sockets[4], 'error', 5)
  send(sockets[4], 'joinRoom', 5, { roomId, gameTicket: issued.p2 })
  assert.match((await activeTakeoverPromise).message, /活动连接占用/, '同票不能顶掉另一个活动连接')

  sockets[1].close()
  await delay(80)
  sockets[1] = await connect()
  const disconnectedRetryPromise = waitMessage(sockets[1], 'roomJoined', 6)
  send(sockets[1], 'joinRoom', 6, { roomId, gameTicket: issued.p2 })
  const disconnectedRetry = await disconnectedRetryPromise
  assert.equal(disconnectedRetry.resumeToken, p2Initial.resumeToken, '首次响应丢失并断线后，同一有效票据必须恢复原席位凭证')

  const hostCreatedPromise = waitMessage(sockets[0], 'roomCreated', 7)
  send(sockets[0], 'createRoom', 7, { roomId, hostName: '票据房主', gameTicket: issued.p1 })
  const hostInitial = await hostCreatedPromise
  assert.equal(hostInitial.myPlayerId, 'p1')

  const hostSameConnectionPromise = waitMessage(sockets[0], 'roomCreated', 13)
  send(sockets[0], 'createRoom', 13, { roomId, hostName: '票据房主', gameTicket: issued.p1 })
  assert.equal((await hostSameConnectionPromise).resumeToken, hostInitial.resumeToken)

  const hostTakeoverPromise = waitMessage(sockets[5], 'error', 14)
  send(sockets[5], 'createRoom', 14, { roomId, hostName: '冒用房主', gameTicket: issued.p1 })
  assert.match((await hostTakeoverPromise).message, /活动连接占用/)

  sockets[0].close()
  await delay(80)
  sockets[0] = await connect()
  const hostDisconnectedRetryPromise = waitMessage(sockets[0], 'roomCreated', 15)
  send(sockets[0], 'createRoom', 15, { roomId, hostName: '票据房主', gameTicket: issued.p1 })
  assert.equal((await hostDisconnectedRetryPromise).resumeToken, hostInitial.resumeToken, 'roomCreated 响应丢失并断线后应恢复原房主席位')

  const p3JoinedPromise = waitMessage(sockets[2], 'roomJoined', 8)
  send(sockets[2], 'joinRoom', 8, { roomId, gameTicket: issued.p3 })
  assert.equal((await p3JoinedPromise).myPlayerId, 'p3')

  const gameStates = sockets.slice(0, 4).map(socket => waitMessage(socket, 'gameState', undefined))
  const p4JoinedPromise = waitMessage(sockets[3], 'roomJoined', 9)
  send(sockets[3], 'joinRoom', 9, { roomId, gameTicket: issued.p4 })
  assert.equal((await p4JoinedPromise).myPlayerId, 'p4')
  const startedStates = await Promise.all(gameStates)
  assert.ok(startedStates.every(packet => packet.phase === 'playing' && packet.roomId === roomId), '匹配四席到齐后四端都应收到自动开局状态')
  assert.ok(startedStates.every(packet => packet.state.players.p1.hand.length === 27))

  const currentStateRetryPromise = waitMessage(sockets[1], 'roomJoined', 10)
  send(sockets[1], 'joinRoom', 10, { roomId, gameTicket: issued.p2 })
  const currentStateRetry = await currentStateRetryPromise
  assert.equal(currentStateRetry.resumeToken, p2Initial.resumeToken)
  assert.equal(currentStateRetry.phase, 'playing')
  assert.equal(currentStateRetry.state.players.p2.hand.length, 27)
  assert.equal(currentStateRetry.state.players.p1.hand[0].rank, undefined, '同票恢复只返回当前玩家可见的脱敏状态')

  const gameStartEvent = await waitForSpectator(event => event.sequence === 1, '未收到 game-start 观战事件')
  assert.equal(gameStartEvent.type, 'game-start')
  const playRequestId = 16
  const playAcceptedPromise = waitMessage(sockets[0], 'actionAccepted', playRequestId)
  send(sockets[0], 'play', playRequestId, { roomId, cardIds: [startedStates[0].state.players.p1.hand[0].id] })
  await playAcceptedPromise
  const passRequestId = 17
  const passAcceptedPromise = waitMessage(sockets[1], 'actionAccepted', passRequestId)
  send(sockets[1], 'pass', passRequestId, { roomId })
  await passAcceptedPromise
  const playEvent = await waitForSpectator(event => event.sequence === 2, '未收到 play 观战事件重试结果')
  const passEvent = await waitForSpectator(event => event.sequence === 3, '未收到 pass 观战事件')
  assert.equal(playEvent.type, 'play')
  assert.equal(playEvent.playerId, 'p1')
  assert.equal(playEvent.automatic, false)
  assert.deepEqual(Object.keys(playEvent.cards[0]).sort(), ['rank', 'suit'], '公开牌面只能包含点数和花色')
  assert.equal(passEvent.type, 'pass')
  assert.equal(passEvent.playerId, 'p2')
  assert.equal(spectatorAttempts.get(playEvent.eventId), 2, '瞬时上报失败应重试，且不能重复推进游戏')
  const automaticEvent = await waitForSpectator(event => event.sequence === 4, '未收到服务端超时自动动作观战事件')
  assert.equal(automaticEvent.playerId, 'p3')
  assert.equal(automaticEvent.automatic, true)

  for (let index = 0; index < 4; index += 1) {
    const requestId = 20 + index
    const leftPromise = waitMessage(sockets[index], 'roomLeft', requestId)
    send(sockets[index], 'safeExit', requestId, { roomId })
    assert.equal((await leftPromise).seatReserved, true)
  }
  const closedEvent = await waitForSpectator(event => event.type === 'room-closed', '全桌安全退出后未上报 room-closed')
  assert.equal(closedEvent.reason, 'empty-timeout')
  assert.deepEqual(acceptedSpectatorEvents.map(event => event.sequence), [1, 2, 3, 4, 5], '公开事件必须按牌局顺序串行上报')
  assert.equal(collectorError, null)
  console.log('weapp required game-ticket integration passed')
} finally {
  sockets.forEach(socket => socket.close())
  child.kill('SIGTERM')
  await new Promise(resolve => collector.close(resolve))
}
