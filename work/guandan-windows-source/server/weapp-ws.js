/**
 * 微信小程序原生 WebSocket 通道。
 * Socket.IO 保留给网页端；小程序不能假定 socket.io-client 可用，因此使用这一条 JSON/WSS 协议。
 */
import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { GameTicketVerifier } from './platform/crypto.js'
import { loadGameSecurityConfig } from './platform/config.js'
import { GameResultReporter } from './platform/result-reporter.js'
import { SpectatorEventReporter } from './platform/spectator-event-reporter.js'
import { buildGameResultEvent, createGameStatsBySeat, ensureGameStatsBySeat, recordAuthoritativeAction } from './game-stats.js'
import { JsonRoomStateStore, roomForPersistence, roomFromPersistence } from './room-state-store.js'
import { adjustDoubleDownSettlement, hasReachedRoundLimit, normalizeFriendRoomSettings, spectatorPolicyFor } from './friend-room-settings.js'
import { chooseMasterBotCards, MASTER_BOT_DIFFICULTY } from './master-bot-policy.js'

const require = createRequire(import.meta.url)
const { PlayType, createGame, dealNextRound, playCards, passTurn, isRoundOver, settle, createTribute, giveTribute, returnTribute, tributeLeader, highestCard, automaticReturnCard } = require('../../../shared-core/dist')
const ids = ['p1', 'p2', 'p3', 'p4']
const rooms = new Map()
const connections = new Map()
const hostExpiryTimers = new Map()
const emptyRoomExpiryTimers = new Map()
const turnTimers = new Map()
const dissolveTimers = new Map()
const matchDurationTimers = new Map()
const acceptedActions = new Map()
const roomStateStore = new JsonRoomStateStore({ filePath: process.env.WEAPP_ROOM_STATE_FILE || '' })
const idempotentActionTypes = new Set([
  'startGame', 'setLobbyReady', 'cancelLobbyReady', 'kickMember', 'addBot', 'removeBot',
  'play', 'pass', 'nextRound', 'readyNextRound', 'roundReady', 'ready', 'cancelRoundReady', 'cancelReady',
  'setTrustee', 'cancelTrustee', 'proposeDissolve', 'dissolveVote', 'voteDissolve', 'chat',
  'tribute', 'returnTribute', 'finishTribute',
])
const maxAcceptedActions = 512
let nextConnection = 1

const TURN_TIMEOUT_MS = Math.max(100, Number(process.env.WEAPP_TURN_TIMEOUT_MS || 20000))
const TRUSTEE_ACTION_DELAY_MS = Math.max(10, Number(process.env.WEAPP_TRUSTEE_ACTION_DELAY_MS || 500))
const BOT_ACTION_DELAY_MS = Math.max(10, Number(process.env.WEAPP_BOT_ACTION_DELAY_MS || 500))
const FRIEND_SECOND_MS = Math.max(1, Number(process.env.WEAPP_FRIEND_SECOND_MS || 1000))
const TOTAL_MINUTE_MS = Math.max(100, Number(process.env.WEAPP_TOTAL_MINUTE_MS || 60000))
const DISSOLVE_TIMEOUT_MS = Math.max(1000, Number(process.env.WEAPP_DISSOLVE_TIMEOUT_MS || 30000))
const EMPTY_ROOM_TIMEOUT_MS = Math.max(100, Number(process.env.WEAPP_EMPTY_ROOM_TIMEOUT_MS || 60000))
const MAX_MESSAGE_BYTES = Math.max(1024, Math.min(65535, Number(process.env.WEAPP_MAX_MESSAGE_BYTES || 65535)))
const TIMEOUTS_BEFORE_TRUSTEE = 2
const QUICK_CHAT_INTERVAL_MS = 1200
const QUICK_CHAT_REPEAT_MS = 8000
const QUICK_CHAT_PHRASES = new Set(['请尽快出牌', '你的牌打得太好啦', '配合得好', '大家加油', '谢谢', '再来一局'])
const security = loadGameSecurityConfig()
const gameTicketVerifier = new GameTicketVerifier({ secret: security.gameTicketSecret, required: security.ticketRequired })
const resultReporter = new GameResultReporter({ endpoint: security.resultEndpoint, secret: security.gameResultSecret })
const spectatorEventReporter = new SpectatorEventReporter({
  endpoint: security.spectatorEventEndpoint,
  secret: security.spectatorEventSecret,
  lifecycleSecret: security.gameResultSecret,
  outboxFilePath: security.spectatorOutboxFile,
})

const createResumeToken = () => randomBytes(32).toString('hex')
const sameToken = (actual, supplied) => {
  if (typeof actual !== 'string' || typeof supplied !== 'string') return false
  const actualBytes = Buffer.from(actual)
  const suppliedBytes = Buffer.from(supplied)
  return actualBytes.length === suppliedBytes.length && timingSafeEqual(actualBytes, suppliedBytes)
}
const phaseFor = (room) => room.matchEnded || room.roundResult ? 'settlement' : room.tribute ? 'tribute' : room.state ? 'playing' : 'lobby'
const createRoomRecord = ({ roomId, hostName = '等待房主', hostConnectionId = null, state = null, ticketClaims = null, roomSettings = null }) => {
  const userIdsBySeat = { p1: null, p2: null, p3: null, p4: null }
  const ticketJtisBySeat = { p1: null, p2: null, p3: null, p4: null }
  const ticketExpiresAtBySeat = { p1: null, p2: null, p3: null, p4: null }
  if (ticketClaims?.seat) userIdsBySeat[ticketClaims.seat] = ticketClaims.sub
  if (ticketClaims?.seat) ticketJtisBySeat[ticketClaims.seat] = ticketClaims.jti
  if (ticketClaims?.seat) ticketExpiresAtBySeat[ticketClaims.seat] = ticketClaims.exp
  return {
    roomId,
    hostName,
    roomSettings: normalizeFriendRoomSettings(roomSettings),
    seats: { p1: hostConnectionId, p2: null, p3: null, p4: null },
    resumeTokens: { p1: hostConnectionId ? createResumeToken() : null, p2: null, p3: null, p4: null },
    userIdsBySeat,
    ticketJtisBySeat,
    ticketExpiresAtBySeat,
    matchId: ticketClaims?.matchId || null,
    ticketBound: Boolean(ticketClaims),
    botPlayerIds: [],
    state,
    matchStartedAt: null,
    totalDeadlineAt: null,
    matchEnded: null,
    tribute: null,
    roundResult: null,
    roundSequence: 0,
    spectatorSequence: 0,
    turnDeadlineAt: null,
    deadlinePlayerId: null,
    deadlineAction: null,
    trustees: { p1: null, p2: null, p3: null, p4: null },
    consecutiveTimeouts: { p1: 0, p2: 0, p3: 0, p4: 0 },
    lobbyReady: { p1: false, p2: false, p3: false, p4: false },
    roundReady: { p1: false, p2: false, p3: false, p4: false },
    dissolveVote: null,
    chatLastAcceptedAt: { p1: 0, p2: 0, p3: 0, p4: 0 },
    chatLastPhraseAt: { p1: {}, p2: {}, p3: {}, p4: {} },
    statsBySeat: createGameStatsBySeat(),
    version: 0,
  }
}

