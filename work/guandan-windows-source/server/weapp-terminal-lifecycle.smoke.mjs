import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GameTicketService,
  gameResultSignature,
  spectatorEventSignature,
} from './platform/crypto.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'

const ticketSecret = 'terminal-ticket-smoke-secret-at-least-thirty-two-characters'
const spectatorSecret = 'terminal-spectator-smoke-secret-at-least-thirty-two-characters'
const lifecycleSecret = 'terminal-lifecycle-smoke-secret-at-least-thirty-two-characters'
const root = mkdtempSync(join(tmpdir(), 'guandan-terminal-lifecycle-'))
const sockets = []
const children = new Set()
const attempts = []
const acceptedEvents = []
const acceptedEventIds = new Set()
const resultAttempts = []
const acceptedResultIds = new Set()
let collectorError = null
let nextRequestId = 1

const matches = {
  round: { matchId: 'mat-terminal-round-limit', roomId: '401001', port: 39117 },
  time: { matchId: 'mat-terminal-time-limit', roomId: '401002', port: 39118 },
  rejected: { matchId: 'mat-terminal-start-rejected', roomId: '401003', port: 39119 },
  participantLost: { matchId: 'mat-terminal-participant-lost', roomId: '401004', port: 39120 },
  passedA: { matchId: 'mat-terminal-passed-a', roomId: '401005', port: 39121 },
  ordinaryRound: { matchId: 'mat-terminal-ordinary-round', roomId: '401006', port: 39122 },
  claimedRestart: { matchId: 'mat-terminal-claimed-restart', roomId: '401007', port: 39123 },
  claimedTimeout: { matchId: 'mat-terminal-claimed-timeout', roomId: '401008', port: 39124 },
}

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const terminalGates = new Map([
  [matches.round.matchId, { seen: deferred(), release: deferred() }],
  [matches.time.matchId, { seen: deferred(), release: deferred() }],
])
const participantLostStartGate = { seen: deferred(), release: deferred() }
const lifecycleTypes = new Set(['game-start', 'match-ended', 'seat-left', 'room-closed'])
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const collector = createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf8')
    try {
      const event = JSON.parse(rawBody)
      if (request.url === '/api/v1/game-results') {
        const timestamp = String(request.headers['x-game-timestamp'] || '')
        const eventId = String(request.headers['x-game-event-id'] || '')
        assert.equal(event.eventId, eventId)
        assert.equal(request.headers['x-game-signature'], gameResultSignature(rawBody, lifecycleSecret, timestamp))
        const duplicate = acceptedResultIds.has(eventId)
        resultAttempts.push(event)
        acceptedResultIds.add(eventId)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          ok: true,
          data: { result: { eventId, accepted: true, duplicate } },
          error: null,
        }))
        return
      }
      const spectatorTimestamp = String(request.headers['x-spectator-timestamp'] || '')
      const eventId = String(request.headers['x-spectator-event-id'] || '')
      assert.equal(request.url, '/api/v1/game/spectator-events')
      assert.equal(event.eventId, eventId)
      assert.equal(
        request.headers['x-spectator-signature'],
        spectatorEventSignature(rawBody, spectatorSecret, spectatorTimestamp),
      )
      if (lifecycleTypes.has(event.type)) {
        const lifecycleTimestamp = String(request.headers['x-game-timestamp'] || '')
        assert.equal(request.headers['x-game-event-id'], eventId)
        assert.equal(lifecycleTimestamp, spectatorTimestamp)
        assert.equal(
          request.headers['x-game-signature'],
          gameResultSignature(rawBody, lifecycleSecret, lifecycleTimestamp),
        )
      }
      attempts.push({ event, lifecycleSigned: Boolean(request.headers['x-game-signature']) })

      if (event.matchId === matches.rejected.matchId && event.type === 'game-start') {
        response.writeHead(409, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          ok: false,
          data: null,
          error: { code: 'MATCH_ENTRY_EXPIRED', message: '模拟平台终态拒绝开局' },
        }))
        return
      }
      if (event.matchId === matches.participantLost.matchId && event.type === 'game-start') {
        participantLostStartGate.seen.resolve(event)
        await participantLostStartGate.release.promise
      }

      const gate = event.type === 'match-ended' ? terminalGates.get(event.matchId) : null
      if (gate) {
        gate.seen.resolve(event)
        await gate.release.promise
      }

      const duplicate = acceptedEventIds.has(eventId)
      if (!duplicate) {
        acceptedEventIds.add(eventId)
        acceptedEvents.push(event)
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        ok: true,
        data: {
          event: event.type === 'game-start'
            ? {
                eventId,
                accepted: true,
                duplicate,
                lifecycleClaim: { accepted: true, status: 'playing', startedAt: Date.now() },
              }
            : { eventId, accepted: true, duplicate },
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
const collectorPort = collector.address().port

const pathsFor = label => ({
  stateFile: join(root, `${label}-rooms.json`),
  outboxFile: join(root, `${label}-spectator-outbox.json`),
  resultOutboxFile: join(root, `${label}-result-outbox.json`),
})

const launch = ({ port, stateFile, outboxFile, resultOutboxFile, totalMinuteMs = 60_000, extraEnv = {} }) => {
  const child = spawn(process.execPath, ['server/weapp-ws.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      WEAPP_WS_PORT: String(port),
      WEAPP_TURN_TIMEOUT_MS: '60000',
      WEAPP_EMPTY_ROOM_TIMEOUT_MS: '60000',
      WEAPP_TOTAL_MINUTE_MS: String(totalMinuteMs),
      WEAPP_ROOM_STATE_FILE: stateFile,
      GAME_TICKET_REQUIRED: 'true',
      GAME_TICKET_SECRET: ticketSecret,
      GAME_RESULT_SECRET: lifecycleSecret,
      GAME_RESULT_ENDPOINT: `http://127.0.0.1:${collectorPort}/api/v1/game-results`,
      GAME_RESULT_OUTBOX_FILE: resultOutboxFile,
      GAME_SPECTATOR_EVENT_SECRET: spectatorSecret,
      GAME_SPECTATOR_EVENT_ENDPOINT: `http://127.0.0.1:${collectorPort}/api/v1/game/spectator-events`,
      GAME_SPECTATOR_OUTBOX_FILE: outboxFile,
      ...extraEnv,
    },
    stdio: 'ignore',
  })
  children.add(child)
  return child
}

const stop = async child => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await Promise.race([
    exited,
    delay(5000).then(() => { throw new Error('终局联机服务关闭超时') }),
  ])
  children.delete(child)
}

