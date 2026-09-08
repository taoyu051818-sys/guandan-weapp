import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { GameTicketService } from './platform/crypto.js'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'

const port = 39107
const friendRoomId = '618033'
const ticketRoomId = '161803'
const secret = 'bot-smoke-secret-with-at-least-thirty-two-characters'
const stateDir = mkdtempSync(join(tmpdir(), 'guandan-weapp-bots-'))
const stateFile = join(stateDir, 'rooms.json')
const sockets = []
let child = null
let nextRequestId = 1

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const startServer = () => {
  const processHandle = spawn(process.execPath, ['server/weapp-ws.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WEAPP_WS_PORT: String(port),
      WEAPP_ROOM_STATE_FILE: stateFile,
      WEAPP_BOT_ACTION_DELAY_MS: '40',
      WEAPP_TURN_TIMEOUT_MS: '5000',
      GAME_TICKET_SECRET: secret,
    },
    stdio: 'ignore',
  })
  child = processHandle
  return processHandle
}
const stopServer = async () => {
  if (!child) return
  const processHandle = child
  child = null
  if (processHandle.exitCode === null) {
    processHandle.kill('SIGTERM')
    await Promise.race([once(processHandle, 'exit'), delay(1000)])
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
  throw new Error('机器人协议测试服务启动超时')
}
const waitFor = (socket, type, predicate = () => true, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timeoutError = new Error(`等待 ${type} 超时`)
  const timer = setTimeout(() => reject(timeoutError), timeoutMs)
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
  sendProtocolCommand(socket, type, payload, requestId)
  return requestId
}
const mutateBot = async (socket, type, playerId, expectedBotPlayerIds) => {
  const requestId = nextRequestId++
  const acceptedPromise = waitFor(socket, 'actionAccepted', packet => packet.requestId === requestId)
  const membersPromise = waitFor(socket, 'roomMembers', packet => (
    packet.roomId === friendRoomId
    && JSON.stringify(packet.botPlayerIds) === JSON.stringify(expectedBotPlayerIds)
  ))
  send(socket, type, { roomId: friendRoomId, playerId }, requestId)
  const [accepted, members] = await Promise.all([acceptedPromise, membersPromise])
  assert.equal(accepted.requestType, type)
  assert.deepEqual(members.botPlayerIds, expectedBotPlayerIds)
  expectedBotPlayerIds.forEach(id => assert.ok(members.memberPlayerIds.includes(id)))
  return { accepted, members }
}

try {
  startServer()
  const host = await connect()
  const guest = await connect()
  const ticketHost = await connect()

  const createId = nextRequestId++
  const createdPromise = waitFor(host, 'roomCreated', packet => packet.requestId === createId)
  send(host, 'createRoom', { roomId: friendRoomId, hostName: '机器人测试' }, createId)
  const created = await createdPromise
  assert.deepEqual(created.botPlayerIds, [])
  assert.deepEqual(created.lobbyReadyPlayerIds, [])
  const hostResumeToken = created.resumeToken

  const firstBot = await mutateBot(host, 'addBot', 'p3', ['p3'])
  assert.deepEqual(firstBot.members.memberPlayerIds, ['p1', 'p3'])
  assert.deepEqual(firstBot.members.lobbyReadyPlayerIds, ['p3'], '机器人占座后应自动满足准备条件')

  const joinId = nextRequestId++
  const joinedPromise = waitFor(guest, 'roomJoined', packet => packet.requestId === joinId)
  send(guest, 'joinRoom', { roomId: friendRoomId }, joinId)
  const joined = await joinedPromise
  assert.equal(joined.myPlayerId, 'p2', '加入者必须跳过已经由机器人占用的 p3 席位')
  assert.deepEqual(joined.botPlayerIds, ['p3'])

  const nonHostId = nextRequestId++
  const nonHostError = waitFor(guest, 'error', packet => packet.requestId === nonHostId)
  send(guest, 'addBot', { roomId: friendRoomId, playerId: 'p4' }, nonHostId)
  assert.match((await nonHostError).message, /只有房主/)

  const occupiedId = nextRequestId++
  const occupiedError = waitFor(host, 'error', packet => packet.requestId === occupiedId)
  send(host, 'addBot', { roomId: friendRoomId, playerId: 'p2' }, occupiedId)
  assert.match((await occupiedError).message, /已有玩家/)

  await mutateBot(host, 'removeBot', 'p3', [])
  await mutateBot(host, 'addBot', 'p3', ['p3'])
  await mutateBot(host, 'addBot', 'p4', ['p3', 'p4'])

  const guestDisconnected = waitFor(host, 'roomMembers', packet => packet.roomId === friendRoomId && !packet.memberPlayerIds.includes('p2'))
  guest.close()
  await guestDisconnected
  await mutateBot(host, 'addBot', 'p2', ['p2', 'p3', 'p4'])

  const staleGuest = await connect()
  const staleRejoinId = nextRequestId++
  const staleRejoinError = waitFor(staleGuest, 'error', packet => packet.requestId === staleRejoinId)
  send(staleGuest, 'rejoinRoom', { roomId: friendRoomId, myPlayerId: 'p2', resumeToken: joined.resumeToken }, staleRejoinId)
  assert.match((await staleRejoinError).message, /机器人占用/, '机器人占座后旧重连凭证不能夺回该席位')

  const tickets = new GameTicketService({ secret, gameEndpoint: `ws://127.0.0.1:${port}/weapp` })
  const issuedTicket = tickets.issue({ userId: 'ticket-host', matchId: 'bot-ticket-check', roomId: ticketRoomId, seat: 'p1' })
  const ticketCreateId = nextRequestId++
  const ticketCreatedPromise = waitFor(ticketHost, 'roomCreated', packet => packet.requestId === ticketCreateId)
  send(ticketHost, 'createRoom', {
    roomId: ticketRoomId,
    hostName: '票据房',
    gameTicket: issuedTicket.gameTicket,
    entryAttemptId: issuedTicket.claims.entryAttemptId,
  }, ticketCreateId)
  await ticketCreatedPromise
  const ticketBotId = nextRequestId++
  const ticketBotError = waitFor(ticketHost, 'error', packet => packet.requestId === ticketBotId)
  send(ticketHost, 'addBot', { roomId: ticketRoomId, playerId: 'p2' }, ticketBotId)
  assert.match((await ticketBotError).message, /票据房不允许/)
  const ticketLeaveId = nextRequestId++
  const ticketLeftPromise = waitFor(ticketHost, 'roomLeft', packet => packet.requestId === ticketLeaveId)
  send(ticketHost, 'leaveRoom', { roomId: ticketRoomId }, ticketLeaveId)
  await ticketLeftPromise

  sockets.splice(0).forEach(socket => socket.close())
  await stopServer()

  startServer()
  const restoredHost = await connect()
  const rejoinId = nextRequestId++
  const rejoinedPromise = waitFor(restoredHost, 'roomRejoined', packet => packet.requestId === rejoinId)
  send(restoredHost, 'rejoinRoom', { roomId: friendRoomId, myPlayerId: 'p1', resumeToken: hostResumeToken }, rejoinId)
  const rejoined = await rejoinedPromise
  assert.deepEqual(rejoined.botPlayerIds, ['p2', 'p3', 'p4'], '重启恢复后机器人席位必须保持')
  assert.deepEqual(rejoined.lobbyReadyPlayerIds, ['p2', 'p3', 'p4'])

  const readyId = nextRequestId++
  const readyAccepted = waitFor(restoredHost, 'actionAccepted', packet => packet.requestId === readyId)
  send(restoredHost, 'setLobbyReady', { roomId: friendRoomId }, readyId)
  await readyAccepted

  const startId = nextRequestId++
  const startAccepted = waitFor(restoredHost, 'actionAccepted', packet => packet.requestId === startId)
  const startedPromise = waitFor(restoredHost, 'gameState', packet => packet.phase === 'playing')
  send(restoredHost, 'startGame', { roomId: friendRoomId }, startId)
  const [, started] = await Promise.all([startAccepted, startedPromise])
  assert.equal(started.state.players.p1.isAI, false)
  assert.ok(['p2', 'p3', 'p4'].every(id => started.state.players[id].isAI === true), '机器人开局必须标记 isAI=true')
  assert.deepEqual(started.botPlayerIds, ['p2', 'p3', 'p4'])

  const postStartRemoveId = nextRequestId++
  const postStartRemoveError = waitFor(restoredHost, 'error', packet => packet.requestId === postStartRemoveId)
  send(restoredHost, 'removeBot', { roomId: friendRoomId, playerId: 'p4' }, postStartRemoveId)
  assert.match((await postStartRemoveError).message, /对局开始后不能/)

  const playId = nextRequestId++
  const playAccepted = waitFor(restoredHost, 'actionAccepted', packet => packet.requestId === playId)
  const botActionPromise = waitFor(restoredHost, 'botAction', packet => packet.playerId === 'p2', 8000)
  const botStatePromise = waitFor(restoredHost, 'gameState', packet => packet.state.playArea.some(action => action.playerId === 'p2'), 8000)
  send(restoredHost, 'play', { roomId: friendRoomId, cardIds: [started.state.players.p1.hand.at(-1).id] }, playId)
  const [, botAction, botState] = await Promise.all([playAccepted, botActionPromise, botStatePromise])
  assert.equal(botAction.difficulty, 'master', '机器人自动动作必须明确使用最高档 master AI')
  assert.equal(botAction.trustees.p2, null, '机器人不能伪装成低档托管席位')
  assert.equal(botAction.consecutiveTimeouts.p2, 0, '机器人动作不能累计超时次数')
  assert.ok(botState.state.playArea.some(action => action.playerId === 'p2'))

  // A single real player and three bots are unanimous at proposal time.
  // There is no second human who could send the final vote to close the room.
  const dissolveId = nextRequestId++
  const dissolveAccepted = waitFor(restoredHost, 'actionAccepted', packet => packet.requestId === dissolveId)
  const dissolved = waitFor(restoredHost, 'roomDissolved', packet => packet.roomId === friendRoomId)
  send(restoredHost, 'proposeDissolve', { roomId: friendRoomId }, dissolveId)
  const [acceptance, closed] = await Promise.all([dissolveAccepted, dissolved])
  assert.equal(acceptance.requestType, 'proposeDissolve')
  assert.equal(closed.reason, 'vote-approved')

  // Closing retires resume-token acceptance aliases. A duplicate must report
  // the absent room, never reopen it or run another vote.
  const duplicateRejected = waitFor(restoredHost, 'error', packet => packet.requestId === dissolveId)
  send(restoredHost, 'proposeDissolve', { roomId: friendRoomId }, dissolveId)
  assert.match((await duplicateRejected).message, /当前不在对局中/)

  process.stdout.write('weapp friend-room bot protocol smoke passed\n')
} finally {
  sockets.splice(0).forEach(socket => socket.close())
  await stopServer()
  rmSync(stateDir, { recursive: true, force: true })
}
