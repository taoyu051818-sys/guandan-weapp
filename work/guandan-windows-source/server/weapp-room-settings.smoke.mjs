import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

const port = 39108
const stateDir = mkdtempSync(join(tmpdir(), 'guandan-room-settings-'))
const stateFile = join(stateDir, 'rooms.json')
const sockets = []
let child = null
let nextRequestId = 1

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const launch = (totalMinuteMs = 60000) => {
  child = spawn(process.execPath, ['server/weapp-ws.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WEAPP_WS_PORT: String(port),
      WEAPP_ROOM_STATE_FILE: stateFile,
      WEAPP_TOTAL_MINUTE_MS: String(totalMinuteMs),
      WEAPP_BOT_ACTION_DELAY_MS: '25',
    },
    stdio: 'ignore',
  })
  return child
}
const stop = async (signal = 'SIGTERM') => {
  if (!child) return
  const running = child
  child = null
  if (running.exitCode === null && running.signalCode === null) {
    running.kill(signal)
    await Promise.race([once(running, 'exit'), delay(1000)])
  }
}
const connectOnce = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  socket.addEventListener('open', () => resolve(socket), { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const connect = async () => {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    try {
      const socket = await connectOnce()
      sockets.push(socket)
      return socket
    } catch {
      await delay(40)
    }
  }
  throw new Error('好友房设置测试服务启动超时')
}
const waitFor = (socket, type, predicate = () => true, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), timeoutMs)
  const handler = ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type !== type || !predicate(packet)) return
    clearTimeout(timer)
    socket.removeEventListener('message', handler)
    resolve(packet)
  }
  socket.addEventListener('message', handler)
})
const send = (socket, type, payload, requestId = nextRequestId++) => {
  socket.send(JSON.stringify({ type, requestId, payload }))
  return requestId
}
const addBot = async (socket, roomId, playerId) => {
  const requestId = nextRequestId++
  const accepted = waitFor(socket, 'actionAccepted', packet => packet.requestId === requestId)
  send(socket, 'addBot', { roomId, playerId }, requestId)
  await accepted
}
const closeSockets = () => sockets.splice(0).forEach(socket => socket.close())

const fullSettings = {
  mode: 'classic',
  rounds: 12,
  scoring: 'double-4',
  scoreVisibility: 'hidden',
  turnSeconds: 60,
  trusteeSeconds: 0,
  totalTimeMinutes: 20,
  spectator: 'delayed-round',
  autoSort: false,
  disableInteraction: true,
  sortOrder: 'asc',
  authoritativeValidation: true,
}

const player = (id, team, hand) => ({ id, name: id, isAI: false, team, hand, role: 'normal' })
const card = (id, suit, rank, value) => ({ id, suit, rank, value, isLevelCard: false })