const inspectEntryTicket = (payload, expected = {}) => gameTicketVerifier.inspectWithConsumptionStatus(payload.gameTicket, expected)
const ticketMatchesRoom = (room, claims) => {
  if (!claims) return !room.ticketBound
  return (!room.ticketBound || room.matchId === claims.matchId) && room.roomId === String(claims.roomId)
}
const reportCompletedGame = (room, result) => {
  if (!resultReporter.configured || !result.isGameWon) return
  if (!ids.every(id => typeof room.userIdsBySeat?.[id] === 'string')) {
    console.warn(`Skip game result callback for ${room.roomId}: ticket user mapping is incomplete`)
    return
  }
  void resultReporter.report(buildGameResultEvent(room, result)).catch(error => {
    console.error(`Game result callback failed for ${room.roomId}:`, error instanceof Error ? error.message : error)
  })
}
const publicCards = (cards) => (Array.isArray(cards) ? cards : []).map(card => ({ rank: card.rank, suit: card.suit }))
const reportSpectatorEvent = (room, detail) => {
  if (!spectatorEventReporter.configured || !room.ticketBound || !room.matchId) return
  room.spectatorSequence = Math.max(0, Number(room.spectatorSequence) || 0) + 1
  const sequence = room.spectatorSequence
  const event = {
    eventId: `spectate:${room.matchId}:${sequence}`,
    matchId: room.matchId,
    roomId: room.roomId,
    sequence,
    at: Date.now(),
    roundSequence: Math.max(1, Number(detail.roundSequence) || room.roundSequence + 1),
    ...detail,
  }
  void spectatorEventReporter.enqueue(event).catch(error => {
    console.error(`Spectator event callback failed for ${room.roomId}/${sequence}:`, error instanceof Error ? error.message : error)
  })
}
const reportSpectatorAction = (room, { type, playerId, cards = [], automatic }) => {
  const detail = { type, playerId, automatic: Boolean(automatic) }
  if (type === 'play') {
    const action = room.state?.playArea?.at(-1)
    detail.cards = publicCards(cards)
    detail.playType = action?.type || PlayType.Single
  }
  reportSpectatorEvent(room, detail)
}
const reportSpectatorRoundEnd = (room, result) => reportSpectatorEvent(room, {
  type: 'round-end',
  roundSequence: room.roundSequence,
  ranking: result.fullRank,
  winnerTeam: result.winnerTeam,
  isGameWon: Boolean(result.isGameWon),
})
const reportSpectatorClosed = (room, reason) => {
  // 正常“过 A”已经通过结算回调进入 finished；随后全员离桌只是资源回收，
  // 不能再发 room-closed 把它伪装成异常终止。
  if (room.roundResult?.isGameWon) return
  reportSpectatorEvent(room, {
    type: 'room-closed',
    roundSequence: Math.max(1, room.roundSequence || 1),
    reason,
  })
}

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
const clearRoomTimer = (timers, roomId) => {
  const timer = timers.get(roomId)
  if (timer) clearTimeout(timer)
  timers.delete(roomId)
}
const clearTurnTimer = (roomId) => clearRoomTimer(turnTimers, roomId)
const clearDissolveTimer = (roomId) => clearRoomTimer(dissolveTimers, roomId)
const clearEmptyRoomExpiry = (roomId) => clearRoomTimer(emptyRoomExpiryTimers, roomId)
const clearMatchDurationTimer = (roomId) => clearRoomTimer(matchDurationTimers, roomId)
const ensureBotMetadata = (room) => {
  const supplied = Array.isArray(room.botPlayerIds) ? room.botPlayerIds : []
  room.botPlayerIds = ids.slice(1).filter(id => supplied.includes(id))
  room.botPlayerIds.forEach(id => {
    if (room.seats) room.seats[id] = null
    if (room.resumeTokens) room.resumeTokens[id] = null
    if (room.userIdsBySeat) room.userIdsBySeat[id] = null
    if (room.ticketJtisBySeat) room.ticketJtisBySeat[id] = null
    if (room.ticketExpiresAtBySeat) room.ticketExpiresAtBySeat[id] = null
  })
}
const isBotPlayer = (room, playerId) => {
  ensureBotMetadata(room)
  return room.botPlayerIds.includes(playerId)
}
const seatIsOccupied = (room, playerId) => Boolean(room.seats[playerId]) || isBotPlayer(room, playerId)
const ensureLobbyMetadata = (room) => {
  ensureBotMetadata(room)
  room.lobbyReady ||= { p1: false, p2: false, p3: false, p4: false }
  ids.forEach(id => { room.lobbyReady[id] = Boolean(room.lobbyReady[id]) })
  room.botPlayerIds.forEach(id => { room.lobbyReady[id] = true })
}
const ensureLiveMetadata = (room) => {
  ensureBotMetadata(room)
  room.trustees ||= { p1: null, p2: null, p3: null, p4: null }
  room.consecutiveTimeouts ||= { p1: 0, p2: 0, p3: 0, p4: 0 }
  room.roundReady ||= { p1: false, p2: false, p3: false, p4: false }
  room.turnDeadlineAt ??= null
  room.deadlinePlayerId ??= null
  room.deadlineAction ??= null
  room.dissolveVote ??= null
  room.matchStartedAt ??= null
  room.totalDeadlineAt ??= null
  room.matchEnded ??= null
  room.statsBySeat = ensureGameStatsBySeat(room.statsBySeat)
  room.roomSettings = normalizeFriendRoomSettings(room.roomSettings)
  if (room.state?.players) {
    ids.forEach(id => {
      if (!isBotPlayer(room, id)) return
      room.state.players[id].isAI = true
      room.state.players[id].name = `机器人${id.slice(1)}`
    })
  }
}
const lobbyMetadataFor = (room) => {
  ensureLobbyMetadata(room)
  return {
    lobbyReadyRequired: !room.ticketBound,
    lobbyReadyPlayerIds: ids.filter(id => room.lobbyReady[id]),
    botPlayerIds: [...room.botPlayerIds],
  }
}
const recordRoomAction = (room, playerId, action) => {
  room.statsBySeat = ensureGameStatsBySeat(room.statsBySeat)
  return recordAuthoritativeAction(room.statsBySeat, playerId, action)
}
const liveMetadataFor = (room) => {
  ensureLiveMetadata(room)
  const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
  return {
    turnDeadlineAt: room.turnDeadlineAt,
    deadlinePlayerId: room.deadlinePlayerId,
    deadlineAction: room.deadlineAction,
    trustees: room.trustees,
    consecutiveTimeouts: room.consecutiveTimeouts,
    roundReadyPlayerIds: ids.filter(id => room.roundReady[id]),
    dissolveVote: room.dissolveVote,
    botPlayerIds: [...room.botPlayerIds],
    roomSettings,
    matchStartedAt: room.matchStartedAt,
    totalDeadlineAt: room.totalDeadlineAt,
    matchEnded: room.matchEnded,
    spectatorPolicy: spectatorPolicyFor(roomSettings),
    scoreboard: roomSettings.scoreVisibility === 'live'
      ? {
          roundsPlayed: Math.max(0, Number(room.roundSequence) || 0),
          currentLevel: room.roundResult?.currentLevel ?? room.state?.currentLevel ?? 2,
          teamLevels: room.teamLevels || { teamA: 2, teamB: 2 },
        }
      : null,
  }
}
const restoreOfflineDissolveVote = (room, playerId) => {
  if (room.dissolveVote?.votes[playerId] !== 'offline') return false
  room.dissolveVote.votes[playerId] = 'pending'
  return true
}
const publishTurnStatus = (room) => broadcast(room, 'turnDeadline', {
  roomId: room.roomId,
  currentTurn: room.deadlineAction === 'play' ? room.deadlinePlayerId : null,
  version: room.version,
  ...liveMetadataFor(room),
})
const publishTrustees = (room) => broadcast(room, 'trusteeUpdated', { roomId: room.roomId, version: room.version, ...liveMetadataFor(room) })
const publishRoundReady = (room) => broadcast(room, 'roundReadyUpdated', { roomId: room.roomId, version: room.version, ...liveMetadataFor(room) })
const roomMembersPayload = (room) => ({
  roomId: room.roomId,
  memberPlayerIds: ids.filter(id => seatIsOccupied(room, id)),
  version: room.version,
  roomSettings: normalizeFriendRoomSettings(room.roomSettings),
  ...lobbyMetadataFor(room),
})
const publishRoomMembers = (room) => broadcast(room, 'roomMembers', roomMembersPayload(room))
const publishLobbyReady = (room) => broadcast(room, 'lobbyReadyUpdated', {
  roomId: room.roomId,
  version: room.version,
  roomSettings: normalizeFriendRoomSettings(room.roomSettings),
  ...lobbyMetadataFor(room),
})
const publishDissolveVote = (room, outcome = null) => broadcast(room, 'dissolveVoteUpdated', {
  roomId: room.roomId,
  version: room.version,
  dissolveVote: room.dissolveVote,
  outcome,
})
const clearHostExpiry = (roomId) => { const timer = hostExpiryTimers.get(roomId); if (timer) { clearTimeout(timer); hostExpiryTimers.delete(roomId) } }
const scheduleEmptyRoomExpiry = (room) => {
  clearEmptyRoomExpiry(room.roomId)
  if (!room.state || ids.some(id => room.seats[id])) return
  emptyRoomExpiryTimers.set(room.roomId, setTimeout(() => {
    emptyRoomExpiryTimers.delete(room.roomId)
    if (!rooms.has(room.roomId) || ids.some(id => room.seats[id])) return
    reportSpectatorClosed(room, 'empty-timeout')
    clearTurnTimer(room.roomId)
    clearMatchDurationTimer(room.roomId)
    clearDissolveTimer(room.roomId)
    clearHostExpiry(room.roomId)
    rooms.delete(room.roomId)
    broadcastRooms()
    persistRuntimeState()
  }, EMPTY_ROOM_TIMEOUT_MS))
}
const scheduleHostExpiry = (roomId, timeoutMs = 15000) => {
  clearHostExpiry(roomId)
  hostExpiryTimers.set(roomId, setTimeout(() => {
    const room = rooms.get(roomId)
    if (room && !room.seats.p1) {
      room.version += 1
      broadcast(room, 'hostLeft', { roomId, version: room.version })
      reportSpectatorClosed(room, 'entry-timeout')
      clearTurnTimer(roomId)
      clearMatchDurationTimer(roomId)
      clearDissolveTimer(roomId)
      clearEmptyRoomExpiry(roomId)
      rooms.delete(roomId)
      broadcastRooms()
      persistRuntimeState()
    }
    hostExpiryTimers.delete(roomId)
  }, timeoutMs))
}
const listRooms = () => [...rooms.entries()].filter(([, room]) => room.seats.p1).map(([roomId, room]) => ({ roomId, hostName: room.hostName, playerCount: ids.filter(id => seatIsOccupied(room, id)).length, roomSettings: normalizeFriendRoomSettings(room.roomSettings), version: room.version }))
const broadcastRooms = () => connections.forEach(connection => send(connection, 'roomList', { rooms: listRooms() }))
const playerIn = (room, connectionId) => ids.find(id => room.seats[id] === connectionId) || null
const resumeTokenFor = (room, connection) => {
  const playerId = room && playerIn(room, connection.id)
  return playerId ? room.resumeTokens[playerId] : null
}
const actionCacheKey = (room, connection, requestId) => {
  const resumeToken = resumeTokenFor(room, connection)
  return resumeToken && Number.isSafeInteger(requestId) ? `${resumeToken}:${requestId}` : null
}
const rememberAccepted = (cacheKey, payload) => {
  if (!cacheKey) return
  acceptedActions.set(cacheKey, payload)
  if (acceptedActions.size > maxAcceptedActions) {
    const oldest = acceptedActions.keys().next().value
    if (oldest !== undefined) acceptedActions.delete(oldest)
  }
}
const persistedRuntimeSnapshot = () => ({
  rooms: [...rooms.values()].map(roomForPersistence),
  acceptedActions: [...acceptedActions.entries()].slice(-maxAcceptedActions),
})
const persistRuntimeState = () => {
  if (!roomStateStore.configured) return
  try { roomStateStore.save(persistedRuntimeSnapshot()) } catch (error) {
    console.error('Failed to persist WeApp room state:', error instanceof Error ? error.message : error)
  }
}
const stateFor = (state, viewerId) => {
  const copy = JSON.parse(JSON.stringify(state))
  ids.filter(id => id !== viewerId).forEach(id => {
    copy.players[id].hand = copy.players[id].hand.map((_, index) => ({ id: `hidden-${id}-${index}` }))
  })
  return copy
}
const publishState = (room) => ids.forEach(id => {
  const connection = connections.get(room.seats[id])
  if (connection) send(connection, 'gameState', { roomId: room.roomId, state: stateFor(room.state, id), version: room.version, phase: phaseFor(room), tribute: room.tribute || null, roundResult: room.roundResult || null, ...liveMetadataFor(room) })
})
const publishTribute = (room, type = 'tributeUpdated') => ids.forEach(id => {
  const connection = connections.get(room.seats[id])
  if (connection) send(connection, type, { roomId: room.roomId, state: stateFor(room.state, id), tribute: room.tribute, roundResult: room.roundResult || null, phase: phaseFor(room), version: room.version, ...liveMetadataFor(room) })
})
const markMatchEnded = (room, reason, endedAt = Date.now()) => {
  if (room.matchEnded) return false
  clearTurnTimer(room.roomId)
  clearMatchDurationTimer(room.roomId)
  room.turnDeadlineAt = null
  room.deadlinePlayerId = null
  room.deadlineAction = null
  room.matchEnded = {
    reason,
    endedAt,
    roundsPlayed: Math.max(0, Number(room.roundSequence) || 0),
    configuredRounds: normalizeFriendRoomSettings(room.roomSettings).rounds,
  }
  return true
}
const expireMatchDuration = (room, expectedDeadline) => {
  if (!rooms.has(room.roomId) || room.matchEnded || room.totalDeadlineAt !== expectedDeadline) return
  if (!markMatchEnded(room, 'time-limit', expectedDeadline)) return
  room.version += 1
  broadcast(room, 'matchEnded', { roomId: room.roomId, phase: phaseFor(room), version: room.version, ...liveMetadataFor(room) })
  publishState(room)
  persistRuntimeState()
}
const armMatchDuration = (room) => {
  clearMatchDurationTimer(room.roomId)
  ensureLiveMetadata(room)
  const totalTimeMinutes = normalizeFriendRoomSettings(room.roomSettings).totalTimeMinutes
  if (!room.state || room.matchEnded || totalTimeMinutes === 0) {
    if (totalTimeMinutes === 0) room.totalDeadlineAt = null
    return
  }
  if (!Number.isFinite(room.matchStartedAt)) room.matchStartedAt = Date.now()
  if (!Number.isFinite(room.totalDeadlineAt)) room.totalDeadlineAt = room.matchStartedAt + totalTimeMinutes * TOTAL_MINUTE_MS
  const expectedDeadline = room.totalDeadlineAt
  matchDurationTimers.set(room.roomId, setTimeout(
    () => expireMatchDuration(room, expectedDeadline),
    Math.max(0, expectedDeadline - Date.now()),
  ))
}
const settleRoundIfNeeded = (room) => {
  if (!isRoundOver(room.state)) return null
  clearTurnTimer(room.roomId)
  room.turnDeadlineAt = null
  room.deadlinePlayerId = null
  room.deadlineAction = null
  const previousTeamLevels = room.teamLevels || { teamA: 2, teamB: 2 }
  const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
  let result = settle(room.state, previousTeamLevels, room.aFailStreaks || { teamA: 0, teamB: 0 })
  if (!result) return null
  result = adjustDoubleDownSettlement({ result, state: room.state, previousTeamLevels, roomSettings })
  room.teamLevels = result.teamLevels
  room.aFailStreaks = result.aFailStreaks
  room.roundResult = result
  room.lastRoundRank = result.fullRank
  room.roundSequence += 1
  if (result.isGameWon) markMatchEnded(room, 'passed-a')
  else if (!room.ticketBound && hasReachedRoundLimit(room.roundSequence, roomSettings)) markMatchEnded(room, 'round-limit')
  else if (!room.ticketBound && Number.isFinite(room.totalDeadlineAt) && Date.now() >= room.totalDeadlineAt) markMatchEnded(room, 'time-limit', room.totalDeadlineAt)
  room.roundReady = room.matchEnded
    ? { p1: false, p2: false, p3: false, p4: false }
    : Object.fromEntries(ids.map(id => [id, !room.seats[id]]))
  reportSpectatorRoundEnd(room, result)
  reportCompletedGame(room, result)
  return result
}
const deadlineStepFor = (room) => {
  if (!room.state || room.roundResult || room.matchEnded) return null
  if (room.tribute) {
    const lastRank = room.lastRoundRank
    if (!Array.isArray(lastRank) || lastRank.length !== 4) return null
    if (room.tribute.isAntiTribute || room.tribute.phase === 'done') {
      return { playerId: tributeLeader(room.tribute, lastRank, lastRank[0]), action: 'finishTribute' }
    }
    if (room.tribute.phase === 'tributing') {
      const action = room.tribute.actions.find(item => !item.card)
      return action ? { playerId: action.from, action: 'tribute' } : null
    }
    if (room.tribute.phase === 'returning') {
      const action = room.tribute.actions.find(item => !item.returnCard)
      return action ? { playerId: action.to, action: 'returnTribute' } : null
    }
    return null
  }
  if (isRoundOver(room.state)) return null
  return { playerId: room.state.currentTurn, action: 'play' }
}
const finishTributeState = (room) => {
  const lastRank = room.lastRoundRank
  if (!room.tribute || !Array.isArray(lastRank) || lastRank.length !== 4) throw new Error('上一局名次缺失')
  if (!room.tribute.isAntiTribute && room.tribute.phase !== 'done') throw new Error('贡还尚未完成')
  room.state = { ...room.state, currentTurn: tributeLeader(room.tribute, lastRank, lastRank[0]), lastValidPlay: null }
  room.tribute = null
  reportSpectatorEvent(room, { type: 'play-start', roundSequence: room.roundSequence + 1 })
}
const chooseBotCards = (room, playerId) => {
  return chooseMasterBotCards({ state: room.state, teamLevels: room.teamLevels, playerId })
}
const automatedDeadline = (room, expectedPlayerId, expectedAction, expectedDeadline) => {
  if (!rooms.has(room.roomId) || room.turnDeadlineAt !== expectedDeadline || room.deadlinePlayerId !== expectedPlayerId || room.deadlineAction !== expectedAction) return
  ensureLiveMetadata(room)
  const isBot = isBotPlayer(room, expectedPlayerId)
  const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
  const autoTrusteeEnabled = room.ticketBound || roomSettings.trusteeSeconds > 0
  const wasTrustee = Boolean(room.trustees[expectedPlayerId])
  if (!isBot && !wasTrustee) {
    room.consecutiveTimeouts[expectedPlayerId] += 1
    if (autoTrusteeEnabled && room.consecutiveTimeouts[expectedPlayerId] >= TIMEOUTS_BEFORE_TRUSTEE) {
      room.trustees[expectedPlayerId] = { reason: 'timeout', since: Date.now() }
    }
  }
  let recordedKind = expectedAction
  let recordedPlayType = null
  try {
    if (expectedAction === 'play') {
      const cards = isBot
        ? chooseBotCards(room, expectedPlayerId)
        : (room.state.lastValidPlay ? [] : [room.state.players[expectedPlayerId].hand.at(-1)])
      const isPass = !cards || cards.length === 0
      room.state = isPass
        ? passTurn(room.state, expectedPlayerId)
        : playCards(room.state, expectedPlayerId, cards)
      recordedKind = isPass ? 'pass' : 'play'
      recordedPlayType = isPass ? null : room.state.playArea.at(-1)?.type || null
      reportSpectatorAction(room, { type: isPass ? 'pass' : 'play', playerId: expectedPlayerId, cards, automatic: true })
    } else if (expectedAction === 'tribute') {
      const hand = room.state.players[expectedPlayerId].hand
      const eligible = hand.filter(card => !(card.isLevelCard && card.suit === 'heart'))
      const card = highestCard(eligible.length ? eligible : hand)
      if (!card) throw new Error('没有可进贡的牌')
      const result = giveTribute(room.state, room.tribute, expectedPlayerId, card.id)
      room.state = result.state
      room.tribute = result.tribute
      reportSpectatorEvent(room, { type: 'tribute', playerId: expectedPlayerId, roundSequence: room.roundSequence + 1 })
    } else if (expectedAction === 'returnTribute') {
      const hand = room.state.players[expectedPlayerId].hand
      const card = automaticReturnCard(hand)
      if (!card) throw new Error('没有可还贡的牌')
      const result = returnTribute(room.state, room.tribute, expectedPlayerId, card.id)
      room.state = result.state
      room.tribute = result.tribute
      reportSpectatorEvent(room, { type: 'return-tribute', playerId: expectedPlayerId, roundSequence: room.roundSequence + 1 })
    } else if (expectedAction === 'finishTribute') finishTributeState(room)
    else throw new Error('未知自动动作')
  } catch (error) {
    console.error(`Automated deadline failed for ${room.roomId}/${expectedPlayerId}/${expectedAction}:`, error instanceof Error ? error.message : error)
    room.turnDeadlineAt = null
    room.deadlinePlayerId = null
    room.deadlineAction = null
    clearTurnTimer(room.roomId)
    publishTurnStatus(room)
    persistRuntimeState()
    return
  }
  recordRoomAction(room, expectedPlayerId, {
    kind: recordedKind,
    playType: recordedPlayType,
    timedOut: !isBot,
    trustee: !isBot && Boolean(room.trustees[expectedPlayerId]),
  })
  room.version += 1
  const result = expectedAction === 'play' ? settleRoundIfNeeded(room) : null
  if (!result) armTurnDeadline(room)
  broadcast(room, isBot ? 'botAction' : 'turnTimedOut', {
    roomId: room.roomId,
    playerId: expectedPlayerId,
    action: expectedAction,
    ...(isBot
        ? { difficulty: MASTER_BOT_DIFFICULTY }
      : { enteredTrustee: !wasTrustee && Boolean(room.trustees[expectedPlayerId]) }),
    version: room.version,
    ...liveMetadataFor(room),
  })
  if (expectedAction === 'play' || expectedAction === 'finishTribute') publishState(room)
  else publishTribute(room)
  if (result) broadcast(room, 'roundEnded', { roomId: room.roomId, result, phase: phaseFor(room), version: room.version, ...liveMetadataFor(room) })
  persistRuntimeState()
}
const armTurnDeadline = (room) => {
  clearTurnTimer(room.roomId)
  ensureLiveMetadata(room)
  const step = deadlineStepFor(room)
  if (!step) {
    room.turnDeadlineAt = null
    room.deadlinePlayerId = null
    room.deadlineAction = null
    return
  }
  const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
  const delay = isBotPlayer(room, step.playerId)
    ? Math.min(BOT_ACTION_DELAY_MS, roomSettings.turnSeconds * FRIEND_SECOND_MS)
    : room.ticketBound
    ? (room.trustees[step.playerId] ? TRUSTEE_ACTION_DELAY_MS : TURN_TIMEOUT_MS)
    : (room.trustees[step.playerId] && roomSettings.trusteeSeconds > 0
        ? roomSettings.trusteeSeconds * FRIEND_SECOND_MS
        : roomSettings.turnSeconds * FRIEND_SECOND_MS)
  const deadline = Date.now() + delay
  room.turnDeadlineAt = deadline
  room.deadlinePlayerId = step.playerId
  room.deadlineAction = step.action
  turnTimers.set(room.roomId, setTimeout(() => automatedDeadline(room, step.playerId, step.action, deadline), delay))
  publishTurnStatus(room)
}
const prepareNextRound = (room, incrementVersion = true) => {
  const result = room.roundResult
  room.state = dealNextRound(room.state, result.currentLevel, result.fullRank[0])
  room.tribute = createTribute(room.state, result.fullRank)
  room.roundResult = null
  room.roundReady = { p1: false, p2: false, p3: false, p4: false }
  if (incrementVersion) room.version += 1
  reportSpectatorEvent(room, { type: 'round-start', roundSequence: room.roundSequence + 1 })
  reportSpectatorEvent(room, {
    type: room.tribute?.isAntiTribute ? 'anti-tribute' : 'tribute-start',
    roundSequence: room.roundSequence + 1,
  })
  armTurnDeadline(room)
  publishTribute(room, 'roundPrepared')
}
const markOfflineReady = (room, playerId) => {
  if (!room.roundResult || room.roundResult.isGameWon) return false
  ensureLiveMetadata(room)
  room.roundReady[playerId] = true
  if (ids.every(id => room.roundReady[id])) {
    prepareNextRound(room, false)
    return true
  }
  publishRoundReady(room)
  return false
}
const dissolveRoom = (room, reason = 'vote-approved') => {
  reportSpectatorClosed(room, 'dissolved')
  clearTurnTimer(room.roomId)
  clearMatchDurationTimer(room.roomId)
  clearDissolveTimer(room.roomId)
  clearHostExpiry(room.roomId)
  clearEmptyRoomExpiry(room.roomId)
  room.turnDeadlineAt = null
  room.deadlinePlayerId = null
  room.deadlineAction = null
  room.version += 1
  broadcast(room, 'roomDissolved', { roomId: room.roomId, reason, version: room.version })
  ids.forEach(id => {
    const connection = connections.get(room.seats[id])
    if (connection) connection.roomId = null
  })
  rooms.delete(room.roomId)
  broadcastRooms()
  persistRuntimeState()
}
const scheduleDissolveExpiry = (room) => {
  clearDissolveTimer(room.roomId)
  const expiresAt = room.dissolveVote?.expiresAt
  if (!expiresAt) return
  dissolveTimers.set(room.roomId, setTimeout(() => {
    if (!rooms.has(room.roomId) || room.dissolveVote?.expiresAt !== expiresAt) return
    room.dissolveVote = null
    room.version += 1
    publishDissolveVote(room, 'expired')
    clearDissolveTimer(room.roomId)
    persistRuntimeState()
  }, Math.max(0, expiresAt - Date.now())))
}
const autoStartMatchedRoom = (room) => {
  if (!room.ticketBound || room.state || ids.some(id => !room.seats[id])) return false
  room.state = createGame(2, 'p1')
  ids.forEach(id => {
    room.state.players[id].isAI = false
    room.state.players[id].name = `玩家${id.slice(1)}`
  })
  room.matchStartedAt = Date.now()
  room.totalDeadlineAt = null
  room.matchEnded = null
  room.version += 1
  reportSpectatorEvent(room, { type: 'game-start', roundSequence: 1 })
  armMatchDuration(room)
  armTurnDeadline(room)
  publishState(room)
  return true
}
const entryPayloadFor = (room, playerId) => ({
  roomId: room.roomId,
  myPlayerId: playerId,
  resumeToken: room.resumeTokens[playerId],
  state: room.state ? stateFor(room.state, playerId) : null,
  tribute: room.tribute || null,
  roundResult: room.roundResult || null,
  phase: phaseFor(room),
  version: room.version,
  roomSettings: normalizeFriendRoomSettings(room.roomSettings),
  ...lobbyMetadataFor(room),
  ...liveMetadataFor(room),
})
const ensureTicketBindings = (room) => {
  room.ticketJtisBySeat ||= { p1: null, p2: null, p3: null, p4: null }
  room.ticketExpiresAtBySeat ||= { p1: null, p2: null, p3: null, p4: null }
}
const seatHasAnotherActiveConnection = (room, playerId, connection) => {
  const connectionId = room.seats[playerId]
  return Boolean(connectionId && connectionId !== connection.id && connections.has(connectionId))
}