const crash = async child => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await Promise.race([
    exited,
    delay(5000).then(() => { throw new Error('终局联机服务崩溃注入关闭超时') }),
  ])
  children.delete(child)
}

const connectOnce = port => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  const opened = () => {
    socket.removeEventListener('error', failed)
    sockets.push(socket)
    resolve(socket)
  }
  const failed = error => {
    socket.removeEventListener('open', opened)
    reject(error)
  }
  socket.addEventListener('open', opened, { once: true })
  socket.addEventListener('error', failed, { once: true })
})

const connect = async port => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try { return await connectOnce(port) } catch { await delay(50) }
  }
  throw new Error(`终局联机服务 ${port} 启动超时`)
}

const waitMessage = (socket, type, requestId, timeoutMs = 6000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.removeEventListener('message', handler)
    reject(new Error(`等待 ${type}/${requestId ?? '*'} 超时`))
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

const sendAndWait = async (socket, type, payload, responseType = 'actionAccepted', timeoutMs = 6000) => {
  const requestId = nextRequestId++
  const response = waitMessage(socket, responseType, requestId, timeoutMs)
  sendProtocolCommand(socket, type, payload, requestId)
  return response
}

const readJson = filePath => JSON.parse(readFileSync(filePath, 'utf8'))
const outboxEvents = filePath => {
  try { return readJson(filePath).events || [] } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}
const waitUntil = async (predicate, message, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (collectorError) throw collectorError
    const result = await predicate()
    if (result) return result
    await delay(25)
  }
  throw new Error(message)
}

const acceptedEvent = (matchId, type) => acceptedEvents.find(event => event.matchId === matchId && event.type === type)
const waitForAccepted = (matchId, type, timeoutMs = 6000) => waitUntil(
  () => acceptedEvent(matchId, type),
  `等待 ${matchId}/${type} ACK 超时`,
  timeoutMs,
)

const baseSettings = overrides => normalizeFriendRoomSettings({
  rounds: 4,
  scoring: 'double-3',
  scoreVisibility: 'live',
  turnSeconds: 60,
  trusteeSeconds: 0,
  totalTimeMinutes: 0,
  spectator: 'live',
  autoSort: true,
  disableInteraction: false,
  sortOrder: 'desc',
  ...overrides,
}, { strict: true })

const enterRoom = async ({ port, roomId, matchId, roomSettings }) => {
  const roomExpiresAt = Date.now() + 120_000
  const tickets = new GameTicketService({
    secret: ticketSecret,
    ttlMs: 60_000,
    gameEndpoint: `ws://127.0.0.1:${port}/weapp`,
  })
  const seats = {}
  const entries = {}
  const issued = {}
  for (const [index, seat] of ['p1', 'p2', 'p3', 'p4'].entries()) {
    issued[seat] = tickets.issue({
      userId: `${matchId}-user-${index + 1}`,
      matchId,
      roomId,
      seat,
      roomKind: 'friend',
      roomExpiresAt,
      roomSettings,
    })
    seats[seat] = await connect(port)
  }
  entries.p1 = await sendAndWait(seats.p1, 'createRoom', {
    roomId,
    hostName: '终局测试房主',
    entryAttemptId: issued.p1.claims.entryAttemptId,
    gameTicket: issued.p1.gameTicket,
  }, 'roomCreated')
  for (const seat of ['p2', 'p3', 'p4']) {
    entries[seat] = await sendAndWait(seats[seat], 'joinRoom', {
      roomId,
      entryAttemptId: issued[seat].claims.entryAttemptId,
      gameTicket: issued[seat].gameTicket,
    }, 'roomJoined')
  }
  return { seats, entries, tickets, issued, roomExpiresAt }
}

const readyRoom = async ({ seats }, roomId) => {
  for (const seat of ['p1', 'p2', 'p3', 'p4']) {
    await sendAndWait(seats[seat], 'setLobbyReady', { roomId })
  }
}

const startRoom = async (entered, roomId) => {
  const requestId = nextRequestId++
  const accepted = waitMessage(entered.seats.p1, 'actionAccepted', requestId)
  const states = Object.fromEntries(Object.entries(entered.seats).map(([seat, socket]) => [
    seat,
    waitMessage(socket, 'gameState', undefined),
  ]))
  sendProtocolCommand(entered.seats.p1, 'startGame', { roomId }, requestId)
  await accepted
  return Object.fromEntries(await Promise.all(Object.entries(states).map(async ([seat, pending]) => [seat, await pending])))
}

