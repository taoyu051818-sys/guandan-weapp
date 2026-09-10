import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { gameVersionFor, sendProtocolCommand } from './weapp-smoke-protocol.mjs'

const allocatePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    probe.close(error => error ? reject(error) : resolve(address.port))
  })
})
const port = await allocatePort()
const roomId = '314159'
const randomPrelude = `data:text/javascript,${encodeURIComponent('let seed=0x5eed1234; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)')}`
const child = spawn(process.execPath, ['--import', randomPrelude, 'server/weapp-ws.js'], {
  cwd: process.cwd(),
  env: { ...process.env, WEAPP_HOST: '127.0.0.1', WEAPP_WS_PORT: String(port), WEAPP_TURN_TIMEOUT_MS: '10000', WEAPP_TRUSTEE_ACTION_DELAY_MS: '5000' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let childOutput = ''
child.stdout.on('data', chunk => { childOutput += chunk.toString() })
child.stderr.on('data', chunk => { childOutput += chunk.toString() })
const sockets = []
const playerIds = ['p1', 'p2', 'p3', 'p4']
let nextRequestId = 1
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const connectOnce = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  socket.addEventListener('open', () => resolve(socket), { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const connect = async () => {
  const deadline = Date.now() + 8000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`WebSocket 服务提前退出 (${child.exitCode})\n${childOutput}`)
    try {
      return await connectOnce()
    } catch (error) {
      lastError = error
      await delay(50)
    }
  }
  throw new Error(`WebSocket 服务启动超时：${lastError?.message || '连接失败'}\n${childOutput}`)
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
  sendProtocolCommand(socket, type, payload, requestId)
  return requestId
}
const assertPrivateViews = (packets, expectedHandCounts, context) => {
  assert.equal(packets.length, playerIds.length)
  packets.forEach((packet, viewerIndex) => {
    const viewerId = playerIds[viewerIndex]
    assert.equal(packet.gameVersion, packet.state.revision, `${context}: ${viewerId} 的版本必须来自 canonical revision`)
    playerIds.forEach(playerId => {
      const hand = packet.state.players[playerId].hand
      assert.equal(hand.length, expectedHandCounts[playerId], `${context}: ${viewerId} 看到的 ${playerId} 手牌数不正确`)
      if (playerId === viewerId) {
        assert.ok(hand.every(card => (
          typeof card.id === 'string'
          && Object.hasOwn(card, 'rank')
          && Object.hasOwn(card, 'suit')
          && Number.isFinite(card.value)
        )), `${context}: ${viewerId} 必须看到自己的真实手牌`)
        return
      }
      assert.ok(hand.every((card, index) => (
        card.id === `hidden-${playerId}-${index}`
        && Object.keys(card).length === 1
      )), `${context}: ${viewerId} 不得看到 ${playerId} 的真实手牌`)
    })
  })
}
const findAscendingSingleCards = hands => {
  const byValue = playerId => [...hands[playerId]].sort((left, right) => left.value - right.value)
  for (const p3Card of byValue('p3')) {
    const p1Card = byValue('p1').find(card => card.value < p3Card.value)
    const p4Card = byValue('p4').find(card => card.value > p3Card.value)
    if (p1Card && p4Card) return { p1: p1Card, p3: p3Card, p4: p4Card }
  }
  throw new Error('固定牌局未找到 p1 < p3 < p4 的单牌链')
}

try {
  await delay(300)
  for (let i = 0; i < 4; i += 1) sockets.push(await connect())

  const createRequestId = nextRequestId++
  const createEntryAttemptId = 'create_attempt_7M4xQ2nV9kLp8sTw'
  const createPayload = {
    roomId,
    hostName: '集成测试',
    entryAttemptId: createEntryAttemptId,
    roomSettings: { disableInteraction: false },
    state: { currentTurn: 'p1', players: { p1: { hand: [{ id: 'injected-card' }] } } },
  }
  const createdPromise = message(sockets[0], 'roomCreated', packet => packet.requestId === createRequestId)
  send(sockets[0], 'createRoom', createPayload, createRequestId)
  const created = await createdPromise
  assert.equal(created.roomId, roomId)
  assert.equal(created.phase, 'lobby')
  assert.equal(created.state, null, 'createRoom 不得接受客户端注入的整局状态')
  assert.equal(created.gameVersion, 0)
  assert.equal(created.tribute, null)
  assert.equal(created.roundResult, null)
  assert.equal(created.lobbyReadyRequired, true)
  assert.deepEqual(created.lobbyReadyPlayerIds, [])
  assert.match(created.resumeToken, /^[a-f0-9]{64}$/)

  sockets[0].close()
  await delay(80)
  sockets[0] = await connect()
  const replayedCreatePromise = message(sockets[0], 'roomCreated', packet => packet.requestId === createRequestId)
  send(sockets[0], 'createRoom', createPayload, createRequestId)
  const replayedCreate = await replayedCreatePromise
  assert.equal(replayedCreate.resumeToken, created.resumeToken, '稳定 entryAttemptId 必须跨连接重放原 roomCreated 凭证')

  const secondRoomRequestId = nextRequestId++
  const secondRoomRejected = message(sockets[0], 'error', packet => packet.requestId === secondRoomRequestId)
  send(sockets[0], 'createRoom', { roomId: '271828', hostName: '幽灵房探针' }, secondRoomRequestId)
  const secondRoomError = await secondRoomRejected
  assert.equal(secondRoomError.code, 'ALREADY_IN_ROOM', '同一连接不得占用第二个房间')

  const listAfterRejectedRoomId = nextRequestId++
  const listAfterRejectedRoom = message(sockets[0], 'roomList', packet => packet.requestId === listAfterRejectedRoomId)
  send(sockets[0], 'listRooms', {}, listAfterRejectedRoomId)
  assert.equal((await listAfterRejectedRoom).rooms.some(room => room.roomId === '271828'), false, '被拒绝的第二房不得留下幽灵记录')

  const credentials = { p1: created.resumeToken }
  for (let i = 1; i < 4; i += 1) {
    const requestId = nextRequestId++
    const entryAttemptId = `join_attempt_${i}_Q7mN4vX9kLp2sTw`
    const joinPayload = { roomId, entryAttemptId }
    const joinedPromise = message(sockets[i], 'roomJoined', packet => packet.requestId === requestId)
    send(sockets[i], 'joinRoom', joinPayload, requestId)
    const joined = await joinedPromise
    assert.equal(joined.roomId, roomId)
    assert.equal(joined.phase, 'lobby')
    assert.match(joined.resumeToken, /^[a-f0-9]{64}$/)
    if (i === 1) {
      sockets[i].close()
      await delay(80)
      sockets[i] = await connect()
      const replayedJoinPromise = message(sockets[i], 'roomJoined', packet => packet.requestId === requestId)
      send(sockets[i], 'joinRoom', joinPayload, requestId)
      const replayedJoin = await replayedJoinPromise
      assert.equal(replayedJoin.myPlayerId, joined.myPlayerId, '动态分配席位必须随幂等响应稳定重放')
      assert.equal(replayedJoin.resumeToken, joined.resumeToken, '稳定 entryAttemptId 必须跨连接重放原 roomJoined 凭证')
    }
    credentials[joined.myPlayerId] = joined.resumeToken
  }
  assert.equal(new Set(Object.values(credentials)).size, 4, '每个席位必须获得独立重连凭证')

  const missingRequestIdPromise = message(sockets[0], 'error', packet => packet.code === 'invalid-request-id')
  sockets[0].send(JSON.stringify({ type: 'setLobbyReady', payload: { roomId, expectedVersion: 0 } }))
  assert.match((await missingRequestIdPromise).message, /requestId/)

  const missingVersionRequestId = nextRequestId++
  const missingVersionPromise = message(sockets[0], 'error', packet => packet.requestId === missingVersionRequestId)
  sockets[0].send(JSON.stringify({ type: 'startGame', requestId: missingVersionRequestId, payload: { roomId } }))
  assert.equal((await missingVersionPromise).code, 'missing-version')

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
  const startPayload = { roomId, expectedVersion: gameVersionFor(sockets[0], roomId) }
  const startAcceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === startRequestId)
  const initialPromises = sockets.slice(0, 4).map(socket => message(socket, 'gameState'))
  send(sockets[0], 'startGame', startPayload, startRequestId)
  const [startAccepted, initialPackets] = await Promise.all([
    startAcceptedPromise,
    Promise.all(initialPromises),
  ])
  const initial = initialPackets[0]
  assert.equal(startAccepted.requestType, 'startGame')
  assert.equal(initial.roomId, roomId)
  assert.equal(initial.phase, 'playing')
  assert.equal(initial.tribute, null)
  assert.equal(initial.roundResult, null)
  assert.equal(initial.gameVersion, initial.state.revision, 'gameVersion 必须直接投影 canonical revision')
  assert.equal(typeof initial.turnDeadlineAt, 'number')
  assert.ok(initial.turnDeadlineAt > Date.now(), '回合截止时间必须由服务端下发')
  assert.deepEqual(initial.roundReadyPlayerIds, [])
  assert.equal(initial.dissolveVote, null)
  assert.equal(initial.state.players.p1.hand.length, 27)
  assert.equal(initial.state.players.p2.hand[0].rank, undefined, '不应向 p1 泄露 p2 手牌')
  const handCounts = { p1: 27, p2: 27, p3: 27, p4: 27 }
  assertPrivateViews(initialPackets, handCounts, '开局')

  const privateHands = Object.fromEntries(playerIds.map((playerId, index) => (
    [playerId, initialPackets[index].state.players[playerId].hand]
  )))
  const singleCards = findAscendingSingleCards(privateHands)

  const duplicateStartAcceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === startRequestId)
  send(sockets[0], 'startGame', startPayload, startRequestId)
  assert.deepEqual(await duplicateStartAcceptedPromise, startAccepted, '重复开始请求不得重新发牌')

  const conflictingStartPromise = message(sockets[0], 'error', packet => packet.requestId === startRequestId)
  send(sockets[0], 'startGame', { ...startPayload, expectedVersion: startPayload.expectedVersion + 1 }, startRequestId)
  assert.equal((await conflictingStartPromise).code, 'IDEMPOTENCY_CONFLICT', '同一 requestId 的不同正文必须被明确拒绝')

  const spoofedActorRequestId = nextRequestId++
  const beforeSpoofGameVersion = gameVersionFor(sockets[0], roomId)
  const spoofedActorErrorPromise = message(sockets[1], 'error', packet => packet.requestId === spoofedActorRequestId)
  send(sockets[1], 'play', {
    roomId,
    actor: 'p1',
    playerId: 'p1',
    cardIds: [singleCards.p1.id],
  }, spoofedActorRequestId)
  assert.equal((await spoofedActorErrorPromise).message, '未轮到该玩家出牌', '错误连接不得通过 actor/playerId 冒用 p1')
  assert.equal(gameVersionFor(sockets[0], roomId), beforeSpoofGameVersion, '越权动作不得改变牌局版本')

  const playRequestId = nextRequestId++
  const acceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === playRequestId)
  const nextStatePromises = sockets.slice(0, 4).map(socket => message(socket, 'gameState', packet => packet.state.playArea.length === 1))
  const playPayload = { roomId, cardIds: [singleCards.p1.id], expectedVersion: gameVersionFor(sockets[0], roomId) }
  const stalePlayRequestId = nextRequestId++
  const stalePlayPromise = message(sockets[0], 'error', packet => packet.requestId === stalePlayRequestId)
  send(sockets[0], 'play', { ...playPayload, expectedVersion: gameVersionFor(sockets[0]) - 1 }, stalePlayRequestId)
  const stalePlay = await stalePlayPromise
  assert.equal(stalePlay.code, 'stale-version')
  assert.equal(stalePlay.actualVersion, gameVersionFor(sockets[0]))
  send(sockets[0], 'play', playPayload, playRequestId)
  const [accepted, afterPlayPackets] = await Promise.all([
    acceptedPromise,
    Promise.all(nextStatePromises),
  ])
  const afterPlay = afterPlayPackets[1]
  assert.equal(accepted.requestType, 'play')
  assert.equal(accepted.roomId, roomId)
  assert.equal(accepted.version, afterPlay.version)
  assert.equal(afterPlay.state.currentTurn, 'p2')
  assert.equal(afterPlay.gameVersion, afterPlay.state.revision, '局内 transition 后不得产生第二套牌局版本')
  handCounts.p1 -= 1
  assertPrivateViews(afterPlayPackets, handCounts, 'p1 出牌后')
  assert.equal(afterPlay.state.playArea[0].playerId, 'p1', '动作身份必须取自 p1 的连接')

  const duplicateAcceptedPromise = message(sockets[0], 'actionAccepted', packet => packet.requestId === playRequestId)
  send(sockets[0], 'play', playPayload, playRequestId)
  const duplicateAccepted = await duplicateAcceptedPromise
  assert.deepEqual(duplicateAccepted, accepted, '重复 requestId 应返回原 accepted，不得再次执行动作')

  const conflictingPlayPromise = message(sockets[0], 'error', packet => packet.requestId === playRequestId)
  send(sockets[0], 'play', { ...playPayload, cardIds: [] }, playRequestId)
  assert.equal((await conflictingPlayPromise).code, 'IDEMPOTENCY_CONFLICT')

  const submitTurnAction = async (playerId, type, payload, expectedTurn, expectedPlayAreaLength) => {
    const socketIndex = playerIds.indexOf(playerId)
    const requestId = nextRequestId++
    const acceptedActionPromise = message(sockets[socketIndex], 'actionAccepted', packet => packet.requestId === requestId)
    const statePromises = sockets.slice(0, 4).map(socket => message(socket, 'gameState', packet => (
      packet.state.playArea.length === expectedPlayAreaLength
      && packet.state.currentTurn === expectedTurn
    )))
    send(sockets[socketIndex], type, { roomId, ...payload }, requestId)
    const [acceptedAction, statePackets] = await Promise.all([
      acceptedActionPromise,
      Promise.all(statePromises),
    ])
    assert.equal(acceptedAction.requestType, type)
    assert.equal(statePackets[0].state.playArea.at(-1).playerId, playerId, `${playerId} 的动作必须绑定自己的连接`)
    assertPrivateViews(statePackets, handCounts, `${playerId} ${type} 后`)
    return statePackets
  }

  const afterP2PassPackets = await submitTurnAction('p2', 'pass', {}, 'p3', 2)
  assert.equal(afterP2PassPackets[0].state.playArea.at(-1).type, 'Pass')

  handCounts.p3 -= 1
  const afterP3PlayPackets = await submitTurnAction('p3', 'play', { cardIds: [singleCards.p3.id] }, 'p4', 3)
  assert.equal(afterP3PlayPackets[0].state.lastValidPlay.playerId, 'p3')

  handCounts.p4 -= 1
  const afterP4PlayPackets = await submitTurnAction('p4', 'play', { cardIds: [singleCards.p4.id] }, 'p1', 4)
  assert.equal(afterP4PlayPackets[0].state.lastValidPlay.playerId, 'p4')
  assert.deepEqual(afterP4PlayPackets[0].state.playArea.map(action => action.playerId), playerIds, '四席必须依次从各自连接提交合法动作')

  const p2DisconnectedPromise = message(sockets[0], 'roomMembers', packet => packet.roomId === roomId && !packet.memberPlayerIds.includes('p2'))
  sockets[1].close()
  await p2DisconnectedPromise

  let replacement = await connect()
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
  const previousResumeToken = credentials.p2
  send(replacement, 'rejoinRoom', { roomId, myPlayerId: 'p2', resumeToken: previousResumeToken }, rejoinRequestId)
  const rejoined = await rejoinedPromise
  assert.equal(rejoined.myPlayerId, 'p2')
  assert.match(rejoined.resumeToken, /^[a-f0-9]{64}$/)
  assert.notEqual(rejoined.resumeToken, previousResumeToken, '每次成功重连都必须轮换恢复凭证')
  credentials.p2 = rejoined.resumeToken
  assert.equal(rejoined.phase, 'playing')
  assert.equal(rejoined.tribute, null)
  assert.equal(rejoined.roundResult, null)
  assert.equal(rejoined.trustees.p2.reason, 'disconnected', '断线席位重连后应先恢复托管快照')
  assert.ok(Object.hasOwn(rejoined, 'tribute') && Object.hasOwn(rejoined, 'roundResult'), '重连响应必须携带阶段恢复元数据')
  assert.equal(rejoined.state.playArea.length, 4, '重复出牌与重连不得改变四席动作链')
  assert.equal(rejoined.roomId, roomId)
  assert.equal(typeof rejoined.version, 'number')

  replacement.close()
  await delay(80)
  replacement = await connect()
  sockets.push(replacement)
  const replayedRejoinPromise = message(replacement, 'roomRejoined', packet => packet.requestId === rejoinRequestId)
  send(replacement, 'rejoinRoom', { roomId, myPlayerId: 'p2', resumeToken: previousResumeToken }, rejoinRequestId)
  const replayedRejoin = await replayedRejoinPromise
  assert.equal(replayedRejoin.resumeToken, rejoined.resumeToken, '重连响应丢失后必须允许用旧凭证和相同 requestId 精确重放新凭证')

  const replayProbe = await connect()
  sockets.push(replayProbe)
  const replayRequestId = nextRequestId++
  const replayErrorPromise = message(replayProbe, 'error', packet => packet.requestId === replayRequestId)
  send(replayProbe, 'rejoinRoom', { roomId, myPlayerId: 'p2', resumeToken: previousResumeToken }, replayRequestId)
  assert.match((await replayErrorPromise).message, /凭证无效/, '轮换前的恢复凭证必须立即失效')

  const retiredChatRequestId = nextRequestId++
  const retiredChatError = message(sockets[2], 'error', packet => packet.requestId === retiredChatRequestId)
  send(sockets[2], 'chat', { roomId, text: '谢谢' }, retiredChatRequestId)
  assert.match((await retiredChatError).message, /未知|不支持/)

  const memberLeftPromise = message(sockets[0], 'roomMembers', packet => packet.roomId === roomId && !packet.memberPlayerIds.includes('p2'))
  send(replacement, 'leaveRoom', { roomId, expectedVersion: 0 })
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
