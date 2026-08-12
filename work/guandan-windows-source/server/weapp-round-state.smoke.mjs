import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'

let nextRequestId = 1
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const send = (socket, type, payload, requestId = nextRequestId++) => {
  sendProtocolCommand(socket, type, payload, requestId)
  return requestId
}
const waitFor = (socket, type, matches = () => true, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), timeoutMs)
  const handler = ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type !== type || !matches(packet)) return
    clearTimeout(timer)
    socket.removeEventListener('message', handler)
    resolve(packet)
  }
  socket.addEventListener('message', handler)
})
const connect = async port => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
        socket.addEventListener('open', () => resolve(socket), { once: true })
        socket.addEventListener('error', reject, { once: true })
      })
    } catch { await delay(40) }
  }
  throw new Error('WebSocket 服务启动超时')
}
const enterRoom = async (port, roomId) => {
  const sockets = await Promise.all([0, 1, 2, 3].map(() => connect(port)))
  const seats = new Map()
  const tokens = {}
  const createId = nextRequestId++
  const createdPromise = waitFor(sockets[0], 'roomCreated', packet => packet.requestId === createId)
  send(sockets[0], 'createRoom', { roomId, hostName: '专项测试' }, createId)
  const created = await createdPromise
  seats.set('p1', sockets[0]); tokens.p1 = created.resumeToken
  for (let index = 1; index < 4; index += 1) {
    const requestId = nextRequestId++
    const joinedPromise = waitFor(sockets[index], 'roomJoined', packet => packet.requestId === requestId)
    send(sockets[index], 'joinRoom', { roomId }, requestId)
    const joined = await joinedPromise
    seats.set(joined.myPlayerId, sockets[index]); tokens[joined.myPlayerId] = joined.resumeToken
  }
  return { sockets, seats, tokens }
}
const startRoom = async (entered, roomId) => {
  for (const seat of ['p1', 'p2', 'p3', 'p4']) {
    const socket = entered.seats.get(seat)
    const requestId = nextRequestId++
    const acceptedPromise = waitFor(socket, 'actionAccepted', packet => packet.requestId === requestId)
    send(socket, 'setLobbyReady', { roomId }, requestId)
    await acceptedPromise
  }
  const statePromise = waitFor(entered.sockets[0], 'gameState')
  send(entered.sockets[0], 'startGame', { roomId })
  return statePromise
}
const launch = (port, env = {}, randomSeed = '0x5eed1234') => {
  return spawn(process.execPath, ['server/weapp-ws.js'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'test', WEAPP_TEST_RANDOM_SEED: randomSeed, WEAPP_WS_PORT: String(port), ...env },
  stdio: 'ignore',
  })
}
const stop = child => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    child.once('exit', resolve)
    child.kill('SIGTERM')
  })
}

