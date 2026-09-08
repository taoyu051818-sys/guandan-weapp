import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import {
  GameTicketService,
  gameResultSignature,
  spectatorEventSignature,
} from './platform/crypto.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'

const port = 39116
const roomId = '314159'
const closedRoomId = '314160'
const matchId = 'mat-friend-ticket-smoke'
const closedMatchId = 'mat-friend-ticket-closed'
const ticketSecret = 'friend-ticket-smoke-secret-at-least-thirty-two-characters'
const spectatorSecret = 'friend-spectator-smoke-secret-at-least-thirty-two-characters'
const resultSecret = 'friend-lifecycle-smoke-secret-at-least-thirty-two-characters'
const roomExpiresAt = Date.now() + 120_000
const closedRoomExpiresAt = roomExpiresAt + 1
const roomSettings = normalizeFriendRoomSettings({
  format: 'rounds', levelMode: 'fixed', levelRank: 'A', tributeEnabled: false,
  rounds: 8,
  scoring: 'double-4',
  scoreVisibility: 'hidden',
  turnSeconds: 60,
  trusteeSeconds: 30,
  totalTimeMinutes: 20,
  spectator: 'live',
  autoSort: false,
  disableInteraction: false,
  sortOrder: 'asc',
}, { strict: true })
const tempDirectory = mkdtempSync(join(tmpdir(), 'guandan-friend-ticket-'))
const roomStateFile = join(tempDirectory, 'rooms.json')
const spectatorOutboxFile = join(tempDirectory, 'spectator-outbox.json')
const sockets = []
const acceptedEvents = []
const acceptedEventIds = new Set()
let collectorError = null
let startClaimSeenResolve
let startClaimReleaseResolve
const startClaimSeen = new Promise(resolve => { startClaimSeenResolve = resolve })
const startClaimRelease = new Promise(resolve => { startClaimReleaseResolve = resolve })
let firstSeatLeftSeenResolve
let firstSeatLeftReleaseResolve
let firstSeatLeftHandled = false
let nextSeatReleaseRevocations = []
const firstSeatLeftSeen = new Promise(resolve => { firstSeatLeftSeenResolve = resolve })
const firstSeatLeftRelease = new Promise(resolve => { firstSeatLeftReleaseResolve = resolve })

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const lifecycleTypes = new Set(['game-start', 'match-ended', 'seat-left', 'room-closed'])

