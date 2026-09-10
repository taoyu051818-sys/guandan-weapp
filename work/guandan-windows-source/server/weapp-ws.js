/** Cocos 客户端的权威 WebSocket 组合根；客户端只提交动作意图。 */
import { createServer } from 'node:http'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { GameTicketVerifier } from './platform/crypto.js'
import { loadGameSecurityConfig } from './platform/config.js'
import { GameResultReporter } from './platform/result-reporter.js'
import { SpectatorEventReporter } from './platform/spectator-event-reporter.js'
import { buildGameResultEvent, createGameStatsBySeat, ensureGameStatsBySeat, recordAuthoritativeAction } from './game-stats.js'
import { JsonRoomStateStore, roomForPersistence, roomFromPersistence } from './room-state-store.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { createRoomOpeningState, isSingleRoundMatch } from './match-format-policy.js'
import { createRoomBotPolicy } from './master-bot-policy.js'
import { migrateLegacyMatchState } from './game-session.js'
import { isProtocolUpgradeRequest, sendProtocolMessage, upgradeToProtocolConnection } from './weapp-websocket-transport.js'
import { createRoomPublisher, phaseForRoom } from './weapp-room-publisher.js'
import { createCommandRouter } from './weapp-command-router.js'
import { createGameCommandHandler, GAME_COMMAND_TYPES } from './weapp-game-command-handler.js'
import { createLobbyCommandHandler, LOBBY_COMMAND_TYPES } from './weapp-lobby-command-handler.js'
import { createEntryCommandHandler, ENTRY_COMMAND_TYPES } from './weapp-entry-command-handler.js'
import { createCommandGateway } from './weapp-command-gateway.js'
import { createCommandPublication } from './weapp-command-publication.js'
import { createRoomExit, EXIT_COMMAND_TYPES } from './weapp-room-exit.js'
import { createWeAppMatchLifecycle } from './weapp-match-lifecycle.js'
import { botSeatBindingsMatch } from './weapp-match-bot-seats.js'
import { createWeAppGameStartCoordinator } from './weapp-game-start-coordinator.js'
import { restoreWeAppRuntime } from './weapp-runtime-recovery.js'
import { GLOBAL_OPERATION_KEY, createWeAppOperationScheduler, operationKeyForCommand } from './weapp-operation-scheduler.js'
import { createAcceptedActionStore } from './weapp-accepted-action-store.js'

import { createRuntimePersistence } from './weapp-runtime-persistence.js'
import { createRoomMetadata } from './weapp-room-metadata.js'
import { createRoomExpiry } from './weapp-room-expiry.js'
import { roomMember } from './friend-room-members.js'
import { createFriendRoomObserverRuntime, FRIEND_VIEW_COMMANDS } from './friend-room-observer-runtime.js'
import { DuplicateRoomRuntime } from './duplicate-room-runtime.js'

const require = createRequire(import.meta.url)
const { PlayType, getRuleProfile } = require('../../../shared-core/dist')
const { validateCommandRequestId, validateExpectedVersion } = require('../../../shared-core/dist/protocol')
const ids = ['p1', 'p2', 'p3', 'p4']
const rooms = new Map()
const connections = new Map()
const sideEffectStageRetryTimers = new Map()
const sideEffectCompletionHandlers = new Map()
const maxAcceptedActions = 512
const acceptedActionStore = createAcceptedActionStore({ maxEntries: maxAcceptedActions })
const acceptedActions = acceptedActionStore.entries
const closedRoomTombstones = new Map()
const roomBotPolicies = new Map()
const idempotentActionTypes = new Set([
  ...FRIEND_VIEW_COMMANDS,
  'startGame', 'setLobbyReady', 'cancelLobbyReady', 'kickMember', 'addBot', 'removeBot',
  'play', 'pass', 'nextRound', 'readyNextRound', 'roundReady', 'ready', 'cancelRoundReady', 'cancelReady',
  'setTrustee', 'cancelTrustee', 'proposeDissolve', 'dissolveVote', 'voteDissolve',
  'tribute', 'returnTribute', 'finishTribute', 'leaveRoom', 'safeExit',
])
let nextConnection = 1
let shuttingDown = false
const operationScheduler = createWeAppOperationScheduler()
const roomOperationKey = roomId => `room:${roomId}`

const security = loadGameSecurityConfig()
const TURN_TIMEOUT_MS = security.turnTimeoutMs
const TRUSTEE_ACTION_DELAY_MS = security.trusteeActionDelayMs
const BOT_ACTION_DELAY_MS = security.botActionDelayMs
const FRIEND_SECOND_MS = security.friendSecondMs
const TOTAL_MINUTE_MS = security.totalMinuteMs
const DISSOLVE_TIMEOUT_MS = security.dissolveTimeoutMs
const EMPTY_ROOM_TIMEOUT_MS = security.emptyRoomTimeoutMs
const MAX_MESSAGE_BYTES = security.maxMessageBytes
const MAX_CONNECTIONS = security.maxConnections
const MAX_ROOMS = security.maxRooms
const COMMAND_RATE_WINDOW_MS = security.commandRateWindowMs
const COMMAND_RATE_LIMIT = security.commandRateLimit
const MAX_PENDING_COMMANDS = security.maxPendingCommands
const PERSIST_DEBOUNCE_MS = security.persistDebounceMs
const roomStateStore = new JsonRoomStateStore({ filePath: security.roomStateFile })
const gameTicketVerifier = new GameTicketVerifier({ secret: security.gameTicketSecret, required: security.ticketRequired })
const resultReporter = new GameResultReporter({ endpoint: security.resultEndpoint, secret: security.gameResultSecret, outboxFilePath: security.resultOutboxFile })
const spectatorEventReporter = new SpectatorEventReporter({
  endpoint: security.spectatorEventEndpoint,
  secret: security.spectatorEventSecret,
  lifecycleSecret: security.gameResultSecret,
  outboxFilePath: security.spectatorOutboxFile,
})