const timeoutPort = 39112
const timeoutChild = launch(timeoutPort, {
  WEAPP_TURN_TIMEOUT_MS: '100',
  WEAPP_TRUSTEE_ACTION_DELAY_MS: '25',
  WEAPP_FRIEND_SECOND_MS: '5',
  WEAPP_EMPTY_ROOM_TIMEOUT_MS: '150',
})
let timeoutSockets = []
try {
  await delay(250)
  const roomId = '271828'
  const entered = await enterRoom(timeoutPort, roomId)
  timeoutSockets = entered.sockets
  const secondP1Timeout = waitFor(entered.sockets[0], 'turnTimedOut', packet => packet.playerId === 'p1' && packet.enteredTrustee, 4000)
  const initial = await startRoom(entered, roomId)
  assert.ok(initial.turnDeadlineAt > Date.now())
  assert.ok(initial.turnDeadlineAt - Date.now() <= 200, '测试配置下仍须使用服务端权威截止时间')
  const timedOut = await secondP1Timeout
  assert.equal(timedOut.trustees.p1.reason, 'timeout')
  assert.equal(timedOut.consecutiveTimeouts.p1, 2)

  const cancelId = nextRequestId++
  const cancelledPromise = waitFor(entered.sockets[0], 'trusteeUpdated', packet => packet.requestId !== cancelId && packet.trustees.p1 === null)
  send(entered.sockets[0], 'cancelTrustee', { roomId }, cancelId)
  const cancelled = await cancelledPromise
  assert.equal(cancelled.consecutiveTimeouts.p1, 0)

  const disconnectedPromise = waitFor(entered.sockets[0], 'trusteeUpdated', packet => packet.trustees.p2?.reason === 'disconnected')
  entered.seats.get('p2').close()
  assert.equal((await disconnectedPromise).trustees.p2.reason, 'disconnected')

  entered.sockets.forEach(socket => socket.close())
  await delay(300)
  const expiredRoomSocket = await connect(timeoutPort)
  timeoutSockets.push(expiredRoomSocket)
  const expiredRejoinId = nextRequestId++
  const expiredRejoinErrorPromise = waitFor(expiredRoomSocket, 'error', packet => packet.requestId === expiredRejoinId)
  send(expiredRoomSocket, 'rejoinRoom', { roomId, myPlayerId: 'p1', resumeToken: entered.tokens.p1 }, expiredRejoinId)
  assert.match((await expiredRejoinErrorPromise).message, /房间或席位无效/, '整桌离线超过宽限期后必须清理恢复凭证')
} finally {
  timeoutSockets.forEach(socket => socket.close())
  await stop(timeoutChild)
}

