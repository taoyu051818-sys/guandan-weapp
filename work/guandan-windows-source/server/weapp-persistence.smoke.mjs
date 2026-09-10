import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'

const port = 39114
const roomId = '424242'
const stateDir = mkdtempSync(join(tmpdir(), 'guandan-weapp-restart-'))
const stateFile = join(stateDir, 'rooms.json')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let nextRequestId = 1
const sockets = []

const launch = () => spawn(process.execPath, ['server/weapp-ws.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WEAPP_WS_PORT: String(port),
    WEAPP_ROOM_STATE_FILE: stateFile,
    WEAPP_TURN_TIMEOUT_MS: '8000',

    WEAPP_DISSOLVE_TIMEOUT_MS: '10000',
    WEAPP_EMPTY_ROOM_TIMEOUT_MS: '15000',
  },
  stdio: 'ignore',
})

const connect = async () => {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
        socket.addEventListener('open', () => resolve(socket), { once: true })
        socket.addEventListener('error', reject, { once: true })
      })
    } catch { await delay(40) }
  }
  throw new Error('持久化测试服务启动超时')
}

const waitFor = (socket, type, match = () => true, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), timeoutMs)
  const handler = ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type !== type || !match(packet)) return
    clearTimeout(timer)
    socket.removeEventListener('message', handler)
    resolve(packet)
  }
  socket.addEventListener('message', handler)
})

const send = (socket, type, payload, requestId = nextRequestId++) => sendProtocolCommand(socket, type, payload, requestId)