const handleCommand = (connection, message) => {
  const { type, requestId, payload = {} } = message
  const reply = (replyType, body = {}) => send(connection, replyType, { requestId, ...body })
  const requestedRoomId = String(payload.roomId || connection.roomId || '')
  const requestedRoom = rooms.get(requestedRoomId)
  const cacheKey = idempotentActionTypes.has(type) ? actionCacheKey(requestedRoom, connection, requestId) : null
  const previousAccepted = cacheKey ? acceptedActions.get(cacheKey) : null
  if (previousAccepted) return send(connection, 'actionAccepted', previousAccepted)
  const acceptAction = (room) => {
    const accepted = { requestId, requestType: type, roomId: room.roomId, version: room.version }
    rememberAccepted(cacheKey, accepted)
    persistRuntimeState()
    send(connection, 'actionAccepted', accepted)
  }
  // 小程序协议只接受意图型命令（play/pass），不接受客户端覆盖整局状态。
  if (type === 'updateState') return reply('error', { message: '该通道禁止整状态同步，请提交出牌或不要动作' })
  if (type === 'listRooms') return reply('roomList', { rooms: listRooms() })
  if (type === 'createRoom') {
    const roomId = String(payload.roomId || '')
    if (!/^\d{6}$/.test(roomId)) return reply('error', { message: '房间号无效' })
    let ticketStatus
    try { ticketStatus = inspectEntryTicket(payload, { roomId, seat: 'p1' }) } catch (error) { return reply('error', { message: error instanceof Error ? error.message : '入桌票据无效' }) }
    const claims = ticketStatus.claims
    let requestedRoomSettings = null
    if (!claims) {
      try { requestedRoomSettings = normalizeFriendRoomSettings(payload.roomSettings, { strict: true }) } catch (error) {
        return reply('error', { message: error instanceof Error ? error.message : '好友房设置无效' })
      }
    }
    let room = rooms.get(roomId)

    if (ticketStatus.consumed) {
      if (!room || !room.ticketBound || !ticketMatchesRoom(room, claims)) return reply('error', { message: '已使用票据对应的房间不存在' })
      ensureTicketBindings(room)
      if (room.ticketJtisBySeat.p1 !== claims.jti) return reply('error', { message: '入桌票据与房主席位绑定不一致' })
      if (seatHasAnotherActiveConnection(room, 'p1', connection)) return reply('error', { message: '房主席位已被另一个活动连接占用' })
      if (!room.resumeTokens.p1) return reply('error', { message: '房主席位恢复凭证不存在' })
      const isSameConnection = room.seats.p1 === connection.id
      room.seats.p1 = connection.id
      connection.roomId = roomId
      clearEmptyRoomExpiry(roomId)
      const restoredDissolveVote = restoreOfflineDissolveVote(room, 'p1')
      if (!isSameConnection) room.version += 1
      clearHostExpiry(roomId)
      reply('roomCreated', entryPayloadFor(room, 'p1'))
      publishRoomMembers(room)
      if (restoredDissolveVote) publishDissolveVote(room)
      broadcastRooms()
      autoStartMatchedRoom(room)
      return
    }

    let createdRoom = false
    if (room) {
      if (!claims || !room.ticketBound || !ticketMatchesRoom(room, claims)) return reply('error', { message: '房间号已存在' })
      ensureTicketBindings(room)
      if (room.ticketJtisBySeat.p1 && room.ticketJtisBySeat.p1 !== claims.jti) return reply('error', { message: '房主席位已绑定其他票据' })
      if (seatHasAnotherActiveConnection(room, 'p1', connection)) return reply('error', { message: '房主席位已被占用' })
    } else {
      room = createRoomRecord({
        roomId,
        hostName: String(payload.hostName || '玩家'),
        hostConnectionId: connection.id,
        state: claims ? null : (payload.state || null),
        ticketClaims: claims,
        roomSettings: requestedRoomSettings,
      })
      rooms.set(roomId, room)
      createdRoom = true
    }
    try { gameTicketVerifier.consume(claims) } catch (error) { if (createdRoom) rooms.delete(roomId); return reply('error', { message: error instanceof Error ? error.message : '入桌票据已使用' }) }
    const resumeToken = room.resumeTokens.p1 || createResumeToken()
    room.hostName = String(payload.hostName || '玩家')
    room.seats.p1 = connection.id
    room.resumeTokens.p1 = resumeToken
    if (claims) {
      room.ticketBound = true
      room.matchId = claims.matchId
      room.userIdsBySeat.p1 = claims.sub
      room.ticketJtisBySeat.p1 = claims.jti
      room.ticketExpiresAtBySeat.p1 = claims.exp
    }
    clearHostExpiry(roomId)
    clearEmptyRoomExpiry(roomId)
    connection.roomId = roomId
    if (room.state && !room.matchStartedAt) {
      room.matchStartedAt = Date.now()
      armMatchDuration(room)
      armTurnDeadline(room)
    }
    reply('roomCreated', entryPayloadFor(room, 'p1'))
    broadcastRooms()
    autoStartMatchedRoom(room)
    return
  }
  if (type === 'joinRoom') {
    const roomId = String(payload.roomId || '')
    if (!/^\d{6}$/.test(roomId)) return reply('error', { message: '房间号无效' })
    let ticketStatus
    try { ticketStatus = inspectEntryTicket(payload, { roomId }) } catch (error) { return reply('error', { message: error instanceof Error ? error.message : '入桌票据无效' }) }
    const claims = ticketStatus.claims
    if (claims?.seat === 'p1') return reply('error', { message: 'p1 席位必须使用 createRoom 入桌' })
    let room = rooms.get(roomId)

    if (ticketStatus.consumed) {
      const myPlayerId = claims.seat
      if (!room || !room.ticketBound || !ticketMatchesRoom(room, claims)) return reply('error', { message: '已使用票据对应的房间不存在' })
      ensureTicketBindings(room)
      if (room.ticketJtisBySeat[myPlayerId] !== claims.jti) return reply('error', { message: '入桌票据与席位绑定不一致' })
      if (seatHasAnotherActiveConnection(room, myPlayerId, connection)) return reply('error', { message: '匹配票据指定席位已被另一个活动连接占用' })
      if (!room.resumeTokens[myPlayerId]) return reply('error', { message: '席位恢复凭证不存在' })
      const isSameConnection = room.seats[myPlayerId] === connection.id
      room.seats[myPlayerId] = connection.id
      connection.roomId = roomId
      clearEmptyRoomExpiry(roomId)
      const restoredDissolveVote = restoreOfflineDissolveVote(room, myPlayerId)
      if (!isSameConnection) room.version += 1
      reply('roomJoined', entryPayloadFor(room, myPlayerId))
      publishRoomMembers(room)
      if (restoredDissolveVote) publishDissolveVote(room)
      broadcastRooms()
      autoStartMatchedRoom(room)
      return
    }

    let createdRoom = false
    if (!room && claims) {
      room = createRoomRecord({ roomId, ticketClaims: claims })
      rooms.set(roomId, room)
      createdRoom = true
      scheduleHostExpiry(roomId, Math.max(1000, claims.exp * 1000 - Date.now()))
    }
    if (!room) return reply('error', { message: '房间不存在' })
    if (!ticketMatchesRoom(room, claims)) return reply('error', { message: room.ticketBound ? '该房间要求有效匹配票据' : '入桌票据与房间不匹配' })
    ensureTicketBindings(room)
    if (room.state) return reply('error', { message: '对局已经开始，请使用重连凭证恢复席位' })
    const myPlayerId = claims?.seat || ids.slice(1).find(id => !seatIsOccupied(room, id))
    if (!myPlayerId) return reply('error', { message: '房间已满' })
    if (claims && room.ticketJtisBySeat[myPlayerId] && room.ticketJtisBySeat[myPlayerId] !== claims.jti) return reply('error', { message: '匹配席位已绑定其他票据' })
    if (seatHasAnotherActiveConnection(room, myPlayerId, connection)) return reply('error', { message: '匹配票据指定席位已被占用' })
    try { gameTicketVerifier.consume(claims) } catch (error) { if (createdRoom) { clearHostExpiry(roomId); rooms.delete(roomId) }; return reply('error', { message: error instanceof Error ? error.message : '入桌票据已使用' }) }
    const resumeToken = createResumeToken()
    room.seats[myPlayerId] = connection.id
    room.resumeTokens[myPlayerId] = resumeToken
    ensureLobbyMetadata(room)
    room.lobbyReady[myPlayerId] = false
    room.version += 1
    connection.roomId = roomId
    clearEmptyRoomExpiry(roomId)
    if (claims) {
      room.ticketBound = true
      room.matchId = claims.matchId
      room.userIdsBySeat[myPlayerId] = claims.sub
      room.ticketJtisBySeat[myPlayerId] = claims.jti
      room.ticketExpiresAtBySeat[myPlayerId] = claims.exp
    }
    reply('roomJoined', entryPayloadFor(room, myPlayerId))
    publishRoomMembers(room)
    broadcastRooms()
    autoStartMatchedRoom(room)
    return
  }
  if (type === 'rejoinRoom') {
    const room = rooms.get(String(payload.roomId || '')); const myPlayerId = payload.myPlayerId
    if (!room || !ids.includes(myPlayerId)) return reply('error', { message: '房间或席位无效' })
    if (isBotPlayer(room, myPlayerId)) return reply('error', { message: '该席位当前由机器人占用' })
    if (!sameToken(room.resumeTokens[myPlayerId], payload.resumeToken)) return reply('error', { message: '重连凭证无效' })
    if (seatHasAnotherActiveConnection(room, myPlayerId, connection)) return reply('error', { message: '该席位已被另一个活动连接占用' })
    room.seats[myPlayerId] = connection.id; room.version += 1; connection.roomId = payload.roomId
    clearEmptyRoomExpiry(payload.roomId)
    const restoredDissolveVote = restoreOfflineDissolveVote(room, myPlayerId)
    if (myPlayerId === 'p1') clearHostExpiry(payload.roomId)
    reply('roomRejoined', entryPayloadFor(room, myPlayerId))
    publishRoomMembers(room)
    if (restoredDissolveVote) publishDissolveVote(room)
    return
  }
  if (type === 'startGame') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    if (!room || playerIn(room, connection.id) !== 'p1') return reply('error', { message: '只有房主可以开始游戏' })
    if (room.state) return reply('error', { message: '对局已经开始' })
    if (ids.some(id => !seatIsOccupied(room, id))) return reply('error', { message: '需要四个已占用席位才能开始' })
    ensureLobbyMetadata(room)
    if (!room.ticketBound && ids.some(id => !room.lobbyReady[id])) return reply('error', { message: '四名玩家都准备后才能开始' })
    room.state = createGame(2, 'p1')
    ids.forEach(id => {
      const isAI = isBotPlayer(room, id)
      room.state.players[id].isAI = isAI
      room.state.players[id].name = isAI ? `机器人${id.slice(1)}` : `玩家${id.slice(1)}`
    })
    room.matchStartedAt = Date.now()
    room.totalDeadlineAt = null
    room.matchEnded = null
    room.version += 1
    reportSpectatorEvent(room, { type: 'game-start', roundSequence: 1 })
    armMatchDuration(room)
    armTurnDeadline(room)
    acceptAction(room)
    publishState(room)
    return
  }
  if (type === 'setLobbyReady' || type === 'cancelLobbyReady') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId) return reply('error', { message: '当前不在房间中' })
    if (room.ticketBound) return reply('error', { message: '匹配房由服务器自动开局，无需手动准备' })
    if (room.state) return reply('error', { message: '对局已经开始' })
    ensureLobbyMetadata(room)
    const ready = type === 'setLobbyReady'
    if (room.lobbyReady[playerId] !== ready) {
      room.lobbyReady[playerId] = ready
      room.version += 1
    }
    acceptAction(room)
    publishLobbyReady(room)
    return
  }
  if (type === 'kickMember') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    if (!room || playerIn(room, connection.id) !== 'p1') return reply('error', { message: '只有房主可以移出成员' })
    if (room.ticketBound) return reply('error', { message: '匹配房不允许房主移出成员' })
    if (room.state) return reply('error', { message: '对局开始后不能移出成员' })
    const targetPlayerId = String(payload.playerId || '')
    if (!ids.includes(targetPlayerId) || targetPlayerId === 'p1') return reply('error', { message: '只能移出其他有效席位' })
    const targetConnectionId = room.seats[targetPlayerId]
    const targetConnection = connections.get(targetConnectionId)
    if (!targetConnectionId || !targetConnection) return reply('error', { message: '该成员当前不在房间中' })
    ensureLobbyMetadata(room)
    if (room.lobbyReady[targetPlayerId]) return reply('error', { message: '已准备成员不能被移出，请等待其取消准备' })
    room.seats[targetPlayerId] = null
    room.resumeTokens[targetPlayerId] = null
    room.lobbyReady[targetPlayerId] = false
    targetConnection.roomId = null
    room.version += 1
    send(targetConnection, 'roomKicked', { roomId: room.roomId, reason: 'host-kicked', version: room.version })
    acceptAction(room)
    publishRoomMembers(room)
    broadcastRooms()
    return
  }
  if (type === 'addBot' || type === 'removeBot') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    if (!room || playerIn(room, connection.id) !== 'p1') return reply('error', { message: '只有房主可以设置机器人' })
    if (room.ticketBound) return reply('error', { message: '匹配票据房不允许设置机器人' })
    if (room.state) return reply('error', { message: '对局开始后不能设置机器人' })
    const targetPlayerId = String(payload.playerId || '')
    if (!ids.slice(1).includes(targetPlayerId)) return reply('error', { message: '只能设置空闲的其他席位' })
    ensureLobbyMetadata(room)
    const botIndex = room.botPlayerIds.indexOf(targetPlayerId)
    if (type === 'addBot') {
      if (room.seats[targetPlayerId]) return reply('error', { message: '该席位已有玩家' })
      if (botIndex >= 0) return reply('error', { message: '该席位已经是机器人' })
      room.botPlayerIds.push(targetPlayerId)
      room.botPlayerIds.sort((left, right) => ids.indexOf(left) - ids.indexOf(right))
      ensureBotMetadata(room)
      room.lobbyReady[targetPlayerId] = true
    } else {
      if (botIndex < 0) return reply('error', { message: '该席位不是机器人' })
      room.botPlayerIds.splice(botIndex, 1)
      room.lobbyReady[targetPlayerId] = false
    }
    room.version += 1
    acceptAction(room)
    publishRoomMembers(room)
    broadcastRooms()
    return
  }
  if (type === 'play' || type === 'pass') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.state) return reply('error', { message: '对局尚未开始' })
    ensureLiveMetadata(room)
    if (room.trustees[playerId]) return reply('error', { message: '请先取消托管再操作' })
    if (room.matchEnded || room.roundResult || room.tribute) return reply('error', { message: '当前阶段不能出牌' })
    try {
      if (type === 'play') {
        const cardIds = Array.isArray(payload.cardIds) ? payload.cardIds : []
        const cards = cardIds.map(id => room.state.players[playerId].hand.find(card => card.id === id)).filter(Boolean)
        if (cards.length !== cardIds.length) throw new Error('所选手牌无效')
        room.state = playCards(room.state, playerId, cards)
        recordRoomAction(room, playerId, { kind: 'play', playType: room.state.playArea.at(-1)?.type || null })
        reportSpectatorAction(room, { type: 'play', playerId, cards, automatic: false })
      } else {
        room.state = passTurn(room.state, playerId)
        recordRoomAction(room, playerId, { kind: 'pass' })
        reportSpectatorAction(room, { type: 'pass', playerId, automatic: false })
      }
      room.consecutiveTimeouts[playerId] = 0
      room.version += 1
      const result = settleRoundIfNeeded(room)
      if (!result) armTurnDeadline(room)
      acceptAction(room)
      publishState(room)
      if (result) broadcast(room, 'roundEnded', { roomId: room.roomId, result, phase: phaseFor(room), version: room.version, ...liveMetadataFor(room) })
    } catch (error) { reply('error', { message: error instanceof Error ? error.message : '出牌失败' }) }
    return
  }
  if (type === 'nextRound' || type === 'readyNextRound' || type === 'roundReady' || type === 'ready') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.roundResult) return reply('error', { message: '当前不能准备下一局' })
    const result = room.roundResult
    if (room.matchEnded) return reply('error', { message: '本场已结束，请重新创建对局' })
    if (result.isGameWon) return reply('error', { message: '本场已打过 A，请重新创建对局' })
    ensureLiveMetadata(room)
    room.roundReady[playerId] = true
    room.version += 1
    acceptAction(room)
    if (ids.every(id => room.roundReady[id])) prepareNextRound(room, false)
    else publishRoundReady(room)
    return
  }
  if (type === 'cancelRoundReady' || type === 'cancelReady') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.roundResult) return reply('error', { message: '当前不能取消准备' })
    ensureLiveMetadata(room)
    room.roundReady[playerId] = false
    room.version += 1
    acceptAction(room)
    publishRoundReady(room)
    return
  }
  if (type === 'setTrustee' || type === 'cancelTrustee') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.state || room.matchEnded) return reply('error', { message: '当前不在进行中的对局' })
    ensureLiveMetadata(room)
    if (type === 'setTrustee' && !room.ticketBound && normalizeFriendRoomSettings(room.roomSettings).trusteeSeconds === 0) {
      return reply('error', { message: '本好友房已关闭托管' })
    }
    if (type === 'setTrustee') room.trustees[playerId] = { reason: 'manual', since: Date.now() }
    else {
      room.trustees[playerId] = null
      room.consecutiveTimeouts[playerId] = 0
    }
    room.version += 1
    if (!room.roundResult && room.deadlinePlayerId === playerId) armTurnDeadline(room)
    acceptAction(room)
    publishTrustees(room)
    if (room.roundResult || room.deadlinePlayerId !== playerId) publishTurnStatus(room)
    return
  }
  if (type === 'proposeDissolve') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.state) return reply('error', { message: '当前不在对局中' })
    ensureLiveMetadata(room)
    if (room.dissolveVote) return reply('error', { message: '已有解散投票进行中' })
    const votes = { p1: 'pending', p2: 'pending', p3: 'pending', p4: 'pending' }
    votes[playerId] = 'agree'
    room.botPlayerIds.forEach(id => { votes[id] = 'agree' })
    room.dissolveVote = { initiator: playerId, votes, expiresAt: Date.now() + DISSOLVE_TIMEOUT_MS }
    room.version += 1
    scheduleDissolveExpiry(room)
    acceptAction(room)
    publishDissolveVote(room)
    return
  }
  if (type === 'dissolveVote' || type === 'voteDissolve') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.dissolveVote) return reply('error', { message: '当前没有解散投票' })
    const agree = payload.agree === true
    room.dissolveVote.votes[playerId] = agree ? 'agree' : 'refuse'
    room.version += 1
    acceptAction(room)
    if (!agree) {
      room.dissolveVote = null
      clearDissolveTimer(room.roomId)
      publishDissolveVote(room, 'rejected')
      return
    }
    if (ids.every(id => room.dissolveVote.votes[id] === 'agree')) {
      dissolveRoom(room)
      return
    }
    publishDissolveVote(room)
    return
  }
  if (type === 'tribute' || type === 'returnTribute') {
    const room = rooms.get(String(payload.roomId || connection.roomId || '')); const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.tribute) return reply('error', { message: '当前不是贡还阶段' })
    if (room.trustees[playerId]) return reply('error', { message: '请先取消托管再操作' })
    if (room.deadlinePlayerId !== playerId || room.deadlineAction !== type) return reply('error', { message: '当前等待其他玩家完成贡还' })
    try {
      const result = type === 'tribute'
        ? giveTribute(room.state, room.tribute, playerId, payload.cardId)
        : returnTribute(room.state, room.tribute, playerId, payload.cardId)
      room.state = result.state; room.tribute = result.tribute; room.consecutiveTimeouts[playerId] = 0; room.version += 1
      recordRoomAction(room, playerId, { kind: type })
      reportSpectatorEvent(room, { type: type === 'tribute' ? 'tribute' : 'return-tribute', playerId, roundSequence: room.roundSequence + 1 })
      armTurnDeadline(room)
      acceptAction(room)
      publishTribute(room)
    } catch (error) { reply('error', { message: error instanceof Error ? error.message : '贡还失败' }) }
    return
  }
  if (type === 'finishTribute') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !room.tribute || (!room.tribute.isAntiTribute && room.tribute.phase !== 'done')) return reply('error', { message: '贡还尚未完成' })
    if (!playerId || room.deadlinePlayerId !== playerId || room.deadlineAction !== 'finishTribute') return reply('error', { message: '当前等待指定玩家开始本局' })
    if (room.trustees[playerId]) return reply('error', { message: '请先取消托管再操作' })
    try { finishTributeState(room) } catch (error) { return reply('error', { message: error instanceof Error ? error.message : '开始本局失败' }) }
    room.consecutiveTimeouts[playerId] = 0
    room.version += 1
    armTurnDeadline(room); acceptAction(room); publishState(room)
    return
  }
  if (type === 'chat') {
    const room = rooms.get(String(payload.roomId || connection.roomId || '')); const playerId = room && playerIn(room, connection.id)
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!room || !playerId) return reply('error', { message: '当前不在房间中' })
    if (!room.ticketBound && normalizeFriendRoomSettings(room.roomSettings).disableInteraction) return reply('error', { message: '本好友房已禁止互动' })
    if (!QUICK_CHAT_PHRASES.has(text)) return reply('error', { message: '仅支持固定快捷语' })
    room.chatLastAcceptedAt ||= { p1: 0, p2: 0, p3: 0, p4: 0 }
    room.chatLastPhraseAt ||= { p1: {}, p2: {}, p3: {}, p4: {} }
    const now = Date.now()
    const intervalRemaining = room.chatLastAcceptedAt[playerId] + QUICK_CHAT_INTERVAL_MS - now
    if (intervalRemaining > 0) return reply('error', { message: '快捷语发送过于频繁', retryAfterMs: intervalRemaining })
    const repeatRemaining = (room.chatLastPhraseAt[playerId][text] || 0) + QUICK_CHAT_REPEAT_MS - now
    if (repeatRemaining > 0) return reply('error', { message: '相同快捷语仍在冷却中', retryAfterMs: repeatRemaining })
    room.chatLastAcceptedAt[playerId] = now
    room.chatLastPhraseAt[playerId][text] = now
    acceptAction(room)
    broadcast(room, 'chat', { roomId: room.roomId, playerId, text, version: room.version })
    return
  }
  if (type === 'leaveRoom' || type === 'safeExit') {
    const room = rooms.get(String(payload.roomId || connection.roomId || '')); const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId) return reply('error', { message: '当前不在房间中' })
    room.version += 1
    if (room.state) {
      ensureLiveMetadata(room)
      room.seats[playerId] = null
      room.trustees[playerId] = { reason: 'disconnected', since: Date.now() }
      if (room.dissolveVote?.votes[playerId] === 'pending') room.dissolveVote.votes[playerId] = 'offline'
      markOfflineReady(room, playerId)
      if (!room.roundResult && room.deadlinePlayerId === playerId) armTurnDeadline(room)
      publishRoomMembers(room)
      publishTrustees(room)
      if (room.dissolveVote) publishDissolveVote(room)
    } else if (playerId === 'p1') {
      reportSpectatorClosed(room, 'host-left')
      clearHostExpiry(payload.roomId || connection.roomId)
      clearTurnTimer(room.roomId)
      clearMatchDurationTimer(room.roomId)
      clearDissolveTimer(room.roomId)
      clearEmptyRoomExpiry(room.roomId)
      rooms.delete(payload.roomId || connection.roomId)
      broadcast(room, 'hostLeft', { roomId: room.roomId, version: room.version })
    } else {
      room.seats[playerId] = null
      room.resumeTokens[playerId] = null
      ensureLobbyMetadata(room)
      room.lobbyReady[playerId] = false
      publishRoomMembers(room)
    }
    connection.roomId = null; broadcastRooms(); reply('roomLeft', { roomId: room.roomId, version: room.version, seatReserved: Boolean(room.state) })
    if (room.state) scheduleEmptyRoomExpiry(room)
    return
  }
  reply('error', { message: '未知协议消息' })
}

