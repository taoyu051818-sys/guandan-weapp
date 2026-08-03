/**
 * 微信小程序原生 WebSocket 通道。
 * Socket.IO 保留给网页端；小程序不能假定 socket.io-client 可用，因此使用这一条 JSON/WSS 协议。
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { canPlay, getPlayInfo, PlayType, createGame, dealNextRound, playCards, passTurn, isRoundOver, settle, createTribute, giveTribute, returnTribute, tributeLeader } = require('../../../shared-core/dist')
const ids = ['p1', 'p2', 'p3', 'p4']
const rooms = new Map()
const connections = new Map()
const hostExpiryTimers = new Map()
let nextConnection = 1

const frame = (text) => {
  const data = Buffer.from(text)
  if (data.length >= 65536) throw new Error('WebSocket 消息过大')
  const header = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 255])
  return Buffer.concat([header, data])
}

const send = (connection, type, payload = {}) => connection.socket.write(frame(JSON.stringify({ type, ...payload })))
const broadcast = (room, type, payload = {}, except = null) => ids.forEach((id) => {
  const connection = connections.get(room.seats[id])
  if (connection && connection !== except) send(connection, type, payload)
})
const clearHostExpiry = (roomId) => { const timer = hostExpiryTimers.get(roomId); if (timer) { clearTimeout(timer); hostExpiryTimers.delete(roomId) } }
const scheduleHostExpiry = (roomId) => {
  clearHostExpiry(roomId)
  hostExpiryTimers.set(roomId, setTimeout(() => { const room = rooms.get(roomId); if (room && !room.seats.p1) { rooms.delete(roomId); broadcastRooms() }; hostExpiryTimers.delete(roomId) }, 15000))
}
const listRooms = () => [...rooms.entries()].filter(([, room]) => room.seats.p1).map(([roomId, room]) => ({ roomId, hostName: room.hostName, playerCount: ids.filter(id => room.seats[id]).length }))
const broadcastRooms = () => connections.forEach(connection => send(connection, 'roomList', { rooms: listRooms() }))
const playerIn = (room, connectionId) => ids.find(id => room.seats[id] === connectionId) || null
const stateFor = (state, viewerId) => {
  const copy = JSON.parse(JSON.stringify(state))
  ids.filter(id => id !== viewerId).forEach(id => {
    copy.players[id].hand = copy.players[id].hand.map((_, index) => ({ id: `hidden-${id}-${index}` }))
  })
  return copy
}
const publishState = (room) => ids.forEach(id => {
  const connection = connections.get(room.seats[id])
  if (connection) send(connection, 'gameState', { state: stateFor(room.state, id), version: room.version })
})
const publishTribute = (room, type = 'tributeUpdated') => ids.forEach(id => {
  const connection = connections.get(room.seats[id])
  if (connection) send(connection, type, { state: stateFor(room.state, id), tribute: room.tribute })
})

const validateTransition = (previous, next) => {
  if (!previous || !next || previous.status !== 'playing' || next.status !== 'playing') return { ok: true }
  if (!Array.isArray(previous.playArea) || !Array.isArray(next.playArea) || next.playArea.length !== previous.playArea.length + 1) return { ok: true }
  const action = next.playArea.at(-1)
  if (!action || !ids.includes(action.playerId) || action.playerId !== previous.currentTurn) return { ok: false, reason: '未轮到该玩家操作' }
  const before = previous.players?.[action.playerId]?.hand || []
  const after = next.players?.[action.playerId]?.hand || []
  if (action.type === PlayType.Pass) return previous.lastValidPlay && action.cards?.length === 0 && before.length === after.length ? { ok: true } : { ok: false, reason: '非法不要' }
  if (!Array.isArray(action.cards) || action.cards.length === 0 || !action.cards.every(card => before.some(owned => owned.id === card.id))) return { ok: false, reason: '出牌不属于玩家手牌' }
  if (after.length !== before.length - action.cards.length || !getPlayInfo(action.cards) || !canPlay(action.cards, previous.lastValidPlay)) return { ok: false, reason: '牌型或压牌规则不合法' }
  return { ok: true }
}

const handle = (connection, message) => {
  const { type, requestId, payload = {} } = message
  const reply = (replyType, body = {}) => send(connection, replyType, { requestId, ...body })
  // 小程序协议只接受意图型命令（play/pass），不接受客户端覆盖整局状态。
  if (type === 'updateState') return reply('error', { message: '该通道禁止整状态同步，请提交出牌或不要动作' })
  if (type === 'listRooms') return reply('roomList', { rooms: listRooms() })
  if (type === 'createRoom') {
    const roomId = String(payload.roomId || '')
    if (!/^\d{6}$/.test(roomId) || rooms.has(roomId)) return reply('error', { message: '房间号无效或已存在' })
    const room = { hostName: String(payload.hostName || '玩家'), seats: { p1: connection.id, p2: null, p3: null, p4: null }, state: payload.state || null, version: 0 }
    rooms.set(roomId, room); connection.roomId = roomId; reply('roomCreated', { roomId, myPlayerId: 'p1', state: room.state, version: 0 }); broadcastRooms(); return
  }
  if (type === 'joinRoom') {
    const room = rooms.get(String(payload.roomId || ''))
    if (!room) return reply('error', { message: '房间不存在' })
    const myPlayerId = ids.slice(1).find(id => !room.seats[id])
    if (!myPlayerId) return reply('error', { message: '房间已满' })
    room.seats[myPlayerId] = connection.id; connection.roomId = payload.roomId
    reply('roomJoined', { roomId: payload.roomId, myPlayerId, state: room.state ? stateFor(room.state, myPlayerId) : null, version: room.version })
    broadcast(room, 'roomMembers', { memberPlayerIds: ids.filter(id => room.seats[id]) }); broadcastRooms(); return
  }
  if (type === 'rejoinRoom') {
    const room = rooms.get(String(payload.roomId || '')); const myPlayerId = payload.myPlayerId
    if (!room || !ids.includes(myPlayerId)) return reply('error', { message: '房间或席位无效' })
    room.seats[myPlayerId] = connection.id; connection.roomId = payload.roomId
    if (myPlayerId === 'p1') clearHostExpiry(payload.roomId)
    reply('roomRejoined', { roomId: payload.roomId, myPlayerId, state: room.state ? stateFor(room.state, myPlayerId) : null, version: room.version })
    broadcast(room, 'roomMembers', { memberPlayerIds: ids.filter(id => room.seats[id]) }); return
  }
  if (type === 'startGame') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    if (!room || playerIn(room, connection.id) !== 'p1') return reply('error', { message: '只有房主可以开始游戏' })
    if (ids.some(id => !room.seats[id])) return reply('error', { message: '需要四名玩家才能开始' })
    room.state = createGame(2, 'p1')
    ids.forEach(id => { room.state.players[id].isAI = false; room.state.players[id].name = `玩家${id.slice(1)}` })
    room.version += 1
    publishState(room)
    return
  }
  if (type === 'play' || type === 'pass') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.state) return reply('error', { message: '对局尚未开始' })
    try {
      if (type === 'play') {
        const cardIds = Array.isArray(payload.cardIds) ? payload.cardIds : []
        const cards = cardIds.map(id => room.state.players[playerId].hand.find(card => card.id === id)).filter(Boolean)
        if (cards.length !== cardIds.length) throw new Error('所选手牌无效')
        room.state = playCards(room.state, playerId, cards)
      } else room.state = passTurn(room.state, playerId)
      room.version += 1
      publishState(room)
      if (isRoundOver(room.state)) {
        const result = settle(room.state, room.teamLevels || { teamA: 2, teamB: 2 }, room.aFailStreaks || { teamA: 0, teamB: 0 })
        if (result) { room.teamLevels = result.teamLevels; room.aFailStreaks = result.aFailStreaks; room.roundResult = result; room.lastRoundRank = result.fullRank; broadcast(room, 'roundEnded', { result }) }
      }
    } catch (error) { reply('error', { message: error instanceof Error ? error.message : '出牌失败' }) }
    return
  }
  if (type === 'nextRound') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    if (!room || playerIn(room, connection.id) !== 'p1' || !room.roundResult) return reply('error', { message: '当前不能开始下一局' })
    const result = room.roundResult
    if (result.isGameWon) return reply('error', { message: '本场已打过 A，请重新创建对局' })
    room.state = dealNextRound(room.state, result.currentLevel, result.fullRank[0])
    room.tribute = createTribute(room.state, result.fullRank)
    room.roundResult = null; room.version += 1
    publishTribute(room, 'roundPrepared')
    return
  }
  if (type === 'tribute' || type === 'returnTribute') {
    const room = rooms.get(String(payload.roomId || connection.roomId || '')); const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.tribute) return reply('error', { message: '当前不是贡还阶段' })
    try {
      const result = type === 'tribute'
        ? giveTribute(room.state, room.tribute, playerId, payload.cardId)
        : returnTribute(room.state, room.tribute, playerId, payload.cardId)
      room.state = result.state; room.tribute = result.tribute; room.version += 1
      publishTribute(room)
    } catch (error) { reply('error', { message: error instanceof Error ? error.message : '贡还失败' }) }
    return
  }
  if (type === 'finishTribute') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    if (!room || !room.tribute || (!room.tribute.isAntiTribute && room.tribute.phase !== 'done')) return reply('error', { message: '贡还尚未完成' })
    // roundResult 在 nextRound 后会清空，因此单独保留上一局名次。
    const lastRank = room.lastRoundRank || payload.lastRoundRank
    if (!Array.isArray(lastRank) || lastRank.length !== 4) return reply('error', { message: '上一局名次缺失' })
    room.state = { ...room.state, currentTurn: tributeLeader(room.tribute, lastRank, lastRank[0]), lastValidPlay: null }
    room.tribute = null; room.version += 1; publishState(room)
    return
  }
  if (type === 'chat') {
    const room = rooms.get(String(payload.roomId || connection.roomId || '')); const playerId = room && playerIn(room, connection.id)
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 40) : ''
    if (!room || !playerId || !text) return reply('error', { message: '聊天内容无效' })
    broadcast(room, 'chat', { playerId, text })
    return
  }
  if (type === 'leaveRoom') {
    const room = rooms.get(String(payload.roomId || connection.roomId || '')); const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId) return reply('error', { message: '当前不在房间中' })
    if (playerId === 'p1') { clearHostExpiry(payload.roomId || connection.roomId); rooms.delete(payload.roomId || connection.roomId); broadcast(room, 'hostLeft') }
    else { room.seats[playerId] = null; broadcast(room, 'roomMembers', { memberPlayerIds: ids.filter(id => room.seats[id]) }) }
    connection.roomId = null; broadcastRooms(); reply('roomLeft')
    return
  }
  reply('error', { message: '未知协议消息' })
}

const server = createServer((_, response) => { response.writeHead(404); response.end() })
server.on('upgrade', (request, socket) => {
  if (request.url !== '/weapp' || request.headers.upgrade?.toLowerCase() !== 'websocket' || !request.headers['sec-websocket-key']) { socket.destroy(); return }
  const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  const connection = { id: `w${nextConnection++}`, socket, buffer: Buffer.alloc(0), roomId: null }
  connections.set(connection.id, connection)
  // 客户端切后台、开发者工具重启都会直接断开 TCP；不能让单个连接拖垮房间服务。
  socket.on('error', () => {})
  socket.on('data', (chunk) => {
    connection.buffer = Buffer.concat([connection.buffer, chunk])
    while (connection.buffer.length >= 2) {
      const length = connection.buffer[1] & 127; const masked = Boolean(connection.buffer[1] & 128); const header = length < 126 ? 2 : 4
      if (!masked || length === 127 || connection.buffer.length < header + 4 + (length === 126 ? connection.buffer.readUInt16BE(2) : length)) return
      const size = length === 126 ? connection.buffer.readUInt16BE(2) : length; const maskStart = header; const bodyStart = header + 4
      const body = Buffer.from(connection.buffer.subarray(bodyStart, bodyStart + size)); for (let i = 0; i < size; i += 1) body[i] ^= connection.buffer[maskStart + i % 4]
      connection.buffer = connection.buffer.subarray(bodyStart + size)
      try { handle(connection, JSON.parse(body.toString())) } catch { send(connection, 'error', { message: '协议数据无效' }) }
    }
  })
  socket.on('close', () => {
    const room = rooms.get(connection.roomId); if (room) { const playerId = playerIn(room, connection.id); if (playerId === 'p1') { room.seats.p1 = null; scheduleHostExpiry(connection.roomId) } else if (playerId) room.seats[playerId] = null; if (rooms.has(connection.roomId)) broadcast(room, 'roomMembers', { memberPlayerIds: ids.filter(id => room.seats[id]) }); broadcastRooms() }
    connections.delete(connection.id)
  })
})

const port = Number(process.env.WEAPP_WS_PORT || 3002)
server.listen(port, () => console.log(`Guandan WeApp WebSocket server running on port ${port}`))