let child = launch()
try {
  await delay(220)
  for (let index = 0; index < 4; index += 1) sockets.push(await connect())
  const createId = nextRequestId++
  const createdPromise = waitFor(sockets[0], 'roomCreated', packet => packet.requestId === createId)
  send(sockets[0], 'createRoom', { roomId, hostName: '恢复测试' }, createId)
  const created = await createdPromise
  const tokens = { p1: created.resumeToken }
  const blockedStateDir = `${stateDir}-blocked`
  renameSync(stateDir, blockedStateDir)
  writeFileSync(stateDir, 'block durable writes')
  const failedJoinId = nextRequestId++
  const failedJoinPayload = { roomId, entryAttemptId: 'persist_retry_join_Q7mN4vX9kLp2' }
  const failedJoinPromise = waitFor(sockets[1], 'error', packet => packet.requestId === failedJoinId)
  send(sockets[1], 'joinRoom', failedJoinPayload, failedJoinId)
  assert.match((await failedJoinPromise).message, /服务器处理请求失败|安全落盘/, '持久化失败时不得发送 roomJoined')
  rmSync(stateDir)
  renameSync(blockedStateDir, stateDir)
  const recoveredJoinPromise = waitFor(sockets[1], 'roomJoined', packet => packet.requestId === failedJoinId)
  send(sockets[1], 'joinRoom', failedJoinPayload, failedJoinId)
  const recoveredJoin = await recoveredJoinPromise
  assert.equal(recoveredJoin.myPlayerId, 'p2')
  tokens.p2 = recoveredJoin.resumeToken

  for (let index = 2; index < 4; index += 1) {
    const requestId = nextRequestId++
    const joinedPromise = waitFor(sockets[index], 'roomJoined', packet => packet.requestId === requestId)
    send(sockets[index], 'joinRoom', { roomId }, requestId)
    const joined = await joinedPromise
    tokens[joined.myPlayerId] = joined.resumeToken
  }

  renameSync(stateDir, blockedStateDir)
  writeFileSync(stateDir, 'block durable writes')
  const failedReadyId = nextRequestId++
  const failedReadyPayload = { roomId }
  const failedReadyPromise = waitFor(sockets[0], 'error', packet => packet.requestId === failedReadyId)
  send(sockets[0], 'setLobbyReady', failedReadyPayload, failedReadyId)
  assert.match((await failedReadyPromise).message, /服务器处理请求失败|安全落盘/, '持久化失败时不得发送 actionAccepted')
  rmSync(stateDir)
  renameSync(blockedStateDir, stateDir)
  const recoveredReadyPromise = waitFor(sockets[0], 'actionAccepted', packet => packet.requestId === failedReadyId)
  send(sockets[0], 'setLobbyReady', failedReadyPayload, failedReadyId)
  assert.equal((await recoveredReadyPromise).requestType, 'setLobbyReady', '同一请求只能在最终状态持久成功后获得 ACK')

  for (let index = 1; index < 4; index += 1) {
    const readyId = nextRequestId++
    const readyAcceptedPromise = waitFor(sockets[index], 'actionAccepted', packet => packet.requestId === readyId)
    send(sockets[index], 'setLobbyReady', { roomId }, readyId)
    await readyAcceptedPromise
  }

  const startId = nextRequestId++
  const startedPromise = waitFor(sockets[0], 'gameState', packet => packet.phase === 'playing')
  send(sockets[0], 'startGame', { roomId }, startId)
  const started = await startedPromise
  const originalDeadline = started.turnDeadlineAt

  const dissolveRequestId = 9001
  const acceptedPromise = waitFor(sockets[0], 'actionAccepted', packet => packet.requestId === dissolveRequestId)
  const votePromise = waitFor(sockets[0], 'dissolveVoteUpdated', packet => packet.dissolveVote?.initiator === 'p1')
  send(sockets[0], 'proposeDissolve', { roomId }, dissolveRequestId)
  const [acceptedBeforeRestart] = await Promise.all([acceptedPromise, votePromise])

  child.kill('SIGKILL')
  await once(child, 'exit')
  sockets.splice(0).forEach(socket => socket.close())

  const legacySnapshot = JSON.parse(readFileSync(stateFile, 'utf8'))
  delete legacySnapshot.rooms[0].state.ruleProfile
  writeFileSync(stateFile, `${JSON.stringify(legacySnapshot)}\n`)

  child = launch()
  const replacement = await connect()
  sockets.push(replacement)
  const rejoinId = nextRequestId++
  const rejoinedPromise = waitFor(replacement, 'roomRejoined', packet => packet.requestId === rejoinId)
  send(replacement, 'rejoinRoom', { roomId, myPlayerId: 'p1', resumeToken: tokens.p1 }, rejoinId)
  const restored = await rejoinedPromise
  assert.equal(restored.phase, 'playing')
  assert.deepEqual(restored.state.ruleProfile, {
    allowA2345Straight: true,
    straightFlushAsBomb: true,
    enableTripleWithPair: true,
  }, '旧快照恢复时必须显式迁移到 classic RuleProfile')
  assert.equal(restored.turnDeadlineAt, originalDeadline, '重启必须继续原 deadline，不能重新获得完整 20 秒')
  assert.equal(restored.deadlinePlayerId, started.deadlinePlayerId)
  assert.equal(restored.dissolveVote.initiator, 'p1')
  assert.equal(restored.dissolveVote.votes.p2, 'offline', '重启后未连接席位必须显示离线票态')
  assert.equal(restored.trustees.p1.reason, 'disconnected')

  const duplicatePromise = waitFor(replacement, 'actionAccepted', packet => packet.requestId === dissolveRequestId)
  send(replacement, 'proposeDissolve', { roomId }, dissolveRequestId)
  assert.deepEqual(await duplicatePromise, acceptedBeforeRestart, '重启后重复 requestId 必须返回原 accepted 而不能重复发起投票')

  const conflictPromise = waitFor(replacement, 'error', packet => packet.requestId === dissolveRequestId)
  send(replacement, 'proposeDissolve', { roomId, changed: true }, dissolveRequestId)
  assert.equal((await conflictPromise).code, 'IDEMPOTENCY_CONFLICT', '重启后相同 requestId 换正文必须拒绝')
} finally {
  sockets.forEach(socket => socket.close())
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), delay(500)]).catch(() => {})
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(`${stateDir}-blocked`, { recursive: true, force: true })
}

process.stdout.write('weapp restart persistence smoke passed\n')