const handle = (connection, message) => {
  try { return handleCommand(connection, message) } finally { persistRuntimeState() }
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
      const opcode = connection.buffer[0] & 15; const length = connection.buffer[1] & 127; const masked = Boolean(connection.buffer[1] & 128); const header = length < 126 ? 2 : 4
      if (!masked || length === 127) { socket.destroy(); return }
      if (connection.buffer.length < header + 4) return
      const size = length === 126 ? connection.buffer.readUInt16BE(2) : length; const maskStart = header; const bodyStart = header + 4
      if (size > MAX_MESSAGE_BYTES) { socket.destroy(); return }
      if (connection.buffer.length < bodyStart + size) return
      const body = Buffer.from(connection.buffer.subarray(bodyStart, bodyStart + size)); for (let i = 0; i < size; i += 1) body[i] ^= connection.buffer[maskStart + i % 4]
      connection.buffer = connection.buffer.subarray(bodyStart + size)
      if (opcode === 8) { socket.end(); return }
      try { handle(connection, JSON.parse(body.toString())) } catch { send(connection, 'error', { message: '协议数据无效' }) }
    }
  })
  socket.on('close', () => {
    const room = rooms.get(connection.roomId)
    if (room) {
      const playerId = playerIn(room, connection.id)
      if (playerId) {
        room.version += 1
        room.seats[playerId] = null
        if (room.state) {
          ensureLiveMetadata(room)
          room.trustees[playerId] = { reason: 'disconnected', since: Date.now() }
          if (room.dissolveVote?.votes[playerId] === 'pending') room.dissolveVote.votes[playerId] = 'offline'
          markOfflineReady(room, playerId)
          if (!room.roundResult && room.deadlinePlayerId === playerId) armTurnDeadline(room)
          publishTrustees(room)
          if (room.dissolveVote) publishDissolveVote(room)
        } else if (playerId === 'p1') {
          const ticketExpiry = room.ticketExpiresAtBySeat?.p1
          const timeoutMs = room.ticketBound && Number.isFinite(ticketExpiry)
            ? Math.max(1000, ticketExpiry * 1000 - Date.now())
            : 15000
          scheduleHostExpiry(connection.roomId, timeoutMs)
        }
      }
      if (rooms.has(connection.roomId)) publishRoomMembers(room)
      if (room.state) scheduleEmptyRoomExpiry(room)
      broadcastRooms()
    }
    connections.delete(connection.id)
    persistRuntimeState()
  })
})