const roundPort = 39113
const roundChild = launch(roundPort, { WEAPP_TURN_TIMEOUT_MS: '30000', WEAPP_TRUSTEE_ACTION_DELAY_MS: '50', WEAPP_FRIEND_SECOND_MS: '5' })
let roundSockets = []
try {
  await delay(250)
  const roomId = '161803'
  const entered = await enterRoom(roundPort, roomId)
  roundSockets = entered.sockets
  const latest = new Map()
  entered.seats.forEach((socket, seat) => socket.addEventListener('message', ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type === 'gameState') latest.set(seat, packet)
  }))
  let table = await startRoom(entered, roomId)
  for (let actions = 0; !table.roundResult && actions < 500; actions += 1) {
    const playerId = table.state.currentTurn
    const playerSocket = entered.seats.get(playerId)
    let privatePacket = latest.get(playerId)
    if (!privatePacket || privatePacket.version < table.version) {
      privatePacket = await waitFor(playerSocket, 'gameState', packet => packet.version >= table.version)
      latest.set(playerId, privatePacket)
    }
    const nextStatePromise = waitFor(entered.sockets[0], 'gameState', packet => packet.version > table.version)
    if (table.state.lastValidPlay) send(playerSocket, 'pass', { roomId })
    else {
      const hand = privatePacket.state.players[playerId].hand
      send(playerSocket, 'play', { roomId, cardIds: [hand.at(-1).id] })
    }
    table = await nextStatePromise
  }
  assert.ok(table.roundResult, '专项测试应完整打完一局以验证局间准备')
  const priorFullRank = table.roundResult.fullRank

  const p4Socket = entered.seats.get('p4')
  const p4ExitId = nextRequestId++
  const p4AutoReadyPromise = waitFor(entered.sockets[0], 'roundReadyUpdated', packet => packet.roundReadyPlayerIds.includes('p4'))
  const p4ExitPromise = waitFor(p4Socket, 'roomLeft', packet => packet.requestId === p4ExitId)
  send(p4Socket, 'safeExit', { roomId, expectedVersion: 0 }, p4ExitId)
  const [p4AutoReady, p4Exit] = await Promise.all([p4AutoReadyPromise, p4ExitPromise])
  assert.deepEqual(p4AutoReady.roundReadyPlayerIds, ['p4'], '结算阶段离线席位必须由服务器自动准备')
  assert.equal(p4Exit.seatReserved, true)

  const p4RejoinId = nextRequestId++
  const p4RejoinedPromise = waitFor(p4Socket, 'roomRejoined', packet => packet.requestId === p4RejoinId)
  send(p4Socket, 'rejoinRoom', { roomId, myPlayerId: 'p4', resumeToken: entered.tokens.p4 }, p4RejoinId)
  const p4Rejoined = await p4RejoinedPromise
  assert.notEqual(p4Rejoined.resumeToken, entered.tokens.p4)
  entered.tokens.p4 = p4Rejoined.resumeToken
  assert.deepEqual(p4Rejoined.roundReadyPlayerIds, ['p4'], '重连快照必须保留服务端自动准备状态')
  const p4TrusteeCancelledPromise = waitFor(entered.sockets[0], 'trusteeUpdated', packet => packet.trustees.p4 === null)
  send(p4Socket, 'cancelTrustee', { roomId })
  await p4TrusteeCancelledPromise

  const seats = ['p1', 'p2']
  for (let index = 0; index < seats.length; index += 1) {
    const readyPromise = waitFor(entered.sockets[0], 'roundReadyUpdated', packet => packet.roundReadyPlayerIds.includes(seats[index]))
    send(entered.seats.get(seats[index]), 'readyNextRound', { roomId })
    const ready = await readyPromise
    assert.equal(ready.roundReadyPlayerIds.length, index + 2)
  }
  let preparedEarly = false
  const earlyHandler = ({ data }) => { if (JSON.parse(data).type === 'roundPrepared') preparedEarly = true }
  entered.sockets[0].addEventListener('message', earlyHandler)
  await delay(30)
  entered.sockets[0].removeEventListener('message', earlyHandler)
  assert.equal(preparedEarly, false, '仍在线的第三名玩家未准备前不得提前开下一局')
  const preparedPromise = waitFor(entered.sockets[0], 'roundPrepared')
  send(entered.seats.get('p3'), 'readyNextRound', { roomId })
  const prepared = await preparedPromise
  assert.equal(prepared.roundResult, null)
  assert.equal(prepared.gameVersion, prepared.state.revision, '准备下一局必须由 canonical transition 推进版本')
  assert.deepEqual(prepared.roundReadyPlayerIds, [])
  assert.equal(prepared.tribute.isDoubleDown, true, '固定单张领出策略应形成同队前二，以覆盖双下贡还')
  assert.equal(prepared.tribute.actions.length, 2)
  assert.equal(prepared.deadlineAction, 'tribute')
  const [firstTribute, secondTribute] = prepared.tribute.actions
  assert.equal(prepared.deadlinePlayerId, firstTribute.from, '双下必须严格按 actions 数组顺序进贡')

  const outOfOrderId = nextRequestId++
  const outOfOrderErrorPromise = waitFor(entered.seats.get(secondTribute.from), 'error', packet => packet.requestId === outOfOrderId)
  send(entered.seats.get(secondTribute.from), 'tribute', { roomId, cardId: 'not-current-yet' }, outOfOrderId)
  assert.match((await outOfOrderErrorPromise).message, /等待其他玩家/, '第二贡者不得越过第一贡者并发提交')

  const firstTributeViewer = entered.seats.get(firstTribute.from)
  const hiddenFirstTributePromise = waitFor(entered.seats.get(secondTribute.from), 'tributeUpdated', packet => (
    packet.deadlineAction === 'tribute' && packet.deadlinePlayerId === secondTribute.from
  ))
  const firstAutoTributePromise = waitFor(firstTributeViewer, 'tributeUpdated', packet => (
    packet.tribute?.actions[0]?.card && packet.deadlineAction === 'tribute' && packet.deadlinePlayerId === secondTribute.from
  ))
  send(firstTributeViewer, 'setTrustee', { roomId })
  const [afterFirstTribute, hiddenFirstTribute] = await Promise.all([firstAutoTributePromise, hiddenFirstTributePromise])
  assert.equal(afterFirstTribute.gameVersion, afterFirstTribute.state.revision, '贡牌选择必须由 canonical transition 推进版本')
  assert.equal(hiddenFirstTribute.tribute.actions[0].card, null, '未完成双贡不得向另一贡者泄露先选牌面')
  assert.equal(hiddenFirstTribute.state.tribute.exchanges[0].tributeCardId, null, '未完成双贡不得通过 canonical state 泄露选择 ID')
  assert.equal(afterFirstTribute.state.tribute.exchanges[0].tributeCardId, afterFirstTribute.tribute.actions[0].card.id, '贡者自己的 canonical state 应确认已选择牌')
  assert.equal(afterFirstTribute.tribute.actions[1].card, null)
  assert.equal(
    Object.values(afterFirstTribute.state.players).reduce((total, player) => total + player.hand.length, 0),
    108,
    '双贡收齐前不得移动任一张牌，避免半完成状态污染权威手牌',
  )
  assert.equal(afterFirstTribute.tribute.actions.filter(action => action.card).length, 1)

  const secondTributeSocket = entered.seats.get(secondTribute.from)
  const returningPromise = waitFor(entered.sockets[0], 'tributeUpdated', packet => (
    packet.tribute?.phase === 'returning' && packet.deadlineAction === 'returnTribute'
  ))
  secondTributeSocket.close()
  const returning = await returningPromise
  assert.ok(returning.tribute.actions[1].card, '当前贡者断线后必须以短延迟自动交出规则要求的最高牌')
  assert.equal(
    Object.values(returning.state.players).reduce((total, player) => total + player.hand.length, 0),
    108,
    '双贡收齐后必须把两张贡牌同时加入动态收贡者手牌',
  )
  const [firstReturn, secondReturn] = returning.tribute.actions
  const leaderAction = returning.tribute.actions.find(action => action.to === priorFullRank[0])
  assert.ok(leaderAction, '双贡收齐后必须存在实际贡给上游的 action')
  assert.equal(returning.deadlinePlayerId, firstReturn.to, '首个还贡 actor 必须来自动态 recipient，而非预设映射')

  const tributeReplacement = await connect(roundPort)
  roundSockets.push(tributeReplacement)
  const tributeRejoinId = nextRequestId++
  const tributeRejoinedPromise = waitFor(tributeReplacement, 'roomRejoined', packet => packet.requestId === tributeRejoinId)
  send(tributeReplacement, 'rejoinRoom', { roomId, myPlayerId: secondTribute.from, resumeToken: entered.tokens[secondTribute.from] }, tributeRejoinId)
  const tributeRejoined = await tributeRejoinedPromise
  assert.notEqual(tributeRejoined.resumeToken, entered.tokens[secondTribute.from])
  entered.tokens[secondTribute.from] = tributeRejoined.resumeToken
  assert.equal(tributeRejoined.deadlineAction, 'returnTribute')
  assert.equal(tributeRejoined.deadlinePlayerId, firstReturn.to, '贡者重连必须恢复动态 recipient 的当前权威还贡步骤，而不是本地补动作')
  entered.seats.set(secondTribute.from, tributeReplacement)

  const firstReturnViewer = entered.seats.get(firstReturn.to)
  const hiddenFirstReturnPromise = waitFor(entered.seats.get(secondReturn.to), 'tributeUpdated', packet => (
    packet.deadlineAction === 'returnTribute' && packet.deadlinePlayerId === secondReturn.to
  ))
  const firstAutoReturnPromise = waitFor(firstReturnViewer, 'tributeUpdated', packet => (
    packet.tribute?.actions[0]?.returnCard && packet.deadlineAction === 'returnTribute' && packet.deadlinePlayerId === secondReturn.to
  ))
  send(firstReturnViewer, 'setTrustee', { roomId })
  const [afterFirstReturn, hiddenFirstReturn] = await Promise.all([firstAutoReturnPromise, hiddenFirstReturnPromise])
  assert.equal(hiddenFirstReturn.tribute.actions[0].returnCard, null, '未完成双还贡不得向另一还贡者泄露先选牌面')
  assert.equal(hiddenFirstReturn.state.tribute.exchanges[0].returnCardId, null, '未完成双还贡不得通过 canonical state 泄露选择 ID')
  assert.equal(afterFirstReturn.state.tribute.exchanges[0].returnCardId, afterFirstReturn.tribute.actions[0].returnCard.id, '还贡者自己的 canonical state 应确认已选择牌')
  assert.equal(afterFirstReturn.tribute.actions[1].returnCard, null)
  assert.ok(afterFirstReturn.tribute.actions[0].returnCard.value <= 10, '超时还贡必须实际落下点数不高于 10 的最低合法牌')

  const tributeDonePromise = waitFor(entered.sockets[0], 'tributeUpdated', packet => (
    packet.tribute?.phase === 'done' && packet.deadlineAction === 'finishTribute' && packet.deadlinePlayerId === leaderAction.from
  ))
  const automaticPlayStartPromise = waitFor(entered.sockets[0], 'gameState', packet => (
    packet.phase === 'playing' && packet.tribute === null && packet.deadlineAction === 'play'
  ))
  send(entered.seats.get(secondReturn.to), 'setTrustee', { roomId })
  const tributeDone = await tributeDonePromise
  assert.ok(tributeDone.tribute.actions.every(action => action.returnCard?.value <= 10), '双下两次自动还贡都必须写入权威 TributeState')
  assert.equal(tributeDone.deadlinePlayerId, leaderAction.from, '贡还完成后必须由实际贡给上游者获得开始本局 deadline')
  const playingAfterTribute = await automaticPlayStartPromise
  assert.equal(playingAfterTribute.state.currentTurn, leaderAction.from)
  assert.equal(playingAfterTribute.deadlinePlayerId, leaderAction.from)

  const firstVotePromise = waitFor(entered.sockets[0], 'dissolveVoteUpdated', packet => packet.dissolveVote?.initiator === 'p1')
  send(entered.seats.get('p1'), 'proposeDissolve', { roomId })
  await firstVotePromise
  const p2OfflineVotePromise = waitFor(entered.sockets[0], 'dissolveVoteUpdated', packet => packet.dissolveVote?.votes.p2 === 'offline')
  entered.seats.get('p2').close()
  await p2OfflineVotePromise
  const p2Replacement = await connect(roundPort)
  roundSockets.push(p2Replacement)
  const p2RejoinId = nextRequestId++
  const p2RejoinedPromise = waitFor(p2Replacement, 'roomRejoined', packet => packet.requestId === p2RejoinId)
  const p2PendingVotePromise = waitFor(entered.sockets[0], 'dissolveVoteUpdated', packet => packet.dissolveVote?.votes.p2 === 'pending')
  send(p2Replacement, 'rejoinRoom', { roomId, myPlayerId: 'p2', resumeToken: entered.tokens.p2 }, p2RejoinId)
  const [p2Rejoined] = await Promise.all([p2RejoinedPromise, p2PendingVotePromise])
  assert.notEqual(p2Rejoined.resumeToken, entered.tokens.p2)
  entered.tokens.p2 = p2Rejoined.resumeToken
  assert.equal(p2Rejoined.dissolveVote.votes.p2, 'pending', '投票中断线玩家重连后必须恢复为可投票状态')
  entered.seats.set('p2', p2Replacement)
  const rejectedPromise = waitFor(entered.sockets[0], 'dissolveVoteUpdated', packet => packet.outcome === 'rejected')
  send(entered.seats.get('p2'), 'dissolveVote', { roomId, agree: false })
  assert.equal((await rejectedPromise).dissolveVote, null)

  const secondVotePromise = waitFor(entered.sockets[0], 'dissolveVoteUpdated', packet => packet.dissolveVote?.initiator === 'p1')
  send(entered.seats.get('p1'), 'proposeDissolve', { roomId })
  await secondVotePromise
  for (const seat of ['p2', 'p3']) {
    const agreedPromise = waitFor(entered.sockets[0], 'dissolveVoteUpdated', packet => packet.dissolveVote?.votes[seat] === 'agree')
    send(entered.seats.get(seat), 'dissolveVote', { roomId, agree: true })
    await agreedPromise
  }
  const dissolvedPromise = waitFor(entered.sockets[0], 'roomDissolved', packet => packet.reason === 'vote-approved')
  send(entered.seats.get('p4'), 'dissolveVote', { roomId, agree: true })
  assert.equal((await dissolvedPromise).roomId, roomId)

} finally {
  roundSockets.forEach(socket => socket.close())
  await stop(roundChild)
}