const createResumeToken = () => randomBytes(32).toString('hex')
const createBotSeed = () => randomBytes(4).readUInt32BE(0)
const cryptoRandom = () => randomInt(0x1_0000_0000) / 0x1_0000_0000
const createTestRandom = value => {
  if (process.env.NODE_ENV !== 'test' || !/^(?:0x[\da-f]+|\d+)$/i.test(String(value || ''))) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) return null
  let seed = parsed >>> 0
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x1_0000_0000)
}
const shuffleRandom = createTestRandom(process.env.WEAPP_TEST_RANDOM_SEED) || cryptoRandom
const sameToken = (actual, supplied) => {
  if (typeof actual !== 'string' || typeof supplied !== 'string') return false
  const actualBytes = Buffer.from(actual)
  const suppliedBytes = Buffer.from(supplied)
  return actualBytes.length === suppliedBytes.length && timingSafeEqual(actualBytes, suppliedBytes)
}
const normalizeEntryAttemptId = value => {
  if (value === undefined || value === null || value === '') return null
  const attemptId = String(value)
  return attemptId.length >= 22 && attemptId.length <= 128 && /^[A-Za-z0-9_-]+$/.test(attemptId)
    ? attemptId
    : undefined
}
const rulePresetForRoom = room => room?.rulePreset === 'tournament' ? 'tournament' : 'classic'
const ruleProfileForRoom = room => getRuleProfile(rulePresetForRoom(room))
const botSeedForRoom = room => {
  if (Number.isSafeInteger(room.botSeed) && room.botSeed >= 0 && room.botSeed <= 0xffff_ffff) return room.botSeed
  room.botSeed = createHash('sha256').update(`guandan-room-bot:${room.roomId}`).digest().readUInt32BE(0)
  return room.botSeed
}
const botPolicyForRoom = room => {
  const existing = roomBotPolicies.get(room.roomId)
  if (existing) return existing
  const policy = createRoomBotPolicy({
    ruleProfile: ruleProfileForRoom(room),
    seed: botSeedForRoom(room),
    checkpoint: room.botPolicyCheckpoint || undefined,
  })
  roomBotPolicies.set(room.roomId, policy)
  return policy
}
const resetRoomBotPolicy = room => {
  roomBotPolicies.delete(room.roomId)
  room.botPolicyCheckpoint = null
}
const checkpointRoomBotPolicy = room => {
  const policy = roomBotPolicies.get(room.roomId)
  if (policy) room.botPolicyCheckpoint = policy.checkpoint()
}
const phaseFor = phaseForRoom
const entryKindForClaims = claims => claims?.roomKind === 'friend' ? 'friend' : 'match'
const isMatchRoom = room => Boolean(room?.ticketBound && room.entryKind !== 'friend')
const isFriendRoom = room => !isMatchRoom(room)
const entryDeadlineForClaims = claims => claims?.roomKind === 'friend'
  ? Number(claims.roomExpiresAt)
  : Number(claims?.exp) * 1000