const pendingTerminalEvent = (stateFile, roomId) => {
  try {
    const snapshot = readJson(stateFile)
    const room = snapshot.rooms.find(candidate => candidate.roomId === roomId)
    return room?.pendingSpectatorEvents?.find(event => event.type === 'match-ended') || null
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}
const pendingRoundFinalization = (stateFile, roomId) => {
  try {
    const room = readJson(stateFile).rooms.find(candidate => candidate.roomId === roomId)
    return room?.pendingRoundFinalization || null
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

const assertPendingAndDrain = async ({ matchId, roomId, stateFile, outboxFile, event, release }) => {
  const persistedEvent = await waitUntil(
    () => pendingTerminalEvent(stateFile, roomId),
    `${matchId} reporter ACK 前快照未保留 pending match-ended`,
  )
  assert.deepEqual(persistedEvent, event)
  const stagedEvent = await waitUntil(
    () => outboxEvents(outboxFile).find(candidate => candidate.eventId === event.eventId),
    `${matchId} reporter ACK 前 outbox 未保留 match-ended`,
  )
  assert.deepEqual(stagedEvent, event)
  release.resolve()
  await waitForAccepted(matchId, 'match-ended')
  await waitUntil(() => (
    !pendingTerminalEvent(stateFile, roomId) && outboxEvents(outboxFile).length === 0
  ), `${matchId} reporter ACK 后 pending/outbox 未排空`)
}

const runRoundLimit = async () => {
  const descriptor = matches.round
  const paths = pathsFor('round-limit')
  const settings = baseSettings({ rounds: 4 })
  let child = launch({
    port: descriptor.port,
    ...paths,
    extraEnv: { WEAPP_TEST_FAIL_ROUND_FINALIZATION_PERSIST_ONCE: '1' },
  })
  try {
    const entered = await enterRoom({ ...descriptor, roomSettings: settings })
    await readyRoom(entered, descriptor.roomId)
    await startRoom(entered, descriptor.roomId)
    await stop(child)

    const snapshot = readJson(paths.stateFile)
    const room = snapshot.rooms.find(candidate => candidate.roomId === descriptor.roomId)
    assert.ok(room?.state, 'round-limit 注入前必须已有真实 WS 开局快照')
    const finalCard = room.state.players.p3.hand.at(-1)
    room.roundSequence = 3
    room.roundResult = null
    room.matchEnded = null
    room.state.phase = 'playing'
    room.state.currentTurn = 'p3'
    room.state.players.p1.hand = []
    room.state.players.p2.hand = []
    room.state.players.p3.hand = [finalCard]
    room.state.finishedPlayers = ['p1', 'p2']
    room.state.trick = { winningPlay: null, passedPlayerIds: [] }
    room.state.lastValidPlay = null
    room.state.playArea = []
    room.state.playHistory = []
    room.state.settlement = null
    room.roundReady = { p1: false, p2: false, p3: false, p4: false }
    writeFileSync(paths.stateFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })

    child = launch({
      port: descriptor.port,
      ...paths,
      extraEnv: { WEAPP_TEST_FAIL_ROUND_FINALIZATION_PERSIST_ONCE: '1' },
    })
    const p3 = await connect(descriptor.port)
    const rejoined = await sendAndWait(p3, 'rejoinRoom', {
      roomId: descriptor.roomId,
      myPlayerId: 'p3',
      resumeToken: entered.entries.p3.resumeToken,
    }, 'roomRejoined')
    assert.equal(rejoined.phase, 'playing')
    await sendAndWait(p3, 'cancelTrustee', { roomId: descriptor.roomId })

    const gate = terminalGates.get(descriptor.matchId)
    let roundEndedCount = 0
    p3.addEventListener('message', ({ data }) => {
      if (JSON.parse(data).type === 'roundEnded') roundEndedCount += 1
    })
    const roundEndedPacket = waitMessage(p3, 'roundEnded', undefined, 7000)
    const playAccepted = sendAndWait(p3, 'play', {
      roomId: descriptor.roomId,
      cardIds: [rejoined.state.players.p3.hand[0].id],
    })
    const pendingFinalization = await waitUntil(
      () => pendingRoundFinalization(paths.stateFile, descriptor.roomId),
      'round-limit 首次提交失败后未持久保留终局动作',
      7000,
    )
    assert.equal(pendingFinalization.result.isGameWon, false)
    assert.equal(roundEndedCount, 0, 'round-limit 安全落盘前不得广播 roundEnded')
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'round-end').length, 0)
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'match-ended').length, 0)
    const event = await Promise.race([
      gate.seen.promise,
      delay(6000).then(() => { throw new Error('未收到 round-limit match-ended') }),
    ])
    assert.equal(event.sequence, 4)
    assert.equal(event.eventId, `spectate:${descriptor.matchId}:4`)
    assert.equal(event.roundSequence, 4)
    assert.equal(event.reason, 'round-limit')
    assert.equal(event.roundsPlayed, 4)
    assert.deepEqual(event.scores, { teamA: 2, teamB: 0 })
    assert.equal(event.winnerTeam, 'teamA')
    assert.ok(Number.isSafeInteger(event.endedAt))
    assert.equal(attempts.find(item => item.event.eventId === event.eventId)?.lifecycleSigned, true)
    const settledPacket = await roundEndedPacket
    assert.equal(settledPacket.matchEnded.winnerTeam, 'teamA')
    assert.equal(roundEndedCount, 1)
    await assertPendingAndDrain({ ...descriptor, ...paths, event, release: gate.release })
    await playAccepted
    await delay(100)
    assert.equal(roundEndedCount, 1, 'round-limit 耐久重试后只能广播一次 roundEnded')
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'round-end').length, 1)
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'match-ended').length, 1)
    assert.equal(resultAttempts.filter(item => item.matchId === descriptor.matchId).length, 0)
  } finally {
    terminalGates.get(descriptor.matchId).release.resolve()
    await stop(child).catch(() => {})
  }
}