try {
  launch()
  const host = await connect()

  const illegalSettings = [
    { ...fullSettings, rounds: 6 },
    { ...fullSettings, turnSeconds: 30 },
    { ...fullSettings, trusteeSeconds: 10 },
    { ...fullSettings, totalTimeMinutes: 5 },
    { ...fullSettings, spectator: 'everyone' },
    { ...fullSettings, authoritativeValidation: false },
    { ...fullSettings, unexpected: true },
  ]
  for (const [index, roomSettings] of illegalSettings.entries()) {
    const requestId = nextRequestId++
    const errorPromise = waitFor(host, 'error', packet => packet.requestId === requestId)
    send(host, 'createRoom', { roomId: String(730000 + index), hostName: '非法设置', roomSettings }, requestId)
    assert.match((await errorPromise).message, /好友房设置无效/)
  }

  const roomId = '707070'
  const createId = nextRequestId++
  const createdPromise = waitFor(host, 'roomCreated', packet => packet.requestId === createId)
  send(host, 'createRoom', { roomId, hostName: '设置恢复', roomSettings: fullSettings }, createId)
  const created = await createdPromise
  assert.deepEqual(created.roomSettings, fullSettings)
  assert.equal(created.scoreboard, null, '隐藏比分房不能发布实时 scoreboard')
  assert.deepEqual(created.spectatorPolicy, { mode: 'delayed-round', allowed: true, delayRounds: 1 })
  const resumeToken = created.resumeToken

  const memberSettingsPromise = waitFor(host, 'roomMembers', packet => packet.roomId === roomId && packet.botPlayerIds.includes('p2'))
  await addBot(host, roomId, 'p2')
  assert.deepEqual((await memberSettingsPromise).roomSettings, fullSettings, '席位广播必须携带权威房间设置')

  closeSockets()
  await stop('SIGKILL')

  launch()
  const restoredHost = await connect()
  const rejoinId = nextRequestId++
  const rejoinedPromise = waitFor(restoredHost, 'roomRejoined', packet => packet.requestId === rejoinId)
  send(restoredHost, 'rejoinRoom', { roomId, myPlayerId: 'p1', resumeToken }, rejoinId)
  const restored = await rejoinedPromise
  assert.deepEqual(restored.roomSettings, fullSettings, '重启恢复不得丢失或降级房间设置')
  assert.deepEqual(restored.botPlayerIds, ['p2'])

  closeSockets()
  await stop()

  launch(100)
  const timedHost = await connect()
  const timedRoomId = '717171'
  const timedSettings = {
    ...fullSettings,
    rounds: 8,
    turnSeconds: 20,
    totalTimeMinutes: 20,
    spectator: 'live',
    autoSort: true,
  }
  const timedCreateId = nextRequestId++
  const timedCreatedPromise = waitFor(timedHost, 'roomCreated', packet => packet.requestId === timedCreateId)
  send(timedHost, 'createRoom', { roomId: timedRoomId, hostName: '限时房', roomSettings: timedSettings }, timedCreateId)
  await timedCreatedPromise
  for (const id of ['p2', 'p3', 'p4']) await addBot(timedHost, timedRoomId, id)

  const blockedChatId = nextRequestId++
  const blockedChatPromise = waitFor(timedHost, 'error', packet => packet.requestId === blockedChatId)
  send(timedHost, 'chat', { roomId: timedRoomId, text: '谢谢' }, blockedChatId)
  assert.match((await blockedChatPromise).message, /禁止互动/)

  const readyId = nextRequestId++
  const readyPromise = waitFor(timedHost, 'actionAccepted', packet => packet.requestId === readyId)
  send(timedHost, 'setLobbyReady', { roomId: timedRoomId }, readyId)
  await readyPromise
  const startId = nextRequestId++
  const startedPromise = waitFor(timedHost, 'gameState', packet => packet.phase === 'playing')
  const matchEndedPromise = waitFor(timedHost, 'matchEnded', packet => packet.matchEnded?.reason === 'time-limit')
  send(timedHost, 'startGame', { roomId: timedRoomId }, startId)
  const started = await startedPromise
  assert.ok(started.turnDeadlineAt - Date.now() > 19000, '首出 20 秒必须进入权威回合截止时间')
  assert.ok(started.totalDeadlineAt - started.matchStartedAt === 2000, '自定义总时长必须进入独立权威截止时间')
  assert.deepEqual(started.spectatorPolicy, { mode: 'live', allowed: true, delayRounds: 0 })

  const trusteeId = nextRequestId++
  const trusteeError = waitFor(timedHost, 'error', packet => packet.requestId === trusteeId)
  send(timedHost, 'setTrustee', { roomId: timedRoomId }, trusteeId)
  assert.match((await trusteeError).message, /关闭托管/)
  const timedEnd = await matchEndedPromise
  assert.equal(timedEnd.phase, 'settlement')
  assert.equal(timedEnd.turnDeadlineAt, null)

  const forcedHost = await connect()
  const forcedRoomId = '727272'
  const forcedState = {
    currentLevel: 2,
    players: {
      p1: player('p1', 'teamA', [card('last-3', 'spade', 3, 3)]),
      p2: player('p2', 'teamB', [card('p2-4', 'club', 4, 4)]),
      p3: player('p3', 'teamA', []),
      p4: player('p4', 'teamB', [card('p4-5', 'diamond', 5, 5)]),
    },
    turnOrder: ['p1', 'p2', 'p3', 'p4'],
    currentTurn: 'p1',
    playArea: [],
    lastValidPlay: null,
    finishedPlayers: ['p3'],
  }
  const forcedSettings = { ...fullSettings, rounds: 4, scoreVisibility: 'live', totalTimeMinutes: 0 }
  const forcedCreateId = nextRequestId++
  const forcedCreatedPromise = waitFor(forcedHost, 'roomCreated', packet => packet.requestId === forcedCreateId)
  send(forcedHost, 'createRoom', { roomId: forcedRoomId, hostName: '结算设置', roomSettings: forcedSettings, state: forcedState }, forcedCreateId)
  await forcedCreatedPromise
  const playId = nextRequestId++
  const roundEndedPromise = waitFor(forcedHost, 'roundEnded', packet => packet.roomId === forcedRoomId)
  send(forcedHost, 'play', { roomId: forcedRoomId, cardIds: ['last-3'] }, playId)
  const roundEnded = await roundEndedPromise
  assert.equal(roundEnded.result.levelUp, 4, '双下 4 分必须修正权威结算')
  assert.equal(roundEnded.result.currentLevel, 6)
  assert.equal(roundEnded.matchEnded, null)
  assert.equal(roundEnded.scoreboard.roundsPlayed, 1)

  process.stdout.write('weapp friend room settings integration passed\n')
} finally {
  closeSockets()
  await stop()
  rmSync(stateDir, { recursive: true, force: true })
}