const { createRoomRecord, isBotPlayer, ensureBotMetadata, ensureLobbyMetadata, ensureLiveMetadata } = createRoomMetadata({
  playerIds: ids, createResumeToken, createBotSeed, entryKindForClaims, entryDeadlineForClaims,
})
const inspectEntryTicket = (payload, expected = {}) => gameTicketVerifier.inspectWithConsumptionStatus(payload.gameTicket, expected)
const friendTicketMatchesRoom = (room, claims) => {
  if (room.entryKind !== 'friend' || claims.roomKind !== 'friend') return false
  if (!Number.isSafeInteger(claims.roomExpiresAt) || claims.roomExpiresAt !== room.entryDeadlineAt) return false
  try {
    return JSON.stringify(normalizeFriendRoomSettings(claims.roomSettings, { strict: true })) === JSON.stringify(normalizeFriendRoomSettings(room.roomSettings))
  } catch {
    return false
  }
}
const ticketMatchesRoom = (room, claims) => {
  if (!claims) return !room.ticketBound
  return (!room.ticketBound || (
    room.matchId === claims.matchId
    && room.entryKind === entryKindForClaims(claims)
    && room.matchMode === claims.matchMode
    && (room.entryKind !== 'friend' || friendTicketMatchesRoom(room, claims))
    && (room.entryKind === 'friend' || botSeatBindingsMatch(room, claims))
  ))
    && room.roomId === String(claims.roomId)
}
const pruneClosedRoomTombstones = (now = Date.now()) => {
  for (const [roomId, tombstone] of closedRoomTombstones) {
    if (!Number.isSafeInteger(tombstone?.until) || tombstone.until <= now) closedRoomTombstones.delete(roomId)
  }
}
const ticketBlockedByClosedRoom = claims => {
  if (!claims) return false
  pruneClosedRoomTombstones()
  const tombstone = closedRoomTombstones.get(String(claims.roomId))
  return Boolean(tombstone && tombstone.matchId === claims.matchId)
}
const pendingSeatReleaseFor = (room, claims) => claims?.roomKind === 'friend' && room?.pendingSpectatorEvents?.find(event => (
  event.type === 'seat-left' && event.playerId === claims.seat
))
const rememberClosedRoomTombstone = room => {
  if (!room.ticketBound || !room.matchId) return
  const until = Number(room.entryDeadlineAt)
  if (!Number.isSafeInteger(until) || until <= Date.now()) return
  closedRoomTombstones.set(room.roomId, { roomId: room.roomId, matchId: room.matchId, until })
}
const reportCompletedGame = (room, result) => {
  if (!resultReporter.configured || (!result.isGameWon && !isSingleRoundMatch(room))) return
  if (!ids.every(id => typeof room.userIdsBySeat?.[id] === 'string')) {
    console.warn(`Skip game result callback for ${room.roomId}: ticket user mapping is incomplete`)
    return
  }
  room.pendingResultEvent ||= buildGameResultEvent(room, result)
}
const publicCards = (cards) => (Array.isArray(cards) ? cards : []).map(card => ({ rank: card.rank, suit: card.suit }))
const reportSpectatorEvent = (room, detail) => {
  if (!spectatorEventReporter.configured || !room.ticketBound || !room.matchId) return
  room.pendingSpectatorEvents ||= []
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
  room.pendingSpectatorEvents.push(event)
  return event
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
  isGameWon: Boolean(result.isGameWon || isSingleRoundMatch(room)),
})
const reportSpectatorClosed = (room, reason) => {
  // 正常“过 A”已经通过结算回调进入 finished；随后全员离桌只是资源回收，
  // 不能再发 room-closed 把它伪装成异常终止。
  if (room.roundResult?.isGameWon || (isSingleRoundMatch(room) && room.matchEnded)) return
  return reportSpectatorEvent(room, {
    type: 'room-closed',
    roundSequence: Math.max(1, room.roundSequence || 1),
    reason,
  })
}
const send = sendProtocolMessage
const broadcast = (room, type, payload = {}, except = null) => { ids.forEach((id) => {
  const connection = connections.get(room.seats[id])
  if (connection && connection !== except) send(connection, type, payload)
}); if (['roomDissolved', 'hostLeft'].includes(type)) for (const member of room.friendMembers || []) {
  if (!member.seat) { const connection = connections.get(member.connectionId); if (connection) send(connection, type, payload) }
} }
const seatHasLiveConnection = (room, playerId) => {
  const connection = connections.get(room.seats[playerId])
  return Boolean(connection?.acceptingCommands && !connection.socket.destroyed)
}
const seatIsOccupied = (room, playerId) => seatHasLiveConnection(room, playerId) || isBotPlayer(room, playerId)
const hasConnectedHuman = room => ids.some(id => seatHasLiveConnection(room, id)) || room.friendMembers?.some(member => connections.has(member.connectionId))
const recordRoomAction = (room, playerId, action) => {
  room.statsBySeat = ensureGameStatsBySeat(room.statsBySeat)
  room.roundStatsBySeat = ensureGameStatsBySeat(room.roundStatsBySeat)
  const profile = ruleProfileForRoom(room)
  recordAuthoritativeAction(room.roundStatsBySeat, playerId, action, profile)
  return recordAuthoritativeAction(room.statsBySeat, playerId, action, profile)
}
const restoreOfflineDissolveVote = (room, playerId) => {
  if (room.dissolveVote?.votes[playerId] !== 'offline') return false
  room.dissolveVote.votes[playerId] = 'pending'
  return true
}
const {
  entryPayloadFor,
  liveMetadataFor,
  publishDissolveVote,
  publishLobbyReady,
  publishRoomMembers,
  publishRoundEnded,
  publishRoundReady,
  publishState,
  publishTribute,
  publishTrustees,
  publishTurnStatus,
} = createRoomPublisher({
  playerIds: ids,
  connections,
  send,
  broadcast,
  ensureLobbyMetadata,
  ensureLiveMetadata,
  isFriendRoom,
  seatIsOccupied,
  captureObservers: (...args) => friendObservers.capture(...args),
  publishObservers: room => friendObservers.publish(room),
})
const roomExpiry = createRoomExpiry({
  rooms, seatHasLiveConnection, hasConnectedHuman,
  enqueueServerOperation: (...args) => enqueueServerOperation(...args),
  closeRoomWithoutAck: (...args) => closeRoomWithoutAck(...args),
  commitRuntimeState: () => commitRuntimeState(), publishDissolveVote,
  emptyRoomTimeoutMs: EMPTY_ROOM_TIMEOUT_MS,
})
const { clearHostExpiry, clearEmptyRoomExpiry, clearDissolveTimer,
  scheduleHostExpiry, scheduleEmptyRoomExpiry, scheduleDissolveExpiry } = roomExpiry