const runOrdinaryRound = async () => {
  const descriptor = matches.ordinaryRound
  const paths = pathsFor('ordinary-round')
  const settings = baseSettings({ rounds: 8 })
  let child = launch({ port: descriptor.port, ...paths })
  try {
    const entered = await enterRoom({ ...descriptor, roomSettings: settings })
    await readyRoom(entered, descriptor.roomId)
    await startRoom(entered, descriptor.roomId)
    await stop(child)

    const snapshot = readJson(paths.stateFile)
    const room = snapshot.rooms.find(candidate => candidate.roomId === descriptor.roomId)
    const finalCard = room.state.players.p3.hand.at(-1)
    room.roundSequence = 0
    room.roundResult = null
    room.matchEnded = null
    room.pendingRoundFinalization = null
    room.state.phase = 'playing'
    room.state.currentTurn = 'p3'
    room.state.players.p1.hand = []
    room.state.players.p2.hand = []
    room.state.players.p3.hand = [finalCard]
    room.state.finishedPlayers = ['p1', 'p2']
    room.state.trick = { winningPlay: null, passedPlayerIds: [] }
    room.state.lastValidPlay = null
    room.state.playArea = []
    room.state.playHistory = []
    room.state.settlement = null
    room.roundReady = { p1: false, p2: false, p3: false, p4: false }
    writeFileSync(paths.stateFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })

    child = launch({
      port: descriptor.port,
      ...paths,
      extraEnv: { WEAPP_TEST_FAIL_ROUND_FINALIZATION_PERSIST_ONCE: '1' },
    })
    const liveSeats = {}
    const rejoined = {}
    for (const seat of ['p1', 'p2', 'p3']) {
      liveSeats[seat] = await connect(descriptor.port)
      rejoined[seat] = await sendAndWait(liveSeats[seat], 'rejoinRoom', {
        roomId: descriptor.roomId,
        myPlayerId: seat,
        resumeToken: entered.entries[seat].resumeToken,
      }, 'roomRejoined')
    }
    await sendAndWait(liveSeats.p3, 'cancelTrustee', { roomId: descriptor.roomId })

    let roundEndedCount = 0
    liveSeats.p1.addEventListener('message', ({ data }) => {
      if (JSON.parse(data).type === 'roundEnded') roundEndedCount += 1
    })
    const settledPacketPromise = waitMessage(liveSeats.p1, 'roundEnded', undefined, 7000)
    const playAccepted = sendAndWait(liveSeats.p3, 'play', {
      roomId: descriptor.roomId,
      cardIds: [rejoined.p3.state.players.p3.hand[0].id],
    })
    const pendingFinalization = await waitUntil(
      () => pendingRoundFinalization(paths.stateFile, descriptor.roomId),
      '普通局首次提交失败后未持久保留结算动作',
      7000,
    )
    assert.equal(pendingFinalization.result.isGameWon, false)
    assert.equal(roundEndedCount, 0, '普通局安全落盘前不得广播 roundEnded')
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'round-end').length, 0)

    const settledPacket = await settledPacketPromise
    await playAccepted
    assert.equal(settledPacket.phase, 'settlement')
    assert.equal(settledPacket.matchEnded, null)
    assert.equal(settledPacket.result.isGameWon, false)
    assert.equal(roundEndedCount, 1)
    await waitUntil(
      () => acceptedEvent(descriptor.matchId, 'round-end'),
      '普通局 round-end 未送达平台',
      7000,
    )
    await delay(100)
    assert.equal(roundEndedCount, 1, '普通局耐久重试后只能广播一次 roundEnded')
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'round-end').length, 1)
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'match-ended').length, 0)
    assert.equal(resultAttempts.filter(item => item.matchId === descriptor.matchId).length, 0)

    for (const seat of ['p1', 'p2']) await sendAndWait(liveSeats[seat], 'readyNextRound', { roomId: descriptor.roomId })
    const prepared = waitMessage(liveSeats.p1, 'roundPrepared', undefined, 7000)
    await sendAndWait(liveSeats.p3, 'readyNextRound', { roomId: descriptor.roomId })
    assert.equal((await prepared).roundResult, null, '普通局重试完成后必须能继续下一局')
  } finally {
    await stop(child).catch(() => {})
  }
}