const antiPort = 39114
const antiChild = launch(antiPort, { WEAPP_TURN_TIMEOUT_MS: '30000', WEAPP_TRUSTEE_ACTION_DELAY_MS: '50', WEAPP_FRIEND_SECOND_MS: '5' }, '1')
let antiSockets = []
try {
  await delay(250)
  const roomId = '141421'
  const entered = await enterRoom(antiPort, roomId)
  antiSockets = entered.sockets
  const latest = new Map()
  entered.seats.forEach((socket, seat) => socket.addEventListener('message', ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type === 'gameState') latest.set(seat, packet)
  }))
  let table = await startRoom(entered, roomId)
  for (let actions = 0; !table.roundResult && actions < 500; actions += 1) {
    const playerId = table.state.currentTurn
    const playerSocket = entered.seats.get(playerId)
    let privatePacket = latest.get(playerId)
    if (!privatePacket || privatePacket.version < table.version) {
      privatePacket = await waitFor(playerSocket, 'gameState', packet => packet.version >= table.version)
      latest.set(playerId, privatePacket)
    }
    const nextStatePromise = waitFor(entered.sockets[0], 'gameState', packet => packet.version > table.version)
    if (table.state.lastValidPlay) send(playerSocket, 'pass', { roomId })
    else send(playerSocket, 'play', { roomId, cardIds: [privatePacket.state.players[playerId].hand.at(-1).id] })
    table = await nextStatePromise
  }
  assert.ok(table.roundResult)
  for (const seat of ['p1', 'p2', 'p3']) {
    const readyPromise = waitFor(entered.sockets[0], 'roundReadyUpdated', packet => packet.roundReadyPlayerIds.includes(seat))
    send(entered.seats.get(seat), 'readyNextRound', { roomId })
    await readyPromise
  }
  const antiPreparedPromise = waitFor(entered.sockets[0], 'roundPrepared')
  send(entered.seats.get('p4'), 'readyNextRound', { roomId })
  const antiPrepared = await antiPreparedPromise
  assert.equal(antiPrepared.tribute.isAntiTribute, true, '确定性牌局必须覆盖抗贡')
  assert.equal(antiPrepared.tribute.phase, 'done')
  assert.equal(antiPrepared.deadlineAction, 'finishTribute')
  assert.equal(antiPrepared.deadlinePlayerId, antiPrepared.state.currentTurn)
  const antiStartedPromise = waitFor(entered.sockets[0], 'gameState', packet => packet.phase === 'playing' && packet.tribute === null)
  send(entered.seats.get(antiPrepared.deadlinePlayerId), 'setTrustee', { roomId })
  const antiStarted = await antiStartedPromise
  assert.equal(antiStarted.deadlineAction, 'play', '抗贡确认 deadline 到期后必须由服务端自动开始本局')
  assert.equal(antiStarted.deadlinePlayerId, antiPrepared.deadlinePlayerId)
} finally {
  antiSockets.forEach(socket => socket.close())
  await stop(antiChild)
}

console.log('weapp round-state integration passed')
