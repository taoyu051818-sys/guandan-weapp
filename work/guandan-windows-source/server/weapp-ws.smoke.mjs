import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const port = 39102
const roomId = '314159'
const child = spawn(process.execPath, ['server/weapp-ws.js'], {
  cwd: process.cwd(),
  env: { ...process.env, WEAPP_WS_PORT: String(port), WEAPP_TURN_TIMEOUT_MS: '10000', WEAPP_TRUSTEE_ACTION_DELAY_MS: '5000' },
  stdio: 'ignore',
})
const sockets = []
let nextRequestId = 1
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const connectOnce = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  socket.addEventListener('open', () => resolve(socket), { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const connect = async () => {
  const deadline = Date.now() + 3000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await connectOnce()
    } catch (error) {
      lastError = error
      await delay(50)
    }
  }
  throw lastError || new Error('WebSocket 服务启动超时')
}
const message = (socket, type, matches = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), 3000)
  const handler = ({ data }) => {
    const payload = JSON.parse(data)
    if (payload.type === type && matches(payload)) {
      clearTimeout(timer)
      socket.removeEventListener('message', handler)
      resolve(payload)
    }
  }
  socket.addEventListener('message', handler)
})
const send = (socket, type, payload, requestId = nextRequestId++) => {
  socket.send(JSON.stringify({ type, requestId, payload }))
  return requestId
}