const runPassedA = async () => {
  const descriptor = matches.passedA
  const paths = pathsFor('passed-a')
  const settings = baseSettings({ rounds: 8 })
  let child = launch({ port: descriptor.port, ...paths })
  try {
    const entered = await enterRoom({ ...descriptor, roomSettings: settings })
    await readyRoom(entered, descriptor.roomId)
    await startRoom(entered, descriptor.roomId)
    await stop(child)

    const snapshot = readJson(paths.stateFile)
    const room = snapshot.rooms.find(candidate => candidate.roomId === descriptor.roomId)
    assert.ok(room?.state, 'passed-a 注入前必须已有真实 WS 开局快照')
    const finalCard = room.state.players.p3.hand.at(-1)
    room.roundSequence = 0
    room.roundResult = null
    room.matchEnded = null
    room.pendingRoundFinalization = null
    room.teamLevels = { teamA: 'A', teamB: 2 }
    room.aFailStreaks = { teamA: 0, teamB: 0 }
    room.scores = { teamA: 0, teamB: 0 }
    room.state.phase = 'playing'
    room.state.currentTurn = 'p3'
    room.state.currentLevel = 'A'
    room.state.levelTeam = 'teamA'
    room.state.teamLevels = { teamA: 'A', teamB: 2 }
    room.state.aFailStreaks = { teamA: 0, teamB: 0 }
    room.state.scores = { teamA: 0, teamB: 0 }
    room.state.players.p1.hand = []
    room.state.players.p2.hand = []
    room.state.players.p3.hand = [finalCard]
    room.state.finishedPlayers = ['p1', 'p2']
    room.state.trick = { winningPlay: null, passedPlayerIds: [] }
    room.state.lastValidPlay = null
    room.state.playArea = []
    room.state.playHistory = []
    room.state.settlement = null
    room.roundReady = { p1: false, p2: false, p3: false, p4: false }
    writeFileSync(paths.stateFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })

    child = launch({
      port: descriptor.port,
      ...paths,
      extraEnv: { WEAPP_TEST_FAIL_ROUND_FINALIZATION_PERSIST_ONCE: '1' },
    })
    const liveSeats = {}
    const rejoined = {}
    for (const seat of ['p1', 'p2', 'p3']) {
      liveSeats[seat] = await connect(descriptor.port)
      rejoined[seat] = await sendAndWait(liveSeats[seat], 'rejoinRoom', {
        roomId: descriptor.roomId,
        myPlayerId: seat,
        resumeToken: entered.entries[seat].resumeToken,
      }, 'roomRejoined')
    }
    await sendAndWait(liveSeats.p3, 'cancelTrustee', { roomId: descriptor.roomId })

    const roundEndedCounts = { p1: 0, p2: 0 }
    for (const seat of ['p1', 'p2']) {
      liveSeats[seat].addEventListener('message', ({ data }) => {
        if (JSON.parse(data).type === 'roundEnded') roundEndedCounts[seat] += 1
      })
    }
    const p1RoundEnded = waitMessage(liveSeats.p1, 'roundEnded', undefined, 7000)
    const p2RoundEnded = waitMessage(liveSeats.p2, 'roundEnded', undefined, 7000)
    const playAccepted = sendAndWait(liveSeats.p3, 'play', {
      roomId: descriptor.roomId,
      cardIds: [rejoined.p3.state.players.p3.hand[0].id],
    })

    const pendingFinalization = await waitUntil(
      () => pendingRoundFinalization(paths.stateFile, descriptor.roomId),
      'passed-a 首次提交失败后未持久保留终局动作',
      7000,
    )
    assert.equal(pendingFinalization.result.isGameWon, true)
    assert.equal(pendingFinalization.result.winnerTeam, 'teamA')
    assert.deepEqual(roundEndedCounts, { p1: 0, p2: 0 }, 'passed-a 安全落盘前不得广播 roundEnded')
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'round-end').length, 0)
    assert.equal(resultAttempts.filter(item => item.matchId === descriptor.matchId).length, 0)

    const [p1Settled, p2Settled] = await Promise.all([p1RoundEnded, p2RoundEnded])
    await playAccepted
    for (const packet of [p1Settled, p2Settled]) {
      assert.equal(packet.result.winnerTeam, 'teamA')
      assert.equal(packet.roundResult.winnerTeam, 'teamA')
      assert.equal(packet.matchEnded.reason, 'passed-a')
      assert.equal(packet.matchEnded.winnerTeam, 'teamA')
      assert.equal(packet.state.settlement.winnerTeam, 'teamA')
    }
    assert.deepEqual(roundEndedCounts, { p1: 1, p2: 1 })
    const spectatorRoundEnd = await waitUntil(
      () => acceptedEvent(descriptor.matchId, 'round-end'),
      'passed-a round-end 未送达平台',
      7000,
    )
    assert.equal(spectatorRoundEnd.winnerTeam, 'teamA')
    const resultEvent = await waitUntil(
      () => resultAttempts.find(item => item.matchId === descriptor.matchId),
      'passed-a GAME_RESULT 未送达平台',
      7000,
    )
    assert.equal(resultEvent.winnerTeam, 'teamA')
    assert.equal(resultEvent.eventId, `game:${descriptor.matchId}:1`)
    await delay(100)
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'round-end').length, 1)
    assert.equal(attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'match-ended').length, 0)
    assert.equal(resultAttempts.filter(item => item.matchId === descriptor.matchId).length, 1)

    const p1Closed = new Promise(resolve => liveSeats.p1.addEventListener('close', resolve, { once: true }))
    liveSeats.p1.close()
    await p1Closed
    await delay(75)
    const localRecoverySocket = await connect(descriptor.port)
    const localRecovery = await sendAndWait(localRecoverySocket, 'rejoinRoom', {
      roomId: descriptor.roomId,
      myPlayerId: 'p1',
      resumeToken: rejoined.p1.resumeToken,
    }, 'roomRejoined')
    assert.equal(localRecovery.phase, 'settlement')
    assert.equal(localRecovery.roundResult.winnerTeam, 'teamA')
    assert.equal(localRecovery.matchEnded.reason, 'passed-a')
    assert.equal(localRecovery.matchEnded.winnerTeam, 'teamA')
    assert.equal(localRecovery.state.settlement.winnerTeam, 'teamA')

    const p2Closed = new Promise(resolve => liveSeats.p2.addEventListener('close', resolve, { once: true }))
    liveSeats.p2.close()
    await p2Closed
    await delay(75)
    const recovery = entered.tickets.issue({
      userId: `${descriptor.matchId}-user-2`,
      matchId: descriptor.matchId,
      roomId: descriptor.roomId,
      seat: 'p2',
      roomKind: 'friend',
      purpose: 'rejoin',
      roomExpiresAt: entered.roomExpiresAt,
      roomSettings: settings,
    })
    const recoveredSocket = await connect(descriptor.port)
    const terminalRecovery = await sendAndWait(recoveredSocket, 'joinRoom', {
      roomId: descriptor.roomId,
      entryAttemptId: recovery.claims.entryAttemptId,
      gameTicket: recovery.gameTicket,
    }, 'roomRejoined')
    assert.equal(terminalRecovery.phase, 'settlement')
    assert.equal(terminalRecovery.roundResult.winnerTeam, 'teamA')
    assert.equal(terminalRecovery.matchEnded.reason, 'passed-a')
    assert.equal(terminalRecovery.matchEnded.winnerTeam, 'teamA')
    assert.equal(terminalRecovery.state.settlement.winnerTeam, 'teamA')
    await waitUntil(() => outboxEvents(paths.resultOutboxFile).length === 0, 'passed-a result outbox 未排空')
  } finally {
    await stop(child).catch(() => {})
  }
}