const listRooms = () => [...rooms.entries()].filter(([, room]) => !room.ticketBound && seatHasLiveConnection(room, 'p1')).map(([roomId, room]) => ({ roomId, hostName: room.hostName, playerCount: ids.filter(id => seatIsOccupied(room, id)).length, roomSettings: normalizeFriendRoomSettings(room.roomSettings), version: room.version }))
const broadcastRooms = () => connections.forEach(connection => send(connection, 'roomList', { rooms: listRooms() }))
const playerIn = (room, connectionId) => ids.find(id => room.seats[id] === connectionId) || null
const membershipsFor = connection => [...rooms.values()].filter(room => playerIn(room, connection.id) || roomMember(room, connection.id))
const syncConnectionRoomId = connection => {
  const memberships = membershipsFor(connection)
  connection.roomId = memberships.length === 1 ? memberships[0].roomId : null
  return memberships
}
const entryConflictFor = (connection, requestedRoomId) => membershipsFor(connection).find(room => room.roomId !== requestedRoomId) || null
const resumeTokenFor = (room, connection) => {
  const playerId = room && playerIn(room, connection.id)
  return roomMember(room, connection.id)?.resumeToken || (playerId ? room.resumeTokens[playerId] : null)
}
const actionCacheKey = (room, connection, requestId) => {
  const resumeToken = resumeTokenFor(room, connection)
  return resumeToken && Number.isSafeInteger(requestId) ? `${resumeToken}:${requestId}` : null
}
const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}
const actionFingerprint = (type, payload) => createHash('sha256').update(JSON.stringify(canonicalize({ type, payload }))).digest('hex')
const rememberAccepted = (...args) => acceptedActionStore.remember(...args)
const rotateAcceptedActionIdentity = (...args) => acceptedActionStore.rotateToken(...args)
const persistedRuntimeSnapshot = () => ({
  rooms: [...rooms.values()].map(room => {
    checkpointRoomBotPolicy(room)
    return roomForPersistence(room)
  }),
  acceptedActions: [...acceptedActions.entries()].slice(-maxAcceptedActions),
  closedRoomTombstones: [...closedRoomTombstones.values()],
})
const runtimePersistence = createRuntimePersistence({
  roomStateStore, acceptedActions, persistedRuntimeSnapshot,
  debounceMs: PERSIST_DEBOUNCE_MS, isShuttingDown: () => shuttingDown,
})
const { persistRuntimeState, flushRuntimeState } = runtimePersistence
const enqueueServerOperation = (operation, label = 'server operation', roomId = null) => {
  const queued = roomId
    ? operationScheduler.enqueue(roomOperationKey(roomId), operation, label)
    : operationScheduler.enqueueGlobal(operation, label)
  void queued.catch(error => console.error(`${label} failed:`, error instanceof Error ? error.message : error))
  return queued
}
const attachSideEffectCompletion = (key, operation, complete, roomId) => {
  if (sideEffectCompletionHandlers.has(key)) return
  const completion = operation.then(result => enqueueServerOperation(async () => {
    await complete(result)
    persistRuntimeState()
    await flushRuntimeState({ throwOnError: true })
  }, `side effect completion ${key}`, roomId)).catch(error => {
    if (!shuttingDown) console.error(`Side effect ${key} failed:`, error instanceof Error ? error.message : error)
  }).finally(() => sideEffectCompletionHandlers.delete(key))
  sideEffectCompletionHandlers.set(key, completion)
}
const scheduleSideEffectStageRetry = (room, delay = 500) => {
  if (shuttingDown || !rooms.has(room.roomId) || sideEffectStageRetryTimers.has(room.roomId)) return
  const timer = setTimeout(() => {
    sideEffectStageRetryTimers.delete(room.roomId)
    void enqueueServerOperation(async () => {
      if (!rooms.has(room.roomId)) return
      try {
        if (room.closingReason) await closeRoomWithoutAck(room, room.closingReason)
        else stagePendingSideEffects(room)
      } catch (error) {
        scheduleSideEffectStageRetry(room, Math.min(5000, delay * 2))
        throw error
      }
    }, `side effect stage retry ${room.roomId}`, room.roomId)
  }, delay)
  timer.unref?.()
  sideEffectStageRetryTimers.set(room.roomId, timer)
}
const stagePendingSideEffects = room => {
  try {
    ensureLiveMetadata(room)
    for (const event of room.pendingSpectatorEvents) {
      const operation = spectatorEventReporter.stage(event)
      attachSideEffectCompletion(`spectator:${event.eventId}`, operation, async accepted => {
        const current = rooms.get(room.roomId)
        if (!current) return
        const legacyRevocation = {
          jti: accepted?.seatRelease?.revokedTicketJti,
          exp: accepted?.seatRelease?.revokedTicketExp,
        }
        const revocations = [
          ...(Array.isArray(accepted?.seatRelease?.revokedTickets) ? accepted.seatRelease.revokedTickets : []),
          legacyRevocation,
        ].filter(item => item && typeof item.jti === 'string' && Number.isFinite(item.exp))
        if (event.type === 'seat-left' && revocations.length) {
          current.revokedTicketJtis ||= []
          for (const revoked of revocations) {
            if (!current.revokedTicketJtis.some(item => item.jti === revoked.jti)) {
              current.revokedTicketJtis.push({ jti: revoked.jti, exp: revoked.exp })
            }
          }
        }
        current.pendingSpectatorEvents = current.pendingSpectatorEvents.filter(item => item.eventId !== event.eventId)
      }, room.roomId)
    }
    if (room.pendingResultEvent) {
      const event = room.pendingResultEvent
      const operation = resultReporter.stage(event)
      attachSideEffectCompletion(`result:${event.eventId}`, operation, async () => {
        const current = rooms.get(room.roomId)
        if (current?.pendingResultEvent?.eventId === event.eventId) current.pendingResultEvent = null
      }, room.roomId)
    }
    const retryTimer = sideEffectStageRetryTimers.get(room.roomId)
    if (retryTimer) clearTimeout(retryTimer)
    sideEffectStageRetryTimers.delete(room.roomId)
  } catch (error) {
    scheduleSideEffectStageRetry(room)
    throw error
  }
}
const commitRuntimeState = async () => {
  persistRuntimeState()
  await flushRuntimeState({ throwOnError: true })
}
const matchLifecycle = createWeAppMatchLifecycle({
  playerIds: ids, rooms, connections,
  turnTimeoutMs: TURN_TIMEOUT_MS,
  trusteeActionDelayMs: TRUSTEE_ACTION_DELAY_MS,
  botActionDelayMs: BOT_ACTION_DELAY_MS,
  friendSecondMs: FRIEND_SECOND_MS,
  totalMinuteMs: TOTAL_MINUTE_MS,
  testMatchEndPersistFailures: process.env.NODE_ENV === 'test' && process.env.WEAPP_TEST_FAIL_MATCH_END_PERSIST_ONCE === '1' ? 1 : 0,
  testRoundFinalizationPersistFailures: process.env.NODE_ENV === 'test' && process.env.WEAPP_TEST_FAIL_ROUND_FINALIZATION_PERSIST_ONCE === '1' ? 1 : 0,
  isShuttingDown: () => shuttingDown,
  enqueueServerOperation, ensureLiveMetadata, isFriendRoom, isMatchRoom, isBotPlayer,
  botPolicyForRoom, existingBotPolicyForRoom: room => roomBotPolicies.get(room.roomId), shuffleRandom,
  persistRuntimeState, commitRuntimeState, stagePendingSideEffects,
  broadcast, send, phaseFor, liveMetadataFor, publishTurnStatus, publishState, publishTribute, publishRoundEnded,
  recordRoomAction, reportSpectatorEvent, reportSpectatorAction, reportSpectatorRoundEnd, reportCompletedGame,
  closeRoomWithoutAck: (...args) => closeRoomWithoutAck(...args),
})
const {
  applyPlayerAction, commitPlayerAction, armMatchDuration, armTurnDeadline, clearMatchDurationTimer, clearTurnTimer,
  finalizePendingRound, markOfflineReady, prepareNextRound,
  restoreTurnDeadline, schedulePendingRoundFinalization, syncRoomFromMatchState,
} = matchLifecycle
const finalizeRemovedRoom = (room, reason = 'vote-approved', eventType = 'roomDissolved', keepAcceptedKey = null) => {
  clearDissolveTimer(room.roomId)
  clearHostExpiry(room.roomId)
  clearEmptyRoomExpiry(room.roomId)
  matchLifecycle.removeRoom(room.roomId)
  gameStartCoordinator.removeRoom(room)
  room.turnDeadlineAt = null
  room.deadlinePlayerId = null
  room.deadlineAction = null
  for (const token of [...Object.values(room.resumeTokens || {}), ...(room.friendMembers || []).map(member => member.resumeToken)]) acceptedActionStore.deleteToken(token, keepAcceptedKey)
  broadcast(room, eventType, { roomId: room.roomId, reason, version: room.version })
  const affectedConnections = [...new Set([...Object.values(room.seats), ...(room.friendMembers || []).map(member => member.connectionId)])].map(id => connections.get(id)).filter(Boolean)
  roomBotPolicies.delete(room.roomId)
  affectedConnections.forEach(syncConnectionRoomId)
  broadcastRooms()
}
const closeRoomWithoutAck = async (room, reason, eventType = 'roomDissolved', spectatorReason = reason) => {
  if (!rooms.has(room.roomId)) return
  if (reason === 'empty-timeout' && hasConnectedHuman(room)) return
  rememberClosedRoomTombstone(room)
  if (!room.closingReason) {
    room.version += 1
    room.closingReason = reason
    reportSpectatorClosed(room, spectatorReason)
    await commitRuntimeState()
  }
  stagePendingSideEffects(room)
  rooms.delete(room.roomId)
  try {
    await commitRuntimeState()
  } catch (error) {
    rooms.set(room.roomId, room)
    persistRuntimeState()
    throw error
  }
  finalizeRemovedRoom(room, reason, eventType)
}
const initializeRoomMatch = room => {
  resetRoomBotPolicy(room)
  room.roundStatsBySeat = createGameStatsBySeat()
  room.state = createRoomOpeningState(room, ruleProfileForRoom(room), shuffleRandom, isBotPlayer)
  syncRoomFromMatchState(room)
}
const ensureTicketBindings = (room) => {
  room.ticketJtisBySeat ||= { p1: null, p2: null, p3: null, p4: null }
  room.ticketExpiresAtBySeat ||= { p1: null, p2: null, p3: null, p4: null }
}
const revokePreviousSeatTicket = (room, playerId, nextJti = null) => {
  const previousJti = room.ticketJtisBySeat?.[playerId]
  const previousExp = room.ticketExpiresAtBySeat?.[playerId]
  if (!previousJti || previousJti === nextJti || !Number.isFinite(previousExp)) return
  room.revokedTicketJtis ||= []
  if (!room.revokedTicketJtis.some(item => item.jti === previousJti)) {
    room.revokedTicketJtis.push({ jti: previousJti, exp: previousExp })
  }
}
const seatHasAnotherActiveConnection = (room, playerId, connection) => {
  const connectionId = room.seats[playerId]
  return Boolean(connectionId && connectionId !== connection.id && connections.has(connectionId))
}
const gameStartCoordinator = createWeAppGameStartCoordinator({
  playerIds: ids, rooms, connections, acceptedActions,
  emptyRoomTimeoutMs: EMPTY_ROOM_TIMEOUT_MS,
  testPersistFailures: process.env.NODE_ENV === 'test' && process.env.WEAPP_TEST_FAIL_GAME_START_PERSIST_ONCE === '1' ? 1 : 0,
  isShuttingDown: () => shuttingDown,
  isFriendRoom, isMatchRoom, seatHasLiveConnection, seatIsOccupied, enqueueServerOperation,
  commitRuntimeState, persistRuntimeState, spectatorEventReporter,
  initializeRoomMatch, armMatchDuration, armTurnDeadline, closeRoomWithoutAck,
  publishRoomMembers, publishLobbyReady, publishState, rememberAccepted, send,
})
const {
  abandon: abandonUnclaimedGameStart,
  autoStartMatchedRoom,
  finalizeClaimedStart: finalizeClaimedGameStart,
  isTerminalClaimError: isTerminalGameStartClaimError,
  persistClaimedStart: persistClaimedGameStart,
  prepare: prepareGameStartClaim,
  publishPending: publishGameStartPending,
  scheduleClaim: scheduleGameStartClaim,
  scheduleEntryDeadline,
} = gameStartCoordinator
const consumeCommandBudget = connection => {
  const now = Date.now()
  if (now - connection.rateWindowStartedAt >= COMMAND_RATE_WINDOW_MS) {
    connection.rateWindowStartedAt = now
    connection.rateWindowCount = 0
  }
  connection.rateWindowCount += 1
  if (connection.rateWindowCount <= COMMAND_RATE_LIMIT) return true
  connection.rateLimitViolations += 1
  return false
}