try {
  await delay(300)
  for (let i = 0; i < 4; i += 1) sockets.push(await connect())

  const createRequestId = nextRequestId++
  const createdPromise = message(sockets[0], 'roomCreated', packet => packet.requestId === createRequestId)
  send(sockets[0], 'createRoom', {
    roomId,
    hostName: '集成测试',
    roomSettings: { disableInteraction: false },
  }, createRequestId)
  const created = await createdPromise
  assert.equal(created.roomId, roomId)
  assert.equal(created.phase, 'lobby')
  assert.equal(created.tribute, null)
  assert.equal(created.roundResult, null)
  assert.equal(created.lobbyReadyRequired, true)
  assert.deepEqual(created.lobbyReadyPlayerIds, [])
  assert.match(created.resumeToken, /^[a-f0-9]{64}$/)

  const credentials = { p1: created.resumeToken }
  for (let i = 1; i < 4; i += 1) {
    const requestId = nextRequestId++
    const joinedPromise = message(sockets[i], 'roomJoined', packet => packet.requestId === requestId)
    send(sockets[i], 'joinRoom', { roomId }, requestId)
    const joined = await joinedPromise
    assert.equal(joined.roomId, roomId)
    assert.equal(joined.phase, 'lobby')
    assert.match(joined.resumeToken, /^[a-f0-9]{64}$/)
    credentials[joined.myPlayerId] = joined.resumeToken
  }
  assert.equal(new Set(Object.values(credentials)).size, 4, '每个席位必须获得独立重连凭证')

  const activeSeatProbe = await connect()
  sockets.push(activeSeatProbe)
  const activeSeatRejoinRequestId = nextRequestId++
  const activeSeatRejoinErrorPromise = message(activeSeatProbe, 'error', packet => packet.requestId === activeSeatRejoinRequestId)
  send(activeSeatProbe, 'rejoinRoom', { roomId, myPlayerId: 'p2', resumeToken: credentials.p2 }, activeSeatRejoinRequestId)
  assert.match((await activeSeatRejoinErrorPromise).message, /活动连接占用/, '重连凭证不能覆盖仍在线的同座连接')
  activeSeatProbe.close()

  const prematureStartRequestId = nextRequestId++
  const prematureStartErrorPromise = message(sockets[0], 'error', packet => packet.requestId === prematureStartRequestId)
  send(sockets[0], 'startGame', { roomId }, prematureStartRequestId)
  assert.match((await prematureStartErrorPromise).message, /都准备/)

  const kickRequestId = nextRequestId++
  const kickedPromise = message(sockets[1], 'roomKicked', packet => packet.roomId === roomId)
  const kickedMembersPromise = message(sockets[0], 'roomMembers', packet => packet.roomId === roomId && !packet.memberPlayerIds.includes('p2'))
  const kickAcceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === kickRequestId)
  send(sockets[0], 'kickMember', { roomId, playerId: 'p2' }, kickRequestId)
  const [kicked, kickedMembers, kickAccepted] = await Promise.all([kickedPromise, kickedMembersPromise, kickAcceptedPromise])
  assert.equal(kicked.reason, 'host-kicked')
  assert.deepEqual(kickedMembers.lobbyReadyPlayerIds, [])
  assert.equal(kickAccepted.requestType, 'kickMember')

  const rejoinAfterKickRequestId = nextRequestId++
  const rejoinAfterKickPromise = message(sockets[1], 'roomJoined', packet => packet.requestId === rejoinAfterKickRequestId)
  send(sockets[1], 'joinRoom', { roomId }, rejoinAfterKickRequestId)
  const rejoinAfterKick = await rejoinAfterKickPromise
  assert.equal(rejoinAfterKick.myPlayerId, 'p2')
  assert.notEqual(rejoinAfterKick.resumeToken, credentials.p2, '被移出后重新入座必须签发新的恢复凭证')
  credentials.p2 = rejoinAfterKick.resumeToken

  const readySeat = async (socket, playerId) => {
    const requestId = nextRequestId++
    const acceptedPromise = message(socket, 'actionAccepted', packet => packet.requestId === requestId)
    const updatedPromise = message(sockets[0], 'lobbyReadyUpdated', packet => packet.lobbyReadyPlayerIds.includes(playerId))
    send(socket, 'setLobbyReady', { roomId }, requestId)
    const [accepted, updated] = await Promise.all([acceptedPromise, updatedPromise])
    assert.equal(accepted.requestType, 'setLobbyReady')
    return updated
  }
  await readySeat(sockets[1], 'p2')

  const nonHostKickRequestId = nextRequestId++
  const nonHostKickErrorPromise = message(sockets[2], 'error', packet => packet.requestId === nonHostKickRequestId)
  send(sockets[2], 'kickMember', { roomId, playerId: 'p4' }, nonHostKickRequestId)
  assert.match((await nonHostKickErrorPromise).message, /只有房主/)

  const kickReadyRequestId = nextRequestId++
  const kickReadyErrorPromise = message(sockets[0], 'error', packet => packet.requestId === kickReadyRequestId)
  send(sockets[0], 'kickMember', { roomId, playerId: 'p2' }, kickReadyRequestId)
  assert.match((await kickReadyErrorPromise).message, /已准备成员不能被移出/)

  await readySeat(sockets[2], 'p3')
  const cancelReadyRequestId = nextRequestId++
  const cancelledReadyPromise = message(sockets[0], 'lobbyReadyUpdated', packet => !packet.lobbyReadyPlayerIds.includes('p3'))
  send(sockets[2], 'cancelLobbyReady', { roomId }, cancelReadyRequestId)
  assert.equal((await cancelledReadyPromise).lobbyReadyPlayerIds.includes('p3'), false)
  await readySeat(sockets[2], 'p3')
  await readySeat(sockets[3], 'p4')
  const allReady = await readySeat(sockets[0], 'p1')
  assert.deepEqual(allReady.lobbyReadyPlayerIds, ['p1', 'p2', 'p3', 'p4'])

  const startRequestId = nextRequestId++
  const startAcceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === startRequestId)
  const initialPromise = message(sockets[0], 'gameState')
  send(sockets[0], 'startGame', { roomId }, startRequestId)
  const [startAccepted, initial] = await Promise.all([startAcceptedPromise, initialPromise])
  assert.equal(startAccepted.requestType, 'startGame')
  assert.equal(initial.roomId, roomId)
  assert.equal(initial.phase, 'playing')
  assert.equal(initial.tribute, null)
  assert.equal(initial.roundResult, null)
  assert.equal(typeof initial.turnDeadlineAt, 'number')
  assert.ok(initial.turnDeadlineAt > Date.now(), '回合截止时间必须由服务端下发')
  assert.deepEqual(initial.roundReadyPlayerIds, [])
  assert.equal(initial.dissolveVote, null)
  assert.equal(initial.state.players.p1.hand.length, 27)
  assert.equal(initial.state.players.p2.hand[0].rank, undefined, '不应向 p1 泄露 p2 手牌')

  const duplicateStartAcceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === startRequestId)
  send(sockets[0], 'startGame', { roomId }, startRequestId)
  assert.deepEqual(await duplicateStartAcceptedPromise, startAccepted, '重复开始请求不得重新发牌')

  const playRequestId = nextRequestId++
  const acceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === playRequestId)
  const nextStatePromise = message(sockets[1], 'gameState', packet => packet.state.playArea.length === 1)
  const playPayload = { roomId, cardIds: [initial.state.players.p1.hand[0].id] }
  send(sockets[0], 'play', playPayload, playRequestId)
  const [accepted, afterPlay] = await Promise.all([acceptedPromise, nextStatePromise])
  assert.equal(accepted.requestType, 'play')
  assert.equal(accepted.roomId, roomId)
  assert.equal(accepted.version, afterPlay.version)
  assert.equal(afterPlay.state.currentTurn, 'p2')

  const duplicateAcceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === playRequestId)
  send(sockets[0], 'play', playPayload, playRequestId)
  const duplicateAccepted = await duplicateAcceptedPromise
  assert.deepEqual(duplicateAccepted, accepted, '重复 requestId 应返回原 accepted，不得再次执行动作')

  const p2DisconnectedPromise = message(sockets[0], 'roomMembers', packet => packet.roomId === roomId && !packet.memberPlayerIds.includes('p2'))
  sockets[1].close()
  await p2DisconnectedPromise

  const replacement = await connect()
  sockets.push(replacement)
  const joinAfterStartRequestId = nextRequestId++
  const joinAfterStartErrorPromise = message(replacement, 'error', packet => packet.requestId === joinAfterStartRequestId)
  send(replacement, 'joinRoom', { roomId }, joinAfterStartRequestId)
  assert.match((await joinAfterStartErrorPromise).message, /已经开始/)

  const wrongTokenRequestId = nextRequestId++
  const wrongTokenErrorPromise = message(replacement, 'error', packet => packet.requestId === wrongTokenRequestId)
  send(replacement, 'rejoinRoom', { roomId, myPlayerId: 'p2', resumeToken: '0'.repeat(64) }, wrongTokenRequestId)
  assert.match((await wrongTokenErrorPromise).message, /凭证无效/)

  const rejoinRequestId = nextRequestId++
  const rejoinedPromise = message(replacement, 'roomRejoined', packet => packet.requestId === rejoinRequestId)
  send(replacement, 'rejoinRoom', { roomId, myPlayerId: 'p2', resumeToken: credentials.p2 }, rejoinRequestId)
  const rejoined = await rejoinedPromise
  assert.equal(rejoined.myPlayerId, 'p2')
  assert.equal(rejoined.resumeToken, credentials.p2)
  assert.equal(rejoined.phase, 'playing')
  assert.equal(rejoined.tribute, null)
  assert.equal(rejoined.roundResult, null)
  assert.equal(rejoined.trustees.p2.reason, 'disconnected', '断线席位重连后应先恢复托管快照')
  assert.ok(Object.hasOwn(rejoined, 'tribute') && Object.hasOwn(rejoined, 'roundResult'), '重连响应必须携带阶段恢复元数据')
  assert.equal(rejoined.state.playArea.length, 1, '重复出牌不得改变服务端状态')
  assert.equal(rejoined.roomId, roomId)
  assert.equal(typeof rejoined.version, 'number')

  const arbitraryChatRequestId = nextRequestId++
  const arbitraryChatErrorPromise = message(sockets[2], 'error', packet => packet.requestId === arbitraryChatRequestId)
  send(sockets[2], 'chat', { roomId, text: '集成测试消息' }, arbitraryChatRequestId)
  assert.match((await arbitraryChatErrorPromise).message, /固定快捷语/)

  const obsoleteCopyRequestId = nextRequestId++
  const obsoleteCopyErrorPromise = message(sockets[2], 'error', packet => packet.requestId === obsoleteCopyRequestId)
  send(sockets[2], 'chat', { roomId, text: '这手打得漂亮' }, obsoleteCopyRequestId)
  assert.match((await obsoleteCopyErrorPromise).message, /固定快捷语/, '旧短文案不能与新原声形成文本不一致')

  const chatRequestId = nextRequestId++
  const chatAcceptedPromise = message(sockets[2], 'actionAccepted', packet => packet.requestId === chatRequestId)
  const receivedChatPromise = message(sockets[0], 'chat')
  send(sockets[2], 'chat', { roomId, text: '你的牌打得太好啦' }, chatRequestId)
  const [chatAccepted, receivedChat] = await Promise.all([chatAcceptedPromise, receivedChatPromise])
  assert.equal(chatAccepted.requestType, 'chat')
  assert.equal(receivedChat.text, '你的牌打得太好啦')
  assert.equal(receivedChat.roomId, roomId)
  assert.equal(typeof receivedChat.version, 'number')

  const throttledChatRequestId = nextRequestId++
  const throttledChatErrorPromise = message(sockets[2], 'error', packet => packet.requestId === throttledChatRequestId)
  send(sockets[2], 'chat', { roomId, text: '谢谢' }, throttledChatRequestId)
  const throttledChat = await throttledChatErrorPromise
  assert.match(throttledChat.message, /频繁/)
  assert.ok(throttledChat.retryAfterMs > 0 && throttledChat.retryAfterMs <= 1200)

  await delay(1250)
  const repeatedChatRequestId = nextRequestId++
  const repeatedChatErrorPromise = message(sockets[2], 'error', packet => packet.requestId === repeatedChatRequestId)
  send(sockets[2], 'chat', { roomId, text: '你的牌打得太好啦' }, repeatedChatRequestId)
  const repeatedChat = await repeatedChatErrorPromise
  assert.match(repeatedChat.message, /冷却/)
  assert.ok(repeatedChat.retryAfterMs > 6000 && repeatedChat.retryAfterMs <= 8000)

  const memberLeftPromise = message(sockets[0], 'roomMembers', packet => packet.roomId === roomId && !packet.memberPlayerIds.includes('p2'))
  send(replacement, 'leaveRoom', { roomId })
  assert.deepEqual((await memberLeftPromise).memberPlayerIds, ['p1', 'p3', 'p4'])

  const hostReservedPromise = message(sockets[2], 'roomMembers', packet => packet.roomId === roomId && !packet.memberPlayerIds.includes('p1'))
  const hostLeaveRequestId = nextRequestId++
  const hostLeftReplyPromise = message(sockets[0], 'roomLeft', packet => packet.requestId === hostLeaveRequestId)
  send(sockets[0], 'leaveRoom', { roomId }, hostLeaveRequestId)
  const [hostReserved, hostLeftReply] = await Promise.all([hostReservedPromise, hostLeftReplyPromise])
  assert.equal(hostReserved.memberPlayerIds.includes('p1'), false)
  assert.equal(hostLeftReply.seatReserved, true, '对局中的安全退出必须保留房主席位，而不是销毁整房')

  console.log('weapp websocket integration passed')
} finally {
  sockets.forEach(socket => socket.close())
  child.kill('SIGTERM')
}