const runTimeLimit = async () => {
  const descriptor = matches.time
  const paths = pathsFor('time-limit')
  const settings = baseSettings({ totalTimeMinutes: 20 })
  const child = launch({
    port: descriptor.port,
    ...paths,
    totalMinuteMs: 100,
    extraEnv: { WEAPP_TEST_FAIL_MATCH_END_PERSIST_ONCE: '1' },
  })
  try {
    const entered = await enterRoom({ ...descriptor, roomSettings: settings })
    await readyRoom(entered, descriptor.roomId)
    let matchEndedBroadcastCount = 0
    const matchEndedHandler = ({ data }) => {
      if (JSON.parse(data).type === 'matchEnded') matchEndedBroadcastCount += 1
    }
    entered.seats.p1.addEventListener('message', matchEndedHandler)
    const matchEndedPacket = waitMessage(entered.seats.p1, 'matchEnded', undefined, 7000)
    await startRoom(entered, descriptor.roomId)
    const gate = terminalGates.get(descriptor.matchId)
    const persistedDuringRetry = await waitUntil(
      () => pendingTerminalEvent(paths.stateFile, descriptor.roomId),
      '首次终局提交失败后 pending match-ended 未由持久化重试保留',
      7000,
    )
    assert.equal(persistedDuringRetry.reason, 'time-limit')
    assert.equal(matchEndedBroadcastCount, 0, '终局提交失败期间不得提前广播 matchEnded')
    assert.equal(
      attempts.filter(item => item.event.matchId === descriptor.matchId && item.event.type === 'match-ended').length,
      0,
      '终局提交失败期间不得提前 stage match-ended',
    )
    assert.equal(outboxEvents(paths.outboxFile).some(item => item.type === 'match-ended'), false)
    const event = await Promise.race([
      gate.seen.promise,
      delay(7000).then(() => { throw new Error('未收到 time-limit match-ended') }),
    ])
    assert.equal(event.sequence, 2)
    assert.equal(event.eventId, `spectate:${descriptor.matchId}:2`)
    assert.equal(event.roundSequence, 1)
    assert.equal(event.reason, 'time-limit')
    assert.equal(event.roundsPlayed, 0)
    assert.deepEqual(event.scores, { teamA: 0, teamB: 0 })
    assert.equal(event.winnerTeam, null)
    assert.ok(Number.isSafeInteger(event.endedAt))
    assert.equal(attempts.find(item => item.event.eventId === event.eventId)?.lifecycleSigned, true)
    const endedPacket = await matchEndedPacket
    assert.equal(matchEndedBroadcastCount, 1, '耐久提交恢复后只能广播一次 matchEnded')
    assert.equal(
      attempts.filter(item => item.event.eventId === event.eventId).length,
      1,
      '耐久提交恢复后只能 stage 一次同一 match-ended',
    )
    assert.equal(endedPacket.matchEnded.reason, 'time-limit')
    const p2Closed = new Promise(resolve => entered.seats.p2.addEventListener('close', resolve, { once: true }))
    entered.seats.p2.close()
    await p2Closed
    await delay(75)
    const terminalAttemptId = 'terminal-p2-recovery-attempt'
    const terminalTicket = entered.tickets.issue({
      userId: `${descriptor.matchId}-user-2`,
      matchId: descriptor.matchId,
      roomId: descriptor.roomId,
      seat: 'p2',
      roomKind: 'friend',
      purpose: 'rejoin',
      entryAttemptId: terminalAttemptId,
      roomExpiresAt: entered.roomExpiresAt,
      roomSettings: settings,
    })
    const terminalSocket = await connect(descriptor.port)
    const terminalRejoined = await sendAndWait(terminalSocket, 'joinRoom', {
      roomId: descriptor.roomId,
      gameTicket: terminalTicket.gameTicket,
      entryAttemptId: terminalAttemptId,
    }, 'roomRejoined')
    assert.equal(terminalRejoined.phase, 'settlement')
    assert.equal(terminalRejoined.matchEnded.reason, 'time-limit')
    assert.ok(terminalRejoined.state, '平台终局 ACK 前的恢复必须返回脱敏终局快照')
    const frozenCommand = await sendAndWait(terminalSocket, 'play', {
      roomId: descriptor.roomId,
      cardIds: [],
    }, 'error')
    assert.equal(frozenCommand.code, 'MATCH_ENDED', '终局恢复连接不得继续执行牌局动作')
    await assertPendingAndDrain({ ...descriptor, ...paths, event, release: gate.release })
  } finally {
    terminalGates.get(descriptor.matchId).release.resolve()
    await stop(child).catch(() => {})
  }
}

const runRejectedStart = async () => {
  const descriptor = matches.rejected
  const paths = pathsFor('start-rejected')
  const child = launch({ port: descriptor.port, ...paths })
  try {
    const entered = await enterRoom({ ...descriptor, roomSettings: baseSettings({}) })
    await readyRoom(entered, descriptor.roomId)
    const requestId = nextRequestId++
    const rejected = waitMessage(entered.seats.p1, 'error', requestId, 8000)
    const dissolved = waitMessage(entered.seats.p1, 'roomDissolved', undefined, 8000)
    const guestPending = waitMessage(entered.seats.p2, 'roomMembers', undefined, 8000)
    sendProtocolCommand(entered.seats.p1, 'startGame', { roomId: descriptor.roomId }, requestId)
    const [error, dissolvedPacket, pendingPacket] = await Promise.all([rejected, dissolved, guestPending])
    assert.equal(error.code, 'MATCH_ENTRY_EXPIRED')
    assert.equal(dissolvedPacket.reason, 'start-rejected')
    assert.equal(pendingPacket.gameStartPending, true, '终态拒绝前访客也必须看到版本化开局确认状态')

    const closed = await waitForAccepted(descriptor.matchId, 'room-closed', 8000)
    const startAttempts = attempts.filter(item => (
      item.event.matchId === descriptor.matchId && item.event.type === 'game-start'
    ))
    assert.ok(startAttempts.length >= 1)
    assert.ok(startAttempts.every(item => item.event.sequence === 1 && item.lifecycleSigned))
    assert.equal(closed.sequence, 1, '终态拒绝的 game-start 不得占用公开事件序号')
    assert.equal(closed.eventId, `spectate:${descriptor.matchId}:1`)
    assert.equal(closed.reason, 'start-rejected')
    assert.equal(attempts.find(item => item.event === closed)?.lifecycleSigned, true)
    await waitUntil(() => outboxEvents(paths.outboxFile).length === 0, 'start-rejected room-closed ACK 后 outbox 未排空')
    const snapshot = readJson(paths.stateFile)
    assert.equal(snapshot.rooms.some(room => room.roomId === descriptor.roomId), false)
    assert.ok(snapshot.closedRoomTombstones.some(item => item.roomId === descriptor.roomId))
  } finally {
    await stop(child).catch(() => {})
  }
}

