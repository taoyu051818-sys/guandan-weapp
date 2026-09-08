import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { GameTicketService, spectatorEventSignature } from './platform/crypto.js'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'

const port = 39103
const roomId = '271828'
const matchId = 'mat-ticket-smoke'
const secret = 'ticket-smoke-secret-with-at-least-thirty-two-characters'
const spectatorSecret = 'spectator-smoke-secret-with-at-least-thirty-two-characters'
const acceptedSpectatorEvents = []
const acceptedSpectatorEventIds = new Set()
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
      const duplicate = acceptedSpectatorEventIds.has(eventId)
      if (!duplicate) {
        acceptedSpectatorEventIds.add(eventId)
        acceptedSpectatorEvents.push(event)
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        ok: true,
        data: {
          event: event.type === 'game-start'
            ? { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate, lifecycleClaim: { accepted: true, status: 'playing', startedAt: Date.now() } }
            : { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate },
        },
        error: null,
      }))
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
  const timer = setTimeout(() => reject(new Error(`等待 ${type}/${requestId ?? '*'} 超时`)), 3000)
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
const send = (socket, type, requestId, payload) => sendProtocolCommand(socket, type, payload, requestId)
const ticketPayload = issued => ({
  gameTicket: issued.gameTicket,
  entryAttemptId: issued.claims.entryAttemptId,
})