const collector = createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf8')
    try {
      const spectatorTimestamp = String(request.headers['x-spectator-timestamp'] || '')
      const eventId = String(request.headers['x-spectator-event-id'] || '')
      assert.equal(request.url, '/api/v1/game/spectator-events')
      assert.equal(
        request.headers['x-spectator-signature'],
        spectatorEventSignature(rawBody, spectatorSecret, spectatorTimestamp),
      )
      const event = JSON.parse(rawBody)
      assert.equal(event.eventId, eventId)
      assert.equal('userIdsBySeat' in event, false)
      assert.equal('hand' in event, false)
      if (lifecycleTypes.has(event.type)) {
        const gameTimestamp = String(request.headers['x-game-timestamp'] || '')
        assert.equal(request.headers['x-game-event-id'], eventId)
        assert.equal(request.headers['x-game-signature'], gameResultSignature(rawBody, resultSecret, gameTimestamp))
      }
      const duplicate = acceptedEventIds.has(eventId)
      if (!duplicate) {
        acceptedEventIds.add(eventId)
        acceptedEvents.push(event)
      }
      if (event.type === 'game-start') {
        startClaimSeenResolve(event)
        await startClaimRelease
      }
      let seatRelease = null
      if (event.type === 'seat-left' && event.matchId === matchId && !firstSeatLeftHandled) {
        firstSeatLeftHandled = true
        firstSeatLeftSeenResolve(event)
        const revoked = await firstSeatLeftRelease
        seatRelease = {
          playerId: event.playerId,
          userId: event.userId,
          revokedTicketJti: revoked.jti,
          revokedTicketExp: revoked.exp,
          revokedTickets: [{ jti: revoked.jti, exp: revoked.exp }],
        }
      } else if (event.type === 'seat-left' && event.matchId === matchId && nextSeatReleaseRevocations.length) {
        const revokedTickets = nextSeatReleaseRevocations
        nextSeatReleaseRevocations = []
        seatRelease = {
          playerId: event.playerId,
          userId: event.userId,
          revokedTicketJti: revokedTickets.at(-1).jti,
          revokedTicketExp: revokedTickets.at(-1).exp,
          revokedTickets,
        }
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        ok: true,
        data: {
          event: event.type === 'game-start'
            ? {
                eventId,
                matchId: event.matchId,
                sequence: event.sequence,
                accepted: true,
                duplicate,
                lifecycleClaim: { accepted: true, status: 'playing', startedAt: Date.now() },
              }
            : { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate, ...(seatRelease ? { seatRelease } : {}) },
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

const serverEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  WEAPP_WS_PORT: String(port),
  WEAPP_EMPTY_ROOM_TIMEOUT_MS: '60000',
  WEAPP_TURN_TIMEOUT_MS: '60000',
  WEAPP_ROOM_STATE_FILE: roomStateFile,
  GAME_TICKET_REQUIRED: 'true',
  GAME_TICKET_SECRET: ticketSecret,
  GAME_RESULT_SECRET: resultSecret,
  GAME_SPECTATOR_EVENT_SECRET: spectatorSecret,
  GAME_SPECTATOR_EVENT_ENDPOINT: `http://127.0.0.1:${spectatorPort}/api/v1/game/spectator-events`,
  GAME_SPECTATOR_OUTBOX_FILE: spectatorOutboxFile,
  WEAPP_TEST_FAIL_GAME_START_PERSIST_ONCE: '1',
}

let child = null
const launchServer = () => {
  child = spawn(process.execPath, ['server/weapp-ws.js'], {
    cwd: process.cwd(),
    env: serverEnvironment,
    stdio: process.env.WEAPP_SMOKE_VERBOSE === '1' ? 'inherit' : 'ignore',
  })
  return child
}

const stopServer = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await Promise.race([
    exited,
    delay(5000).then(() => { throw new Error('好友票据联机服务关闭超时') }),
  ])
}

const crashServer = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await Promise.race([
    exited,
    delay(5000).then(() => { throw new Error('好友票据联机服务崩溃注入关闭超时') }),
  ])
}

const connectOnce = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  const onOpen = () => {
    socket.removeEventListener('error', onError)
    sockets.push(socket)
    resolve(socket)
  }
  const onError = error => {
    socket.removeEventListener('open', onOpen)
    reject(error)
  }
  socket.addEventListener('open', onOpen, { once: true })
  socket.addEventListener('error', onError, { once: true })
})

const connect = async () => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try { return await connectOnce() } catch { await delay(50) }
  }
  throw new Error('好友票据联机服务启动超时')
}

const waitMessage = (socket, type, requestId, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const timeoutError = new Error(`等待 ${type}/${requestId ?? '*'} 超时`)
  const timer = setTimeout(() => {
    socket.removeEventListener('message', handler)
    reject(timeoutError)
  }, timeoutMs)
  const handler = ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type !== type || (requestId !== undefined && packet.requestId !== requestId)) return
    clearTimeout(timer)
    socket.removeEventListener('message', handler)
    resolve(packet)
  }
  socket.addEventListener('message', handler)
})

let requestId = 1
const sendAndWait = async (socket, type, payload, responseType = 'actionAccepted') => {
  const currentRequestId = requestId++
  const response = waitMessage(socket, responseType, currentRequestId)
  sendProtocolCommand(socket, type, payload, currentRequestId)
  return response
}

const expectError = async (socket, type, payload) => sendAndWait(socket, type, payload, 'error')

const issueFriendTicket = (service, {
  userId,
  match = matchId,
  room = roomId,
  seat,
  purpose = 'entry',
  expiresAt = roomExpiresAt,
}) => (
  service.issue({
    userId,
    matchId: match,
    roomId: room,
    seat,
    roomKind: 'friend',
    purpose,
    roomExpiresAt: expiresAt,
    roomSettings,
  })
)
const ticketPayload = issued => ({
  gameTicket: issued.gameTicket,
  entryAttemptId: issued.claims.entryAttemptId,
})