const gameCommandDependencies = {
  ids, rooms, connections, acceptedActions,
  dissolveTimeoutMs: DISSOLVE_TIMEOUT_MS,
  playerIn, ensureLiveMetadata, ensureLobbyMetadata, isFriendRoom,
  applyPlayerAction,
  commitPlayerAction,
  syncRoomFromMatchState,
  recordRoomAction,
  reportSpectatorAction,
  armTurnDeadline,
  finalizePendingRound,
  publishState, publishRoundEnded, prepareNextRound, publishTribute,
  publishRoundReady, publishTrustees, publishTurnStatus,
  scheduleDissolveExpiry,
  publishDissolveVote,
  clearDissolveTimer,
  rememberClosedRoomTombstone,
  reportSpectatorClosed,
  commitRuntimeState,
  stagePendingSideEffects,
  persistRuntimeState,
  finalizeRemovedRoom,
  reportSpectatorEvent,
  broadcast,
  rememberAccepted,
  syncConnectionRoomId,
  deleteAcceptedActionIdentity: acceptedActionStore.deleteToken,
  markOfflineReady,
  publishRoomMembers,
  scheduleEmptyRoomExpiry,
  broadcastRooms,
  send,
}
const publishCurrentRoom = createCommandPublication({ publishRoomMembers, publishLobbyReady, publishState, publishTribute, publishRoundEnded, publishRoundReady, publishTrustees, publishTurnStatus, publishDissolveVote })
const gameCommandHandler = createGameCommandHandler(gameCommandDependencies)
const roomExit = createRoomExit({ ...gameCommandDependencies, publishCurrentRoom, enqueueServerOperation })
const lobbyCommandHandler = createLobbyCommandHandler({
  ids, rooms, connections, playerIn,
  isMatchRoom, isFriendRoom, seatIsOccupied, ensureLobbyMetadata,
  prepareGameStartClaim,
  commitRuntimeState,
  publishGameStartPending,
  spectatorEventReporter,
  persistClaimedGameStart,
  isTerminalGameStartClaimError,
  abandonUnclaimedGameStart,
  closeRoomWithoutAck,
  scheduleGameStartClaim,
  finalizeClaimedGameStart,
  initializeRoomMatch,
  reportSpectatorEvent,
  armMatchDuration,
  armTurnDeadline,
  publishState,
  deleteAcceptedActionIdentity: acceptedActionStore.deleteToken,
  publishLobbyReady,
  ensureBotMetadata,
  syncConnectionRoomId,
  send,
  publishRoomMembers,
  broadcastRooms,
})
const entryDependencies = {
  ids, rooms, acceptedActions, maxRooms: MAX_ROOMS,
  gameTicketVerifier, inspectEntryTicket, ticketBlockedByClosedRoom, normalizeEntryAttemptId,
  pendingSeatReleaseFor, actionFingerprint, sameToken, seatHasAnotherActiveConnection,
  clearEmptyRoomExpiry, restoreOfflineDissolveVote, commitRuntimeState, stagePendingSideEffects,
  send,
  publishRoomMembers,
  publishDissolveVote,
  publishState,
  scheduleEntryDeadline,
  scheduleGameStartClaim,
  entryPayloadFor,
  rememberAccepted,
  reserveAccepted: acceptedActionStore.reserve,
  releaseAccepted: acceptedActionStore.release,
  entryConflictFor,
  createRoomRecord,
  ticketMatchesRoom,
  ensureTicketBindings,
  createResumeToken,
  entryKindForClaims,
  entryDeadlineForClaims,
  revokePreviousSeatTicket,
  clearHostExpiry,
  armMatchDuration,
  armTurnDeadline,
  autoStartMatchedRoom,
  broadcastRooms,
  playerIn,
  rotateAcceptedActionIdentity,
  deleteAcceptedActionIdentity: acceptedActionStore.deleteToken,
  publishGameStartPending,
  isBotPlayer,
  seatIsOccupied,
  ensureLobbyMetadata,
}
const friendObservers = createFriendRoomObserverRuntime({ ...entryDependencies, connections })
const legacyEntryCommandHandler = createEntryCommandHandler(entryDependencies)
const entryCommandHandler = async context => { if (!await friendObservers.enter(context)) await legacyEntryCommandHandler(context) }
const commandRouter = createCommandRouter([
  { types: FRIEND_VIEW_COMMANDS, handle: friendObservers.handle },
  { types: ENTRY_COMMAND_TYPES, handle: entryCommandHandler },
  { types: LOBBY_COMMAND_TYPES, handle: lobbyCommandHandler },
  { types: GAME_COMMAND_TYPES, handle: gameCommandHandler },
  { types: EXIT_COMMAND_TYPES, handle: roomExit.handle },
])