try {
  await delay(250)
  for (let index = 0; index < 6; index += 1) sockets.push(await connect())
  const incompleteRoomId = '161803'
  const incompleteMatchId = 'mat-incomplete-ticket-smoke'
  const shortTickets = new GameTicketService({ secret, gameEndpoint: `ws://127.0.0.1:${port}/weapp`, ttlMs: 2200 })
  const incompleteIssued = Object.fromEntries(['p1', 'p2', 'p3'].map((seat, index) => [seat, shortTickets.issue({ userId: `usr-incomplete-${index + 1}`, matchId: incompleteMatchId, roomId: incompleteRoomId, seat })]))
  const incompleteCreate = waitMessage(sockets[0], 'roomCreated', 40)
  send(sockets[0], 'createRoom', 40, { roomId: incompleteRoomId, hostName: '缺席关闭测试', ...ticketPayload(incompleteIssued.p1) })
  await incompleteCreate
  for (const [index, seat] of [[1, 'p2'], [2, 'p3']]) {
    const requestId = 40 + index
    const joined = waitMessage(sockets[index], 'roomJoined', requestId)
    send(sockets[index], 'joinRoom', requestId, { roomId: incompleteRoomId, ...ticketPayload(incompleteIssued[seat]) })
    await joined
  }
  const hiddenRoomList = waitMessage(sockets[0], 'roomList', 44)
  send(sockets[0], 'listRooms', 44, {})
  assert.equal((await hiddenRoomList).rooms.some(room => room.roomId === incompleteRoomId), false, '平台票据房不得出现在匿名房间列表')
  const incompleteClosed = waitMessage(sockets[0], 'roomDissolved', undefined)
  assert.equal((await incompleteClosed).reason, 'entry-timeout', '第四席未在共享deadline前到达时必须关闭整房')

  const issued = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((seat, index) => [seat, tickets.issue({ userId: `usr-${index + 1}`, matchId, roomId, seat })]))

  const missingPromise = waitMessage(sockets[4], 'error', 1)
  send(sockets[4], 'joinRoom', 1, { roomId })
  assert.match((await missingPromise).message, /票据/)

  const wrongSeatPromise = waitMessage(sockets[5], 'error', 2)
  send(sockets[5], 'createRoom', 2, { roomId, hostName: '错误席位', ...ticketPayload(issued.p3) })
  assert.match((await wrongSeatPromise).message, /席位/)

  const p2JoinedPromise = waitMessage(sockets[1], 'roomJoined', 3)
  send(sockets[1], 'joinRoom', 3, { roomId, ...ticketPayload(issued.p2) })
  // 测试工具观察首次响应以比对凭证；模拟客户端随后丢弃该响应并重发/断线恢复。
  const p2Initial = await p2JoinedPromise
  assert.equal(p2Initial.myPlayerId, 'p2', '非房主先到时应按票据预建等待房主的房间')

  const secondP2Ticket = tickets.issue({ userId: 'usr-2', matchId, roomId, seat: 'p2' })
  const differentTicketPromise = waitMessage(sockets[5], 'error', 11)
  send(sockets[5], 'joinRoom', 11, { roomId, ...ticketPayload(secondP2Ticket) })
  assert.match((await differentTicketPromise).message, /其他票据|活动连接|已被占用/, '相同席位不能用不同 jti 顶掉活动连接的原票据绑定')

  const wrongMatchTicket = tickets.issue({ userId: 'usr-4', matchId: 'mat-other', roomId, seat: 'p4' })
  const wrongMatchPromise = waitMessage(sockets[5], 'error', 12)
  send(sockets[5], 'joinRoom', 12, { roomId, ...ticketPayload(wrongMatchTicket) })
  assert.match((await wrongMatchPromise).message, /有效匹配票据|不匹配/, '同房间但不同 matchId 的票据必须拒绝')

  const sameConnectionRetryPromise = waitMessage(sockets[1], 'roomJoined', 3)
  send(sockets[1], 'joinRoom', 3, { roomId, ...ticketPayload(issued.p2) })
  const sameConnectionRetry = await sameConnectionRetryPromise
  assert.equal(sameConnectionRetry.resumeToken, p2Initial.resumeToken, '同一连接重发同票必须返回原恢复凭证')

  const activeTakeoverPromise = waitMessage(sockets[4], 'error', 5)
  send(sockets[4], 'joinRoom', 5, { roomId, ...ticketPayload(issued.p2) })
  assert.equal((await activeTakeoverPromise).code, 'GAME_TICKET_USED', '一次性入桌票不得用新 requestId 顶掉活动连接')

  const freshP2Entry = tickets.issue({ userId: 'usr-2', matchId, roomId, seat: 'p2' })
  const p2FreshRekeyPromise = waitMessage(sockets[1], 'roomJoined', 16)
  send(sockets[1], 'joinRoom', 16, { roomId, ...ticketPayload(freshP2Entry) })
  assert.equal((await p2FreshRekeyPromise).resumeToken, p2Initial.resumeToken, '同连接同绑定的 fresh entry 票必须原子 rekey')

  sockets[1].close()
  await delay(80)
  sockets[1] = await connect()
  const disconnectedRetryPromise = waitMessage(sockets[1], 'roomJoined', 16)
  send(sockets[1], 'joinRoom', 16, { roomId, ...ticketPayload(freshP2Entry) })
  const disconnectedRetry = await disconnectedRetryPromise
  assert.equal(disconnectedRetry.resumeToken, p2Initial.resumeToken, '首次响应丢失并断线后，同一有效票据必须恢复原席位凭证')

  sockets[1].close()
  await delay(80)
  sockets[1] = await connect()
  const reissuedP2Ticket = tickets.issue({ userId: 'usr-2', matchId, roomId, seat: 'p2' })
  const reissuedJoinPromise = waitMessage(sockets[1], 'roomJoined', 18)
  send(sockets[1], 'joinRoom', 18, { roomId, ...ticketPayload(reissuedP2Ticket) })
  assert.equal((await reissuedJoinPromise).resumeToken, p2Initial.resumeToken, '同用户短票重签必须恢复原席位会话而不是创建新席')
  const revokedOldTicketPromise = waitMessage(sockets[5], 'error', 19)
  send(sockets[5], 'joinRoom', 19, { roomId, ...ticketPayload(issued.p2) })
  assert.match((await revokedOldTicketPromise).message, /绑定不一致|撤销|占用/, 'JTI轮换后旧票必须失效')

  const hostCreatedPromise = waitMessage(sockets[0], 'roomCreated', 7)
  send(sockets[0], 'createRoom', 7, { roomId, hostName: '票据房主', ...ticketPayload(issued.p1) })
  const hostInitial = await hostCreatedPromise
  assert.equal(hostInitial.myPlayerId, 'p1')

  const hostSameConnectionPromise = waitMessage(sockets[0], 'roomCreated', 7)
  send(sockets[0], 'createRoom', 7, { roomId, hostName: '票据房主', ...ticketPayload(issued.p1) })
  assert.equal((await hostSameConnectionPromise).resumeToken, hostInitial.resumeToken)

  const hostTakeoverPromise = waitMessage(sockets[5], 'error', 14)
  send(sockets[5], 'createRoom', 14, { roomId, hostName: '冒用房主', ...ticketPayload(issued.p1) })
  assert.equal((await hostTakeoverPromise).code, 'GAME_TICKET_USED')

  const freshHostEntry = tickets.issue({ userId: 'usr-1', matchId, roomId, seat: 'p1' })
  const hostFreshRekeyPromise = waitMessage(sockets[0], 'roomCreated', 17)
  send(sockets[0], 'createRoom', 17, { roomId, hostName: '票据房主', ...ticketPayload(freshHostEntry) })
  assert.equal((await hostFreshRekeyPromise).resumeToken, hostInitial.resumeToken, '房主同绑定 fresh entry 票必须原子 rekey')

  sockets[0].close()
  await delay(80)
  sockets[0] = await connect()
  const hostDisconnectedRetryPromise = waitMessage(sockets[0], 'roomCreated', 17)
  send(sockets[0], 'createRoom', 17, { roomId, hostName: '票据房主', ...ticketPayload(freshHostEntry) })
  assert.equal((await hostDisconnectedRetryPromise).resumeToken, hostInitial.resumeToken, 'roomCreated 响应丢失并断线后应恢复原房主席位')

  const p3JoinedPromise = waitMessage(sockets[2], 'roomJoined', 8)
  send(sockets[2], 'joinRoom', 8, { roomId, ...ticketPayload(issued.p3) })
  assert.equal((await p3JoinedPromise).myPlayerId, 'p3')

  const gameStates = sockets.slice(0, 4).map(socket => waitMessage(socket, 'gameState', undefined))
  const p4JoinedPromise = waitMessage(sockets[3], 'roomJoined', 9)
  send(sockets[3], 'joinRoom', 9, { roomId, ...ticketPayload(issued.p4) })
  assert.equal((await p4JoinedPromise).myPlayerId, 'p4')
  const startedStates = await Promise.all(gameStates)
  assert.ok(startedStates.every(packet => packet.phase === 'playing' && packet.roomId === roomId), '匹配四席到齐后四端都应收到自动开局状态')
  assert.ok(startedStates.every(packet => packet.state.players.p1.hand.length === 27))

  const currentStateRetryPromise = waitMessage(sockets[1], 'error', 10)
  send(sockets[1], 'joinRoom', 10, { roomId, ...ticketPayload(reissuedP2Ticket) })
  const currentStateRetry = await currentStateRetryPromise
  assert.equal(currentStateRetry.code, 'GAME_TICKET_USED', '已开局后旧 entry 票只能精确重放原响应，不能作为恢复凭证')

  const p1RecoveryAttempt = 'match-recovery-p1-attempt-0001'
  const p1RecoveryTicket = tickets.issue({
    userId: 'usr-1',
    matchId,
    roomId,
    seat: 'p1',
    roomKind: 'match',
    purpose: 'rejoin',
    entryAttemptId: p1RecoveryAttempt,
  })
  sockets[0].close()
  await delay(80)
  sockets[0] = await connect()
  const missingRecoveryAttempt = waitMessage(sockets[0], 'error', 50)
  send(sockets[0], 'joinRoom', 50, { roomId, gameTicket: p1RecoveryTicket.gameTicket })
  assert.equal((await missingRecoveryAttempt).code, 'ENTRY_ATTEMPT_MISMATCH')
  const mismatchedRecoveryAttempt = waitMessage(sockets[0], 'error', 51)
  send(sockets[0], 'joinRoom', 51, {
    roomId,
    gameTicket: p1RecoveryTicket.gameTicket,
    entryAttemptId: 'match-recovery-p1-wrong-0001',
  })
  assert.equal((await mismatchedRecoveryAttempt).code, 'ENTRY_ATTEMPT_MISMATCH')

  const p1RecoveredPromise = waitMessage(sockets[0], 'roomRejoined', 52)
  send(sockets[0], 'joinRoom', 52, { roomId, ...ticketPayload(p1RecoveryTicket) })
  const p1Recovered = await p1RecoveredPromise
  assert.equal(p1Recovered.myPlayerId, 'p1')
  assert.notEqual(p1Recovered.resumeToken, hostInitial.resumeToken, '普通匹配恢复票必须轮换 p1 本地恢复凭证')
  const p1ReplayPromise = waitMessage(sockets[0], 'roomRejoined', 52)
  send(sockets[0], 'joinRoom', 52, { roomId, ...ticketPayload(p1RecoveryTicket) })
  const p1Replay = await p1ReplayPromise
  assert.equal(p1Replay.resumeToken, p1Recovered.resumeToken, '同恢复票、同 requestId 必须重放原响应而不能再次轮换')

  sockets[0].close()
  await delay(80)
  sockets[0] = await connect()
  const staleHostResume = waitMessage(sockets[0], 'error', 53)
  send(sockets[0], 'rejoinRoom', 53, { roomId, myPlayerId: 'p1', resumeToken: hostInitial.resumeToken })
  assert.match((await staleHostResume).message, /重连凭证无效/)
  const p1SecondRecoveryTicket = tickets.issue({
    userId: 'usr-1',
    matchId,
    roomId,
    seat: 'p1',
    roomKind: 'match',
    purpose: 'rejoin',
    entryAttemptId: 'match-recovery-p1-attempt-0002',
  })
  assert.notEqual(p1SecondRecoveryTicket.claims.jti, p1RecoveryTicket.claims.jti)
  const p1SecondRecoveryPromise = waitMessage(sockets[0], 'roomRejoined', 54)
  send(sockets[0], 'joinRoom', 54, { roomId, ...ticketPayload(p1SecondRecoveryTicket) })
  const p1SecondRecovery = await p1SecondRecoveryPromise
  assert.notEqual(p1SecondRecovery.resumeToken, p1Recovered.resumeToken, '新恢复 JTI 必须完成第二次原子会话轮换')
  const p1TrusteeCancelled = waitMessage(sockets[0], 'actionAccepted', 55)
  send(sockets[0], 'cancelTrustee', 55, { roomId })
  await p1TrusteeCancelled

  const p2RecoveryTicket = tickets.issue({
    userId: 'usr-2',
    matchId,
    roomId,
    seat: 'p2',
    roomKind: 'match',
    purpose: 'rejoin',
    entryAttemptId: 'match-recovery-p2-attempt-0001',
  })
  sockets[1].close()
  await delay(80)
  sockets[1] = await connect()
  const p2RecoveredPromise = waitMessage(sockets[1], 'roomRejoined', 56)
  send(sockets[1], 'joinRoom', 56, { roomId, ...ticketPayload(p2RecoveryTicket) })
  const p2Recovered = await p2RecoveredPromise
  assert.equal(p2Recovered.myPlayerId, 'p2')
  assert.notEqual(p2Recovered.resumeToken, p2Initial.resumeToken, '普通匹配恢复票必须恢复非房主席位')
  const p2TrusteeCancelled = waitMessage(sockets[1], 'actionAccepted', 57)
  send(sockets[1], 'cancelTrustee', 57, { roomId })
  await p2TrusteeCancelled

  const gameStartEvent = await waitForSpectator(event => event.matchId === matchId && event.sequence === 1, '未收到 game-start 观战事件')
  assert.equal(gameStartEvent.type, 'game-start')
  const playRequestId = 16
  const playAcceptedPromise = waitMessage(sockets[0], 'actionAccepted', playRequestId)
  const p2AfterPlayPromise = waitMessage(sockets[1], 'gameState', undefined)
  send(sockets[0], 'play', playRequestId, { roomId, cardIds: [startedStates[0].state.players.p1.hand[0].id] })
  await Promise.all([playAcceptedPromise, p2AfterPlayPromise])
  const passRequestId = 17
  const passAcceptedPromise = waitMessage(sockets[1], 'actionAccepted', passRequestId)
  send(sockets[1], 'pass', passRequestId, { roomId })
  await passAcceptedPromise
  const playEvent = await waitForSpectator(event => event.matchId === matchId && event.sequence === 2, '未收到 play 观战事件重试结果')
  const passEvent = await waitForSpectator(event => event.matchId === matchId && event.sequence === 3, '未收到 pass 观战事件')
  assert.equal(playEvent.type, 'play')
  assert.equal(playEvent.playerId, 'p1')
  assert.equal(playEvent.automatic, false)
  assert.deepEqual(Object.keys(playEvent.cards[0]).sort(), ['rank', 'suit'], '公开牌面只能包含点数和花色')
  assert.equal(passEvent.type, 'pass')
  assert.equal(passEvent.playerId, 'p2')
  assert.ok(spectatorAttempts.get(playEvent.eventId) >= 2, '瞬时上报失败应以同一 eventId 幂等重试，且不能重复推进游戏')
  const automaticEvent = await waitForSpectator(event => event.matchId === matchId && event.sequence === 4, '未收到服务端超时自动动作观战事件')
  assert.equal(automaticEvent.playerId, 'p3')
  assert.equal(automaticEvent.automatic, true)

  for (let index = 0; index < 4; index += 1) {
    const requestId = 20 + index
    const leftPromise = waitMessage(sockets[index], 'roomLeft', requestId)
    send(sockets[index], 'safeExit', requestId, { roomId })
    assert.equal((await leftPromise).seatReserved, true)
  }
  const closedEvent = await waitForSpectator(event => event.matchId === matchId && event.type === 'room-closed', '全桌安全退出后未上报 room-closed')
  assert.equal(closedEvent.reason, 'empty-timeout')
  const sequences = acceptedSpectatorEvents.filter(event => event.matchId === matchId).map(event => event.sequence)
  assert.deepEqual(sequences, sequences.map((_, index) => index + 1), '公开事件必须按牌局顺序串行上报')
  assert.equal(acceptedSpectatorEvents.filter(event => event.matchId === matchId).at(-1).type, 'room-closed')
  assert.equal(collectorError, null)
  console.log('weapp required game-ticket integration passed')
} finally {
  sockets.forEach(socket => socket.close())
  child.kill('SIGTERM')
  await new Promise(resolve => collector.close(resolve))
}