const assertFriendLobby = packet => {
  assert.equal(packet.phase, 'lobby')
  assert.equal(packet.state, null)
  assert.equal(packet.entryKind, 'friend')
  assert.equal(packet.lobbyReadyRequired, true)
  assert.deepEqual(packet.capabilities, {
    canUseBots: false,
    canKickMembers: true,
    requiresLobbyReady: true,
  })
  assert.deepEqual(packet.roomSettings, roomSettings)
}

const waitForPersistedRoom = async (targetRoomId, predicate = () => true) => {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    try {
      const snapshot = JSON.parse(readFileSync(roomStateFile, 'utf8'))
      const room = snapshot.rooms.find(candidate => candidate.roomId === targetRoomId)
      if (room && predicate(room, snapshot)) return { room, snapshot }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await delay(25)
  }
  throw new Error(`等待房间 ${targetRoomId} 持久化超时`)
}

const longTickets = new GameTicketService({
  secret: ticketSecret,
  ttlMs: 30_000,
  gameEndpoint: `ws://127.0.0.1:${port}/weapp`,
})
const shortTickets = new GameTicketService({
  secret: ticketSecret,
  ttlMs: 2500,
  gameEndpoint: `ws://127.0.0.1:${port}/weapp`,
})

try {
  launchServer()
  const guest = await connect()
  const shortGuestTicket = issueFriendTicket(shortTickets, { userId: 'usr-friend-2', seat: 'p2' })
  const missingAttempt = await expectError(guest, 'joinRoom', { roomId, gameTicket: shortGuestTicket.gameTicket })
  assert.equal(missingAttempt.code, 'ENTRY_ATTEMPT_MISMATCH')
  const wrongAttempt = await expectError(guest, 'joinRoom', {
    roomId,
    gameTicket: shortGuestTicket.gameTicket,
    entryAttemptId: 'wrong_entry_attempt_nonce_1234',
  })
  assert.equal(wrongAttempt.code, 'ENTRY_ATTEMPT_MISMATCH')
  const guestFirst = await sendAndWait(guest, 'joinRoom', {
    roomId,
    ...ticketPayload(shortGuestTicket),
  }, 'roomJoined')
  assert.equal(guestFirst.myPlayerId, 'p2')
  assertFriendLobby(guestFirst)

  await delay(Math.max(0, shortGuestTicket.claims.exp * 1000 - Date.now() + 75))
  assert.ok(Date.now() >= shortGuestTicket.claims.exp * 1000, '测试前置条件：首位访客的短票必须已经过期')
  const beforeHost = await waitForPersistedRoom(roomId)
  assert.equal(beforeHost.room.entryDeadlineAt, roomExpiresAt, '好友房入桌期限应来自房间租约而不是首张短票')

  const host = await connect()
  const hostTicket = issueFriendTicket(longTickets, { userId: 'usr-friend-1', seat: 'p1' })
  const hostCreated = await sendAndWait(host, 'createRoom', {
    roomId,
    hostName: '好友房主',
    ...ticketPayload(hostTicket),
  }, 'roomCreated')
  assert.equal(hostCreated.myPlayerId, 'p1')
  assertFriendLobby(hostCreated)
  assert.equal((await waitForPersistedRoom(roomId)).room.entryDeadlineAt, roomExpiresAt)

  const botDenied = await expectError(host, 'addBot', { roomId, playerId: 'p4' })
  assert.match(botDenied.message, /票据房.*不允许.*机器人/)

  const firstLeave = sendAndWait(guest, 'safeExit', { roomId }, 'roomLeft')
  const firstSeatLeftEvent = await firstSeatLeftSeen
  assert.equal(firstSeatLeftEvent.playerId, 'p2')
  await firstLeave
  const racedReturnTicket = issueFriendTicket(longTickets, { userId: 'usr-friend-2', seat: 'p2' })
  const releasePending = await expectError(guest, 'joinRoom', {
    roomId,
    ...ticketPayload(racedReturnTicket),
  })
  assert.equal(releasePending.code, 'FRIEND_SEAT_RELEASE_PENDING', '平台离席回执前必须封锁竞态恢复票')
  firstSeatLeftReleaseResolve(racedReturnTicket.claims)
  await waitForPersistedRoom(roomId, room => (
    !room.pendingSpectatorEvents.some(event => event.type === 'seat-left') &&
    room.revokedTicketJtis.some(item => item.jti === racedReturnTicket.claims.jti)
  ))
  const racedTicketRevoked = await expectError(guest, 'joinRoom', {
    roomId,
    ...ticketPayload(racedReturnTicket),
  })
  assert.equal(racedTicketRevoked.code, 'FRIEND_ROOM_TICKET_REVOKED', '离席回执必须撤销竞态期间平台签发的票据')
  const staleFirstReturnTicket = issueFriendTicket(longTickets, { userId: 'usr-friend-2', seat: 'p2' })
  const firstReturnTicket = issueFriendTicket(longTickets, { userId: 'usr-friend-2', seat: 'p2' })
  assert.equal((await sendAndWait(guest, 'joinRoom', {
    roomId,
    ...ticketPayload(firstReturnTicket),
  }, 'roomJoined')).myPlayerId, 'p2')
  nextSeatReleaseRevocations = [staleFirstReturnTicket.claims, firstReturnTicket.claims].map(({ jti, exp }) => ({ jti, exp }))
  await sendAndWait(guest, 'safeExit', { roomId }, 'roomLeft')

  await waitForPersistedRoom(roomId, room => (
    room.revokedTicketJtis.some(item => item.jti === staleFirstReturnTicket.claims.jti) &&
    room.revokedTicketJtis.some(item => item.jti === firstReturnTicket.claims.jti)
  ))
  const staleTicketRevoked = await expectError(guest, 'joinRoom', {
    roomId,
    ...ticketPayload(staleFirstReturnTicket),
  })
  assert.equal(staleTicketRevoked.code, 'FRIEND_ROOM_TICKET_REVOKED', '同席更旧但未消费的 T1 也必须随离席世代撤销')
  const revokedTicket = await expectError(guest, 'joinRoom', {
    roomId,
    ...ticketPayload(firstReturnTicket),
  })
  assert.equal(revokedTicket.code, 'FRIEND_ROOM_TICKET_REVOKED')
  const secondReturnTicket = issueFriendTicket(longTickets, { userId: 'usr-friend-2', seat: 'p2' })
  const guestReturned = await sendAndWait(guest, 'joinRoom', {
    roomId,
    ...ticketPayload(secondReturnTicket),
  }, 'roomJoined')
  assert.equal(guestReturned.myPlayerId, 'p2', '主动离桌用户应可凭新 JTI 返回')

  const thirdSeat = await connect()
  const kickedUserId = 'usr-friend-kicked'
  const kickedTicket = issueFriendTicket(longTickets, { userId: kickedUserId, seat: 'p3' })
  assert.equal((await sendAndWait(thirdSeat, 'joinRoom', {
    roomId,
    ...ticketPayload(kickedTicket),
  }, 'roomJoined')).myPlayerId, 'p3')
  const kickedNotice = waitMessage(thirdSeat, 'roomKicked', undefined)
  await sendAndWait(host, 'kickMember', { roomId, playerId: 'p3' })
  assert.equal((await kickedNotice).reason, 'host-kicked')

  const kickedOldTicket = await expectError(thirdSeat, 'joinRoom', {
    roomId,
    ...ticketPayload(kickedTicket),
  })
  assert.equal(kickedOldTicket.code, 'FRIEND_ROOM_PARTICIPANT_REVOKED')
  const kickedReplacementTicket = issueFriendTicket(longTickets, { userId: kickedUserId, seat: 'p3' })
  const kickedNewTicket = await expectError(thirdSeat, 'joinRoom', {
    roomId,
    ...ticketPayload(kickedReplacementTicket),
  })
  assert.equal(kickedNewTicket.code, 'FRIEND_ROOM_PARTICIPANT_REVOKED')

  const replacementTicket = issueFriendTicket(longTickets, { userId: 'usr-friend-3-replacement', seat: 'p3' })
  const replacementJoined = await sendAndWait(thirdSeat, 'joinRoom', {
    roomId,
    ...ticketPayload(replacementTicket),
  }, 'roomJoined')
  assert.equal(replacementJoined.myPlayerId, 'p3')
  const fourthSeat = await connect()
  const fourthTicket = issueFriendTicket(longTickets, { userId: 'usr-friend-4', seat: 'p4' })
  const fourthJoined = await sendAndWait(fourthSeat, 'joinRoom', {
    roomId,
    ...ticketPayload(fourthTicket),
  }, 'roomJoined')
  assert.equal(fourthJoined.myPlayerId, 'p4')
  assertFriendLobby(fourthJoined)

  let autoStarted = false
  const autoStartHandler = ({ data }) => {
    if (JSON.parse(data).type === 'gameState') autoStarted = true
  }
  ;[host, guest, thirdSeat, fourthSeat].forEach(socket => socket.addEventListener('message', autoStartHandler))
  await delay(250)
  ;[host, guest, thirdSeat, fourthSeat].forEach(socket => socket.removeEventListener('message', autoStartHandler))
  assert.equal(autoStarted, false, '好友房四席到齐后不得自动发牌')

  for (const socket of [host, guest, thirdSeat, fourthSeat]) {
    await sendAndWait(socket, 'setLobbyReady', { roomId })
  }

  let claimReleased = false
  let gameStateBeforeClaim = false
  const claimBarrierHandler = ({ data }) => {
    if (JSON.parse(data).type === 'gameState' && !claimReleased) gameStateBeforeClaim = true
  }
  ;[host, guest, thirdSeat, fourthSeat].forEach(socket => socket.addEventListener('message', claimBarrierHandler))
  const startRequestId = requestId++
  const pendingPackets = [host, guest, thirdSeat, fourthSeat].map(socket => waitMessage(socket, 'roomMembers', undefined, 5000))
  sendProtocolCommand(host, 'startGame', { roomId }, startRequestId)
  const startEvent = await Promise.race([
    startClaimSeen,
    delay(4000).then(() => { throw new Error('平台未收到同步 game-start claim') }),
  ])
  assert.equal(startEvent.type, 'game-start')
  const pendingForAllSeats = await Promise.all(pendingPackets)
  assert.ok(pendingForAllSeats.every(packet => packet.gameStartPending === true && packet.phase === undefined), '开局确认中元数据必须广播给四席')
  assert.equal(new Set(pendingForAllSeats.map(packet => packet.version)).size, 1, '四席必须收到同一版本的开局确认状态')
  await delay(150)
  assert.equal(gameStateBeforeClaim, false, '平台确认返回前不得向客户端发布 gameState')

  const pendingSnapshot = await waitForPersistedRoom(roomId, room => Boolean(room.pendingGameStartEvent && room.pendingGameStartRequest))
  assert.equal(pendingSnapshot.room.pendingGameStartRequest.requestId, startRequestId)
  await crashServer()
  launchServer()
  const pendingRestartTokens = {
    p1: hostCreated.resumeToken,
    p2: guestReturned.resumeToken,
    p3: replacementJoined.resumeToken,
    p4: fourthJoined.resumeToken,
  }
  const pendingRestartConnections = {}
  const pendingRestartPackets = {}
  for (const seat of ['p1', 'p2', 'p3', 'p4']) {
    const socket = await connect()
    const finalSeatMetadata = seat === 'p4'
      ? waitMessage(pendingRestartConnections.p1, 'roomMembers', undefined, 7000)
      : null
    const packet = await sendAndWait(socket, 'rejoinRoom', {
      roomId,
      myPlayerId: seat,
      resumeToken: pendingRestartTokens[seat],
    }, 'roomRejoined')
    assert.equal(packet.gameStartPending, true, `重启恢复时 ${seat} 必须看到开局确认中状态`)
    assert.equal(packet.phase, 'lobby')
    pendingRestartConnections[seat] = socket
    pendingRestartPackets[seat] = packet
    if (finalSeatMetadata) {
      const metadata = await finalSeatMetadata
      assert.equal(metadata.version, packet.version, '必须先消费 p4 重连触发的成员元数据再释放开局 claim')
    }
  }
  const beforeFinalize = await waitForPersistedRoom(roomId, room => (
    room.pendingGameStartEvent && room.pendingGameStartRequest && room.state === null && room.gameStartClaimedAt === null
  ))
  const startAccepted = waitMessage(pendingRestartConnections.p1, 'actionAccepted', startRequestId, 7000).then(
    value => ({ value }),
    error => ({ error }),
  )
  const durableFailurePending = waitMessage(pendingRestartConnections.p1, 'roomMembers', undefined, 7000)
  const gameStates = ['p1', 'p3', 'p4'].map(seat => waitMessage(pendingRestartConnections[seat], 'gameState', undefined, 7000))
  claimReleased = true
  startClaimReleaseResolve()
  const rollbackPacket = await durableFailurePending
  assert.equal(rollbackPacket.gameStartPending, true)
  assert.equal(rollbackPacket.version, beforeFinalize.room.version, '开局落盘失败不得推进房间版本')
  assert.equal(rollbackPacket.gameVersion, beforeFinalize.room.gameVersion, '开局落盘失败不得推进牌局版本')
  const rolledBack = await waitForPersistedRoom(roomId, room => (
    room.pendingGameStartEvent && room.pendingGameStartRequest && room.state === null &&
    Number.isSafeInteger(room.gameStartClaimedAt) && Number.isSafeInteger(room.gameStartReconnectDeadlineAt) &&
    room.version === beforeFinalize.room.version && room.gameVersion === beforeFinalize.room.gameVersion
  ))
  assert.equal(rolledBack.room.version, beforeFinalize.room.version)
  assert.equal(rolledBack.room.gameVersion, beforeFinalize.room.gameVersion)
  assert.equal(rolledBack.room.matchStartedAt, null)
  assert.equal(rolledBack.room.totalDeadlineAt, null)
  assert.equal(rolledBack.room.turnDeadlineAt, null)
  assert.deepEqual(rolledBack.room.statsBySeat, beforeFinalize.room.statsBySeat)
  assert.deepEqual(rolledBack.room.roundStatsBySeat, beforeFinalize.room.roundStatsBySeat)

  const pendingP2Closed = new Promise(resolve => pendingRestartConnections.p2.addEventListener('close', resolve, { once: true }))
  pendingRestartConnections.p2.close()
  await pendingP2Closed
  const pendingRecoveryTicket = issueFriendTicket(longTickets, {
    userId: 'usr-friend-2',
    seat: 'p2',
    purpose: 'rejoin',
  })
  const pendingRecoverySocket = await connect()
  // Register before joining: the retry may publish gameState immediately after
  // roomRejoined, before the idempotent replay below has finished awaiting.
  gameStates.push(waitMessage(pendingRecoverySocket, 'gameState', undefined, 7000))
  const pendingRecoveryRequestId = requestId++
  const pendingRecoveryPayload = { roomId, ...ticketPayload(pendingRecoveryTicket) }
  const pendingRecoveryResponse = waitMessage(pendingRecoverySocket, 'roomRejoined', pendingRecoveryRequestId, 7000)
  sendProtocolCommand(pendingRecoverySocket, 'joinRoom', pendingRecoveryPayload, pendingRecoveryRequestId)
  const pendingRecovered = await pendingRecoveryResponse
  assert.equal(pendingRecovered.gameStartPending, true)
  assert.equal(pendingRecovered.phase, 'lobby')
  assert.equal(pendingRecovered.state, null)
  assert.equal(pendingRecovered.tribute, null)
  assert.equal(pendingRecovered.myPlayerId, 'p2')
  assert.ok(pendingRecovered.version > rollbackPacket.version)
  const replayedPendingRecovery = waitMessage(pendingRecoverySocket, 'roomRejoined', pendingRecoveryRequestId, 7000)
  sendProtocolCommand(pendingRecoverySocket, 'joinRoom', pendingRecoveryPayload, pendingRecoveryRequestId)
  assert.deepEqual(await replayedPendingRecovery, pendingRecovered, 'pending 恢复必须按同一 requestId 稳定重放原等待快照')
  pendingRestartConnections.p2 = pendingRecoverySocket
  pendingRestartPackets.p2 = pendingRecovered
  const startAcceptedResult = await startAccepted
  if (startAcceptedResult.error) throw startAcceptedResult.error
  const startedStates = await Promise.all(gameStates)
  assert.ok(startedStates.every(packet => packet.state.currentLevel === 'A' && packet.state.matchFormat.kind === 'independent'), '好友房签名规则在开局、服务端恢复后仍固定打A')
  assert.ok(startedStates.every(packet => packet.phase === 'playing' && packet.roomId === roomId))
  ;[host, guest, thirdSeat, fourthSeat].forEach(socket => socket.removeEventListener('message', claimBarrierHandler))

  const tombstoneHost = await connect()
  const tombstoneTicket = issueFriendTicket(longTickets, {
    userId: 'usr-closed-host',
    match: closedMatchId,
    room: closedRoomId,
    seat: 'p1',
    expiresAt: closedRoomExpiresAt,
  })
  await sendAndWait(tombstoneHost, 'createRoom', {
    roomId: closedRoomId,
    hostName: '关闭房房主',
    ...ticketPayload(tombstoneTicket),
  }, 'roomCreated')
  await sendAndWait(tombstoneHost, 'safeExit', { roomId: closedRoomId }, 'roomLeft')
  await waitForPersistedRoom(roomId, (_room, snapshot) => (
    snapshot.closedRoomTombstones.some(item => item.roomId === closedRoomId && item.matchId === closedMatchId)
  ))

  const recoveryUsers = {
    p1: 'usr-friend-1',
    p2: 'usr-friend-2',
    p3: 'usr-friend-3-replacement',
    p4: 'usr-friend-4',
  }
  const previousResumeTokens = {
    p1: pendingRestartPackets.p1.resumeToken,
    p2: pendingRestartPackets.p2.resumeToken,
    p3: pendingRestartPackets.p3.resumeToken,
    p4: pendingRestartPackets.p4.resumeToken,
  }
  const recoveryTickets = Object.fromEntries(Object.entries(recoveryUsers).map(([seat, userId]) => [
    seat,
    issueFriendTicket(longTickets, { userId, seat, purpose: 'rejoin' }),
  ]))
  const wrongUserRecovery = issueFriendTicket(longTickets, {
    userId: 'usr-friend-intruder',
    seat: 'p2',
    purpose: 'rejoin',
  })
  const wrongSeatRecovery = issueFriendTicket(longTickets, {
    userId: recoveryUsers.p2,
    seat: 'p3',
    purpose: 'rejoin',
  })

  await stopServer()
  launchServer()
  const invalidRecoverySocket = await connect()
  const replayedP1Entry = await expectError(invalidRecoverySocket, 'createRoom', {
    roomId,
    hostName: '旧票重放',
    ...ticketPayload(hostTicket),
  })
  assert.equal(replayedP1Entry.code, 'GAME_TICKET_USED', '重启后当前 p1 entry JTI 仍必须视为已消费')
  const replayedP2Entry = await expectError(invalidRecoverySocket, 'joinRoom', {
    roomId,
    ...ticketPayload(secondReturnTicket),
  })
  assert.equal(replayedP2Entry.code, 'FRIEND_ROOM_TICKET_REVOKED', '平台 pending 恢复轮换后，p2 旧 entry JTI 必须在重启后保持撤销')
  const staleT1AfterRestart = await expectError(invalidRecoverySocket, 'joinRoom', {
    roomId,
    ...ticketPayload(staleFirstReturnTicket),
  })
  assert.equal(staleT1AfterRestart.code, 'FRIEND_ROOM_TICKET_REVOKED', '重启后离席世代内未消费的旧 T1 仍必须保持撤销')
  const wrongUser = await expectError(invalidRecoverySocket, 'joinRoom', {
    roomId,
    ...ticketPayload(wrongUserRecovery),
  })
  assert.equal(wrongUser.code, 'RECOVERY_BINDING_MISMATCH')
  assert.match(wrongUser.message, /用户|身份|绑定/)
  const wrongSeat = await expectError(invalidRecoverySocket, 'joinRoom', {
    roomId,
    ...ticketPayload(wrongSeatRecovery),
  })
  assert.equal(wrongSeat.code, 'RECOVERY_BINDING_MISMATCH')
  assert.match(wrongSeat.message, /席位|用户|身份|绑定/)

  const recoveredConnections = {}
  const recoveredPackets = {}
  for (const seat of ['p1', 'p2', 'p3', 'p4']) {
    const socket = await connect()
    const recovered = await sendAndWait(socket, 'joinRoom', {
      roomId,
      ...ticketPayload(recoveryTickets[seat]),
    }, 'roomRejoined')
    assert.equal(recovered.myPlayerId, seat, `purpose=rejoin 必须允许 ${seat} 恢复其原席位`)
    assert.equal(recovered.phase, 'playing')
    assert.notEqual(recovered.resumeToken, previousResumeTokens[seat], '平台恢复票必须原子轮换本地恢复凭证')
    recoveredConnections[seat] = socket
    recoveredPackets[seat] = recovered
  }

  const p2Closed = new Promise(resolve => recoveredConnections.p2.addEventListener('close', resolve, { once: true }))
  recoveredConnections.p2.close()
  await p2Closed
  await delay(75)
  const consumedRecoverySocket = await connect()
  const consumedRecovery = await expectError(consumedRecoverySocket, 'joinRoom', {
    roomId,
    ...ticketPayload(recoveryTickets.p2),
  })
  assert.equal(consumedRecovery.code, 'RECOVERY_TICKET_USED')
  assert.match(consumedRecovery.message, /已使用|消费|失效/)
  const staleLocalToken = await expectError(consumedRecoverySocket, 'rejoinRoom', {
    roomId,
    myPlayerId: 'p2',
    resumeToken: previousResumeTokens.p2,
  })
  assert.match(staleLocalToken.message, /重连凭证无效/)
  const localRecovery = await sendAndWait(consumedRecoverySocket, 'rejoinRoom', {
    roomId,
    myPlayerId: 'p2',
    resumeToken: recoveredPackets.p2.resumeToken,
  }, 'roomRejoined')
  assert.equal(localRecovery.myPlayerId, 'p2')
  assert.notEqual(localRecovery.resumeToken, recoveredPackets.p2.resumeToken, '本地重连快路径也必须轮换恢复凭证')

  const afterRestart = await connect()
  const kickedAfterRestart = issueFriendTicket(longTickets, { userId: kickedUserId, seat: 'p3' })
  const durableRevocation = await expectError(afterRestart, 'joinRoom', {
    roomId,
    ...ticketPayload(kickedAfterRestart),
  })
  assert.equal(durableRevocation.code, 'FRIEND_ROOM_PARTICIPANT_REVOKED', '重启后仍应拒绝被移出的同一用户')

  const tombstoneRetry = issueFriendTicket(longTickets, {
    userId: 'usr-closed-host',
    match: closedMatchId,
    room: closedRoomId,
    seat: 'p1',
    expiresAt: closedRoomExpiresAt,
  })
  const durableTombstone = await expectError(afterRestart, 'createRoom', {
    roomId: closedRoomId,
    hostName: '关闭房房主',
    ...ticketPayload(tombstoneRetry),
  })
  assert.equal(durableTombstone.code, 'ROOM_CLOSED', '重启后仍应拒绝已关闭房间的新 JTI')
  assert.equal(collectorError, null)
  console.log('weapp signed friend-ticket integration passed')
} finally {
  startClaimReleaseResolve()
  firstSeatLeftReleaseResolve({ jti: 'cleanup', exp: Math.floor(Date.now() / 1000) + 60 })
  sockets.forEach(socket => socket.close())
  await stopServer().catch(() => {})
  await new Promise(resolve => collector.close(resolve))
  rmSync(tempDirectory, { recursive: true, force: true })
}