const restoreTurnDeadline = (room) => {
  clearTurnTimer(room.roomId)
  const step = deadlineStepFor(room)
  if (!step) {
    room.turnDeadlineAt = null
    room.deadlinePlayerId = null
    room.deadlineAction = null
    return
  }
  const deadline = Number(room.turnDeadlineAt)
  const matchesStoredStep = Number.isFinite(deadline) && room.deadlinePlayerId === step.playerId && room.deadlineAction === step.action
  if (!matchesStoredStep) {
    armTurnDeadline(room)
    return
  }
  const delay = Math.max(0, deadline - Date.now())
  turnTimers.set(room.roomId, setTimeout(() => automatedDeadline(room, step.playerId, step.action, deadline), delay))
}

const restorePersistedRuntime = () => {
  if (!roomStateStore.configured) return
  const stored = roomStateStore.load()
  for (const entry of stored.acceptedActions.slice(-maxAcceptedActions)) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object') acceptedActions.set(entry[0], entry[1])
  }
  for (const rawRoom of stored.rooms) {
    if (!rawRoom || !/^\d{6}$/.test(String(rawRoom.roomId || '')) || rooms.has(String(rawRoom.roomId))) continue
    const room = roomFromPersistence(rawRoom)
    ensureTicketBindings(room)
    ensureLobbyMetadata(room)
    ensureLiveMetadata(room)
    if (!room.resumeTokens || !ids.every(id => Object.prototype.hasOwnProperty.call(room.resumeTokens, id))) continue
    if (!Number.isSafeInteger(room.version) || room.version < 0) room.version = 0
    if (room.state) {
      ids.forEach(id => {
        if (room.resumeTokens[id] && !room.trustees[id]) room.trustees[id] = { reason: 'disconnected', since: Date.now() }
        if (room.dissolveVote?.votes?.[id] === 'pending') room.dissolveVote.votes[id] = 'offline'
      })
    }
    rooms.set(room.roomId, room)
    if (room.dissolveVote) scheduleDissolveExpiry(room)
    if (room.state) {
      if (!room.roundResult && !room.matchEnded) restoreTurnDeadline(room)
      armMatchDuration(room)
      scheduleEmptyRoomExpiry(room)
    } else {
      const ticketExpiry = room.ticketExpiresAtBySeat?.p1
      const timeoutMs = room.ticketBound && Number.isFinite(ticketExpiry)
        ? Math.max(1000, ticketExpiry * 1000 - Date.now())
        : 15000
      scheduleHostExpiry(room.roomId, timeoutMs)
    }
  }
  persistRuntimeState()
  console.log(`Restored ${rooms.size} WeApp room(s) from ${roomStateStore.filePath}`)
}

const port = Number(process.env.WEAPP_WS_PORT || 3002)
restorePersistedRuntime()
server.listen(port, () => console.log(`Guandan WeApp WebSocket server running on port ${port}`))