const runParticipantLostDuringClaim = async () => {
  const descriptor = matches.participantLost
  const paths = pathsFor('start-participant-lost')
  const child = launch({ port: descriptor.port, ...paths })
  let publishedGameState = false
  try {
    const entered = await enterRoom({ ...descriptor, roomSettings: baseSettings({}) })
    await readyRoom(entered, descriptor.roomId)
    const stateHandler = ({ data }) => {
      if (JSON.parse(data).type === 'gameState') publishedGameState = true
    }
    ;[entered.seats.p1, entered.seats.p3, entered.seats.p4].forEach(socket => socket.addEventListener('message', stateHandler))
    const requestId = nextRequestId++
    const guestPending = waitMessage(entered.seats.p3, 'roomMembers', undefined, 8000)
    const dissolved = waitMessage(entered.seats.p1, 'roomDissolved', undefined, 8000)
    sendProtocolCommand(entered.seats.p1, 'startGame', { roomId: descriptor.roomId }, requestId)
    const [startEvent, pendingPacket] = await Promise.all([
      participantLostStartGate.seen.promise,
      guestPending,
    ])
    assert.equal(startEvent.type, 'game-start')
    assert.equal(pendingPacket.gameStartPending, true)

    const disconnected = new Promise(resolve => entered.seats.p2.addEventListener('close', resolve, { once: true }))
    entered.seats.p2.close()
    await disconnected
    await delay(75)
    participantLostStartGate.release.resolve()

    assert.equal((await dissolved).reason, 'start-participant-lost')
    const closed = await waitForAccepted(descriptor.matchId, 'room-closed', 8000)
    assert.equal(closed.sequence, 2, '平台已确认的 game-start 后关闭必须保持连续序号')
    assert.equal(closed.reason, 'start-participant-lost')
    await delay(100)
    assert.equal(publishedGameState, false, '慢 claim 期间掉线后不得向剩余玩家发牌')
    const snapshot = readJson(paths.stateFile)
    assert.equal(snapshot.rooms.some(room => room.roomId === descriptor.roomId), false)
    assert.ok(snapshot.closedRoomTombstones.some(item => item.roomId === descriptor.roomId))
  } finally {
    participantLostStartGate.release.resolve()
    await stop(child).catch(() => {})
  }
}

const runClaimedStartCrashRecovery = async () => {
  const descriptor = matches.claimedRestart
  const paths = pathsFor('claimed-start-restart')
  const reconnectGraceMs = 30_000
  let child = launch({
    port: descriptor.port,
    ...paths,
    extraEnv: {
      WEAPP_EMPTY_ROOM_TIMEOUT_MS: String(reconnectGraceMs),
      WEAPP_TEST_FAIL_GAME_START_PERSIST_ONCE: '1',
    },
  })
  try {
    const entered = await enterRoom({ ...descriptor, roomSettings: baseSettings({}) })
    await readyRoom(entered, descriptor.roomId)
    const requestId = nextRequestId++
    const pending = waitMessage(entered.seats.p1, 'gameStartPending', requestId, 8000)
    sendProtocolCommand(entered.seats.p1, 'startGame', { roomId: descriptor.roomId }, requestId)
    const pendingPacket = await pending
    assert.equal(pendingPacket.code, 'PERSISTENCE_PENDING')

    const claimedRoom = await waitUntil(() => {
      const snapshot = readJson(paths.stateFile)
      return snapshot.rooms.find(room => (
        room.roomId === descriptor.roomId &&
        room.pendingGameStartEvent &&
        Number.isSafeInteger(room.gameStartClaimedAt) &&
        Number.isSafeInteger(room.gameStartReconnectDeadlineAt) &&
        room.state === null
      ))
    }, '平台 ACK 后未在牌局初始化前持久化 claimed-start marker', 8000)
    assert.ok(claimedRoom.gameStartReconnectDeadlineAt > claimedRoom.gameStartClaimedAt)
    assert.ok(claimedRoom.gameStartReconnectDeadlineAt <= claimedRoom.gameStartClaimedAt + reconnectGraceMs)
    await crash(child)

    child = launch({
      port: descriptor.port,
      ...paths,
      extraEnv: { WEAPP_EMPTY_ROOM_TIMEOUT_MS: String(reconnectGraceMs) },
    })
    const recoveredSockets = {}
    const recoveredPackets = {}
    for (const seat of ['p1', 'p2', 'p3']) {
      recoveredSockets[seat] = await connect(descriptor.port)
      recoveredPackets[seat] = await sendAndWait(recoveredSockets[seat], 'rejoinRoom', {
        roomId: descriptor.roomId,
        myPlayerId: seat,
        resumeToken: entered.entries[seat].resumeToken,
      }, 'roomRejoined', 8000)
      assert.equal(recoveredPackets[seat].gameStartPending, true)
      assert.equal(recoveredPackets[seat].phase, 'lobby')
      assert.equal(recoveredPackets[seat].state, null)
    }

    recoveredSockets.p4 = await connect(descriptor.port)
    const gameStateCounts = { p1: 0, p2: 0, p3: 0, p4: 0 }
    const statePromises = {}
    for (const seat of ['p1', 'p2', 'p3', 'p4']) {
      const socket = recoveredSockets[seat]
      socket.addEventListener('message', ({ data }) => {
        if (JSON.parse(data).type === 'gameState') gameStateCounts[seat] += 1
      })
      statePromises[seat] = waitMessage(socket, 'gameState', undefined, 8000)
    }
    const accepted = waitMessage(recoveredSockets.p1, 'actionAccepted', requestId, 8000)
    recoveredPackets.p4 = await sendAndWait(recoveredSockets.p4, 'rejoinRoom', {
      roomId: descriptor.roomId,
      myPlayerId: 'p4',
      resumeToken: entered.entries.p4.resumeToken,
    }, 'roomRejoined', 8000)
    assert.equal(recoveredPackets.p4.gameStartPending, true)
    assert.equal(recoveredPackets.p4.phase, 'lobby')
    assert.equal(recoveredPackets.p4.state, null)
    await accepted
    const states = await Promise.all(Object.values(statePromises))
    assert.ok(states.every(packet => packet.phase === 'playing' && packet.roomId === descriptor.roomId))
    await delay(150)
    assert.deepEqual(gameStateCounts, { p1: 1, p2: 1, p3: 1, p4: 1 })
    assert.ok(['p1', 'p2', 'p3', 'p4'].every(seat => (
      recoveredPackets[seat].resumeToken !== entered.entries[seat].resumeToken
    )), '四席恢复后必须全部轮换本地 resumeToken')

    const startedRoom = await waitUntil(() => {
      const snapshot = readJson(paths.stateFile)
      return snapshot.rooms.find(room => (
        room.roomId === descriptor.roomId && room.state && !room.pendingGameStartEvent &&
        room.gameStartClaimedAt === null && room.gameStartReconnectDeadlineAt === null
      ))
    }, '四席恢复后 claimed-start marker 未被原子清除', 8000)
    assert.ok(startedRoom.matchStartedAt)
    assert.equal(attempts.filter(item => (
      item.event.matchId === descriptor.matchId && item.event.type === 'game-start'
    )).length, 1, '重启后必须复用已确认 claim，不能再次请求平台开局')

    const staleTokenSocket = await connect(descriptor.port)
    const staleToken = await sendAndWait(staleTokenSocket, 'rejoinRoom', {
      roomId: descriptor.roomId,
      myPlayerId: 'p1',
      resumeToken: entered.entries.p1.resumeToken,
    }, 'error')
    assert.match(staleToken.message, /重连凭证无效/)
  } finally {
    await stop(child).catch(() => {})
  }
}