const handleCommand = createCommandGateway({
  rooms, acceptedActions, idempotentActionTypes, actionCacheKey, actionFingerprint,
  validateCommandRequestId, validateExpectedVersion, playerIn, isFriendRoom,
  finalizePendingRound, scheduleGameStartClaim, commitRuntimeState, stagePendingSideEffects,
  publishCurrentRoom, completeRoomExit: roomExit.complete, rememberAccepted, reserveAccepted: acceptedActionStore.reserve,
  releaseAccepted: acceptedActionStore.release, listRooms, send, router: commandRouter,
})

const enqueueCommand = (connection, message) => {
  if (shuttingDown || !connection.acceptingCommands) return Promise.resolve()
  if (!consumeCommandBudget(connection)) {
    send(connection, 'error', { requestId: message?.requestId, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试', retryAfterMs: COMMAND_RATE_WINDOW_MS })
    if (connection.rateLimitViolations >= 3) {
      connection.acceptingCommands = false
      connection.dropQueuedCommands = true
      connection.socket.destroy()
    }
    return Promise.resolve()
  }
  if (connection.pendingCommands >= MAX_PENDING_COMMANDS) {
    send(connection, 'error', { requestId: message?.requestId, code: 'COMMAND_QUEUE_FULL', message: '当前连接的待处理请求过多' })
    connection.acceptingCommands = false
    connection.dropQueuedCommands = true
    connection.socket.destroy()
    return Promise.resolve()
  }
  connection.pendingCommands += 1
  const task = () => {
    if (connection.dropQueuedCommands) return undefined
    return duplicateRooms.owns(connection, message) ? duplicateRooms.handle(connection, message) : handleCommand(connection, message)
  }
  const key = operationKeyForCommand({ connection, message, rooms, entryTypes: ENTRY_COMMAND_TYPES })
  const operation = (key !== GLOBAL_OPERATION_KEY
    ? operationScheduler.enqueue(key, task, `command ${message?.type || 'unknown'}`)
    : operationScheduler.enqueueGlobal(task, `command ${message?.type || 'unknown'}`)
  ).finally(() => { connection.pendingCommands = Math.max(0, connection.pendingCommands - 1) })
  void operation.catch(error => {
    console.error('WeApp protocol command failed:', error instanceof Error ? error.message : error)
    if (!connection.socket.destroyed) send(connection, 'error', { requestId: message?.requestId, message: '服务器处理请求失败' })
  })
  return operation
}

const rejectInvalidProtocolMessage = connection => {
  if (consumeCommandBudget(connection)) send(connection, 'error', { message: '协议数据无效' })
  else if (connection.rateLimitViolations >= 3) {
    connection.acceptingCommands = false
    connection.dropQueuedCommands = true
    connection.socket.destroy()
  }
}

const handleConnectionClosed = connection => {
  connection.acceptingCommands = false
  if (connection.duplicateRoomId) { void duplicateRooms.disconnected(connection).catch(error => console.warn(error.message)); connections.delete(connection.id); return }
  if (shuttingDown) {
    connections.delete(connection.id)
    return
  }
  void enqueueServerOperation(async () => {
    const memberships = membershipsFor(connection)
    const preparedRooms = new Set()
    for (const room of memberships) {
      const playerId = playerIn(room, connection.id)
      const member = roomMember(room, connection.id)
      const wasHost = member ? member.userId === room.friendHostUserId : playerId === 'p1'
      if (member) member.connectionId = null
      if (wasHost && !room.state && !room.ticketBound) scheduleHostExpiry(room.roomId, 15000)
      if (playerId) {
        room.version += 1
        room.seats[playerId] = null
        if (room.state) {
          ensureLiveMetadata(room)
          room.trustees[playerId] = { reason: 'disconnected', since: Date.now() }
          if (room.dissolveVote?.votes[playerId] === 'pending') room.dissolveVote.votes[playerId] = 'offline'
          if (markOfflineReady(room, playerId)) preparedRooms.add(room.roomId)
          if (!room.roundResult && room.deadlinePlayerId === playerId) armTurnDeadline(room, { publish: false })
        } else if (room.ticketBound) scheduleEntryDeadline(room)
      }
    }
    connections.delete(connection.id)
    await commitRuntimeState()
    for (const room of memberships) {
      if (!rooms.has(room.roomId)) continue
      stagePendingSideEffects(room)
      publishRoomMembers(room)
      if (room.state) {
        publishTrustees(room)
        if (room.dissolveVote) publishDissolveVote(room)
        if (preparedRooms.has(room.roomId)) publishTribute(room, 'roundPrepared')
        else if (room.roundResult) publishRoundReady(room)
        scheduleEmptyRoomExpiry(room)
      }
    }
    broadcastRooms()
  }, 'WeApp disconnect cleanup')
}

const server = createServer(
  { shouldUpgradeCallback: isProtocolUpgradeRequest },
  (_, response) => { response.writeHead(404); response.end() },
)
server.on('upgrade', (request, socket) => {
  upgradeToProtocolConnection({
    request,
    socket,
    allowedOrigins: security.allowedOrigins,
    connectionCount: connections.size,
    maxConnections: MAX_CONNECTIONS,
    maxMessageBytes: MAX_MESSAGE_BYTES,
    createConnectionId: () => `w${nextConnection++}`,
    onOpen: connection => connections.set(connection.id, connection),
    onMessage: enqueueCommand,
    onInvalidMessage: rejectInvalidProtocolMessage,
    onClose: handleConnectionClosed,
  })
})

const restorePersistedRuntime = async () => {
  await restoreWeAppRuntime({
    roomStateStore, rooms, acceptedActions, closedRoomTombstones, maxAcceptedActions, playerIds: ids,
    roomFromPersistence, migrateLegacyMatchState, ensureTicketBindings, ensureLobbyMetadata, ensureLiveMetadata,
    rulePresetForRoom, ruleProfileForRoom, syncRoomFromMatchState, botPolicyForRoom, resetRoomBotPolicy,
    stagePendingSideEffects, rememberClosedRoomTombstone, removeRoomBotPolicy: roomId => roomBotPolicies.delete(roomId),
    scheduleDissolveExpiry, schedulePendingRoundFinalization, gameStartCoordinator,
    restoreTurnDeadline, armMatchDuration, scheduleEmptyRoomExpiry, scheduleHostExpiry, commitRuntimeState,
  })
}
const port = security.wsPort
const duplicateRooms = new DuplicateRoomRuntime({ connections, send, verifier: gameTicketVerifier, reporter: spectatorEventReporter,
  filePath: security.roomStateFile ? `${security.roomStateFile}.duplicate` : '', random: shuffleRandom, maxRooms: Math.min(MAX_ROOMS, 64) })
await restorePersistedRuntime()
server.listen(port, security.host, () => console.log(`Guandan WeApp WebSocket server running at ${security.host}:${port}`))

const shutdown = async signal => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Stopping Guandan WeApp server after ${signal}`)
  connections.forEach(connection => { connection.acceptingCommands = false })
  const serverClosed = new Promise(resolve => server.close(resolve))
  roomExpiry.dispose()
  friendObservers.dispose()
  roomExit.dispose()
  for (const timer of sideEffectStageRetryTimers.values()) clearTimeout(timer)
  sideEffectStageRetryTimers.clear()
  matchLifecycle.dispose()
  gameStartCoordinator.dispose()
  runtimePersistence.cancelPendingTimer()
  let failed = false
  try {
    resultReporter.stop(new Error(`server shutdown: ${signal}`))
    for (const room of rooms.values()) {
      if (room.matchId) spectatorEventReporter.stop(room.matchId, new Error(`server shutdown: ${signal}`))
    }
    await Promise.allSettled([...sideEffectCompletionHandlers.values()])
    await operationScheduler.drain()
    await duplicateRooms.dispose()
    await commitRuntimeState()
    await roomStateStore.whenIdle()
  } catch (error) {
    failed = true
    console.error('Final WeApp persistence failed:', error instanceof Error ? error.message : error)
  } finally {
    for (const connection of connections.values()) connection.socket.destroy()
    await serverClosed
    process.exitCode = failed ? 1 : 0
  }
}
process.once('SIGTERM', () => { void shutdown('SIGTERM') })
process.once('SIGINT', () => { void shutdown('SIGINT') })