const runClaimedStartReconnectTimeout = async () => {
  const descriptor = matches.claimedTimeout
  const paths = pathsFor('claimed-start-timeout')
  const reconnectGraceMs = 3000
  let child = launch({
    port: descriptor.port,
    ...paths,
    extraEnv: {
      WEAPP_EMPTY_ROOM_TIMEOUT_MS: String(reconnectGraceMs),
      WEAPP_TEST_FAIL_GAME_START_PERSIST_ONCE: '1',
    },
  })
  try {
    const entered = await enterRoom({ ...descriptor, roomSettings: baseSettings({}) })
    await readyRoom(entered, descriptor.roomId)
    const requestId = nextRequestId++
    const pending = waitMessage(entered.seats.p1, 'gameStartPending', requestId, 8000)
    sendProtocolCommand(entered.seats.p1, 'startGame', { roomId: descriptor.roomId }, requestId)
    assert.equal((await pending).code, 'PERSISTENCE_PENDING')
    const claimedRoom = await waitUntil(() => {
      const snapshot = readJson(paths.stateFile)
      return snapshot.rooms.find(room => (
        room.roomId === descriptor.roomId && Number.isSafeInteger(room.gameStartReconnectDeadlineAt) && room.state === null
      ))
    }, '超时用例未持久化 claimed-start marker', 8000)
    const originalDeadline = claimedRoom.gameStartReconnectDeadlineAt
    await crash(child)

    child = launch({
      port: descriptor.port,
      ...paths,
      extraEnv: { WEAPP_EMPTY_ROOM_TIMEOUT_MS: String(reconnectGraceMs) },
    })
    await connect(descriptor.port)
    const restoredRoom = await waitUntil(() => {
      const snapshot = readJson(paths.stateFile)
      return snapshot.rooms.find(room => room.roomId === descriptor.roomId)
    }, 'claimed-start 重启后在宽限期内错误关闭房间', 1500)
    assert.equal(restoredRoom.gameStartReconnectDeadlineAt, originalDeadline, '重启不得延长席位恢复宽限')

    const closed = await waitForAccepted(descriptor.matchId, 'room-closed', 10_000)
    assert.equal(closed.reason, 'start-participant-lost')
    assert.equal(closed.sequence, 2)
    assert.equal(attempts.filter(item => (
      item.event.matchId === descriptor.matchId && item.event.type === 'game-start'
    )).length, 1)
    await waitUntil(() => {
      const snapshot = readJson(paths.stateFile)
      return !snapshot.rooms.some(room => room.roomId === descriptor.roomId) &&
        snapshot.closedRoomTombstones.some(item => item.roomId === descriptor.roomId)
    }, 'claimed-start 恢复宽限到期后房间未耐久关闭', 8000)
  } finally {
    await stop(child).catch(() => {})
  }
}

try {
  await runRoundLimit()
  await runOrdinaryRound()
  await runPassedA()
  await runTimeLimit()
  await runRejectedStart()
  await runParticipantLostDuringClaim()
  await runClaimedStartCrashRecovery()
  await runClaimedStartReconnectTimeout()
  assert.equal(collectorError, null)
  console.log('weapp terminal lifecycle integration passed')
} finally {
  for (const gate of terminalGates.values()) gate.release.resolve()
  participantLostStartGate.release.resolve()
  sockets.forEach(socket => socket.close())
  await Promise.all([...children].map(child => stop(child).catch(() => {})))
  await new Promise(resolve => collector.close(resolve))
  rmSync(root, { recursive: true, force: true })
}
